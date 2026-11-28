/** What the assistant is told about a project: its sprites and their state, and each sprite's scripts. */
import type { SerializedProject } from '../sb3/types'
import { printScripts } from '../text/dialects'
import { scriptRootIds, scriptsFromTarget } from '../text/from-blocks'
import type { AssistantBlock, AssistantCostume, AssistantTarget, AssistantVm } from './vm-types'

export interface VariableState {
  name: string
  value: unknown
}

export interface TargetState {
  name: string
  isStage: boolean
  x?: number
  y?: number
  direction?: number
  size?: number
  visible?: boolean
  costume: string
  clones?: number
  variables: VariableState[]
  lists: VariableState[]
}

type OverviewTarget = TargetState & { scriptCount: number; costumes: string[] }

export interface ProjectOverview {
  editingSprite: string | null
  running: boolean
  stage: OverviewTarget
  sprites: OverviewTarget[]
}

export interface ScriptDescription {
  /** The id of the script's top block. */
  id: string
  /** The script in Python-style text, as Text mode shows it. */
  code: string
  /** Loops and other C-blocks in the script with their block ids, indented by nesting. */
  outline: string[]
}

const SHORT_ROUND = (value: number) => Math.round(value * 100) / 100

export const targetState = (target: AssistantTarget, clones?: number): TargetState => {
  const variables: VariableState[] = []
  const lists: VariableState[] = []
  for (const variable of Object.values(target.variables)) {
    if (variable.type === '') variables.push({ name: variable.name, value: variable.value })
    else if (variable.type === 'list') lists.push({ name: variable.name, value: variable.value })
  }
  const costume = target.getCostumes()[target.currentCostume]?.name ?? ''
  if (target.isStage) return { name: target.getName(), isStage: true, costume, variables, lists }
  return {
    name: target.getName(),
    isStage: false,
    x: SHORT_ROUND(target.x),
    y: SHORT_ROUND(target.y),
    direction: SHORT_ROUND(target.direction),
    size: SHORT_ROUND(target.size),
    visible: target.visible,
    costume,
    ...(clones ? { clones } : {}),
    variables,
    lists,
  }
}

export const isProjectRunning = (vm: AssistantVm): boolean =>
  vm.runtime.threads.some((thread) => !thread.updateMonitor && vm.runtime.isActiveThread(thread))

export const describeProject = (vm: AssistantVm): ProjectOverview => {
  const originals = vm.runtime.targets.filter((target) => target.isOriginal)
  const cloneCount = (name: string) =>
    vm.runtime.targets.filter((target) => !target.isOriginal && target.getName() === name).length
  const withScripts = (target: AssistantTarget) => ({
    ...targetState(target, target.isStage ? undefined : cloneCount(target.getName())),
    scriptCount: target.blocks.getScripts().length,
    costumes: target.getCostumes().map((costume) => costume.name),
  })
  const stage = originals.find((target) => target.isStage)
  if (!stage) throw new Error('describeProject: the project has no stage')
  return {
    editingSprite: vm.editingTarget?.getName() ?? null,
    running: isProjectRunning(vm),
    stage: withScripts(stage),
    sprites: originals.filter((target) => !target.isStage).map(withScripts),
  }
}

export const findTarget = (vm: AssistantVm, name: string): AssistantTarget => {
  const target = vm.runtime.targets.find((candidate) => candidate.isOriginal && candidate.getName() === name)
  if (!target) {
    const names = vm.runtime.targets.filter((candidate) => candidate.isOriginal).map((c) => c.getName())
    throw new Error(`There is no sprite named "${name}". The sprites are: ${names.join(', ')}`)
  }
  return target
}

export const findCostume = (target: AssistantTarget, name: string): AssistantCostume => {
  const costumes = target.getCostumes()
  const costume = costumes.find((candidate) => candidate.name === name)
  if (!costume) {
    const names = costumes.map((candidate) => candidate.name).join(', ')
    throw new Error(`"${target.getName()}" has no costume named "${name}". Its costumes are: ${names}`)
  }
  return costume
}

const SUBSTACKS = ['SUBSTACK', 'SUBSTACK2']

const loopLabel = (target: AssistantTarget, block: AssistantBlock): string => {
  const name = block.opcode.replace(/^control_/, '')
  const timesId = block.inputs.TIMES?.block
  const times = timesId ? target.blocks.getBlock(timesId) : undefined
  const literal = times?.shadow ? Object.values(times.fields)[0]?.value : undefined
  return typeof literal === 'string' || typeof literal === 'number' ? `${name} (${literal})` : name
}

/** The C-blocks (loops, if/else, ...) of the stack starting at `id`. */
const outlineOf = (target: AssistantTarget, id: string | null, depth: number, lines: string[]): void => {
  for (let blockId = id; blockId;) {
    const block = target.blocks.getBlock(blockId)
    if (!block) return
    const substacks = SUBSTACKS.map((name) => block.inputs[name]).filter((input) => input !== undefined)
    if (substacks.length > 0) {
      lines.push(`${'  '.repeat(depth)}[${block.id}] ${loopLabel(target, block)}`)
      for (const input of substacks) outlineOf(target, input.block, depth + 1, lines)
    }
    blockId = block.next
  }
}

/** Every script of a sprite (or the stage), with its top-block id, its text and an outline of its loops. */
export const describeScripts = (vm: AssistantVm, name: string): ScriptDescription[] => {
  const target = findTarget(vm, name)
  const project = JSON.parse(vm.toJSON()) as SerializedProject
  const json = project.targets.find((candidate) => candidate.name === name)
  if (!json) throw new Error(`describeScripts: "${name}" is missing from the serialized project`)
  const ids = scriptRootIds(json)
  const scripts = scriptsFromTarget(json)
  return scripts.map((script, index) => {
    const id = ids[index] ?? ''
    const outline: string[] = []
    outlineOf(target, id, 0, outline)
    return { id, code: printScripts([script], 'python').trim(), outline }
  })
}
