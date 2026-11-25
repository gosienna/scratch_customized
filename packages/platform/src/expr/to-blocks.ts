/** Convert an expression into stock Scratch operator blocks (sb3 JSON). */
import {
  type BlockMap,
  COLOR_PICKER_PRIMITIVE,
  type CompressedPrimitive,
  INPUT_BLOCK_NO_SHADOW,
  INPUT_DIFF_BLOCK_SHADOW,
  INPUT_SAME_BLOCK_SHADOW,
  type InputValue,
  MATH_NUM_PRIMITIVE,
  type SerializedBlock,
  type SerializedInput,
  TEXT_PRIMITIVE,
  VAR_PRIMITIVE,
} from '../sb3/types'
import type { SlotKind } from './ops'
import { type ExprScope, resolveName } from './scope'
import { NUMBER_LITERAL_RE, type ExprNode, isBooleanNode, operatorOf } from './syntax'

export class ExprTypeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExprTypeError'
  }
}

/** The input slot an expression is placed into. */
export interface Slot {
  kind: SlotKind
  /** The slot's shadow: a compressed primitive (number or text field) or a shadow block ID (e.g. a menu). */
  shadow: InputValue
}

export interface LowerContext {
  blocks: BlockMap
  scope: ExprScope
  newId: () => string
  /**
   * Place a `reporter` node (text mode only). Receives the same arguments as placeInSlot; returns the input, or
   * undefined for an empty boolean slot.
   */
  placeReporter?: (
    node: Extract<ExprNode, { kind: 'reporter' }>,
    parentId: string,
    slot: Slot,
    rootId?: string,
  ) => SerializedInput | undefined
  /** Called for a name that is not a variable or parameter; by default it is saved as 0. */
  onUnknownName?: (name: string) => void
}

const isNumberPrimitive = (type: number) => type >= 4 && type <= 8

const newBlock = (opcode: string, parent: string | null): SerializedBlock => ({
  opcode,
  next: null,
  parent,
  inputs: {},
  fields: {},
  shadow: false,
  topLevel: false,
})

/**
 * Add the operator block for `node` (and its children) to the block map; returns its ID.
 */
const buildOperator = (node: ExprNode, parentId: string | null, ctx: LowerContext, id = ctx.newId()): string => {
  const operator = operatorOf(node)
  if (!operator) throw new Error(`buildOperator: a ${node.kind} node is not an operator`)
  const { spec, args } = operator
  const block = newBlock(spec.opcode, parentId)
  if (spec.mathop) block.fields.OPERATOR = [spec.mathop, null]
  ctx.blocks[id] = block
  spec.inputs.forEach((input, i) => {
    const slot: Slot =
      input.kind === 'boolean'
        ? { kind: 'boolean', shadow: null }
        : { kind: input.kind, shadow: [input.primitive ?? MATH_NUM_PRIMITIVE, ''] }
    const arg = args[i]
    if (!arg) throw new Error(`buildOperator: ${spec.opcode} is missing input ${input.name}`)
    const placed = placeInSlot(arg, id, slot, ctx)
    // An empty boolean slot is simply absent from `inputs`, as in scratch-vm's serializer.
    if (placed) block.inputs[input.name] = placed
  })
  return id
}

const buildJoinWrapper = (text: string, parentId: string | null, ctx: LowerContext, id = ctx.newId()): string => {
  const block = newBlock('operator_join', parentId)
  block.inputs.STRING1 = [INPUT_SAME_BLOCK_SHADOW, [TEXT_PRIMITIVE, text]]
  block.inputs.STRING2 = [INPUT_SAME_BLOCK_SHADOW, [TEXT_PRIMITIVE, '']]
  ctx.blocks[id] = block
  return id
}

const buildParamReporter = (
  name: string,
  boolean: boolean,
  parentId: string | null,
  ctx: LowerContext,
  id = ctx.newId(),
) => {
  const block = newBlock(boolean ? 'argument_reporter_boolean' : 'argument_reporter_string_number', parentId)
  block.fields.VALUE = [name, null]
  ctx.blocks[id] = block
  return id
}

/**
 * Put a literal into a slot: directly into its field when the field accepts it, else via `join(text, "")`.
 */
const placeLiteral = (
  text: string,
  parentId: string,
  slot: Slot,
  ctx: LowerContext,
  rootId?: string,
): SerializedInput => {
  const shadow = slot.shadow
  if (Array.isArray(shadow)) {
    const type = shadow[0]
    // An empty field is valid in every slot (Scratch reads it as 0 or as empty text).
    const fits = type === TEXT_PRIMITIVE || (isNumberPrimitive(type) && (text === '' || NUMBER_LITERAL_RE.test(text)))
    if (fits) return [INPUT_SAME_BLOCK_SHADOW, [type, text] as CompressedPrimitive]
    if (type === COLOR_PICKER_PRIMITIVE && /^#[0-9a-fA-F]{6}$/.test(text)) {
      return [INPUT_SAME_BLOCK_SHADOW, [type, text] as CompressedPrimitive]
    }
  }
  return [INPUT_DIFF_BLOCK_SHADOW, buildJoinWrapper(text, parentId, ctx, rootId), shadow]
}

const reporterInput = (value: InputValue, slot: Slot): SerializedInput =>
  slot.shadow === null ? [INPUT_BLOCK_NO_SHADOW, value] : [INPUT_DIFF_BLOCK_SHADOW, value, slot.shadow]

/**
 * Lower `node` into the slot of block `parentId`. Returns the serialized input, or undefined for an empty
 * boolean slot. `rootId`, if given, is used as the ID of the block created for `node` itself.
 */
export const placeInSlot = (
  node: ExprNode,
  parentId: string,
  slot: Slot,
  ctx: LowerContext,
  rootId?: string,
): SerializedInput | undefined => {
  if (node.kind === 'reporter') {
    if (!ctx.placeReporter) throw new ExprTypeError(`Unknown function "${node.name}"`)
    return ctx.placeReporter(node, parentId, slot, rootId)
  }
  if (slot.kind === 'boolean') {
    if (isBooleanNode(node)) return [INPUT_BLOCK_NO_SHADOW, buildOperator(node, parentId, ctx, rootId)]
    if (node.kind === 'name') {
      const resolved = resolveName(node.name, ctx.scope)
      if (resolved.kind === 'param' && resolved.type === 'boolean') {
        return [INPUT_BLOCK_NO_SHADOW, buildParamReporter(node.name, true, parentId, ctx, rootId)]
      }
    }
    throw new ExprTypeError('This slot needs a true/false value, such as a comparison like "x > 5"')
  }
  switch (node.kind) {
    case 'number':
      return placeLiteral(node.text, parentId, slot, ctx, rootId)
    case 'string':
      return placeLiteral(node.value, parentId, slot, ctx, rootId)
    case 'name': {
      const resolved = resolveName(node.name, ctx.scope)
      if (resolved.kind === 'variable') return reporterInput([VAR_PRIMITIVE, resolved.name, resolved.id], slot)
      if (resolved.kind === 'param') {
        return reporterInput(buildParamReporter(node.name, resolved.type === 'boolean', parentId, ctx, rootId), slot)
      }
      ctx.onUnknownName?.(node.name)
      return placeLiteral('0', parentId, slot, ctx, rootId)
    }
    default:
      return reporterInput(buildOperator(node, parentId, ctx, rootId), slot)
  }
}

/**
 * Lower an expression that is not inside any input (a loose reporter on the workspace). The result is a
 * top-level block or variable reporter with ID `id` at position (x, y).
 */
export const placeTopLevel = (node: ExprNode, id: string, x: number, y: number, ctx: LowerContext): void => {
  if (node.kind === 'name') {
    const resolved = resolveName(node.name, ctx.scope)
    if (resolved.kind === 'variable') {
      ctx.blocks[id] = [VAR_PRIMITIVE, resolved.name, resolved.id, x, y]
      return
    }
    if (resolved.kind === 'param') buildParamReporter(node.name, resolved.type === 'boolean', null, ctx, id)
    else buildJoinWrapper('0', null, ctx, id)
  } else if (node.kind === 'number' || node.kind === 'string') {
    buildJoinWrapper(node.kind === 'number' ? node.text : node.value, null, ctx, id)
  } else {
    buildOperator(node, null, ctx, id)
  }
  const block = ctx.blocks[id] as SerializedBlock
  block.topLevel = true
  block.x = x
  block.y = y
}

/**
 * A generator of fresh block IDs derived from `baseId` that do not collide with existing blocks.
 */
export const idGenerator = (blocks: BlockMap, baseId: string) => {
  let counter = 0
  return () => {
    let id: string
    do id = `${baseId}-${++counter}`
    while (id in blocks)
    return id
  }
}
