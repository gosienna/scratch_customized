/**
 * The mapping between expression syntax and stock Scratch operator blocks. Lowering, raising and runtime
 * evaluation all read this table, so an expression always behaves exactly like the blocks it is saved as.
 */
import { MATH_NUM_PRIMITIVE, TEXT_PRIMITIVE, WHOLE_NUM_PRIMITIVE } from '../sb3/types'

/** What an operator input accepts: a number slot, a text slot, or a boolean (hexagonal) slot. */
export type SlotKind = 'number' | 'text' | 'boolean'

export interface InputSpec {
  name: string
  kind: SlotKind
  /** Primitive type used for the slot's shadow (number and text slots only). */
  primitive?: number
}

export interface OperatorSpec {
  opcode: string
  inputs: InputSpec[]
  /** True if the block is a boolean reporter (hexagonal). */
  boolean: boolean
  /** For operator_mathop: the OPERATOR field value. */
  mathop?: string
}

const num = (name: string, primitive = MATH_NUM_PRIMITIVE): InputSpec => ({ name, kind: 'number', primitive })
const text = (name: string): InputSpec => ({ name, kind: 'text', primitive: TEXT_PRIMITIVE })
const bool = (name: string): InputSpec => ({ name, kind: 'boolean' })

export type BinaryOperator = '+' | '-' | '*' | '/' | '%' | '<' | '>' | '=' | 'and' | 'or'

export const BINARY_OPERATORS: Record<BinaryOperator, OperatorSpec> = {
  '+': { opcode: 'operator_add', inputs: [num('NUM1'), num('NUM2')], boolean: false },
  '-': { opcode: 'operator_subtract', inputs: [num('NUM1'), num('NUM2')], boolean: false },
  '*': { opcode: 'operator_multiply', inputs: [num('NUM1'), num('NUM2')], boolean: false },
  '/': { opcode: 'operator_divide', inputs: [num('NUM1'), num('NUM2')], boolean: false },
  '%': { opcode: 'operator_mod', inputs: [num('NUM1'), num('NUM2')], boolean: false },
  '<': { opcode: 'operator_lt', inputs: [text('OPERAND1'), text('OPERAND2')], boolean: true },
  '>': { opcode: 'operator_gt', inputs: [text('OPERAND1'), text('OPERAND2')], boolean: true },
  '=': { opcode: 'operator_equals', inputs: [text('OPERAND1'), text('OPERAND2')], boolean: true },
  and: { opcode: 'operator_and', inputs: [bool('OPERAND1'), bool('OPERAND2')], boolean: true },
  or: { opcode: 'operator_or', inputs: [bool('OPERAND1'), bool('OPERAND2')], boolean: true },
}

export const NOT_OPERATOR: OperatorSpec = { opcode: 'operator_not', inputs: [bool('OPERAND')], boolean: true }

/** Binding strength of each operator; higher binds tighter. */
export const PRECEDENCE: Record<BinaryOperator | 'not', number> = {
  or: 1,
  and: 2,
  not: 3,
  '<': 4,
  '>': 4,
  '=': 4,
  '+': 5,
  '-': 5,
  '*': 6,
  '/': 6,
  '%': 6,
}

const mathop = (value: string): OperatorSpec => ({
  opcode: 'operator_mathop',
  inputs: [num('NUM')],
  boolean: false,
  mathop: value,
})

/** Function-call syntax, e.g. `sqrt(x)` or `random(1, 10)`. */
export const FUNCTIONS = {
  abs: mathop('abs'),
  floor: mathop('floor'),
  ceiling: mathop('ceiling'),
  sqrt: mathop('sqrt'),
  sin: mathop('sin'),
  cos: mathop('cos'),
  tan: mathop('tan'),
  asin: mathop('asin'),
  acos: mathop('acos'),
  atan: mathop('atan'),
  ln: mathop('ln'),
  log: mathop('log'),
  exp: mathop('e ^'),
  pow10: mathop('10 ^'),
  round: { opcode: 'operator_round', inputs: [num('NUM')], boolean: false },
  random: { opcode: 'operator_random', inputs: [num('FROM'), num('TO')], boolean: false },
  join: { opcode: 'operator_join', inputs: [text('STRING1'), text('STRING2')], boolean: false },
  length: { opcode: 'operator_length', inputs: [text('STRING')], boolean: false },
  letter: {
    opcode: 'operator_letter_of',
    inputs: [num('LETTER', WHOLE_NUM_PRIMITIVE), text('STRING')],
    boolean: false,
  },
  contains: { opcode: 'operator_contains', inputs: [text('STRING1'), text('STRING2')], boolean: true },
} satisfies Record<string, OperatorSpec>

export type FunctionName = keyof typeof FUNCTIONS

export const isFunctionName = (name: string): name is FunctionName => Object.hasOwn(FUNCTIONS, name)

/** Words that cannot be used as bare variable names (write `[name]` to refer to such a variable). */
export const RESERVED_WORDS = new Set(['and', 'or', 'not', 'mod', ...Object.keys(FUNCTIONS)])

export const OPERATOR_OPCODES = new Set([
  ...Object.values(BINARY_OPERATORS).map((spec) => spec.opcode),
  NOT_OPERATOR.opcode,
  ...Object.values(FUNCTIONS).map((spec) => spec.opcode),
])

export const binaryOperatorForOpcode = (opcode: string): BinaryOperator | undefined =>
  (Object.keys(BINARY_OPERATORS) as BinaryOperator[]).find((op) => BINARY_OPERATORS[op].opcode === opcode)

export const functionForBlock = (opcode: string, mathopValue?: string): FunctionName | undefined =>
  (Object.entries(FUNCTIONS) as [FunctionName, OperatorSpec][]).find(
    ([, spec]) => spec.opcode === opcode && (opcode !== 'operator_mathop' || spec.mathop === mathopValue),
  )?.[0]
