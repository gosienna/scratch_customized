/**
 * Raising: recognize stock block patterns that Custom mode shows as its own blocks. Runs when a project or
 * sprite is loaded in Custom mode. Every rewrite here is undone exactly by lowering, so a file that is opened
 * and saved again in Custom mode keeps the same program.
 */
import { nodeFromBlock, operatorCount } from '../expr/from-blocks'
import { OPERATOR_OPCODES } from '../expr/ops'
import { isBooleanNode, printExpression } from '../expr/syntax'
import { indexVariables, scopeForBlock, type VariableIndex } from '../sb3/scope'
import {
  type BlockMap,
  deleteBlockTree,
  getBlock,
  INPUT_BLOCK_NO_SHADOW,
  inputNameHolding,
  isBlock,
  isProject,
  type SerializedBlock,
  type SerializedJson,
  type SerializedTarget,
  targetsOf,
} from '../sb3/types'
import { copyForRewrite, type TransformContext } from './lower'
import { CONDITION_OPCODE, EXPRESSION_FIELD, EXPRESSION_OPCODE, MOUSE_UP_OPCODE } from './opcodes'

export interface RaiseOptions {
  /** Show operator block trees as typed expressions. Default true. */
  expressions?: boolean
  /** Only trees with at least this many operator blocks become expressions. Default 2. */
  minOperators?: number
}

const detachCommentsOfDeleted = (target: SerializedTarget, before: Set<string>) => {
  for (const comment of Object.values(target.comments ?? {})) {
    if (comment.blockId && before.has(comment.blockId) && !(comment.blockId in target.blocks)) comment.blockId = null
  }
}

const raiseMouseUp = (blocks: BlockMap) => {
  for (const [id, block] of Object.entries(blocks)) {
    if (!isBlock(block) || block.opcode !== 'operator_not') continue
    const operand = block.inputs.OPERAND
    const mouseDownId = operand?.[0] === INPUT_BLOCK_NO_SHADOW ? operand[1] : null
    const mouseDown = getBlock(blocks, mouseDownId)
    if (typeof mouseDownId !== 'string' || mouseDown?.opcode !== 'sensing_mousedown' || mouseDown.parent !== id)
      continue
    delete blocks[mouseDownId]
    block.opcode = MOUSE_UP_OPCODE
    block.inputs = {}
    block.fields = {}
  }
}

const isOperatorBlock = (block: SerializedBlock | undefined): block is SerializedBlock =>
  Boolean(block && !block.shadow && OPERATOR_OPCODES.has(block.opcode))

const tryRaiseTree = (
  target: SerializedTarget,
  stageVariables: VariableIndex,
  id: string,
  minOperators: number,
): void => {
  const blocks = target.blocks
  const block = getBlock(blocks, id)
  if (!isOperatorBlock(block)) return
  const scope = scopeForBlock(target, stageVariables, id)
  const node = nodeFromBlock(block, blocks, scope)
  const text = node && operatorCount(node) >= minOperators ? printExpression(node) : undefined
  if (node && text !== undefined) {
    const parent = getBlock(blocks, block.parent)
    const inBooleanSlot = parent
      ? parent.inputs[inputNameHolding(parent, id) ?? '']?.[0] === INPUT_BLOCK_NO_SHADOW
      : false
    const opcode = isBooleanNode(node) && (inBooleanSlot || !parent) ? CONDITION_OPCODE : EXPRESSION_OPCODE
    for (const input of Object.values(block.inputs)) {
      for (const value of input.slice(1)) if (typeof value === 'string') deleteBlockTree(blocks, value)
    }
    const raised: SerializedBlock = {
      opcode,
      next: null,
      parent: block.parent,
      inputs: {},
      fields: { [EXPRESSION_FIELD]: [text, null] },
      shadow: false,
      topLevel: block.topLevel,
    }
    if (block.topLevel) {
      raised.x = block.x
      raised.y = block.y
    }
    if (block.comment) raised.comment = block.comment
    blocks[id] = raised
    return
  }
  // The whole tree has no expression form; parts of it may.
  for (const input of Object.values(block.inputs)) {
    const childId = input[1]
    if (typeof childId === 'string' && isOperatorBlock(getBlock(blocks, childId))) {
      tryRaiseTree(target, stageVariables, childId, minOperators)
    }
  }
}

const raiseExpressions = (target: SerializedTarget, stageVariables: VariableIndex, minOperators: number) => {
  const blocks = target.blocks
  const roots = Object.keys(blocks).filter((id) => {
    const block = getBlock(blocks, id)
    return isOperatorBlock(block) && !isOperatorBlock(getBlock(blocks, block.parent))
  })
  for (const id of roots) tryRaiseTree(target, stageVariables, id, minOperators)
}

/**
 * Return a copy of `json` with recognizable stock patterns replaced by Custom-mode blocks.
 */
export const raiseProject = <T extends SerializedJson>(
  json: T,
  options: RaiseOptions = {},
  context: TransformContext = {},
): T => {
  const copy = copyForRewrite(json)
  const stageVariables = isProject(copy)
    ? indexVariables(copy.targets.find((target) => target.isStage)?.variables)
    : (context.stageVariables ?? new Map<string, string>())
  for (const target of targetsOf(copy)) {
    const before = new Set(Object.keys(target.blocks))
    raiseMouseUp(target.blocks)
    if (options.expressions ?? true) raiseExpressions(target, stageVariables, options.minOperators ?? 2)
    detachCommentsOfDeleted(target, before)
  }
  return copy
}
