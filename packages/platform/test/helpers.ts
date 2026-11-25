import type { SerializedBlock, SerializedProject, SerializedTarget } from '../src/sb3/types'

export const block = (opcode: string, extra: Partial<SerializedBlock> = {}): SerializedBlock => ({
  opcode,
  next: null,
  parent: null,
  inputs: {},
  fields: {},
  shadow: false,
  topLevel: false,
  ...extra,
})

export const target = (name: string, isStage: boolean, extra: Partial<SerializedTarget> = {}): SerializedTarget => ({
  isStage,
  name,
  variables: {},
  lists: {},
  broadcasts: {},
  blocks: {},
  comments: {},
  currentCostume: 0,
  costumes: [],
  sounds: [],
  volume: 100,
  layerOrder: isStage ? 0 : 1,
  ...extra,
})

export const project = (
  sprite: SerializedTarget,
  stage: SerializedTarget = target('Stage', true),
): SerializedProject => ({
  targets: [stage, sprite],
  monitors: [],
  extensions: [],
  meta: { semver: '3.0.0', vm: '0.0.0', agent: 'test' },
})

/**
 * A comparable form of a target's scripts: blocks are renamed by their position in a depth-first walk from each
 * top-level block, and obscured shadow values are dropped (they only affect what a slot shows when emptied).
 */
export const canonicalScripts = (t: SerializedTarget): unknown => {
  const names = new Map<string, string>()
  const walk = (id: string): unknown => {
    const b = t.blocks[id]
    if (Array.isArray(b)) return b
    names.set(id, `#${names.size}`)
    const inputs: Record<string, unknown> = {}
    for (const [key, input] of Object.entries(b.inputs)) {
      const value = input[1]
      inputs[key] = [input[0] === 3 ? 3 : input[0], typeof value === 'string' ? walk(value) : value]
    }
    return { opcode: b.opcode, fields: b.fields, inputs, mutation: b.mutation, next: b.next ? walk(b.next) : null }
  }
  return Object.keys(t.blocks)
    .filter((id) => {
      const b = t.blocks[id]
      return Array.isArray(b) || b.topLevel
    })
    .map((id) => walk(id))
}
