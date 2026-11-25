/** Build expression scopes from serialized sb3 JSON. */
import type { ExprScope, ParamType } from '../expr/scope'
import { argumentTypesOf } from '../local-vars'
import { type BlockMap, getBlock, type SerializedTarget, topOfScript } from './types'

export type VariableIndex = Map<string, string>

/** Parse a JSON-encoded string array from a procedure mutation (e.g. `argumentnames`). */
export const parseStringArray = (json: string | undefined): string[] => {
  if (!json) return []
  const parsed: unknown = JSON.parse(json)
  return Array.isArray(parsed) ? parsed.map(String) : []
}

/**
 * Index scalar variables by name. When names repeat, the first one wins, as in scratch-vm's lookup.
 */
export const indexVariables = (variables: SerializedTarget['variables'] | undefined): VariableIndex => {
  const index: VariableIndex = new Map()
  for (const [id, [name]] of Object.entries(variables ?? {})) if (!index.has(name)) index.set(name, id)
  return index
}

export interface ProcedureInfo {
  proccode: string
  params: Map<string, ParamType>
}

/**
 * If the block with this ID is inside a custom block definition, describe that custom block.
 */
export const enclosingProcedure = (blocks: BlockMap, blockId: string): ProcedureInfo | undefined => {
  const top = topOfScript(blocks, blockId)
  if (top?.opcode !== 'procedures_definition') return undefined
  const prototype = getBlock(blocks, top.inputs.custom_block?.[1])
  const mutation = prototype?.mutation
  if (!prototype || !mutation?.proccode) return undefined
  const names = parseStringArray(mutation.argumentnames)
  const params = new Map<string, ParamType>()
  const types = argumentTypesOf(mutation.proccode)
  names.forEach((name, i) => params.set(name, types[i] ?? 'number'))
  return { proccode: mutation.proccode, params }
}

export const scopeForBlock = (
  target: SerializedTarget,
  stageVariables: VariableIndex,
  blockId: string,
): ExprScope => {
  const targetVariables = indexVariables(target.variables)
  const procedure = enclosingProcedure(target.blocks, blockId)
  return {
    params: procedure?.params ?? new Map<string, ParamType>(),
    proccode: procedure?.proccode,
    findTargetVariable: (name) => targetVariables.get(name),
    findStageVariable: (name) => (target.isStage ? undefined : stageVariables.get(name)),
  }
}
