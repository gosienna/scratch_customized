/**
 * scratch-vm implementations of the editor-only blocks. Expressions are evaluated by calling the VM's own
 * operator and argument-reporter primitives, so an expression gives exactly the result of the stock blocks it
 * is saved as.
 */
import { effectiveExpression } from '../compat/lower'
import { CONDITION_OPCODE, EXPRESSION_FIELD, EXPRESSION_OPCODE, MOUSE_UP_OPCODE } from '../compat/opcodes'
import { type ExprScope, type ParamType, resolveName } from '../expr/scope'
import { type ExprNode, operatorOf } from '../expr/syntax'
import { argumentTypesOf } from '../local-vars'
import { parseStringArray } from '../sb3/scope'

type Primitive = (args: Record<string, unknown>, util: VmUtil) => unknown

interface VmBlock {
  id: string
  opcode: string
  parent: string | null
  inputs: Record<string, { block: string | null }>
  mutation?: { proccode?: string; argumentids?: string; argumentnames?: string }
}

interface VmVariable {
  id: string
  name: string
  type: string
  value: unknown
}

interface VmTarget {
  isStage: boolean
  variables: Record<string, VmVariable>
  blocks: { getBlock: (id: string) => VmBlock | undefined; getTopLevelScript: (id: string) => string | null }
  runtime: { getTargetForStage: () => VmTarget | undefined }
  lookupVariableById: (id: string) => VmVariable | undefined
}

export interface VmUtil {
  target: VmTarget
  thread: { peekStack: () => string | undefined }
  ioQuery: (device: string, func: string, args?: unknown[]) => unknown
}

export interface VmLike {
  runtime: { getOpcodeFunction: (opcode: string) => Primitive | undefined }
  addPrimitives: (primitives: Record<string, Primitive>) => void
}

const findScalar = (target: VmTarget | undefined, name: string): string | undefined => {
  if (!target) return undefined
  for (const variable of Object.values(target.variables))
    if (variable.name === name && variable.type === '') return variable.id
  return undefined
}

/**
 * The scope of the script the thread is currently running.
 */
const scopeForThread = (util: VmUtil): ExprScope => {
  const target = util.target
  const params = new Map<string, ParamType>()
  let proccode: string | undefined
  const stackBlock = util.thread.peekStack()
  const topId = stackBlock ? target.blocks.getTopLevelScript(stackBlock) : null
  const top = topId ? target.blocks.getBlock(topId) : undefined
  if (top?.opcode === 'procedures_definition') {
    const prototypeId = top.inputs.custom_block?.block
    const prototype = prototypeId ? target.blocks.getBlock(prototypeId) : undefined
    if (prototype?.mutation?.proccode) {
      proccode = prototype.mutation.proccode
      const names = parseStringArray(prototype.mutation.argumentnames)
      const types = argumentTypesOf(proccode)
      names.forEach((name, i) => params.set(name, types[i] ?? 'number'))
    }
  }
  return {
    params,
    proccode,
    findTargetVariable: (name) => findScalar(target, name),
    findStageVariable: (name) => (target.isStage ? undefined : findScalar(target.runtime.getTargetForStage(), name)),
  }
}

export const createPrimitives = (vm: VmLike): Record<string, Primitive> => {
  const cache = new Map<string, ExprNode | 'false'>()
  const expressionFor = (opcode: string, source: string) => {
    const key = `${opcode}\u0000${source}`
    let node = cache.get(key)
    if (node === undefined) {
      node = effectiveExpression(opcode, source)
      cache.set(key, node)
    }
    return node
  }

  const callPrimitive = (opcode: string, args: Record<string, unknown>, util: VmUtil) => {
    const fn = vm.runtime.getOpcodeFunction(opcode)
    if (!fn) throw new Error(`createPrimitives: scratch-vm has no implementation for ${opcode}`)
    return fn(args, util)
  }

  const evaluate = (node: ExprNode, scope: ExprScope, util: VmUtil): unknown => {
    switch (node.kind) {
      case 'number':
        return node.text
      case 'string':
        return node.value
      case 'name': {
        const resolved = resolveName(node.name, scope)
        if (resolved.kind === 'variable') return util.target.lookupVariableById(resolved.id)?.value
        if (resolved.kind === 'param') {
          const opcode = resolved.type === 'boolean' ? 'argument_reporter_boolean' : 'argument_reporter_string_number'
          return callPrimitive(opcode, { VALUE: node.name }, util)
        }
        // Saved as the literal "0".
        return '0'
      }
      default: {
        const operator = operatorOf(node)
        if (!operator) throw new Error(`evaluate: unexpected ${node.kind} node`)
        const { spec, args } = operator
        const values: Record<string, unknown> = {}
        spec.inputs.forEach((input, i) => {
          const arg = args[i]
          if (arg) values[input.name] = evaluate(arg, scope, util)
        })
        if (spec.mathop) values.OPERATOR = spec.mathop
        return callPrimitive(spec.opcode, values, util)
      }
    }
  }

  const expressionPrimitive =
    (opcode: string): Primitive =>
    (args, util) => {
      const field = args[EXPRESSION_FIELD]
      const node = expressionFor(opcode, typeof field === 'string' ? field : '')
      if (node === 'false') return false
      return evaluate(node, scopeForThread(util), util)
    }

  return {
    [EXPRESSION_OPCODE]: expressionPrimitive(EXPRESSION_OPCODE),
    [CONDITION_OPCODE]: expressionPrimitive(CONDITION_OPCODE),
    [MOUSE_UP_OPCODE]: (_args, util) => !util.ioQuery('mouse', 'getIsDown'),
  }
}

/**
 * Register the editor-only blocks with a scratch-vm instance.
 */
export const installPrimitives = (vm: VmLike): void => vm.addPrimitives(createPrimitives(vm))
