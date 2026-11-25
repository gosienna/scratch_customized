/** Connect lowering and raising to scratch-vm's `setProjectTransforms` hook. */
import type { VariableIndex } from '../sb3/scope'
import type { SerializedJson } from '../sb3/types'
import { lowerProject, type TransformContext } from './lower'
import { raiseProject, type RaiseOptions } from './raise'

interface VmWithStage {
  runtime: {
    getTargetForStage: () => { variables: Record<string, { id: string; name: string; type: string }> } | undefined
  }
}

interface HookContext {
  vm: VmWithStage
  isSprite: boolean
}

const stageVariablesOf = (vm: VmWithStage): VariableIndex => {
  const index: VariableIndex = new Map()
  for (const variable of Object.values(vm.runtime.getTargetForStage()?.variables ?? {})) {
    if (variable.type === '' && !index.has(variable.name)) index.set(variable.name, variable.id)
  }
  return index
}

const contextFor = ({ vm, isSprite }: HookContext): TransformContext =>
  isSprite ? { stageVariables: stageVariablesOf(vm) } : {}

export interface ProjectTransformOptions {
  /** Whether loaded projects should be raised to Custom-mode blocks (true only in Custom mode). */
  shouldRaise: () => boolean
  raiseOptions?: () => RaiseOptions
}

export const createProjectTransforms = ({ shouldRaise, raiseOptions }: ProjectTransformOptions) => ({
  serialize: (json: SerializedJson, context: HookContext) => lowerProject(json, contextFor(context)),
  deserialize: (json: SerializedJson, context: HookContext) =>
    shouldRaise() ? raiseProject(json, raiseOptions?.() ?? {}, contextFor(context)) : json,
})
