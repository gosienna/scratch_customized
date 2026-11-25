/**
 * How names in an expression resolve, in priority order:
 *   1. a parameter of the custom block whose definition contains the expression
 *   2. a block-local variable of that custom block (stored as the sprite variable `<block label>::<name>`)
 *   3. a variable of the sprite ("for this sprite only")
 *   4. a variable of the stage ("for all sprites")
 * Unknown names evaluate to 0, matching how they are saved.
 */
import { localVariableName } from '../local-vars'

export type ParamType = 'number' | 'boolean'

export interface ExprScope {
  /** Parameters of the enclosing custom block definition, by name. */
  params: Map<string, ParamType>
  /** The proccode of the enclosing custom block definition, if any. */
  proccode?: string
  /** Look up a variable of the current target (sprite, or the stage itself) by exact name; returns its ID. */
  findTargetVariable: (name: string) => string | undefined
  /** Look up a stage variable by exact name; returns its ID. */
  findStageVariable: (name: string) => string | undefined
}

export type ResolvedName =
  | { kind: 'param'; name: string; type: ParamType }
  | { kind: 'variable'; id: string; name: string }
  | { kind: 'unknown'; name: string }

export const resolveName = (name: string, scope: ExprScope): ResolvedName => {
  const paramType = scope.params.get(name)
  if (paramType) return { kind: 'param', name, type: paramType }
  if (scope.proccode) {
    const localName = localVariableName(scope.proccode, name)
    const localId = scope.findTargetVariable(localName)
    if (localId) return { kind: 'variable', id: localId, name: localName }
  }
  const targetId = scope.findTargetVariable(name)
  if (targetId) return { kind: 'variable', id: targetId, name }
  const stageId = scope.findStageVariable(name)
  if (stageId) return { kind: 'variable', id: stageId, name }
  return { kind: 'unknown', name }
}

/**
 * The name to write in an expression for a variable, or undefined if writing it would resolve to a different
 * variable (for example a stage variable hidden by a sprite variable with the same name).
 */
export const nameForVariable = (variableName: string, variableId: string, scope: ExprScope): string | undefined => {
  const candidates = [variableName]
  if (scope.proccode) {
    const prefix = localVariableName(scope.proccode, '')
    if (variableName.startsWith(prefix)) candidates.unshift(variableName.slice(prefix.length))
  }
  return candidates.find((candidate) => {
    const resolved = resolveName(candidate, scope)
    return resolved.kind === 'variable' && resolved.id === variableId
  })
}
