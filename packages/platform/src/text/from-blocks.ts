/** Convert a target's blocks (sb3 JSON) into scripts for the text editor. */
import { binaryOperatorForOpcode, BINARY_OPERATORS, FUNCTIONS, functionForBlock, NOT_OPERATOR } from '../expr/ops'
import { formatName, NUMBER_LITERAL_RE, type ExprNode } from '../expr/syntax'
import { parseLocalVariableName, procedureLabel } from '../local-vars'
import { parseStringArray } from '../sb3/scope'
import {
  BROADCAST_PRIMITIVE,
  getBlock,
  isBlock,
  type BlockMap,
  type SerializedBlock,
  type SerializedInput,
  type SerializedTarget,
  TEXT_PRIMITIVE,
  VAR_PRIMITIVE,
} from '../sb3/types'
import type { RawBlockJson, Script, ScriptHead, Stmt } from './ast'
import { type ArgSpec, BLOCK_SPECS, RAW_REPORTER, RAW_STATEMENT, specForOpcode } from './specs'

const isNumberPrimitive = (type: number) => type >= 4 && type <= 8

/** Function names for the custom blocks defined in a target, by proccode. */
export const functionNamesFor = (blocks: BlockMap): Map<string, string> => {
  const taken = new Set(BLOCK_SPECS.map((spec) => spec.name))
  const names = new Map<string, string>()
  for (const block of Object.values(blocks)) {
    if (!isBlock(block) || block.opcode !== 'procedures_prototype') continue
    const proccode = block.mutation?.proccode
    if (!proccode || names.has(proccode)) continue
    let base = procedureLabel(proccode)
      .replace(/[^\p{L}\p{N}_]+/gu, '_')
      .replace(/^_+|_+$/g, '')
    if (!base) base = 'my_block'
    if (/^\p{N}/u.test(base)) base = `_${base}`
    let name = base
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`
    taken.add(name)
    names.set(proccode, name)
  }
  return names
}

/** The JSON of a block and every block nested in its inputs, detached from its stack. */
export const rawJsonFor = (blocks: BlockMap, rootId: string): string => {
  const collected: Record<string, unknown> = {}
  const collect = (id: string, followNext: boolean) => {
    const block = blocks[id]
    if (!block || id in collected) return
    collected[id] = block
    if (!isBlock(block)) return
    for (const input of Object.values(block.inputs)) {
      for (const value of input.slice(1)) if (typeof value === 'string') collect(value, true)
    }
    if (followNext && block.next) collect(block.next, true)
  }
  collect(rootId, false)
  const root = collected[rootId]
  if (isBlock(root as SerializedBlock)) {
    collected[rootId] = {
      ...(root as SerializedBlock),
      next: null,
      parent: null,
      topLevel: false,
      x: undefined,
      y: undefined,
    }
  }
  const raw: RawBlockJson = { root: rootId, blocks: collected }
  return JSON.stringify(raw)
}

const rawReporter = (blocks: BlockMap, id: string): ExprNode => ({
  kind: 'reporter',
  name: RAW_REPORTER,
  args: [{ kind: 'string', value: rawJsonFor(blocks, id) }],
})

const literal = (text: string): ExprNode =>
  NUMBER_LITERAL_RE.test(text) ? { kind: 'number', text } : { kind: 'string', value: text }

class ScriptReader {
  private readonly blocks: BlockMap
  private readonly functionNames: Map<string, string>
  /** The custom block whose definition is being read, if any. */
  private procedure: { label: string; params: string[] } | undefined

  constructor(target: SerializedTarget) {
    this.blocks = target.blocks
    this.functionNames = functionNamesFor(target.blocks)
  }

  read(): Script[] {
    const scripts: Script[] = []
    for (const [id, block] of Object.entries(this.blocks)) {
      if (Array.isArray(block)) {
        // A loose variable or list reporter on the workspace.
        scripts.push({
          head: { kind: 'stack' },
          body: [{ kind: 'raw', json: rawJsonFor(this.blocks, id) }],
          x: block[3],
          y: block[4],
        })
        continue
      }
      if (!block.topLevel || block.shadow) continue
      scripts.push(this.readScript(id, block))
    }
    return scripts
  }

  /** How to write a variable: block-local variables of the definition being read go by their short name. */
  private variableName(name: string): string {
    const local = parseLocalVariableName(name)
    if (local && local.label === this.procedure?.label && !this.procedure.params.includes(local.name)) {
      return local.name
    }
    return name
  }

  private readScript(id: string, block: SerializedBlock): Script {
    this.procedure = undefined
    const position = { x: block.x, y: block.y }
    if (block.opcode === 'procedures_definition') {
      const prototype = getBlock(this.blocks, block.inputs.custom_block?.[1])
      const mutation = prototype?.mutation
      if (mutation?.proccode) {
        this.procedure = {
          label: procedureLabel(mutation.proccode),
          params: parseStringArray(mutation.argumentnames),
        }
        const head: ScriptHead = {
          kind: 'define',
          proccode: mutation.proccode,
          params: parseStringArray(mutation.argumentnames),
          warp: mutation.warp === 'true',
          functionName: this.functionNames.get(mutation.proccode) ?? 'my_block',
        }
        return { head, body: this.readStack(block.next), ...position }
      }
    }
    const spec = specForOpcode(block.opcode)
    if (spec?.shape === 'hat') {
      const args = this.readArgs(block, spec.args)
      if (args) return { head: { kind: 'hat', name: spec.name, args }, body: this.readStack(block.next), ...position }
    }
    return { head: { kind: 'stack' }, body: this.readStack(id), ...position }
  }

  private readStack(firstId: string | null | undefined): Stmt[] {
    const statements: Stmt[] = []
    const seen = new Set<string>()
    let id = firstId ?? null
    while (id && !seen.has(id)) {
      seen.add(id)
      const block = getBlock(this.blocks, id)
      if (!block) break
      statements.push(this.readStatement(id, block))
      id = block.next
    }
    return statements
  }

  private substack(block: SerializedBlock, name: string): Stmt[] {
    const value = block.inputs[name]?.[1]
    return typeof value === 'string' ? this.readStack(value) : []
  }

  private condition(block: SerializedBlock): ExprNode | null | undefined {
    const input = block.inputs.CONDITION
    if (input?.[1] === null || input === undefined) return null
    return this.readInput(input) ?? undefined
  }

  private readStatement(id: string, block: SerializedBlock): Stmt {
    const raw: Stmt = { kind: 'raw', json: rawJsonFor(this.blocks, id) }
    switch (block.opcode) {
      case 'control_forever':
        return { kind: 'forever', body: this.substack(block, 'SUBSTACK') }
      case 'control_repeat': {
        const times = this.readInput(block.inputs.TIMES)
        return times ? { kind: 'repeat', times, body: this.substack(block, 'SUBSTACK') } : raw
      }
      case 'control_repeat_until': {
        const condition = this.condition(block)
        return condition === undefined ? raw : { kind: 'until', condition, body: this.substack(block, 'SUBSTACK') }
      }
      case 'control_if':
      case 'control_if_else': {
        const condition = this.condition(block)
        if (condition === undefined) return raw
        const statement: Stmt = { kind: 'if', condition, then: this.substack(block, 'SUBSTACK') }
        if (block.opcode === 'control_if_else') statement.else = this.substack(block, 'SUBSTACK2')
        return statement
      }
      case 'data_setvariableto':
      case 'data_changevariableby': {
        const name = block.fields.VARIABLE?.[0]
        const value = this.readInput(block.inputs.VALUE)
        if (!name || formatName(name) === undefined || !value) return raw
        return {
          kind: block.opcode === 'data_setvariableto' ? 'set' : 'change',
          variable: this.variableName(name),
          value,
        }
      }
      case 'procedures_call': {
        const proccode = block.mutation?.proccode
        const functionName = proccode ? this.functionNames.get(proccode) : undefined
        if (!proccode || !functionName) return raw
        const args: ExprNode[] = []
        for (const argId of parseStringArray(block.mutation?.argumentids)) {
          const arg = this.readInput(block.inputs[argId])
          if (!arg) return raw
          args.push(arg)
        }
        return { kind: 'call', name: functionName, args }
      }
      default: {
        const spec = specForOpcode(block.opcode)
        if (!spec || (spec.shape !== 'statement' && spec.shape !== 'cap')) return raw
        const args = this.readArgs(block, spec.args)
        return args ? { kind: 'call', name: spec.name, args } : raw
      }
    }
  }

  /** The arguments of a block with a spec, or undefined if some argument has no text form. */
  private readArgs(block: SerializedBlock, specs: ArgSpec[]): ExprNode[] | undefined {
    const args: ExprNode[] = []
    for (const spec of specs) {
      let arg: ExprNode | null | undefined
      // Menus also name a field, but their value is in the shadow block of their input.
      if ('field' in spec && !('menu' in spec)) {
        const value = block.fields[spec.field]?.[0]
        arg = typeof value === 'string' ? { kind: 'string', value } : undefined
      } else if ('broadcastField' in spec) {
        const value = block.fields[spec.broadcastField]?.[0]
        arg = typeof value === 'string' ? { kind: 'string', value } : undefined
      } else if ('list' in spec || 'variable' in spec) {
        const value = block.fields['list' in spec ? 'LIST' : 'VARIABLE']?.[0]
        arg = typeof value === 'string' && formatName(value) !== undefined ? { kind: 'name', name: value } : undefined
      } else if ('broadcastInput' in spec) {
        arg = this.readInput(block.inputs[spec.broadcastInput])
      } else {
        arg = this.readInput(block.inputs[spec.input])
      }
      if (!arg) return undefined
      args.push(arg)
    }
    return args
  }

  /** The expression an input holds, or null if it is empty or has no text form. */
  readInput(input: SerializedInput | undefined): ExprNode | null {
    if (!input) return null
    const value = input[1]
    if (value === null) return null
    if (Array.isArray(value)) {
      const [type, text] = value
      if (type === VAR_PRIMITIVE) {
        const name = this.variableName(String(text))
        return formatName(name) === undefined ? null : { kind: 'name', name }
      }
      if (type === BROADCAST_PRIMITIVE) return { kind: 'string', value: String(text) }
      if (isNumberPrimitive(type) || type === TEXT_PRIMITIVE) return literal(String(text))
      if (type === 9) return { kind: 'string', value: String(text) }
      return null
    }
    const block = getBlock(this.blocks, value)
    if (!block) {
      // A list reporter is stored as a compressed primitive under its own ID.
      return this.blocks[value] ? rawReporter(this.blocks, value) : null
    }
    return this.readReporter(value, block)
  }

  private readReporter(id: string, block: SerializedBlock): ExprNode {
    // A menu shadow (e.g. "_mouse_") reads as its value.
    const fieldValues = Object.values(block.fields)
    if (block.shadow && Object.keys(block.inputs).length === 0 && fieldValues.length === 1) {
      return { kind: 'string', value: String(fieldValues[0]?.[0] ?? '') }
    }
    if (block.opcode === 'argument_reporter_string_number' || block.opcode === 'argument_reporter_boolean') {
      const name = String(block.fields.VALUE?.[0] ?? '')
      return formatName(name) === undefined ? rawReporter(this.blocks, id) : { kind: 'name', name }
    }
    const operator = this.readOperator(block)
    if (operator) return operator
    const spec = specForOpcode(block.opcode)
    if (spec && (spec.shape === 'reporter' || spec.shape === 'boolean')) {
      const args = this.readArgs(block, spec.args)
      if (args) return { kind: 'reporter', name: spec.name, args }
    }
    return rawReporter(this.blocks, id)
  }

  private readOperator(block: SerializedBlock): ExprNode | null {
    const read = (names: string[]) => {
      const children: ExprNode[] = []
      for (const name of names) {
        const child = this.readInput(block.inputs[name])
        if (!child) return null
        children.push(child)
      }
      return children
    }
    const op = binaryOperatorForOpcode(block.opcode)
    if (op) {
      const [left, right] = read(BINARY_OPERATORS[op].inputs.map((input) => input.name)) ?? []
      return left && right ? { kind: 'binary', op, left, right } : null
    }
    if (block.opcode === NOT_OPERATOR.opcode) {
      const [operand] = read(['OPERAND']) ?? []
      return operand ? { kind: 'not', operand } : null
    }
    const fn = functionForBlock(block.opcode, block.fields.OPERATOR?.[0])
    if (fn) {
      const args = read(FUNCTIONS[fn].inputs.map((input) => input.name))
      return args && { kind: 'call', fn, args }
    }
    return null
  }
}

/** The scripts of a target, in the order they appear in its block list. */
export const scriptsFromTarget = (target: SerializedTarget): Script[] => new ScriptReader(target).read()

export { RAW_STATEMENT }
