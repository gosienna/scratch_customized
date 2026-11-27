/** The assistant's project descriptions, test runs, console capture, tools and conversation loop, in scratch-vm. */
import { beforeEach, describe, expect, test } from 'vitest'
import { ASSISTANT_MODELS, createAssistant, type AssistantClient } from '../../src/assistant/chat'
import { ConsoleCapture } from '../../src/assistant/console-capture'
import { describeProject, describeScripts } from '../../src/assistant/project-summary'
import { type RunClock, runProject, runScript } from '../../src/assistant/run'
import { type ProjectEditor, runTool } from '../../src/assistant/tools'
import { applyText, TextSyntaxError } from '../../src/text'
import { project, target } from '../helpers'
import { createVm, type VM } from './vm-helpers'

const CODE = `when flag_clicked:
    score = 0
    for _ in range(5):
        score += 1
    say(join("done ", score))

when this_sprite_clicked:
    while True:
        change_x_by(1)
        for _ in range(3):
            turn_right(15)

when key_pressed("space"):
    for _ in range(4):
        change_x_by(10)
    turn_right(90)
`

const costume = {
  assetId: 'cd21514d0531fdffb22204e0ec5ed84a',
  name: 'costume1',
  md5ext: 'cd21514d0531fdffb22204e0ec5ed84a.svg',
  dataFormat: 'svg',
  rotationCenterX: 0,
  rotationCenterY: 0,
}

const loadVm = async (code = CODE): Promise<VM> => {
  const vm = createVm()
  const cat = target('Cat', false, {
    costumes: [costume],
    x: 0,
    y: 0,
    size: 100,
    direction: 90,
    draggable: false,
    rotationStyle: 'all around',
    visible: true,
  })
  const json = applyText(project(cat, target('Stage', true, { costumes: [costume] })), 'Cat', code, 'python')
  await vm.loadProject(JSON.parse(JSON.stringify(json)))
  return vm
}

/** Steps the VM one frame per wait, with 30 frames to a second. */
const frameClock = (vm: VM): RunClock => {
  let time = 0
  return {
    now: () => time,
    wait: () => {
      time += 1000 / 30
      vm.runtime._step()
      return Promise.resolve()
    },
  }
}

/** The block id at the start of an outline line, `[id] repeat (3)`. */
const outlineId = (line: string): string => /\[(.+)\]/.exec(line)?.[1] ?? ''

const opcodeOf = (vm: VM, id: string) => vm.runtime.getSpriteTargetByName('Cat').blocks.getBlock(id)?.opcode

let capture: ConsoleCapture
beforeEach(() => {
  capture = new ConsoleCapture()
})

describe('project descriptions', () => {
  test('the overview lists sprites with their state and variables', async () => {
    const vm = await loadVm()
    const overview = describeProject(vm)
    expect(overview.running).toBe(false)
    expect(overview.sprites.map((sprite) => sprite.name)).toEqual(['Cat'])
    expect(overview.sprites[0]).toMatchObject({ x: 0, y: 0, direction: 90, scriptCount: 3 })
    expect(overview.sprites[0].variables.map((variable) => variable.name)).toContain('score')
    expect(overview.sprites[0].costumes).toEqual(['costume1'])
  })

  test('a costume picture comes with its details; an unknown costume names the costumes there are', async () => {
    const vm = await loadVm()
    const drawn: string[] = []
    const renderCostume = (costume: { name: string }) => {
      drawn.push(costume.name)
      return Promise.resolve({ mediaType: 'image/png' as const, data: 'AAAA', width: 10, height: 20 })
    }
    const output = await runTool('get_costume_image', { sprite: 'Cat', costume: 'costume1' }, { vm, renderCostume })
    expect(drawn).toEqual(['costume1'])
    expect(output.image).toEqual({ mediaType: 'image/png', data: 'AAAA', width: 10, height: 20 })
    expect(JSON.parse(output.text)).toMatchObject({
      costume: 'costume1',
      isCurrentCostume: true,
      format: 'vector',
      pictureSize: [10, 20],
    })
    await expect(
      runTool('get_costume_image', { sprite: 'Cat', costume: 'dog' }, { vm, renderCostume }),
    ).rejects.toThrow('"Cat" has no costume named "dog". Its costumes are: costume1')
  })

  test('scripts come with their top-block ids, text and an outline of loops with real block ids', async () => {
    const vm = await loadVm()
    const scripts = describeScripts(vm, 'Cat')
    expect(scripts).toHaveLength(3)
    expect(scripts.map((script) => opcodeOf(vm, script.id))).toEqual([
      'event_whenflagclicked',
      'event_whenthisspriteclicked',
      'event_whenkeypressed',
    ])
    expect(scripts[0].code).toContain('for _ in range(5):')
    const outline = scripts[1].outline
    expect(outline).toHaveLength(2)
    expect(outline[0]).toMatch(/^\[.+\] forever$/)
    expect(outline[1]).toMatch(/^ {2}\[.+\] repeat \(3\)$/)
    for (const line of outline) expect(opcodeOf(vm, outlineId(line))).toMatch(/^control_/)
  })

  test('an unknown sprite is an error naming the sprites', async () => {
    const vm = await loadVm()
    await expect(runTool('get_sprite_scripts', { sprite: 'Dog' }, { vm, capture })).rejects.toThrow(
      'There is no sprite named "Dog". The sprites are: Stage, Cat',
    )
  })
})

describe('test runs', () => {
  test('running the project reports what was said and what changed, and finishes', async () => {
    const vm = await loadVm()
    const report = await runProject(vm, { seconds: 3, capture, clock: frameClock(vm) })
    expect(report.finished).toBe(true)
    expect(report.said).toEqual([{ sprite: 'Cat', kind: 'say', text: 'done 5' }])
    expect(report.scriptsStarted).toEqual([expect.objectContaining({ sprite: 'Cat', hat: 'event_whenflagclicked' })])
    expect(report.changes).toContainEqual({ target: 'Cat', what: 'variable score', before: 0, after: 5 })
  })

  test('a forever loop is stopped at the time limit', async () => {
    const vm = await loadVm()
    const [, clicked] = describeScripts(vm, 'Cat')
    const report = await runScript(vm, 'Cat', clicked.id, { seconds: 1, capture, clock: frameClock(vm) })
    expect(report.finished).toBe(false)
    expect(report.stoppedBy).toBe('time limit')
    expect(report.seconds).toBe(1)
    expect(report.changes.find((change) => change.what === 'x')?.after).toBeGreaterThan(20)
    expect(vm.runtime.threads.filter((thread: { isKilled: boolean }) => !thread.isKilled)).toHaveLength(0)
  })

  test('a loop inside a script runs from that block to the end of its stack', async () => {
    const vm = await loadVm()
    const [, , keyScript] = describeScripts(vm, 'Cat')
    const loopId = outlineId(keyScript.outline[0])
    const report = await runScript(vm, 'Cat', loopId, { seconds: 3, capture, clock: frameClock(vm) })
    expect(report.finished).toBe(true)
    expect(report.changes).toContainEqual({ target: 'Cat', what: 'x', before: 0, after: 40 })
    expect(report.changes).toContainEqual({ target: 'Cat', what: 'direction', before: 90, after: 180 })
  })

  test('a block that throws is reported with its sprite and block id', async () => {
    const vm = await loadVm()
    capture.setVm(vm)
    vm.addPrimitives({
      motion_turnright: () => {
        throw new Error('turning is broken')
      },
    })
    const [, , keyScript] = describeScripts(vm, 'Cat')
    const report = await runScript(vm, 'Cat', keyScript.id, { seconds: 0.5, capture, clock: frameClock(vm) })
    expect(report.finished).toBe(false)
    expect(report.errors).toHaveLength(1)
    const [error] = report.errors
    expect(error.text).toContain('turning is broken')
    expect(error.sprite).toBe('Cat')
    expect(opcodeOf(vm, String(error.blockId))).toBe('motion_turnright')
    expect(error.count).toBeGreaterThan(1)
  })

  test('a missing block id is an error', async () => {
    const vm = await loadVm()
    await expect(
      runTool('run_script', { sprite: 'Cat', block_id: 'nope', seconds: 1 }, { vm, capture }),
    ).rejects.toThrow('Sprite "Cat" has no block with id "nope"')
  })
})

describe('console capture', () => {
  test('keeps console output and uncaught errors, newest last, filtered by level', () => {
    const listeners: Record<string, (event: unknown) => void> = {}
    const printed: unknown[][] = []
    const fakeWindow = {
      console: {
        error: (...args: unknown[]) => printed.push(args),
        warn: (...args: unknown[]) => printed.push(args),
        log: (...args: unknown[]) => printed.push(args),
      },
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners[type] = listener
      },
    } as unknown as Window & typeof globalThis
    capture.install(fakeWindow)
    fakeWindow.console.log('hello', { a: 1 })
    fakeWindow.console.warn('careful')
    listeners.error({ error: new Error('oops'), message: 'oops' })
    expect(printed).toEqual([['hello', { a: 1 }], ['careful']])
    expect(capture.getLogs().map((entry) => [entry.level, entry.text.split('\n')[0]])).toEqual([
      ['log', 'hello {"a":1}'],
      ['warn', 'careful'],
      ['error', 'Error: oops'],
    ])
    expect(capture.getLogs({ levels: ['error'] })).toHaveLength(1)
    expect(capture.getLogs({ limit: 1 })[0].level).toBe('error')
  })
})

describe('conversation', () => {
  /** A client that answers with the given messages in turn and records each request. */
  const scriptedClient = (replies: object[]) => {
    const requests: { messages: unknown[] }[] = []
    const client: AssistantClient = {
      beta: {
        messages: {
          stream: (params) => {
            requests.push(JSON.parse(JSON.stringify(params)))
            const reply = replies.shift() as { content: { type: string; text?: string }[] }
            return {
              on: (_event, listener) => {
                for (const block of reply.content) if (block.type === 'text') listener(block.text ?? '')
              },
              finalMessage: () => Promise.resolve(reply as never),
            }
          },
        },
      },
    }
    return { client, requests }
  }

  test('runs the tools Claude asks for and sends all results back in one message', async () => {
    const vm = await loadVm()
    const { client, requests } = scriptedClient([
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'text', text: 'Let me look. ' },
          { type: 'tool_use', id: 't1', name: 'get_project_overview', input: {} },
          { type: 'tool_use', id: 't2', name: 'get_sprite_scripts', input: { sprite: 'Dog' } },
        ],
      },
      {
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 't3', name: 'get_costume_image', input: { sprite: 'Cat', costume: 'costume1' } },
        ],
      },
      { stop_reason: 'end_turn', content: [{ type: 'text', text: 'There is no Dog sprite.' }] },
    ])
    const renderCostume = () =>
      Promise.resolve({ mediaType: 'image/png' as const, data: 'AAAA', width: 1, height: 1 })
    const assistant = createAssistant({ vm, client, capture, renderCostume })
    const texts: string[] = []
    const tools: string[] = []
    const result = await assistant.send('Why does my dog not move?', {
      onText: (delta) => texts.push(delta),
      onToolEnd: (call, outcome) => tools.push(`${call.name}:${outcome.ok}`),
    })
    expect(result).toEqual({})
    expect(texts.join('')).toBe('Let me look. There is no Dog sprite.')
    expect(tools).toEqual(['get_project_overview:true', 'get_sprite_scripts:false', 'get_costume_image:true'])
    expect(requests).toHaveLength(3)
    const third = requests[2].messages as { content: { type: string; content?: { type: string }[] }[] }[]
    expect(third[4].content[0].content?.map((block) => block.type)).toEqual(['text', 'image'])
    const second = requests[1].messages as { role: string; content: { type: string; is_error?: boolean }[] }[]
    expect(second.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(second[2].content.map((block) => [block.type, block.is_error ?? false])).toEqual([
      ['tool_result', false],
      ['tool_result', true],
    ])
    expect(JSON.stringify(second[0].content[0])).toContain('Editing: off')
    const toolNames = (requests[0] as unknown as { tools: { name: string }[] }).tools.map((tool) => tool.name)
    expect(toolNames).not.toContain('set_sprite_code')
  })
})

/** A client that ends every reply at once and records each request. */
const recordingClient = (requests: unknown[]): AssistantClient => ({
  beta: {
    messages: {
      stream: (params) => {
        requests.push(JSON.parse(JSON.stringify(params)))
        return {
          on: () => undefined,
          finalMessage: () => Promise.resolve({ stop_reason: 'end_turn', content: [] } as never),
        }
      },
    },
  },
})

describe('model choice', () => {
  test('each message uses the chosen model; Sonnet and Opus ask for server-side fallbacks, Haiku does not', async () => {
    const vm = await loadVm()
    const requests: { model: string; betas?: string[]; fallbacks?: string }[] = []
    let model: string = ASSISTANT_MODELS.haiku
    const assistant = createAssistant({ vm, client: recordingClient(requests), capture, model: () => model })
    await assistant.send('one')
    model = ASSISTANT_MODELS.sonnet
    await assistant.send('two')
    model = ASSISTANT_MODELS.opus
    await assistant.send('three')
    expect(requests.map((request) => [request.model, request.betas, request.fallbacks])).toEqual([
      ['claude-haiku-5-5', undefined, undefined],
      ['claude-sonnet-5-5', ['server-side-fallback-2026-07-01'], 'default'],
      ['claude-opus-5-5', ['server-side-fallback-2026-07-01'], 'default'],
    ])
  })
})

describe('editing', () => {
  /** An editor like the GUI's, without a renderer: code goes through applyText and a project reload. */
  const codeEditor = (vm: VM): ProjectEditor & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      setSpriteCode: async (sprite, code) => {
        const json = applyText(JSON.parse(vm.toJSON()), sprite, code, 'python')
        await vm.loadProject(json)
      },
      createSprite: (name, costume) => {
        calls.push(`create ${name} ${costume.name}`)
        return Promise.resolve()
      },
      addCostume: (sprite, costume) => {
        calls.push(`costume ${sprite} ${costume.name}`)
        return Promise.resolve()
      },
    }
  }

  test('edit tools are refused while editing is off', async () => {
    const vm = await loadVm()
    await expect(runTool('set_sprite_code', { sprite: 'Cat', code: '' }, { vm })).rejects.toThrow(
      'Editing is turned off in Settings',
    )
    await expect(
      runTool('create_sprite', { name: 'Dog', costume_name: 'dog', svg: '<svg/>' }, { vm }),
    ).rejects.toThrow('Editing is turned off in Settings')
  })

  test('set_sprite_code replaces the scripts and returns them with their new ids', async () => {
    const vm = await loadVm()
    const editor = codeEditor(vm)
    const output = await runTool(
      'set_sprite_code',
      { sprite: 'Cat', code: 'when flag_clicked:\n    lives = 3\n    say("Go!")\n' },
      { vm, editor },
    )
    const result = JSON.parse(output.text) as { changed: string; scripts: { id: string; code: string }[] }
    expect(result.changed).toBe('Cat')
    expect(result.scripts).toHaveLength(1)
    expect(result.scripts[0].code).toContain('say("Go!")')
    expect(opcodeOf(vm, result.scripts[0].id)).toBe('event_whenflagclicked')
    expect(describeProject(vm).sprites[0].variables.map((variable) => variable.name)).toContain('lives')
  })

  test('a mistake in the code is reported with its line and changes nothing', async () => {
    const vm = await loadVm()
    const before = vm.toJSON()
    await expect(
      runTool(
        'set_sprite_code',
        { sprite: 'Cat', code: 'when flag_clicked:\n    fly(3)\n' },
        { vm, editor: codeEditor(vm) },
      ),
    ).rejects.toThrow(TextSyntaxError)
    expect(vm.toJSON()).toBe(before)
  })

  test('sprites and costumes go to the editor; a taken sprite name is refused', async () => {
    const vm = await loadVm()
    const editor = codeEditor(vm)
    await runTool('create_sprite', { name: 'Ball', costume_name: 'ball', svg: '<svg/>' }, { vm, editor })
    await runTool('add_costume', { sprite: 'Stage', name: 'sky', svg: '<svg/>' }, { vm, editor })
    expect(editor.calls).toEqual(['create Ball ball', 'costume Stage sky'])
    await expect(
      runTool('create_sprite', { name: 'Cat', costume_name: 'x', svg: '<svg/>' }, { vm, editor }),
    ).rejects.toThrow('There is already a sprite named "Cat"')
    await expect(runTool('add_costume', { sprite: 'Dog', name: 'x', svg: '<svg/>' }, { vm, editor })).rejects.toThrow(
      'There is no sprite named "Dog"',
    )
  })

  test('the edit tools and "Editing: on" are sent only while an editor is given', async () => {
    const vm = await loadVm()
    const requests: { tools: { name: string }[]; messages: { content: { text?: string }[] }[] }[] = []
    let canEdit = true
    const client = recordingClient(requests)
    const editor = codeEditor(vm)
    const assistant = createAssistant({ vm, client, capture, editor: () => (canEdit ? editor : undefined) })
    await assistant.send('Make the cat jump')
    canEdit = false
    await assistant.send('Never mind')
    const names = requests.map((request) => request.tools.map((tool) => tool.name))
    expect(names[0]).toEqual(expect.arrayContaining(['set_sprite_code', 'create_sprite', 'add_costume']))
    expect(names[1]).not.toContain('set_sprite_code')
    expect(requests[0].messages[0].content[0].text).toContain('Editing: on')
    expect(requests[1].messages[2].content[0].text).toContain('Editing: off')
  })
})
