/** The tools the assistant can call, and how each one runs against the editor's VM. */
import type Anthropic from '@anthropic-ai/sdk'
import { type ConsoleCapture, consoleCapture } from './console-capture'
import { type CostumeImage, type CostumeRenderer, renderCostumeInBrowser } from './costume-image'
import { describeProject, describeScripts, findCostume, findTarget } from './project-summary'
import { DEFAULT_RUN_SECONDS, MAX_RUN_SECONDS, type RunOptions, runProject, runScript } from './run'
import type { AssistantVm } from './vm-types'

const secondsProperty = {
  type: 'number',
  description: `How long to let it run, in seconds (${DEFAULT_RUN_SECONDS} is usually enough; at most ${MAX_RUN_SECONDS}). Scripts still running then are stopped.`,
}

/** Changes the project for the assistant; given only while the learner has turned editing on. */
export interface ProjectEditor {
  /** Replace all of a sprite's scripts with Python-style text. Throws TextSyntaxError for mistakes. */
  setSpriteCode: (sprite: string, code: string) => Promise<void>
  createSprite: (name: string, costume: { name: string; svg: string }) => Promise<void>
  /** Add a costume to a sprite, or a backdrop to "Stage", and switch to it. */
  addCostume: (sprite: string, costume: { name: string; svg: string }) => Promise<void>
  /** Add a comment to a sprite's workspace, attached to a block when blockId is given. Returns the comment's id. */
  addComment: (sprite: string, comment: CommentRequest) => Promise<string>
}

export interface CommentRequest {
  text: string
  blockId: string | null
  /** Workspace position; chosen by the editor when left out. */
  x?: number
  y?: number
}

/** A place on a sprite's workspace: a block, or a point in workspace coordinates. */
export type WorkspacePlace = { blockId: string } | { x: number; y: number }

/** Moves the learner's view of the editor; it does not change the project. */
export interface EditorView {
  /** Select a sprite, or "Stage", in the editor. */
  openSprite: (sprite: string) => Promise<void>
  /** Open the sprite's code and scroll the code area to the place. Not shown when the blocks are hidden. */
  showInWorkspace: (sprite: string, place: WorkspacePlace) => Promise<{ shown: boolean; reason?: string }>
}

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] })

const svgProperty = {
  type: 'string',
  description:
    'A complete SVG document with a viewBox, for example <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">' +
    '...</svg>. No scripts, external images or fonts.',
}

/** Tools that change the project. */
export const EDIT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'set_sprite_code',
    description:
      "Replace ALL of a sprite's (or the Stage's) scripts with the given Python-style text, in the same format " +
      'get_sprite_scripts shows (several scripts separated by blank lines). Variables, lists and broadcast messages ' +
      'the code uses are created. Include every script the sprite should keep. Returns the new scripts with their ' +
      'block ids. A mistake in the text is reported with its line number and nothing is changed.',
    input_schema: {
      type: 'object',
      properties: {
        sprite: { type: 'string', description: 'Sprite name, or "Stage".' },
        code: { type: 'string', description: 'All scripts of the sprite, Python-style.' },
      },
      required: ['sprite', 'code'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'create_sprite',
    description: 'Create a new sprite with one costume drawn from SVG. It appears in the middle of the stage.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the new sprite (must not be taken).' },
        costume_name: { type: 'string', description: 'Name of its costume.' },
        svg: svgProperty,
      },
      required: ['name', 'costume_name', 'svg'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'add_costume',
    description:
      'Add a costume drawn from SVG to a sprite and switch the sprite to it, or add a backdrop when sprite is "Stage" ' +
      '(backdrops are 480x360). Check the result with get_costume_image.',
    input_schema: {
      type: 'object',
      properties: {
        sprite: { type: 'string', description: 'Sprite name, or "Stage" for a backdrop.' },
        name: { type: 'string', description: 'Name of the new costume or backdrop.' },
        svg: svgProperty,
      },
      required: ['sprite', 'name', 'svg'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'add_comment',
    description:
      "Add a comment (a yellow note) to a sprite's (or the Stage's) code. With block_id it is attached to that block; " +
      'with block_id null it sits on its own on the workspace at x, y (null x and y put it next to the scripts). ' +
      'Use block ids from get_sprite_scripts. Returns the new comment id.',
    input_schema: {
      type: 'object',
      properties: {
        sprite: { type: 'string', description: 'Sprite name, or "Stage".' },
        text: { type: 'string', description: 'The comment text. Keep it short and friendly.' },
        block_id: nullable({ type: 'string', description: 'Id of the block to attach it to, or null.' }),
        x: nullable({ type: 'number', description: 'Workspace x, or null to place it automatically.' }),
        y: nullable({ type: 'number', description: 'Workspace y, or null to place it automatically.' }),
      },
      required: ['sprite', 'text', 'block_id', 'x', 'y'],
      additionalProperties: false,
    },
    strict: true,
  },
]

/** Tools that move the learner's view of the editor without changing the project. */
export const VIEW_TOOLS: Anthropic.Tool[] = [
  {
    name: 'open_sprite',
    description: 'Select a sprite (or the Stage) in the editor, as when the learner clicks it in the sprite list.',
    input_schema: {
      type: 'object',
      properties: { sprite: { type: 'string', description: 'Sprite name, or "Stage".' } },
      required: ['sprite'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'show_in_workspace',
    description:
      "Point the learner at code: open the sprite's Code tab and scroll the code area so a block (block_id) or a " +
      'workspace point (x and y, as in "@pos") is in the middle. Give either block_id or x and y; set the others to ' +
      'null. Does not work in Text mode, where the blocks are hidden.',
    input_schema: {
      type: 'object',
      properties: {
        sprite: { type: 'string', description: 'Sprite name, or "Stage".' },
        block_id: nullable({ type: 'string', description: 'Id from get_sprite_scripts, or null.' }),
        x: nullable({ type: 'number', description: 'Workspace x, or null.' }),
        y: nullable({ type: 'number', description: 'Workspace y, or null.' }),
      },
      required: ['sprite', 'block_id', 'x', 'y'],
      additionalProperties: false,
    },
    strict: true,
  },
]

const EDIT_TOOL_NAMES = new Set(EDIT_TOOLS.map((tool) => tool.name))
const VIEW_TOOL_NAMES = new Set(VIEW_TOOLS.map((tool) => tool.name))

/** The tools to offer: the edit tools only while editing is on, the view tools only when there is a view. */
export const toolsFor = (canEdit: boolean, canView = false): Anthropic.Tool[] => [
  ...ASSISTANT_TOOLS,
  ...(canView ? VIEW_TOOLS : []),
  ...(canEdit ? EDIT_TOOLS : []),
]

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_project_overview',
    description:
      'The stage and every sprite with their current position, direction, size, costume, visibility, clone count, ' +
      'variables and lists (with values), and whether the project is running.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: 'get_sprite_scripts',
    description:
      "One sprite's (or the Stage's) scripts in Python-style text, each with the id of its top block and an outline " +
      'of its loops and if-blocks with their block ids. Use the ids with run_script.',
    input_schema: {
      type: 'object',
      properties: { sprite: { type: 'string', description: 'Sprite name exactly as shown, or "Stage".' } },
      required: ['sprite'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_costume_image',
    description:
      "A picture of one of a sprite's (or the Stage's) costumes or backdrops, so you can see what it looks like, plus " +
      'its size and rotation center. Costume names are in get_project_overview. The picture is on a white background ' +
      'scaled to between 256 and 512 pixels on its longest side; sizeOnStage is its real size.',
    input_schema: {
      type: 'object',
      properties: {
        sprite: { type: 'string', description: 'Sprite name, or "Stage" for backdrops.' },
        costume: { type: 'string', description: 'Costume or backdrop name exactly as listed.' },
      },
      required: ['sprite', 'costume'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'run_project',
    description:
      'Click the green flag and watch the project. Returns whether it finished or was stopped at the time limit, ' +
      'what sprites said or thought, which scripts started, errors, and how sprites, variables and lists changed. ' +
      "This really runs the learner's project: sprites move and variables change, as when they click the flag.",
    input_schema: {
      type: 'object',
      properties: { seconds: secondsProperty },
      required: ['seconds'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'run_script',
    description:
      'Run one script of a sprite, as when the learner clicks it, and report what happened (same report as ' +
      "run_project). block_id is the script's top block id, or the id of a block inside it (for example a loop from " +
      'the outline): the run then starts at that block and continues to the end of its stack.',
    input_schema: {
      type: 'object',
      properties: {
        sprite: { type: 'string', description: 'Sprite name, or "Stage".' },
        block_id: { type: 'string', description: 'Id from get_sprite_scripts.' },
        seconds: secondsProperty,
      },
      required: ['sprite', 'block_id', 'seconds'],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: 'get_console_logs',
    description:
      "Recent messages from the browser console (errors, warnings and logs from the editor and the project's " +
      'runtime). Errors thrown while a script ran carry the sprite and block id.',
    input_schema: {
      type: 'object',
      properties: {
        only_problems: { type: 'boolean', description: 'true for errors and warnings only.' },
        limit: { type: 'integer', description: 'How many of the latest entries (at most 100).' },
      },
      required: ['only_problems', 'limit'],
      additionalProperties: false,
    },
    strict: true,
  },
]

export interface ToolContext {
  vm: AssistantVm
  capture?: ConsoleCapture
  signal?: AbortSignal
  runOptions?: Omit<RunOptions, 'seconds' | 'signal'>
  /** Draws a costume as a picture; defaults to drawing it in the browser. */
  renderCostume?: CostumeRenderer
  /** Present only while the learner has turned editing on. */
  editor?: ProjectEditor
  /** The editor's view, when there is one to move (not in tests without a GUI). */
  view?: EditorView
}

/** What a tool call returns: text for Claude, and for some tools a picture. */
export interface ToolOutput {
  text: string
  image?: CostumeImage
}

const asString = (input: Record<string, unknown>, key: string): string => {
  const value = input[key]
  if (typeof value !== 'string') throw new Error(`"${key}" must be a string`)
  return value
}

const asNumber = (input: Record<string, unknown>, key: string): number => {
  const value = input[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`"${key}" must be a number`)
  return value
}

const optionalNumber = (input: Record<string, unknown>, key: string): number | undefined =>
  input[key] === null || input[key] === undefined ? undefined : asNumber(input, key)

const optionalString = (input: Record<string, unknown>, key: string): string | null =>
  input[key] === null || input[key] === undefined ? null : asString(input, key)

const checkBlock = (vm: AssistantVm, sprite: string, blockId: string): void => {
  if (!findTarget(vm, sprite).blocks.getBlock(blockId)) {
    throw new Error(`"${sprite}" has no block with id "${blockId}". Block ids are in get_sprite_scripts`)
  }
}

const costumeOutput = async (context: ToolContext, sprite: string, name: string): Promise<ToolOutput> => {
  const target = findTarget(context.vm, sprite)
  const costume = findCostume(target, name)
  const image = await (context.renderCostume ?? renderCostumeInBrowser)(costume)
  const details = {
    sprite,
    costume: name,
    isCurrentCostume: target.getCostumes()[target.currentCostume] === costume,
    format: costume.dataFormat === 'svg' ? 'vector' : 'bitmap',
    sizeOnStage: costume.size,
    rotationCenter: [costume.rotationCenterX, costume.rotationCenterY],
    pictureSize: [image.width, image.height],
  }
  return { text: JSON.stringify(details), image }
}

const json = (value: unknown): ToolOutput => ({ text: JSON.stringify(value) })

const runEditTool = async (
  editor: ProjectEditor,
  name: string,
  input: Record<string, unknown>,
  vm: AssistantVm,
): Promise<ToolOutput> => {
  switch (name) {
    case 'set_sprite_code': {
      const sprite = asString(input, 'sprite')
      findTarget(vm, sprite)
      await editor.setSpriteCode(sprite, asString(input, 'code'))
      return json({ changed: sprite, scripts: describeScripts(vm, sprite) })
    }
    case 'create_sprite': {
      const sprite = asString(input, 'name')
      if (vm.runtime.targets.some((target) => target.isOriginal && target.getName() === sprite)) {
        throw new Error(`There is already a sprite named "${sprite}"`)
      }
      await editor.createSprite(sprite, { name: asString(input, 'costume_name'), svg: asString(input, 'svg') })
      return json({ created: sprite, overview: describeProject(vm) })
    }
    case 'add_costume': {
      const sprite = asString(input, 'sprite')
      const target = findTarget(vm, sprite)
      const costume = asString(input, 'name')
      await editor.addCostume(sprite, { name: costume, svg: asString(input, 'svg') })
      const added = findTarget(vm, sprite).getCostumes().at(-1)
      return json({ added: added?.name ?? costume, sprite, costumes: target.getCostumes().map((c) => c.name) })
    }
    case 'add_comment': {
      const sprite = asString(input, 'sprite')
      findTarget(vm, sprite)
      const blockId = optionalString(input, 'block_id')
      if (blockId) checkBlock(vm, sprite, blockId)
      const x = optionalNumber(input, 'x')
      const y = optionalNumber(input, 'y')
      const id = await editor.addComment(sprite, {
        text: asString(input, 'text'),
        blockId,
        ...(x === undefined ? {} : { x }),
        ...(y === undefined ? {} : { y }),
      })
      return json({ added: id, sprite, attachedTo: blockId })
    }
    default:
      throw new Error(`Unknown edit tool "${name}"`)
  }
}

const runViewTool = async (
  view: EditorView,
  name: string,
  input: Record<string, unknown>,
  vm: AssistantVm,
): Promise<ToolOutput> => {
  const sprite = asString(input, 'sprite')
  findTarget(vm, sprite)
  switch (name) {
    case 'open_sprite':
      await view.openSprite(sprite)
      return json({ opened: sprite })
    case 'show_in_workspace': {
      const blockId = optionalString(input, 'block_id')
      const x = optionalNumber(input, 'x')
      const y = optionalNumber(input, 'y')
      let place: WorkspacePlace
      if (blockId && x === undefined && y === undefined) place = { blockId }
      else if (!blockId && x !== undefined && y !== undefined) place = { x, y }
      else throw new Error('Give either block_id, or both x and y (set the others to null)')
      if (blockId) checkBlock(vm, sprite, blockId)
      return json({ sprite, ...place, ...(await view.showInWorkspace(sprite, place)) })
    }
    default:
      throw new Error(`Unknown view tool "${name}"`)
  }
}

/** Run one tool call. Throws for bad input (reported to the model as an error). */
export const runTool = async (
  name: string,
  input: Record<string, unknown>,
  context: ToolContext,
): Promise<ToolOutput> => {
  const { vm } = context
  if (EDIT_TOOL_NAMES.has(name)) {
    if (!context.editor) throw new Error('Editing is turned off in Settings, so the project cannot be changed')
    return runEditTool(context.editor, name, input, vm)
  }
  if (VIEW_TOOL_NAMES.has(name)) {
    if (!context.view) throw new Error('The editor view is not available, so it cannot be moved')
    return runViewTool(context.view, name, input, vm)
  }
  const runOptions = { ...context.runOptions, capture: context.capture, signal: context.signal }
  switch (name) {
    case 'get_project_overview':
      return json(describeProject(vm))
    case 'get_sprite_scripts':
      return json(describeScripts(vm, asString(input, 'sprite')))
    case 'get_costume_image':
      return costumeOutput(context, asString(input, 'sprite'), asString(input, 'costume'))
    case 'run_project':
      return json(await runProject(vm, { ...runOptions, seconds: asNumber(input, 'seconds') }))
    case 'run_script':
      return json(
        await runScript(vm, asString(input, 'sprite'), asString(input, 'block_id'), {
          ...runOptions,
          seconds: asNumber(input, 'seconds'),
        }),
      )
    case 'get_console_logs': {
      const capture = context.capture ?? consoleCapture
      const limit = Math.min(100, Math.max(1, Math.round(asNumber(input, 'limit'))))
      const levels = input.only_problems === true ? (['error', 'warn'] as const) : undefined
      return json(capture.getLogs({ levels: levels && [...levels], limit }))
    }
    default:
      throw new Error(`Unknown tool "${name}"`)
  }
}
