/**
 * Tokenizer, parser and printer for typed expressions such as `(var1 + var2) / 2`.
 *
 * Grammar, from loosest to tightest binding:
 *   or  →  and  →  not  →  comparison (< > = != <= >=)  →  + -  →  * / % mod  →  unary -  →  atom
 * Atoms are numbers, quoted strings, names, `[names with spaces]`, function calls and parenthesized expressions.
 * `!=`, `<=` and `>=` are written as `not (...)` in blocks, because Scratch has no such operators.
 */
import {
  BINARY_OPERATORS,
  type BinaryOperator,
  FUNCTIONS,
  type FunctionName,
  isFunctionName,
  NOT_OPERATOR,
  type OperatorSpec,
  PRECEDENCE,
  RESERVED_WORDS,
} from './ops'

export type ExprNode =
  | { kind: 'number'; text: string }
  | { kind: 'string'; value: string }
  | { kind: 'name'; name: string }
  | { kind: 'binary'; op: BinaryOperator; left: ExprNode; right: ExprNode }
  | { kind: 'not'; operand: ExprNode }
  | { kind: 'call'; fn: FunctionName; args: ExprNode[] }

export class ExprSyntaxError extends Error {
  readonly position: number

  constructor(message: string, position: number) {
    super(message)
    this.name = 'ExprSyntaxError'
    this.position = position
  }
}

type TokenType = 'number' | 'string' | 'name' | 'op' | 'eof'

interface Token {
  type: TokenType
  text: string
  position: number
}

const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/
const NAME_RE = /^[\p{L}_][\p{L}\p{N}_]*/u
const OPERATOR_RE = /^(?:==|!=|<=|>=|&&|\|\||[+\-*/%()<>=,!≠≤≥])/

/** A number literal exactly as Scratch's number fields accept it. */
export const NUMBER_LITERAL_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

const OPERATOR_ALIASES: Record<string, string> = {
  '==': '=',
  '&&': 'and',
  '||': 'or',
  '!': 'not',
  '≠': '!=',
  '≤': '<=',
  '≥': '>=',
}

const tokenize = (source: string): Token[] => {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const rest = source.slice(i)
    const space = /^\s+/.exec(rest)
    if (space) {
      i += space[0].length
      continue
    }
    const numberMatch = NUMBER_RE.exec(rest)
    if (numberMatch) {
      tokens.push({ type: 'number', text: numberMatch[0], position: i })
      i += numberMatch[0].length
      continue
    }
    if (rest.startsWith('"') || rest.startsWith("'")) {
      const quote = rest[0]
      let value = ''
      let j = 1
      for (; j < rest.length && rest[j] !== quote; j++) {
        if (rest[j] === '\\' && j + 1 < rest.length) j++
        value += rest[j]
      }
      if (j >= rest.length) throw new ExprSyntaxError('Missing closing quote', i)
      tokens.push({ type: 'string', text: value, position: i })
      i += j + 1
      continue
    }
    if (rest.startsWith('[')) {
      const end = rest.indexOf(']')
      if (end < 0) throw new ExprSyntaxError('Missing closing ] after variable name', i)
      const name = rest.slice(1, end).trim()
      if (!name) throw new ExprSyntaxError('Empty variable name in [ ]', i)
      tokens.push({ type: 'name', text: name, position: i })
      i += end + 1
      continue
    }
    const nameMatch = NAME_RE.exec(rest)
    if (nameMatch) {
      const word = nameMatch[0]
      const isOperatorWord = word === 'and' || word === 'or' || word === 'not' || word === 'mod'
      tokens.push({ type: isOperatorWord ? 'op' : 'name', text: word === 'mod' ? '%' : word, position: i })
      i += word.length
      continue
    }
    const opMatch = OPERATOR_RE.exec(rest)
    if (opMatch) {
      tokens.push({ type: 'op', text: OPERATOR_ALIASES[opMatch[0]] ?? opMatch[0], position: i })
      i += opMatch[0].length
      continue
    }
    throw new ExprSyntaxError(`Unexpected character "${rest[0]}"`, i)
  }
  tokens.push({ type: 'eof', text: '', position: source.length })
  return tokens
}

class Parser {
  private index = 0
  private readonly tokens: Token[]

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  parse(): ExprNode {
    const node = this.parseOr()
    const token = this.peek()
    if (token.type !== 'eof') throw new ExprSyntaxError(`Unexpected "${token.text}"`, token.position)
    return node
  }

  private peek(): Token {
    // The token list always ends with an 'eof' token, which is never consumed past.
    const token = this.tokens[Math.min(this.index, this.tokens.length - 1)]
    if (!token) throw new Error('Parser: token list is empty')
    return token
  }

  private next(): Token {
    const token = this.peek()
    if (token.type !== 'eof') this.index++
    return token
  }

  private acceptOp(...ops: string[]): string | undefined {
    const token = this.peek()
    if (token.type === 'op' && ops.includes(token.text)) {
      this.index++
      return token.text
    }
    return undefined
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd()
    while (this.acceptOp('or')) left = { kind: 'binary', op: 'or', left, right: this.parseAnd() }
    return left
  }

  private parseAnd(): ExprNode {
    let left = this.parseNot()
    while (this.acceptOp('and')) left = { kind: 'binary', op: 'and', left, right: this.parseNot() }
    return left
  }

  private parseNot(): ExprNode {
    if (this.acceptOp('not')) return { kind: 'not', operand: this.parseNot() }
    return this.parseComparison()
  }

  private parseComparison(): ExprNode {
    let left = this.parseAdditive()
    for (;;) {
      const op = this.acceptOp('<', '>', '=', '!=', '<=', '>=')
      if (!op) return left
      const right = this.parseAdditive()
      if (op === '!=') left = { kind: 'not', operand: { kind: 'binary', op: '=', left, right } }
      else if (op === '<=') left = { kind: 'not', operand: { kind: 'binary', op: '>', left, right } }
      else if (op === '>=') left = { kind: 'not', operand: { kind: 'binary', op: '<', left, right } }
      else left = { kind: 'binary', op: op as BinaryOperator, left, right }
    }
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative()
    for (;;) {
      const op = this.acceptOp('+', '-')
      if (!op) return left
      left = { kind: 'binary', op: op as BinaryOperator, left, right: this.parseMultiplicative() }
    }
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parseUnary()
    for (;;) {
      const op = this.acceptOp('*', '/', '%')
      if (!op) return left
      left = { kind: 'binary', op: op as BinaryOperator, left, right: this.parseUnary() }
    }
  }

  private parseUnary(): ExprNode {
    if (this.acceptOp('-')) {
      const operand = this.parseUnary()
      if (operand.kind === 'number' && !operand.text.startsWith('-'))
        return { kind: 'number', text: `-${operand.text}` }
      return { kind: 'binary', op: '-', left: { kind: 'number', text: '0' }, right: operand }
    }
    if (this.acceptOp('+')) return this.parseUnary()
    return this.parseAtom()
  }

  private parseAtom(): ExprNode {
    const token = this.next()
    if (token.type === 'number') return { kind: 'number', text: token.text }
    if (token.type === 'string') return { kind: 'string', value: token.text }
    if (token.type === 'name') {
      if (this.acceptOp('(')) return this.parseCall(token)
      return { kind: 'name', name: token.text }
    }
    if (token.type === 'op' && token.text === '(') {
      const inner = this.parseOr()
      if (!this.acceptOp(')')) throw new ExprSyntaxError('Missing closing )', this.peek().position)
      return inner
    }
    if (token.type === 'eof') throw new ExprSyntaxError('Expression ends too early', token.position)
    throw new ExprSyntaxError(`Unexpected "${token.text}"`, token.position)
  }

  private parseCall(nameToken: Token): ExprNode {
    const fn = nameToken.text
    if (!isFunctionName(fn)) throw new ExprSyntaxError(`Unknown function "${fn}"`, nameToken.position)
    const spec: OperatorSpec = FUNCTIONS[fn]
    const args: ExprNode[] = []
    if (!this.acceptOp(')')) {
      do args.push(this.parseOr())
      while (this.acceptOp(','))
      if (!this.acceptOp(')')) throw new ExprSyntaxError('Missing closing ) after arguments', this.peek().position)
    }
    if (args.length !== spec.inputs.length) {
      throw new ExprSyntaxError(
        `${fn}() takes ${spec.inputs.length} argument${spec.inputs.length === 1 ? '' : 's'}`,
        nameToken.position,
      )
    }
    return { kind: 'call', fn, args }
  }
}

export const parseExpression = (source: string): ExprNode => new Parser(tokenize(source)).parse()

const BARE_NAME_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u

/**
 * Print a name bare when the parser would read it back as the same name, otherwise as `[name]`.
 */
export const formatName = (name: string): string | undefined => {
  if (BARE_NAME_RE.test(name) && !RESERVED_WORDS.has(name)) return name
  if (name.includes(']') || name.trim() !== name || !name) return undefined
  return `[${name}]`
}

const quote = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

const precedenceOf = (node: ExprNode): number => {
  if (node.kind === 'binary') return PRECEDENCE[node.op]
  if (node.kind === 'not') return PRECEDENCE.not
  return Infinity
}

/**
 * Print an expression so that parsing the text gives back the same tree. Returns undefined if some name
 * cannot be written in expression syntax.
 */
export const printExpression = (node: ExprNode): string | undefined => {
  switch (node.kind) {
    case 'number':
      return node.text
    case 'string':
      return quote(node.value)
    case 'name':
      return formatName(node.name)
    case 'not': {
      const operand = printExpression(node.operand)
      if (operand === undefined) return undefined
      return precedenceOf(node.operand) < PRECEDENCE.not ? `not (${operand})` : `not ${operand}`
    }
    case 'call': {
      const args = node.args.map(printExpression)
      if (args.some((arg) => arg === undefined)) return undefined
      return `${node.fn}(${args.join(', ')})`
    }
    case 'binary': {
      const own = PRECEDENCE[node.op]
      const left = printExpression(node.left)
      const right = printExpression(node.right)
      if (left === undefined || right === undefined) return undefined
      // Left-associative: the left side needs parentheses only when it binds looser; the right side also when equal.
      // A negative number on the right would read as subtraction of a positive one, so it is parenthesized too.
      const leftText = precedenceOf(node.left) < own ? `(${left})` : left
      const rightNeedsParens =
        precedenceOf(node.right) <= own || (node.right.kind === 'number' && node.right.text.startsWith('-'))
      const rightText = rightNeedsParens ? `(${right})` : right
      const opText = node.op === '%' ? 'mod' : node.op
      return `${leftText} ${opText} ${rightText}`
    }
  }
}

/**
 * True if the operator produces a true/false value.
 */
export const isBooleanNode = (node: ExprNode): boolean =>
  node.kind === 'not' ||
  (node.kind === 'binary' && BINARY_OPERATORS[node.op].boolean) ||
  (node.kind === 'call' && FUNCTIONS[node.fn].boolean)

/**
 * Every name the expression refers to, in order of first appearance.
 */
export const namesIn = (node: ExprNode, into: string[] = []): string[] => {
  if (node.kind === 'name' && !into.includes(node.name)) into.push(node.name)
  if (node.kind === 'binary') {
    namesIn(node.left, into)
    namesIn(node.right, into)
  }
  if (node.kind === 'not') namesIn(node.operand, into)
  if (node.kind === 'call') node.args.forEach((arg) => namesIn(arg, into))
  return into
}

/** The operator block an operator node stands for, with the nodes for its inputs in order. */
export const operatorOf = (node: ExprNode): { spec: OperatorSpec; args: ExprNode[] } | undefined => {
  if (node.kind === 'binary') return { spec: BINARY_OPERATORS[node.op], args: [node.left, node.right] }
  if (node.kind === 'not') return { spec: NOT_OPERATOR, args: [node.operand] }
  if (node.kind === 'call') return { spec: FUNCTIONS[node.fn], args: node.args }
  return undefined
}
