/**
 * Types and helpers for the serialized sb3 `project.json` format, as produced by scratch-vm's
 * `serialization/sb3.js`.
 */

/** Input type tags (first element of a serialized input). */
export const INPUT_SAME_BLOCK_SHADOW = 1
export const INPUT_BLOCK_NO_SHADOW = 2
export const INPUT_DIFF_BLOCK_SHADOW = 3

/** Compressed primitive type tags. */
export const MATH_NUM_PRIMITIVE = 4
export const POSITIVE_NUM_PRIMITIVE = 5
export const WHOLE_NUM_PRIMITIVE = 6
export const INTEGER_NUM_PRIMITIVE = 7
export const ANGLE_NUM_PRIMITIVE = 8
export const COLOR_PICKER_PRIMITIVE = 9
export const TEXT_PRIMITIVE = 10
export const BROADCAST_PRIMITIVE = 11
export const VAR_PRIMITIVE = 12
export const LIST_PRIMITIVE = 13

/** `[type, value]` for literals, `[type, name, id]` for variables, lists and broadcasts. */
export type CompressedPrimitive = [number, string | number] | [number, string, string]

/** A top-level compressed primitive also carries its workspace position. */
export type TopLevelPrimitive = [number, string, string, number, number]

/** What an input slot points at: a block ID, a compressed primitive, or nothing. */
export type InputValue = string | CompressedPrimitive | null

export type SerializedInput =
  | [typeof INPUT_SAME_BLOCK_SHADOW, InputValue]
  | [typeof INPUT_BLOCK_NO_SHADOW, InputValue]
  | [typeof INPUT_DIFF_BLOCK_SHADOW, InputValue, InputValue]

export interface SerializedMutation {
  tagName: string
  children: unknown[]
  proccode?: string
  argumentids?: string
  argumentnames?: string
  argumentdefaults?: string
  warp?: string
  [key: string]: unknown
}

export interface SerializedBlock {
  opcode: string
  next: string | null
  parent: string | null
  inputs: Record<string, SerializedInput>
  fields: Record<string, [string, string | null] | [string]>
  shadow: boolean
  topLevel: boolean
  x?: number
  y?: number
  comment?: string
  mutation?: SerializedMutation
}

export type BlockMap = Record<string, SerializedBlock | TopLevelPrimitive>

export interface SerializedTarget {
  isStage: boolean
  name: string
  variables: Record<string, [string, unknown] | [string, unknown, boolean]>
  lists: Record<string, [string, unknown[]]>
  broadcasts: Record<string, string>
  blocks: BlockMap
  comments?: Record<string, { blockId?: string | null; [key: string]: unknown }>
  [key: string]: unknown
}

export interface SerializedProject {
  targets: SerializedTarget[]
  monitors?: unknown[]
  extensions: string[]
  meta: Record<string, unknown>
}

/** Either a whole project or a single sprite (sprite3 export). */
export type SerializedJson = SerializedProject | SerializedTarget

export const isProject = (json: SerializedJson): json is SerializedProject =>
  Array.isArray((json as SerializedProject).targets)

export const targetsOf = (json: SerializedJson): SerializedTarget[] => (isProject(json) ? json.targets : [json])

export const isBlock = (value: SerializedBlock | TopLevelPrimitive | undefined): value is SerializedBlock =>
  typeof value === 'object' && !Array.isArray(value)

/**
 * Return the block with the given ID, or undefined if it is missing or a top-level primitive.
 */
export const getBlock = (blocks: BlockMap, id: unknown): SerializedBlock | undefined => {
  if (typeof id !== 'string') return undefined
  const block = blocks[id]
  return isBlock(block) ? block : undefined
}

/**
 * The value an input currently holds (the non-shadow part when the shadow is obscured).
 */
export const inputValue = (input: SerializedInput | undefined): InputValue => (input ? input[1] : null)

/**
 * The shadow an input holds: its own value for type 1, its third element for type 3, none for type 2.
 */
export const inputShadow = (input: SerializedInput | undefined): InputValue => {
  if (!input) return null
  if (input[0] === INPUT_SAME_BLOCK_SHADOW) return input[1]
  if (input[0] === INPUT_DIFF_BLOCK_SHADOW) return input[2]
  return null
}

/**
 * Find the topmost block of the script that contains `id`.
 */
export const topOfScript = (blocks: BlockMap, id: string): SerializedBlock | undefined => {
  let current = getBlock(blocks, id)
  const seen = new Set<string>()
  let currentId = id
  while (current?.parent && !seen.has(currentId)) {
    seen.add(currentId)
    currentId = current.parent
    current = getBlock(blocks, currentId)
  }
  return current
}

/**
 * Find, in `parent`, the name of the input whose value is the block `childId`.
 */
export const inputNameHolding = (parent: SerializedBlock, childId: string): string | undefined =>
  Object.keys(parent.inputs).find((name) => parent.inputs[name]?.[1] === childId)

/**
 * Remove a block and every block nested in its inputs (not its `next` chain).
 */
export const deleteBlockTree = (blocks: BlockMap, id: string): void => {
  const block = getBlock(blocks, id)
  if (!block) return
  for (const input of Object.values(block.inputs)) {
    for (const value of input.slice(1)) {
      if (typeof value === 'string' && getBlock(blocks, value)?.parent === id) deleteBlockTree(blocks, value)
    }
  }
  delete blocks[id]
}
