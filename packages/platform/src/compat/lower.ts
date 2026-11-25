/**
 * Lowering: rewrite editor-only blocks as stock Scratch blocks so the saved file opens unchanged in official
 * Scratch. Runs on every save (scratch-vm `toJSON`).
 */
import { parseExpression, type ExprNode, isBooleanNode } from '../expr/syntax'
import { idGenerator, type LowerContext, placeInSlot, placeTopLevel, type Slot } from '../expr/to-blocks'
import { indexVariables, scopeForBlock, type VariableIndex } from '../sb3/scope'
import {
  type BlockMap,
  getBlock,
  INPUT_BLOCK_NO_SHADOW,
  inputNameHolding,
  inputShadow,
  isBlock,
  isProject,
  type SerializedJson,
  type SerializedTarget,
  targetsOf,
} from '../sb3/types'
import {
  CONDITION_OPCODE,
  CUSTOM_OPCODES,
  EXPRESSION_FIELD,
  EXPRESSION_OPCODE,
  MOUSE_UP_OPCODE,
  OFFICIAL_EXTENSION_IDS,
} from './opcodes'

export interface TransformContext {
  /** Stage variables, needed when the JSON is a single sprite (the stage is not part of it). */
  stageVariables?: VariableIndex
}

export class CompatibilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompatibilityError'
  }
}

const stageVariablesFor = (json: SerializedJson, context: TransformContext): VariableIndex => {
  if (isProject(json)) return indexVariables(json.targets.find((target) => target.isStage)?.variables)
  return context.stageVariables ?? new Map<string, string>()
}

/**
 * Parse the expression of a block, or return undefined if it is not valid.
 */
const tryParse = (source: string): ExprNode | undefined => {
  try {
    return parseExpression(source)
  } catch {
    return undefined
  }
}

/**
 * The tree an expression/condition block stands for. An invalid expression behaves as its own source text;
 * a condition that is invalid or not true/false behaves as `false`. The runtime evaluator follows the same rules.
 */
export const effectiveExpression = (opcode: string, source: string): ExprNode | 'false' => {
  const ast = tryParse(source)
  if (opcode === CONDITION_OPCODE) return ast && isBooleanNode(ast) ? ast : 'false'
  return ast ?? { kind: 'string', value: source }
}

/**
 * When a block is removed, comments attached to it become workspace comments.
 */
const detachComments = (target: SerializedTarget, blockId: string) => {
  for (const comment of Object.values(target.comments ?? {})) {
    if (comment.blockId === blockId) comment.blockId = null
  }
}

const lowerExpressionBlock = (target: SerializedTarget, stageVariables: VariableIndex, id: string) => {
  const blocks = target.blocks
  const block = getBlock(blocks, id)
  if (!block) return
  const source = String(block.fields[EXPRESSION_FIELD]?.[0] ?? '')
  const node = effectiveExpression(block.opcode, source)
  const ctx: LowerContext = {
    blocks,
    scope: scopeForBlock(target, stageVariables, id),
    newId: idGenerator(blocks, id),
  }
  const commentId = block.comment

  delete blocks[id]
  const parentId = block.parent
  const parent = getBlock(blocks, parentId)
  if (!parent || parentId === null || block.topLevel) {
    placeTopLevel(node === 'false' ? { kind: 'string', value: source } : node, id, block.x ?? 0, block.y ?? 0, ctx)
  } else {
    const inputName = inputNameHolding(parent, id)
    if (!inputName) throw new CompatibilityError(`Block ${id} is not connected to its parent ${parentId}`)
    const input = parent.inputs[inputName]
    if (!input) throw new CompatibilityError(`Block ${id} is not connected to its parent ${parentId}`)
    const slot: Slot =
      input[0] === INPUT_BLOCK_NO_SHADOW
        ? { kind: 'boolean', shadow: null }
        : { kind: 'text', shadow: inputShadow(input) }
    if (node === 'false' && slot.kind === 'boolean') {
      // An empty boolean slot reads as false.
      delete parent.inputs[inputName]
    } else {
      const placed = placeInSlot(
        node === 'false' ? { kind: 'string', value: 'false' } : node,
        parentId,
        slot,
        ctx,
        id,
      )
      if (placed) parent.inputs[inputName] = placed
    }
  }

  const replacement = blocks[id]
  if (commentId) {
    if (isBlock(replacement)) replacement.comment = commentId
    else detachComments(target, id)
  }
}

const lowerMouseUpBlock = (blocks: BlockMap, id: string) => {
  const block = getBlock(blocks, id)
  if (!block) return
  const mouseDownId = idGenerator(blocks, id)()
  block.opcode = 'operator_not'
  block.inputs = { OPERAND: [INPUT_BLOCK_NO_SHADOW, mouseDownId] }
  block.fields = {}
  blocks[mouseDownId] = {
    opcode: 'sensing_mousedown',
    next: null,
    parent: id,
    inputs: {},
    fields: {},
    shadow: false,
    topLevel: false,
  }
}

/**
 * Throw if the JSON contains anything official Scratch could not load.
 */
export const assertStockProject = (json: SerializedJson): void => {
  for (const target of targetsOf(json)) {
    for (const [id, block] of Object.entries(target.blocks)) {
      if (isBlock(block) && CUSTOM_OPCODES.has(block.opcode)) {
        throw new CompatibilityError(`"${target.name}" still contains the editor-only block ${block.opcode} (${id})`)
      }
    }
  }
  if (isProject(json)) {
    const unknown = json.extensions.filter((extensionId) => !OFFICIAL_EXTENSION_IDS.has(extensionId))
    if (unknown.length)
      throw new CompatibilityError(`Unsupported extensions for official Scratch: ${unknown.join(', ')}`)
  }
}

/** Return a copy of `json` with every editor-only block replaced by stock blocks. */
/**
 * Copy the parts of sb3 JSON that lowering and raising rewrite (blocks and comments, which are plain JSON).
 * The rest is shared with the input: scratch-vm's serializer output is not always structured-cloneable.
 */
export const copyForRewrite = <T extends SerializedJson>(json: T): T => {
  const copyTarget = (target: SerializedTarget): SerializedTarget => ({
    ...target,
    blocks: JSON.parse(JSON.stringify(target.blocks)) as BlockMap,
    comments: JSON.parse(JSON.stringify(target.comments ?? {})) as NonNullable<SerializedTarget['comments']>,
  })
  return (isProject(json) ? { ...json, targets: json.targets.map(copyTarget) } : copyTarget(json)) as T
}

export const lowerProject = <T extends SerializedJson>(json: T, context: TransformContext = {}): T => {
  const copy = copyForRewrite(json)
  const stageVariables = stageVariablesFor(copy, context)
  for (const target of targetsOf(copy)) {
    const blocks = target.blocks
    const ids = Object.keys(blocks)
    for (const id of ids) {
      const block = blocks[id]
      if (isBlock(block) && (block.opcode === EXPRESSION_OPCODE || block.opcode === CONDITION_OPCODE)) {
        lowerExpressionBlock(target, stageVariables, id)
      }
    }
    for (const id of ids) {
      const block = blocks[id]
      if (isBlock(block) && block.opcode === MOUSE_UP_OPCODE) lowerMouseUpBlock(blocks, id)
    }
  }
  assertStockProject(copy)
  return copy
}
