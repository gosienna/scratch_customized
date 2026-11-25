/** Build a target's blocks (sb3 JSON) from text-editor scripts. */
import { type ExprScope, resolveName } from '../expr/scope'
import { type ExprNode, isBooleanNode, NUMBER_LITERAL_RE } from '../expr/syntax'
import { ExprTypeError, type LowerContext, placeInSlot, type Slot } from '../expr/to-blocks'
import { argumentTypesOf } from '../local-vars'
import { indexVariables } from '../sb3/scope'
import {
  BROADCAST_PRIMITIVE,
  INPUT_BLOCK_NO_SHADOW,
  INPUT_DIFF_BLOCK_SHADOW,
  INPUT_SAME_BLOCK_SHADOW,
  isBlock,
  MATH_NUM_PRIMITIVE,
  TEXT_PRIMITIVE,
  WHOLE_NUM_PRIMITIVE,
  type BlockMap,
  type InputValue,
  type SerializedBlock,
  type SerializedInput,
  type SerializedTarget,
  type TopLevelPrimitive,
} from '../sb3/types'
import { type RawBlockJson, type Script, type Stmt, TextSyntaxError } from './ast'
import { type ArgSpec, blockSpec, type BlockSpec, hatSpec, RAW_REPORTER, RAW_STATEMENT } from './specs'

type ReporterNode = Extract<ExprNode, { kind: 'reporter' }>

export interface BuildResult {
  blocks: BlockMap
  /** Variables created because the text assigns to a name that did not exist (sprite-local). */
  newVariables: Record<string, [string, number]>
  newLists: Record<string, [string, unknown[]]>
  /** Broadcast messages created because the text uses a name that did not exist (stored on the stage). */
  newBroadcasts: Record<string, string>
}

interface Procedure {
  proccode: string
  params: string[]
  argumentIds: string[]
  types: ('number' | 'boolean')[]
}

const block = (opcode: string, parent: string | null, extra: Partial<SerializedBlock> = {}): SerializedBlock => ({
  opcode,
  next: null,
  parent,
  inputs: {},
  fields: {},
  shadow: false,
  topLevel: false,
  ...extra,
})

const literalText = (node: ExprNode): string | undefined => {
  if (node.kind === 'string') return node.value
  if (node.kind === 'number') return node.text
  return undefined
}

class ScriptBuilder {
  readonly blocks: BlockMap = {}
  readonly newVariables: BuildResult['newVariables'] = {}
  readonly newLists: BuildResult['newLists'] = {}
  readonly newBroadcasts: BuildResult['newBroadcasts'] = {}
  private counter = 0
  private line = 0
  private readonly target: SerializedTarget
  private readonly stage: SerializedTarget | undefined
  private readonly procedures = new Map<string, Procedure>()
  private scope: ExprScope
  private scriptProcedure: Procedure | undefined

  constructor(target: SerializedTarget, stage: SerializedTarget | undefined, scripts: Script[]) {
    this.target = target
    this.stage = stage
    for (const script of scripts) {
      if (script.head.kind !== 'define') continue
      const { proccode, params, functionName } = script.head
      if (this.procedures.has(functionName)) this.fail(`The block ${functionName} is defined twice`, script.line)
      const types = argumentTypesOf(proccode)
      if (types.length !== params.length) {
        this.fail(`"${proccode}" has ${types.length} inputs but ${functionName} lists ${params.length}`, script.line)
      }
      const prefix = this.newId()
      this.procedures.set(functionName, {
        proccode,
        params,
        types,
        argumentIds: params.map((_, i) => `${prefix}-arg${i}`),
      })
    }
    // Assigning to an unknown name creates a variable for this sprite, as Scratch's "make a variable" would.
    // Each script is checked in its own scope, so a custom block's local variables are found by short name.
    this.scope = this.scopeFor(undefined)
    for (const script of scripts) {
      this.scriptProcedure = this.procedureOf(script)
      this.scope = this.scopeFor(this.scriptProcedure)
      this.collectAssignments(script.body)
    }
    this.scriptProcedure = undefined
  }

  private procedureOf(script: Script): Procedure | undefined {
    return script.head.kind === 'define' ? this.procedures.get(script.head.functionName) : undefined
  }

  private fail(message: string, line?: number): never {
    throw new TextSyntaxError(message, line ?? this.line)
  }

  private newId(): string {
    return `t${(++this.counter).toString(36)}`
  }

  private scopeFor(procedure: Procedure | undefined): ExprScope {
    const targetVariables = indexVariables({ ...this.target.variables, ...this.newVariables })
    const stageVariables = indexVariables(this.stage?.variables)
    return {
      params: new Map(procedure?.params.map((param, i) => [param, procedure.types[i] ?? 'number'])),
      proccode: procedure?.proccode,
      findTargetVariable: (name) => targetVariables.get(name),
      findStageVariable: (name) => (this.target.isStage ? undefined : stageVariables.get(name)),
    }
  }

  private collectAssignments(statements: Stmt[]) {
    for (const statement of statements) {
      if (statement.kind === 'set' || statement.kind === 'change') {
        if (resolveName(statement.variable, this.scope).kind === 'unknown') {
          this.newVariables[this.newId()] = [statement.variable, 0]
          this.scope = this.scopeFor(this.scriptProcedure)
        }
      }
      if (statement.kind === 'if') {
        this.collectAssignments(statement.then)
        if (statement.else) this.collectAssignments(statement.else)
      }
      if (statement.kind === 'forever' || statement.kind === 'repeat' || statement.kind === 'until') {
        this.collectAssignments(statement.body)
      }
    }
  }

  build(scripts: Script[]): void {
    let nextY = 0
    for (const script of scripts) {
      this.line = script.line ?? 0
      const x = script.x ?? 0
      const y = script.y ?? nextY
      nextY = Math.max(nextY, y) + 100 + 50 * script.body.length
      const procedure = this.procedureOf(script)
      this.scope = this.scopeFor(procedure)
      this.buildScript(script, x, y, procedure)
    }
  }

  private buildScript(script: Script, x: number, y: number, procedure: Procedure | undefined) {
    const head = script.head
    if (head.kind === 'stack') {
      const first = this.buildStack(script.body, null)
      if (!first) return
      const top = this.blocks[first]
      if (isBlock(top)) Object.assign(top, { topLevel: true, x, y })
      else if (Array.isArray(top)) this.blocks[first] = [top[0], top[1], top[2], x, y] as TopLevelPrimitive
      return
    }
    const id = this.newId()
    if (head.kind === 'define' && procedure) {
      this.buildDefinition(id, procedure, head.warp)
    } else if (head.kind === 'hat') {
      const spec = hatSpec(head.name)
      if (!spec) this.fail(`Unknown event "${head.name}"`)
      this.blocks[id] = block(spec.opcode, null)
      this.fillArgs(id, spec, head.args)
    }
    Object.assign(this.blocks[id] as SerializedBlock, { topLevel: true, x, y })
    ;(this.blocks[id] as SerializedBlock).next = this.buildStack(script.body, id)
  }

  private buildDefinition(id: string, procedure: Procedure, warp: boolean) {
    const prototypeId = this.newId()
    const definition = block('procedures_definition', null)
    definition.inputs.custom_block = [INPUT_SAME_BLOCK_SHADOW, prototypeId]
    this.blocks[id] = definition
    const prototype = block('procedures_prototype', id, {
      shadow: true,
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode: procedure.proccode,
        argumentids: JSON.stringify(procedure.argumentIds),
        argumentnames: JSON.stringify(procedure.params),
        argumentdefaults: JSON.stringify(procedure.types.map((type) => (type === 'boolean' ? 'false' : ''))),
        warp: String(warp),
      },
    })
    procedure.argumentIds.forEach((argumentId, i) => {
      const reporterId = this.newId()
      const opcode =
        procedure.types[i] === 'boolean' ? 'argument_reporter_boolean' : 'argument_reporter_string_number'
      this.blocks[reporterId] = block(opcode, prototypeId, {
        shadow: true,
        fields: { VALUE: [procedure.params[i] ?? '', null] },
      })
      prototype.inputs[argumentId] = [INPUT_SAME_BLOCK_SHADOW, reporterId]
    })
    this.blocks[prototypeId] = prototype
  }

  /** Build a chain of statements under `parent`; returns the first block's ID. */
  private buildStack(statements: Stmt[], parent: string | null): string | null {
    let first: string | null = null
    let previous: string | null = null
    for (const statement of statements) {
      if (statement.line) this.line = statement.line
      const id = this.buildStatement(statement, previous ?? parent)
      first ??= id
      const previousBlock = previous ? this.blocks[previous] : undefined
      if (isBlock(previousBlock)) previousBlock.next = id
      previous = id
    }
    return first
  }

  private substack(owner: SerializedBlock, name: string, statements: Stmt[], ownerId: string) {
    const first = this.buildStack(statements, ownerId)
    if (first) owner.inputs[name] = [INPUT_BLOCK_NO_SHADOW, first]
  }

  private conditionInput(owner: SerializedBlock, ownerId: string, condition: ExprNode | null) {
    if (!condition) return
    const input = this.place(condition, ownerId, { kind: 'boolean', shadow: null })
    if (input) owner.inputs.CONDITION = input
  }

  private buildStatement(statement: Stmt, parent: string | null): string {
    const id = this.newId()
    switch (statement.kind) {
      case 'raw':
        return this.insertRaw(statement.json, parent)
      case 'forever': {
        const forever = (this.blocks[id] = block('control_forever', parent))
        this.substack(forever, 'SUBSTACK', statement.body, id)
        return id
      }
      case 'repeat': {
        const repeat = (this.blocks[id] = block('control_repeat', parent))
        repeat.inputs.TIMES = this.placeValue(statement.times, id, WHOLE_NUM_PRIMITIVE)
        this.substack(repeat, 'SUBSTACK', statement.body, id)
        return id
      }
      case 'until': {
        const until = (this.blocks[id] = block('control_repeat_until', parent))
        this.conditionInput(until, id, statement.condition)
        this.substack(until, 'SUBSTACK', statement.body, id)
        return id
      }
      case 'if': {
        const ifBlock = (this.blocks[id] = block(statement.else ? 'control_if_else' : 'control_if', parent))
        this.conditionInput(ifBlock, id, statement.condition)
        this.substack(ifBlock, 'SUBSTACK', statement.then, id)
        if (statement.else) this.substack(ifBlock, 'SUBSTACK2', statement.else, id)
        return id
      }
      case 'set':
      case 'change': {
        const resolved = resolveName(statement.variable, this.scope)
        if (resolved.kind !== 'variable') this.fail(`"${statement.variable}" is not a variable`)
        const opcode = statement.kind === 'set' ? 'data_setvariableto' : 'data_changevariableby'
        const setBlock = (this.blocks[id] = block(opcode, parent, {
          fields: { VARIABLE: [resolved.name, resolved.id] },
        }))
        setBlock.inputs.VALUE = this.placeValue(
          statement.value,
          id,
          statement.kind === 'set' ? TEXT_PRIMITIVE : MATH_NUM_PRIMITIVE,
        )
        return id
      }
      case 'call': {
        const procedure = this.procedures.get(statement.name)
        if (procedure) return this.buildCall(id, parent, procedure, statement.args)
        if (statement.name === RAW_STATEMENT) {
          const [only] = statement.args
          const json = statement.args.length === 1 && only ? literalText(only) : undefined
          if (json === undefined) this.fail(`${RAW_STATEMENT}() takes the block's JSON as one string`)
          return this.insertRaw(json, parent)
        }
        const spec = blockSpec(statement.name)
        if (!spec) this.fail(`Unknown block "${statement.name}"`)
        if (spec.shape !== 'statement' && spec.shape !== 'cap') {
          this.fail(`${statement.name}() gives a value; use it inside another block, e.g. say(${statement.name}())`)
        }
        this.blocks[id] = block(spec.opcode, parent)
        this.fillArgs(id, spec, statement.args)
        return id
      }
    }
  }

  private buildCall(id: string, parent: string | null, procedure: Procedure, args: ExprNode[]): string {
    if (args.length !== procedure.params.length) {
      this.fail(`This block takes ${procedure.params.length} input${procedure.params.length === 1 ? '' : 's'}`)
    }
    const call = (this.blocks[id] = block('procedures_call', parent, {
      mutation: {
        tagName: 'mutation',
        children: [],
        proccode: procedure.proccode,
        argumentids: JSON.stringify(procedure.argumentIds),
        warp: 'false',
      },
    }))
    args.forEach((arg, i) => {
      const argumentId = procedure.argumentIds[i] ?? ''
      const input =
        procedure.types[i] === 'boolean'
          ? this.place(arg, id, { kind: 'boolean', shadow: null })
          : this.placeValue(arg, id, TEXT_PRIMITIVE)
      if (input) call.inputs[argumentId] = input
    })
    return id
  }

  private fillArgs(id: string, spec: BlockSpec, args: ExprNode[]) {
    const target = this.blocks[id] as SerializedBlock
    if (args.length !== spec.args.length) {
      this.fail(
        `${spec.name}() takes ${spec.args.length} input${spec.args.length === 1 ? '' : 's'}, not ${args.length}`,
      )
    }
    spec.args.forEach((argSpec, i) => {
      const arg = args[i]
      if (arg) this.fillArg(target, id, argSpec, arg)
    })
    if (spec.opcode === 'control_stop') {
      const option = String(target.fields.STOP_OPTION?.[0] ?? '')
      target.mutation = { tagName: 'mutation', children: [], hasnext: String(option.startsWith('other scripts')) }
    }
  }

  private fillArg(target: SerializedBlock, id: string, spec: ArgSpec, arg: ExprNode) {
    // Menus also name a field, so they are matched before plain fields.
    if ('menu' in spec) {
      const menuId = this.newId()
      const value = literalText(arg)
      this.blocks[menuId] = block(spec.menu, id, {
        shadow: true,
        fields: { [spec.field]: [value ?? spec.default, null] },
      })
      if (value !== undefined) {
        target.inputs[spec.input] = [INPUT_SAME_BLOCK_SHADOW, menuId]
      } else {
        const input = this.place(arg, id, { kind: 'text', shadow: menuId })
        if (input) target.inputs[spec.input] = input
      }
      return
    }
    if ('field' in spec || 'broadcastField' in spec) {
      const value = literalText(arg)
      const field = 'field' in spec ? spec.field : spec.broadcastField
      if (value === undefined) this.fail(`Write the ${field.toLowerCase()} as text in quotes`)
      target.fields[field] = 'field' in spec ? [value, null] : [value, this.broadcastId(value)]
      return
    }
    if ('list' in spec || 'variable' in spec) {
      if (arg.kind !== 'name') this.fail(`Write the ${'list' in spec ? 'list' : 'variable'} by name`)
      if ('variable' in spec) {
        const resolved = resolveName(arg.name, this.scope)
        if (resolved.kind !== 'variable') this.fail(`"${arg.name}" is not a variable`)
        target.fields.VARIABLE = [resolved.name, resolved.id]
      } else {
        target.fields.LIST = [arg.name, this.listId(arg.name)]
      }
      return
    }
    if ('broadcastInput' in spec) {
      const name = literalText(arg)
      if (name !== undefined) {
        target.inputs[spec.broadcastInput] = [
          INPUT_SAME_BLOCK_SHADOW,
          [BROADCAST_PRIMITIVE, name, this.broadcastId(name)],
        ]
      } else {
        const fallback = Object.values(this.stage?.broadcasts ?? {})[0] ?? 'message1'
        const input = this.place(arg, id, {
          kind: 'text',
          shadow: [BROADCAST_PRIMITIVE, fallback, this.broadcastId(fallback)],
        })
        if (input) target.inputs[spec.broadcastInput] = input
      }
      return
    }
    if ('boolean' in spec) {
      const input = this.place(arg, id, { kind: 'boolean', shadow: null })
      if (input) target.inputs[spec.input] = input
      return
    }
    target.inputs[spec.input] = this.placeValue(arg, id, spec.primitive)
  }

  private placeValue(node: ExprNode, parentId: string, primitive: number): SerializedInput {
    const input = this.place(node, parentId, {
      kind: primitive === TEXT_PRIMITIVE ? 'text' : 'number',
      shadow: [primitive, ''],
    })
    if (!input) this.fail('This input needs a value')
    return input
  }

  private place(node: ExprNode, parentId: string, slot: Slot): SerializedInput | undefined {
    const ctx: LowerContext = {
      blocks: this.blocks,
      scope: this.scope,
      newId: () => this.newId(),
      placeReporter: (reporter, reporterParent, reporterSlot, rootId) =>
        this.placeReporter(reporter, reporterParent, reporterSlot, rootId),
      onUnknownName: (name) => this.fail(`Unknown variable "${name}" (assign it first, e.g. ${name} = 0)`),
    }
    try {
      return placeInSlot(node, parentId, slot, ctx)
    } catch (error) {
      if (error instanceof ExprTypeError) this.fail(error.message)
      throw error
    }
  }

  private placeReporter(
    node: ReporterNode,
    parentId: string,
    slot: Slot,
    rootId?: string,
  ): SerializedInput | undefined {
    let id: string
    let isBoolean: boolean
    if (node.name === RAW_REPORTER) {
      const [only] = node.args
      const json = node.args.length === 1 && only ? literalText(only) : undefined
      if (json === undefined) this.fail(`${RAW_REPORTER}() takes the block's JSON as one string`)
      id = this.insertRaw(json, parentId)
      const inserted = this.blocks[id]
      isBoolean = isBlock(inserted) && isBooleanOpcode(inserted.opcode)
    } else {
      const spec = blockSpec(node.name)
      if (!spec) this.fail(`Unknown function "${node.name}"`)
      if (spec.shape !== 'reporter' && spec.shape !== 'boolean') {
        this.fail(`${node.name}() is a statement and cannot be used as a value`)
      }
      id = rootId ?? this.newId()
      this.blocks[id] = block(spec.opcode, parentId)
      this.fillArgs(id, spec, node.args)
      isBoolean = spec.shape === 'boolean'
    }
    if (slot.kind === 'boolean') {
      if (!isBoolean) this.fail(`${node.name}() is not true/false, so it cannot go in a condition`)
      return [INPUT_BLOCK_NO_SHADOW, id]
    }
    return slot.shadow === null ? [INPUT_BLOCK_NO_SHADOW, id] : [INPUT_DIFF_BLOCK_SHADOW, id, slot.shadow]
  }

  /** Copy a raw block (and its nested blocks) in with fresh IDs; returns the root's new ID. */
  private insertRaw(json: string, parent: string | null): string {
    let raw: RawBlockJson
    try {
      raw = JSON.parse(json) as RawBlockJson
    } catch {
      this.fail(`${RAW_STATEMENT}() contains broken JSON`)
    }
    const ids = new Map(Object.keys(raw.blocks).map((oldId) => [oldId, this.newId()]))
    const remap = (value: unknown): unknown => (typeof value === 'string' && ids.has(value) ? ids.get(value) : value)
    for (const [oldId, value] of Object.entries(raw.blocks)) {
      const newId = ids.get(oldId)
      if (!newId) continue
      if (Array.isArray(value)) {
        this.blocks[newId] = value as TopLevelPrimitive
        continue
      }
      const copy = JSON.parse(JSON.stringify(value)) as SerializedBlock
      copy.parent = oldId === raw.root ? parent : (remap(copy.parent) as string | null)
      copy.next = oldId === raw.root ? null : (remap(copy.next) as string | null)
      if (oldId === raw.root) {
        copy.topLevel = false
        delete copy.x
        delete copy.y
      }
      for (const input of Object.values(copy.inputs)) {
        for (let i = 1; i < input.length; i++) input[i] = remap(input[i]) as InputValue
      }
      delete copy.comment
      this.blocks[newId] = copy
    }
    const rootId = ids.get(raw.root)
    if (!rootId) this.fail(`${RAW_STATEMENT}() JSON has no root block`)
    return rootId
  }

  private listId(name: string): string {
    const find = (lists: SerializedTarget['lists'] | undefined) =>
      Object.entries(lists ?? {}).find(([, [listName]]) => listName === name)?.[0]
    const existing =
      find(this.target.lists) ?? find(this.newLists) ?? (this.target.isStage ? undefined : find(this.stage?.lists))
    if (existing) return existing
    const id = this.newId()
    this.newLists[id] = [name, []]
    return id
  }

  private broadcastId(name: string): string {
    const all = { ...this.stage?.broadcasts, ...this.target.broadcasts, ...this.newBroadcasts }
    const existing = Object.entries(all).find(([, broadcastName]) => broadcastName === name)?.[0]
    if (existing) return existing
    const id = this.newId()
    this.newBroadcasts[id] = name
    return id
  }
}

const BOOLEAN_OPCODES =
  /^(operator_(lt|gt|equals|and|or|not|contains)|sensing_(touching|keypressed|mousedown|coloris)|data_listcontainsitem)/
const isBooleanOpcode = (opcode: string): boolean => BOOLEAN_OPCODES.test(opcode)

/**
 * Build the blocks for a target from its scripts. Throws TextSyntaxError (with a line number) for mistakes.
 * @param target - the target being replaced (its variables, lists and broadcasts are used for name lookups).
 * @param stage - the stage target, for global variables and broadcasts (undefined when the target is the stage).
 */
export const blocksFromScripts = (
  target: SerializedTarget,
  stage: SerializedTarget | undefined,
  scripts: Script[],
): BuildResult => {
  const builder = new ScriptBuilder(target, stage, scripts)
  builder.build(scripts)
  return {
    blocks: builder.blocks,
    newVariables: builder.newVariables,
    newLists: builder.newLists,
    newBroadcasts: builder.newBroadcasts,
  }
}

export { isBooleanNode, NUMBER_LITERAL_RE }
