/**
 * Tokenizer, parser and printer for typed expressions such as `(var1 + var2) / 2`.
 *
 * Grammar, from loosest to tightest binding:
 *   or  →  and  →  not  →  comparison (< > = != <= >=)  →  + -  →  * / % mod  →  unary - (and JS !)  →  atom
 * Atoms are numbers, quoted strings, names, `[names with spaces]`, function calls and parenthesized expressions.
 * `!=`, `<=` and `>=` are written as `not (...)` in blocks, because Scratch has no such operators.
 *
 * Three dialects share the grammar and differ only in spelling: `scratch` (Custom-mode expression blocks:
 * `=`, `mod`, `and`/`or`/`not`), `python` (`==`, `%`, `and`/`or`/`not`) and `javascript` (`==`, `%`, `&&`/`||`
 * and a tightly binding `!`). Every dialect reads the other spellings too.
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

export type ExprDialect = 'scratch' | 'python' | 'javascript'

export type ExprNode =
  | { kind: 'number'; text: string }
  | { kind: 'string'; value: string }
  | { kind: 'name'; name: string }
  | { kind: 'binary'; op: BinaryOperator; left: ExprNode; right: ExprNode }
  | { kind: 'not'; operand: ExprNode }
  | { kind: 'call'; fn: FunctionName; args: ExprNode[] }
  /** A call to a non-operator reporter, e.g. `x_position()` (text mode only). */
  | { kind: 'reporter'; name: string; args: ExprNode[] }

export class ExprSyntaxError extends Error {
  readonly position: number

  constructor(message: string, position: number) {
    super(message)
    this.name = 'ExprSyntaxError'
    this.position = position
  }
}

export interface ParseOptions {
  dialect?: ExprDialect
  /**
   * Accept calls to functions other than the operator functions, as `reporter` nodes. The function receives the
   * name as written and returns the canonical name, or undefined if there is no such reporter.
   */
  reporterName?: (name: string) => string | undefined
}

export interface PrintOptions {
  dialect?: ExprDialect
  /** How to write a reporter's canonical name (e.g. camelCase in JavaScript). */
  reporterName?: (name: string) => string
}

type TokenType = 'number' | 'string' | 'name' | 'op' | 'eof'

interface Token {
  type: TokenType
  text: string
  position: number
}

const NUMBER_RE = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/
const NAME_RE = /^[\p{L}_][\p{L}\p{N}_]*/u
const OPERATOR_RE = /^(?:===|!==|==|!=|<=|>=|&&|\|\||[+\-*/%()<>=,!≠≤≥])/

/** A number literal exactly as Scratch's number fields accept it. */
export const NUMBER_LITERAL_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

const OPERATOR_ALIASES: Record<string, string> = {
  '===': '=',
  '==': '=',
  '!==': '!=',
  '&&': 'and',
  '||': 'or',
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
  private readonly options: ParseOptions

  constructor(tokens: Token[], options: ParseOptions) {
    this.tokens = tokens
    this.options = options
  }

  parse(): ExprNode {
    const node = this.parseOr()
    const token = this.peek()
    if (token.type !== 'eof') throw new ExprSyntaxError(`Unexpected "${token.text}"`, token.position)
    return node
  }

  private get jsNot(): boolean {
    return this.options.dialect === 'javascript'
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
    // In JavaScript `!` binds tightly and is read in parseUnary instead.
    if (this.acceptOp('not') ?? (this.jsNot ? undefined : this.acceptOp('!'))) {
      return { kind: 'not', operand: this.parseNot() }
    }
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
      if (operand.kind === 'number' && !operand.text.startsWith('-')) {
        return { kind: 'number', text: `-${operand.text}` }
      }
      return { kind: 'binary', op: '-', left: { kind: 'number', text: '0' }, right: operand }
    }
    if (this.acceptOp('+')) return this.parseUnary()
    if (this.jsNot && this.acceptOp('!')) return { kind: 'not', operand: this.parseUnary() }
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

  private parseArguments(): ExprNode[] {
    const args: ExprNode[] = []
    if (this.acceptOp(')')) return args
    do args.push(this.parseOr())
    while (this.acceptOp(','))
    if (!this.acceptOp(')')) throw new ExprSyntaxError('Missing closing ) after arguments', this.peek().position)
    return args
  }

  private parseCall(nameToken: Token): ExprNode {
    const fn = nameToken.text
    if (!isFunctionName(fn)) {
      const reporter = this.options.reporterName?.(fn)
      if (reporter === undefined) throw new ExprSyntaxError(`Unknown function "${fn}"`, nameToken.position)
      return { kind: 'reporter', name: reporter, args: this.parseArguments() }
    }
    const spec: OperatorSpec = FUNCTIONS[fn]
    const args = this.parseArguments()
    if (args.length !== spec.inputs.length) {
      throw new ExprSyntaxError(
        `${fn}() takes ${spec.inputs.length} argument${spec.inputs.length === 1 ? '' : 's'}`,
        nameToken.position,
      )
    }
    return { kind: 'call', fn, args }
  }
}

export const parseExpression = (source: string, options: ParseOptions = {}): ExprNode =>
  new Parser(tokenize(source), options).parse()

const BARE_NAME_RE = /^[\p{L}_][\p{L}\p{N}_]*$/u

/** Print a name bare when the parser would read it back as the same name, otherwise as `[name]`. */
export const formatName = (name: string): string | undefined => {
  if (BARE_NAME_RE.test(name) && !RESERVED_WORDS.has(name)) return name
  if (name.includes(']') || name.trim() !== name || !name) return undefined
  return `[${name}]`
}

export const quoteString = (value: string): string => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

const OPERATOR_TEXT: Record<ExprDialect, Partial<Record<BinaryOperator, string>>> = {
  scratch: { '%': 'mod' },
  python: { '=': '==' },
  javascript: { '=': '==', and: '&&', or: '||' },
}

const precedenceOf = (node: ExprNode, dialect: ExprDialect): number => {
  if (node.kind === 'binary') return PRECEDENCE[node.op]
  // JavaScript's `!` is printed with a parenthesized operand, so it reads as an atom.
  if (node.kind === 'not') return dialect === 'javascript' ? Infinity : PRECEDENCE.not
  return Infinity
}

/**
 * Print an expression so that parsing the text (in the same dialect) gives back the same tree. Returns undefined
 * if some name cannot be written in expression syntax.
 */
export const printExpression = (node: ExprNode, options: PrintOptions = {}): string | undefined => {
  const dialect = options.dialect ?? 'scratch'
  const print = (child: ExprNode) => printExpression(child, options)
  switch (node.kind) {
    case 'number':
      return node.text
    case 'string':
      return quoteString(node.value)
    case 'name':
      return formatName(node.name)
    case 'not': {
      const operand = print(node.operand)
      if (operand === undefined) return undefined
      if (dialect === 'javascript') {
        return precedenceOf(node.operand, dialect) === Infinity ? `!${operand}` : `!(${operand})`
      }
      return precedenceOf(node.operand, dialect) < PRECEDENCE.not ? `not (${operand})` : `not ${operand}`
    }
    case 'call':
    case 'reporter': {
      const args = node.args.map(print)
      if (args.some((arg) => arg === undefined)) return undefined
      const name = node.kind === 'call' ? node.fn : (options.reporterName?.(node.name) ?? node.name)
      return `${name}(${args.join(', ')})`
    }
    case 'binary': {
      const own = PRECEDENCE[node.op]
      const left = print(node.left)
      const right = print(node.right)
      if (left === undefined || right === undefined) return undefined
      // Left-associative: the left side needs parentheses only when it binds looser; the right side also when equal.
      // A negative number on the right would read as subtraction of a positive one, so it is parenthesized too.
      const leftText = precedenceOf(node.left, dialect) < own ? `(${left})` : left
      const rightNeedsParens =
        precedenceOf(node.right, dialect) <= own || (node.right.kind === 'number' && node.right.text.startsWith('-'))
      const rightText = rightNeedsParens ? `(${right})` : right
      return `${leftText} ${OPERATOR_TEXT[dialect][node.op] ?? node.op} ${rightText}`
    }
  }
}

/**
 * True if the node produces a true/false value. `isBooleanReporter` answers for reporter nodes.
 */
export const isBooleanNode = (node: ExprNode, isBooleanReporter?: (name: string) => boolean): boolean =>
  node.kind === 'not' ||
  (node.kind === 'binary' && BINARY_OPERATORS[node.op].boolean) ||
  (node.kind === 'call' && FUNCTIONS[node.fn].boolean) ||
  (node.kind === 'reporter' && Boolean(isBooleanReporter?.(node.name)))

/** Every name the expression refers to, in order of first appearance. */
export const namesIn = (node: ExprNode, into: string[] = []): string[] => {
  if (node.kind === 'name' && !into.includes(node.name)) into.push(node.name)
  if (node.kind === 'binary') {
    namesIn(node.left, into)
    namesIn(node.right, into)
  }
  if (node.kind === 'not') namesIn(node.operand, into)
  if (node.kind === 'call' || node.kind === 'reporter') node.args.forEach((arg) => namesIn(arg, into))
  return into
}

/** The operator block an operator node stands for, with the nodes for its inputs in order. */
export const operatorOf = (node: ExprNode): { spec: OperatorSpec; args: ExprNode[] } | undefined => {
  if (node.kind === 'binary') return { spec: BINARY_OPERATORS[node.op], args: [node.left, node.right] }
  if (node.kind === 'not') return { spec: NOT_OPERATOR, args: [node.operand] }
  if (node.kind === 'call') return { spec: FUNCTIONS[node.fn], args: node.args }
  return undefined
}
