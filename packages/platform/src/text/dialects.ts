/**
 * The two text forms of scripts.
 *
 * ```text
 * Python style:                          JavaScript style:
 *   # @pos(0, 0)                           // @pos(0, 0)
 *   when flag_clicked:                     when (flagClicked) {
 *       count = 0                            count = 0;
 *       while True:                          while (true) {
 *           if mouse_down():                   if (mouseDown()) {
 *               count += 1                       count += 1;
 *           move(count % 10)                   }
 *                                              move(count % 10);
 *                                            }
 *                                          }
 *   @block("jump %n high")                 @block("jump %n high")
 *   def jump_high(n):                      function jumpHigh(n) {
 *       change_y_by(n * 2)                   changeYBy(n * 2);
 *                                          }
 * ```
 * `for _ in range(n):` / `repeat (n) {` repeat n times; `while not c:` / `while (!(c)) {` repeat until c.
 */
import { ExprSyntaxError, type ExprNode, parseExpression, printExpression, quoteString } from '../expr/syntax'
import { type Script, type ScriptHead, type Stmt, TextSyntaxError } from './ast'
import { BLOCK_SPECS, RAW_REPORTER, RAW_STATEMENT, snakeToCamel } from './specs'

export type TextDialect = 'python' | 'javascript'

const INDENT: Record<TextDialect, string> = { python: '    ', javascript: '  ' }
const COMMENT: Record<TextDialect, string> = { python: '#', javascript: '//' }

/** JavaScript spelling of canonical (snake_case) names, and back. */
const jsNames = new Map<string, string>()
for (const name of [...BLOCK_SPECS.map((spec) => spec.name), RAW_STATEMENT, RAW_REPORTER]) {
  jsNames.set(snakeToCamel(name), name)
}

const nameIn = (dialect: TextDialect) => (name: string) => (dialect === 'javascript' ? snakeToCamel(name) : name)

/** A regular-expression group that the pattern always captures. */
const group = (match: RegExpExecArray, index: number): string => match[index] ?? ''

const negate = (condition: ExprNode): ExprNode =>
  condition.kind === 'not' ? condition.operand : { kind: 'not', operand: condition }

// ---------------------------------------------------------------------------------------------------------------
// Printing

class Printer {
  private readonly lines: string[] = []
  private readonly dialect: TextDialect

  constructor(dialect: TextDialect) {
    this.dialect = dialect
  }

  print(scripts: Script[]): string {
    scripts.forEach((script, i) => {
      if (i > 0) this.lines.push('')
      this.script(script)
    })
    return `${this.lines.join('\n')}\n`
  }

  private expr(node: ExprNode): string {
    const text = printExpression(node, { dialect: this.dialect, reporterName: nameIn(this.dialect) })
    if (text === undefined) throw new Error('Printer: an expression has a name that cannot be written')
    return text
  }

  private emit(depth: number, text: string) {
    this.lines.push(`${INDENT[this.dialect].repeat(depth)}${text}`)
  }

  private get js(): boolean {
    return this.dialect === 'javascript'
  }

  private call(name: string, args: ExprNode[]): string {
    return `${nameIn(this.dialect)(name)}(${args.map((arg) => this.expr(arg)).join(', ')})`
  }

  private script(script: Script) {
    if (script.x !== undefined && script.y !== undefined) {
      this.emit(0, `${COMMENT[this.dialect]} @pos(${Math.round(script.x)}, ${Math.round(script.y)})`)
    }
    const head = script.head
    if (head.kind === 'define') {
      this.emit(0, `@block(${quoteString(head.proccode)}${head.warp ? ', warp' : ''})`)
      const name = nameIn(this.dialect)(head.functionName)
      this.emit(
        0,
        this.js ? `function ${name}(${head.params.join(', ')}) {` : `def ${name}(${head.params.join(', ')}):`,
      )
    } else if (head.kind === 'hat') {
      const hat = head.args.length ? this.call(head.name, head.args) : nameIn(this.dialect)(head.name)
      this.emit(0, this.js ? `when (${hat}) {` : `when ${hat}:`)
    } else {
      this.emit(0, this.js ? 'stack {' : 'stack:')
    }
    this.body(script.body, 1)
    if (this.js) this.emit(0, '}')
  }

  private body(statements: Stmt[], depth: number) {
    if (statements.length === 0 && !this.js) this.emit(depth, 'pass')
    for (const statement of statements) this.statement(statement, depth)
  }

  private block(header: string, statements: Stmt[], depth: number) {
    this.emit(depth, this.js ? `${header} {` : `${header}:`)
    this.body(statements, depth + 1)
    if (this.js) this.emit(depth, '}')
  }

  private statement(statement: Stmt, depth: number) {
    const end = this.js ? ';' : ''
    switch (statement.kind) {
      case 'call':
        this.emit(depth, `${this.call(statement.name, statement.args)}${end}`)
        return
      case 'raw':
        this.emit(depth, `${this.call(RAW_STATEMENT, [{ kind: 'string', value: statement.json }])}${end}`)
        return
      case 'set':
      case 'change': {
        const target = this.expr({ kind: 'name', name: statement.variable })
        this.emit(depth, `${target} ${statement.kind === 'set' ? '=' : '+='} ${this.expr(statement.value)}${end}`)
        return
      }
      case 'forever':
        this.block(this.js ? 'while (true)' : 'while True', statement.body, depth)
        return
      case 'repeat':
        this.block(
          this.js ? `repeat (${this.expr(statement.times)})` : `for _ in range(${this.expr(statement.times)})`,
          statement.body,
          depth,
        )
        return
      case 'until': {
        // An empty condition is never true, so the loop runs forever: `while not <empty>` reads as `while not False`.
        const condition = statement.condition
          ? this.expr(negate(statement.condition))
          : this.js
            ? '!false'
            : 'not False'
        this.block(this.js ? `while (${condition})` : `while ${condition}`, statement.body, depth)
        return
      }
      case 'if': {
        const condition = statement.condition ? this.expr(statement.condition) : this.js ? 'false' : 'False'
        this.emit(depth, this.js ? `if (${condition}) {` : `if ${condition}:`)
        this.body(statement.then, depth + 1)
        if (statement.else) {
          this.emit(depth, this.js ? '} else {' : 'else:')
          this.body(statement.else, depth + 1)
        }
        if (this.js) this.emit(depth, '}')
      }
    }
  }
}

export const printScripts = (scripts: Script[], dialect: TextDialect): string => new Printer(dialect).print(scripts)

// ---------------------------------------------------------------------------------------------------------------
// Parsing

interface Line {
  number: number
  indent: number
  text: string
}

/** Remove a trailing comment, ignoring comment markers inside strings. */
const stripComment = (text: string, marker: string): string => {
  let quote: string | null = null
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quote) {
      if (char === '\\') i++
      else if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (text.startsWith(marker, i)) {
      return text.slice(0, i)
    }
  }
  return text
}

const POS_RE = /^(?:#|\/\/)\s*@pos\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)\s*$/
const BLOCK_RE = /^@block\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*(?:,\s*warp\s*)?\)\s*$/
const ASSIGN_RE = /^(\[[^\]]+\]|[\p{L}_][\p{L}\p{N}_]*)\s*(\+=|-=|=(?!=))\s*(.+)$/u
const DEF_PY_RE = /^def\s+([\p{L}_][\p{L}\p{N}_]*)\s*\(([^)]*)\)\s*:$/u
const DEF_JS_RE = /^function\s+([\p{L}_][\p{L}\p{N}_]*)\s*\(([^)]*)\)\s*\{$/u

class TextParser {
  private readonly lines: Line[] = []
  private index = 0
  private readonly dialect: TextDialect
  private pendingPosition: { x: number; y: number } | undefined
  private pendingBlock: { proccode: string; warp: boolean; line: number } | undefined

  constructor(source: string, dialect: TextDialect) {
    this.dialect = dialect
    source.split(/\r?\n/).forEach((raw, i) => {
      const number = i + 1
      const trimmed = raw.trim()
      const position = POS_RE.exec(trimmed)
      if (position) {
        this.lines.push({ number, indent: 0, text: `@pos ${position[1]} ${position[2]}` })
        return
      }
      const text = stripComment(raw, COMMENT[dialect]).trimEnd()
      if (!text.trim()) return
      this.lines.push({ number, indent: text.length - text.trimStart().length, text: text.trim() })
    })
  }

  private get js(): boolean {
    return this.dialect === 'javascript'
  }

  private fail(message: string, line: Line | undefined): never {
    throw new TextSyntaxError(message, line?.number ?? this.lines.at(-1)?.number ?? 1)
  }

  private expr(source: string, line: Line): ExprNode {
    try {
      return parseExpression(source, {
        dialect: this.dialect === 'javascript' ? 'javascript' : 'python',
        reporterName: (name) => (this.js ? (jsNames.get(name) ?? name) : name),
      })
    } catch (error) {
      if (error instanceof ExprSyntaxError) this.fail(`${error.message} in "${source}"`, line)
      throw error
    }
  }

  /** A condition, where `False` / `false` stands for an empty slot. */
  private condition(source: string, line: Line): ExprNode | null {
    return /^(False|false)$/.test(source.trim()) ? null : this.expr(source, line)
  }

  private name(name: string): string {
    return this.js ? (jsNames.get(name) ?? name) : name
  }

  parse(): Script[] {
    const scripts: Script[] = []
    while (this.index < this.lines.length) {
      const line = this.lines[this.index++]
      if (!line) break
      if (line.text.startsWith('@pos ')) {
        const [, x, y] = line.text.split(' ')
        this.pendingPosition = { x: Number(x), y: Number(y) }
        continue
      }
      const block = BLOCK_RE.exec(line.text)
      if (block) {
        const proccode = (this.expr(group(block, 1), line) as { value?: string }).value ?? ''
        this.pendingBlock = { proccode, warp: /,\s*warp\s*\)$/.test(line.text), line: line.number }
        continue
      }
      if (line.indent > 0) {
        this.fail(
          'This line is indented differently from the lines above it (or a script does not start at the left edge)',
          line,
        )
      }
      const head = this.parseHead(line)
      if (this.pendingBlock && head.kind !== 'define')
        this.fail('@block(...) must come right before a definition', line)
      this.pendingBlock = undefined
      scripts.push({ head, body: this.parseBody(line), line: line.number, ...this.pendingPosition })
      this.pendingPosition = undefined
    }
    return scripts
  }

  private header(line: Line, keyword: string): string | undefined {
    if (this.js) {
      const match = new RegExp(`^${keyword}\\s*\\((.*)\\)\\s*\\{$`).exec(line.text)
      return match?.[1]
    }
    const match = new RegExp(`^${keyword}\\s+(.*):$`).exec(line.text)
    return match?.[1]
  }

  private parseHead(line: Line): ScriptHead {
    const definition = (this.js ? DEF_JS_RE : DEF_PY_RE).exec(line.text)
    if (definition) {
      const functionName = group(definition, 1)
      const params = group(definition, 2)
        .split(',')
        .map((param) => param.trim())
        .filter(Boolean)
      const proccode = this.pendingBlock?.proccode ?? [functionName, ...params.map(() => '%s')].join(' ')
      return { kind: 'define', proccode, params, warp: this.pendingBlock?.warp ?? false, functionName }
    }
    if (line.text === (this.js ? 'stack {' : 'stack:')) return { kind: 'stack' }
    const hat = this.header(line, 'when')
    if (hat !== undefined) {
      const node = this.expr(hat, line)
      if (node.kind === 'name') return { kind: 'hat', name: this.name(node.name), args: [] }
      if (node.kind === 'reporter') return { kind: 'hat', name: node.name, args: node.args }
      this.fail(`"${hat}" is not an event`, line)
    }
    this.fail(
      this.js
        ? 'Expected "when (event) {", "function name(...) {" or "stack {"'
        : 'Expected "when event:", "def name(...):" or "stack:"',
      line,
    )
  }

  /** Parse the statements of the block opened by `owner`. */
  private parseBody(owner: Line): Stmt[] {
    const statements: Stmt[] = []
    if (this.js) {
      for (;;) {
        const line = this.lines[this.index]
        if (!line) this.fail('Missing "}"', owner)
        if (line.text === '}' || line.text.startsWith('} else')) {
          if (line.text === '}') this.index++
          return statements
        }
        this.index++
        statements.push(this.parseStatement(line))
      }
    }
    const first = this.lines[this.index]
    if (!first || first.indent <= owner.indent)
      this.fail('Expected an indented block (write "pass" if it is empty)', owner)
    const indent = first.indent
    while (this.index < this.lines.length) {
      const line = this.lines[this.index]
      if (!line || line.indent < indent) break
      if (line.indent > indent) this.fail('This line is indented more than the lines above it', line)
      this.index++
      if (line.text === 'pass') continue
      statements.push(this.parseStatement(line))
    }
    return statements
  }

  private parseStatement(line: Line): Stmt {
    const where = { line: line.number }
    const text = this.js ? line.text.replace(/;$/, '') : line.text
    const ifCondition = this.header(line, 'if')
    if (ifCondition !== undefined) return this.parseIf(line, ifCondition)
    const whileCondition = this.header(line, 'while')
    if (whileCondition !== undefined) {
      const body = this.parseBody(line)
      const trimmed = whileCondition.trim()
      if (/^(True|true)$/.test(trimmed)) return { kind: 'forever', body, ...where }
      if (/^(not\s+False|!\s*false)$/.test(trimmed)) return { kind: 'until', condition: null, body, ...where }
      return { kind: 'until', condition: negate(this.expr(whileCondition, line)), body, ...where }
    }
    const times = this.js ? this.header(line, 'repeat') : /^for\s+\S+\s+in\s+range\((.*)\)\s*:$/.exec(line.text)?.[1]
    if (times !== undefined)
      return { kind: 'repeat', times: this.expr(times, line), body: this.parseBody(line), ...where }
    if (!this.js && (line.text === 'else:' || line.text.startsWith('elif '))) this.fail('"else" without "if"', line)
    const assignment = ASSIGN_RE.exec(text)
    if (assignment) {
      const variable = group(assignment, 1).replace(/^\[\s*|\s*\]$/g, '')
      let value = this.expr(group(assignment, 3), line)
      if (assignment[2] === '=') return { kind: 'set', variable, value, ...where }
      if (assignment[2] === '-=') {
        value =
          value.kind === 'number' && !value.text.startsWith('-')
            ? { kind: 'number', text: `-${value.text}` }
            : { kind: 'binary', op: '-', left: { kind: 'number', text: '0' }, right: value }
      }
      return { kind: 'change', variable, value, ...where }
    }
    const node = this.expr(text, line)
    if (node.kind !== 'reporter' && node.kind !== 'call') {
      this.fail('Expected a block such as move(10), an assignment such as score = 0, or if/while/repeat', line)
    }
    const name = node.kind === 'call' ? node.fn : node.name
    if (name === RAW_STATEMENT) {
      const json = node.args[0]
      if (json?.kind !== 'string') this.fail(`${RAW_STATEMENT}() takes the block's JSON as one string`, line)
      return { kind: 'raw', json: json.value, ...where }
    }
    return { kind: 'call', name, args: node.args, ...where }
  }

  private parseIf(line: Line, conditionText: string): Stmt {
    const statement: Stmt = {
      kind: 'if',
      condition: this.condition(conditionText, line),
      then: this.parseBody(line),
      line: line.number,
    }
    const next = this.lines[this.index]
    if (!next) return statement
    if (this.js) {
      if (next.text === '} else {') {
        this.index++
        statement.else = this.parseBody(next)
      } else {
        const elseIf = /^\}\s*else\s+if\s*\((.*)\)\s*\{$/.exec(next.text)
        if (elseIf) {
          this.index++
          statement.else = [this.parseIf(next, group(elseIf, 1))]
        }
      }
      return statement
    }
    if (next.indent !== line.indent) return statement
    if (next.text === 'else:') {
      this.index++
      statement.else = this.parseBody(next)
    } else if (next.text.startsWith('elif ') && next.text.endsWith(':')) {
      this.index++
      statement.else = [this.parseIf(next, next.text.slice(5, -1))]
    }
    return statement
  }
}

/** Parse a text into scripts. Throws TextSyntaxError (with a line number) for mistakes. */
export const parseScripts = (source: string, dialect: TextDialect): Script[] =>
  new TextParser(source, dialect).parse()
