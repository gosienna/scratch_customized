/**
 * Compatibility with official Scratch (Levels 1 and 2 of the plan).
 *
 * Every kind of file this editor writes is checked against the UNMODIFIED official scratch-vm from npm
 * (pinned in package.json), never against this repository's fork:
 *   Level 1  the official validator (scratch-parser) accepts it; every opcode is one official Scratch knows;
 *            every block, variable, list and broadcast it refers to exists.
 *   Level 2  the official VM loads it and runs it frame by frame exactly like this editor runs the Custom-mode
 *            original.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, test } from 'vitest'
import { raiseProject } from '../../packages/platform/src/compat/raise'
import { installPrimitives } from '../../packages/platform/src/runtime/primitives'
import type { SerializedBlock, SerializedProject, SerializedTarget } from '../../packages/platform/src/sb3/types'
import { applyText } from '../../packages/platform/src/text'
import { customFeaturesProject } from '../../packages/platform/test/fixtures/custom-features'
import { createVm as createForkVm, runFrames } from '../../packages/platform/test/vm/vm-helpers'
import { outputs, savedByEditor } from './outputs'

const here = path.dirname(fileURLToPath(import.meta.url))

// The official package's own sources (its `default` export); its Node bundle needs browser-only files.
const officialRoot = path.resolve(here, 'node_modules/@scratch/scratch-vm')
const officialRequire = createRequire(path.join(officialRoot, 'package.json'))
const OfficialVM = officialRequire('./src/virtual-machine.js')
const officialParser = officialRequire('scratch-parser')

const createOfficialVm = () => {
  const vm = new OfficialVM()
  vm.runtime.currentStepTime = 1000 / 30
  let ticks = 0
  vm.runtime.sequencer.timer = { start: () => (ticks = 0), timeElapsed: () => ticks++ }
  return vm
}

let officialOpcodes: Set<string>

beforeAll(() => {
  const vm = createOfficialVm()
  officialOpcodes = new Set([...Object.keys(vm.runtime._primitives), ...Object.keys(vm.runtime._hats)])
})

const validate = (json: unknown) =>
  new Promise<void>((resolve, reject) =>
    officialParser(JSON.stringify(json), false, (error: unknown) => (error ? reject(new Error(JSON.stringify(error))) : resolve())),
  )

/** Problems official Scratch would have with a project, as readable strings (empty when there are none). */
const structuralProblems = (project: SerializedProject): string[] => {
  const problems: string[] = []
  const stage = project.targets.find((t) => t.isStage)
  const broadcasts = new Set(Object.keys(stage?.broadcasts ?? {}))
  for (const target of project.targets) {
    const where = (id: string) => `${target.name}/${id}`
    const variables = new Set([...Object.keys(target.variables), ...Object.keys(stage?.variables ?? {})])
    const lists = new Set([...Object.keys(target.lists), ...Object.keys(stage?.lists ?? {})])
    const checkPrimitive = (value: unknown, id: string) => {
      if (!Array.isArray(value)) return
      if (value[0] === 12 && !variables.has(String(value[2]))) problems.push(`${where(id)}: unknown variable ${value[1]}`)
      if (value[0] === 13 && !lists.has(String(value[2]))) problems.push(`${where(id)}: unknown list ${value[1]}`)
      if (value[0] === 11 && !broadcasts.has(String(value[2]))) problems.push(`${where(id)}: unknown broadcast ${value[1]}`)
    }
    for (const [id, block] of Object.entries(target.blocks)) {
      if (Array.isArray(block)) {
        checkPrimitive(block, id)
        continue
      }
      const b = block as SerializedBlock
      if (!b.shadow && !officialOpcodes.has(b.opcode) && b.opcode !== 'procedures_prototype') {
        problems.push(`${where(id)}: opcode ${b.opcode} is not in official Scratch`)
      }
      for (const ref of [b.parent, b.next]) {
        if (ref && !(ref in target.blocks)) problems.push(`${where(id)}: refers to missing block ${ref}`)
      }
      for (const input of Object.values(b.inputs)) {
        for (const value of input.slice(1)) {
          if (typeof value === 'string' && !(value in target.blocks)) problems.push(`${where(id)}: input refers to missing block ${value}`)
          checkPrimitive(value, id)
        }
      }
      const variable = b.fields.VARIABLE
      if (variable?.[1] && !variables.has(variable[1])) problems.push(`${where(id)}: unknown variable ${variable[0]}`)
      const list = b.fields.LIST
      if (list?.[1] && !lists.has(list[1])) problems.push(`${where(id)}: unknown list ${list[0]}`)
      const broadcast = b.fields.BROADCAST_OPTION
      if (broadcast?.[1] && !broadcasts.has(broadcast[1])) problems.push(`${where(id)}: unknown broadcast ${broadcast[0]}`)
    }
  }
  return problems
}

describe('Level 1: official validator, opcodes and references', async () => {
  test.each((await outputs()).map((output) => [output.name, output.project] as const))('%s', async (_name, project) => {
    await validate(project)
    expect(structuralProblems(project)).toEqual([])
  })
})

describe('Level 2: official VM loads and runs it the same', () => {
  const mouseDownAt = (frame: number) => frame % 17 < 6 || (frame > 60 && frame % 5 === 0)

  test('Custom-mode features run the same in official Scratch', async () => {
    const custom = customFeaturesProject()
    const fork = createForkVm()
    installPrimitives(fork)
    await fork.loadProject(JSON.parse(JSON.stringify(custom)))
    const editorRun = runFrames(fork, 120, mouseDownAt)

    const official = createOfficialVm()
    await official.loadProject(JSON.stringify(await savedByEditor(custom)))
    const officialRun = runFrames(official, 120, mouseDownAt)

    expect(editorRun[119]?.Sprite1?.x).not.toBe(0)
    for (let frame = 0; frame < 120; frame++) expect(officialRun[frame], `frame ${frame}`).toEqual(editorRun[frame])
  })

  test.each(['python', 'javascript'] as const)('a %s text edit runs the same in official Scratch', async (dialect) => {
    const saved = await savedByEditor(customFeaturesProject())
    const text =
      dialect === 'python'
        ? 'when flag_clicked:\n    count = 0\n    while True:\n        if mouse_down():\n            count += 1\n        change_x_by(count % 3)\n'
        : 'when (flagClicked) {\n  count = 0;\n  while (true) {\n    if (mouseDown()) {\n      count += 1;\n    }\n    changeXBy(count % 3);\n  }\n}\n'
    const project = applyText(saved, 'Sprite1', text, dialect)
    const fork = createForkVm()
    await fork.loadProject(JSON.parse(JSON.stringify(project)))
    const official = createOfficialVm()
    await official.loadProject(JSON.stringify(project))
    expect(runFrames(official, 60, mouseDownAt)).toEqual(runFrames(fork, 60, mouseDownAt))
  })

  test('the official VM saves it back and the editor raises the custom features again', async () => {
    const official = createOfficialVm()
    await official.loadProject(JSON.stringify(await savedByEditor(customFeaturesProject())))
    const resaved = JSON.parse(official.toJSON()) as SerializedProject
    const raised = raiseProject(resaved)
    const opcodes = (raised.targets.find((t: SerializedTarget) => t.name === 'Sprite1')?.blocks ?? {}) as Record<string, SerializedBlock>
    const used = new Set(Object.values(opcodes).map((block) => block.opcode))
    expect(used.has('sensing_mouseup')).toBe(true)
    expect(used.has('operator_expression')).toBe(true)
  })
})
