/** Read a tree of stock Scratch operator blocks (sb3 JSON) as an expression. */
import {
  type BlockMap,
  getBlock,
  type SerializedBlock,
  type SerializedInput,
  TEXT_PRIMITIVE,
  VAR_PRIMITIVE,
} from '../sb3/types'
import {
  binaryOperatorForOpcode,
  BINARY_OPERATORS,
  FUNCTIONS,
  functionForBlock,
  NOT_OPERATOR,
  type OperatorSpec,
} from './ops'
import { type ExprScope, nameForVariable, resolveName } from './scope'
import { NUMBER_LITERAL_RE, type ExprNode, formatName } from './syntax'

const isNumberPrimitive = (type: number) => type >= 4 && type <= 8

const nodeFromInput = (input: SerializedInput | undefined, blocks: BlockMap, scope: ExprScope): ExprNode | null => {
  if (!input) return null
  const value = input[1]
  if (Array.isArray(value)) {
    const [type, text, id] = value
    if (type === VAR_PRIMITIVE) {
      const name = nameForVariable(String(text), String(id), scope)
      return name !== undefined && formatName(name) !== undefined ? { kind: 'name', name } : null
    }
    const literal = String(text)
    if (isNumberPrimitive(type)) return NUMBER_LITERAL_RE.test(literal) ? { kind: 'number', text: literal } : null
    if (type === TEXT_PRIMITIVE) {
      return NUMBER_LITERAL_RE.test(literal) ? { kind: 'number', text: literal } : { kind: 'string', value: literal }
    }
    return null
  }
  const block = getBlock(blocks, value)
  if (!block) return null
  if (block.opcode === 'argument_reporter_string_number' || block.opcode === 'argument_reporter_boolean') {
    const name = String(block.fields.VALUE?.[0] ?? '')
    const resolved = resolveName(name, scope)
    const expectedType = block.opcode === 'argument_reporter_boolean' ? 'boolean' : 'number'
    if (resolved.kind !== 'param' || resolved.type !== expectedType || formatName(name) === undefined) return null
    return { kind: 'name', name }
  }
  return nodeFromBlock(block, blocks, scope)
}

const childrenOf = (block: SerializedBlock, spec: OperatorSpec, blocks: BlockMap, scope: ExprScope) => {
  const children: ExprNode[] = []
  for (const input of spec.inputs) {
    const child = nodeFromInput(block.inputs[input.name], blocks, scope)
    if (!child) return null
    children.push(child)
  }
  return children
}

/**
 * Convert an operator block tree to an expression, or return null if some part has no expression syntax.
 */
export const nodeFromBlock = (block: SerializedBlock, blocks: BlockMap, scope: ExprScope): ExprNode | null => {
  const op = binaryOperatorForOpcode(block.opcode)
  if (op) {
    const [left, right] = childrenOf(block, BINARY_OPERATORS[op], blocks, scope) ?? []
    return left && right ? { kind: 'binary', op, left, right } : null
  }
  if (block.opcode === NOT_OPERATOR.opcode) {
    const [operand] = childrenOf(block, NOT_OPERATOR, blocks, scope) ?? []
    return operand ? { kind: 'not', operand } : null
  }
  const fn = functionForBlock(block.opcode, block.fields.OPERATOR?.[0])
  if (fn) {
    const children = childrenOf(block, FUNCTIONS[fn], blocks, scope)
    return children && { kind: 'call', fn, args: children }
  }
  return null
}

/**
 * Number of operator blocks the expression stands for.
 */
export const operatorCount = (node: ExprNode): number => {
  if (node.kind === 'binary') return 1 + operatorCount(node.left) + operatorCount(node.right)
  if (node.kind === 'not') return 1 + operatorCount(node.operand)
  if (node.kind === 'call') return 1 + node.args.reduce((sum, arg) => sum + operatorCount(arg), 0)
  return 0
}
