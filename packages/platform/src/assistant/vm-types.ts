/** The parts of scratch-vm the assistant reads and drives. */

export interface AssistantCostume {
  name: string
  dataFormat: string
  rotationCenterX: number
  rotationCenterY: number
  bitmapResolution?: number
  /** Size on the stage in pixels; set once the renderer has loaded the costume. */
  size?: [number, number]
  asset?: { data: Uint8Array; dataFormat: string }
}

export interface AssistantVariable {
  id: string
  name: string
  type: string
  value: unknown
}

export interface AssistantBlock {
  id: string
  opcode: string
  next: string | null
  parent: string | null
  topLevel: boolean
  shadow: boolean
  inputs: Record<string, { name: string; block: string | null; shadow: string | null }>
  fields: Record<string, { name: string; value: unknown }>
  mutation?: { proccode?: string }
}

export interface AssistantThread {
  topBlock: string
  target: AssistantTarget
  status: number
  isKilled: boolean
  updateMonitor: boolean
  stack: string[]
  peekStack: () => string | undefined
}

export interface AssistantTarget {
  id: string
  isStage: boolean
  isOriginal: boolean
  x: number
  y: number
  direction: number
  size: number
  visible: boolean
  currentCostume: number
  getName: () => string
  getCostumes: () => AssistantCostume[]
  variables: Record<string, AssistantVariable>
  blocks: {
    getBlock: (id: string) => AssistantBlock | undefined
    getScripts: () => string[]
    getTopLevelScript: (id: string) => string | null
  }
}

export interface AssistantRuntime {
  targets: AssistantTarget[]
  threads: AssistantThread[]
  sequencer: { activeThread: AssistantThread | null }
  _steppingInterval: unknown
  _pushThread: (id: string, target: AssistantTarget, opts?: { stackClick?: boolean }) => AssistantThread
  _stopThread: (thread: AssistantThread) => void
  isActiveThread: (thread: AssistantThread) => boolean
  getSpriteTargetByName: (name: string) => AssistantTarget | undefined
  getTargetForStage: () => AssistantTarget | undefined
  on: (event: string, listener: (...args: never[]) => void) => unknown
  removeListener: (event: string, listener: (...args: never[]) => void) => unknown
}

export interface AssistantVm {
  runtime: AssistantRuntime
  editingTarget: AssistantTarget | null
  toJSON: () => string
  start: () => void
  greenFlag: () => void
  stopAll: () => void
}
