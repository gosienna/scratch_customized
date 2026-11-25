/** Helpers for tests that run projects in the in-repo scratch-vm (Node, no renderer). */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

const vmDir = path.resolve(here, '../../../scratch-vm')
export const requireFromVm = createRequire(path.join(vmDir, 'package.json'))

export type VM = any

export const createVm = (): VM => {
  const VirtualMachine = requireFromVm('./src/virtual-machine.js')
  const vm = new VirtualMachine()
  vm.runtime.currentStepTime = 1000 / 30
  // The sequencer runs threads until a wall-clock budget is used up. Count calls instead of milliseconds so
  // every run executes the same number of iterations per frame.
  let ticks = 0
  vm.runtime.sequencer.timer = {
    start: () => {
      ticks = 0
    },
    timeElapsed: () => ticks++,
  }
  return vm
}

export const fixturePath = (name: string) => path.join(vmDir, 'test/fixtures', name)

/** Validate JSON with scratch-parser, the validator scratch-vm and scratch.mit.edu use. */
export const validateWithScratchParser = (json: unknown, isSprite = false): Promise<void> =>
  new Promise((resolve, reject) => {
    const validate = requireFromVm('scratch-parser')
    validate(JSON.stringify(json), isSprite, (error: unknown) =>
      error ? reject(new Error(JSON.stringify(error))) : resolve(),
    )
  })

/** A deterministic replacement for Math.random (mulberry32). */
export const seededRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export type FrameState = Record<
  string,
  { x: number; y: number; direction: number; variables: Record<string, unknown> }
>

/** Run a loaded VM for `frames` frames, feeding mouse input and recording every target's state each frame. */
export const runFrames = (
  vm: VM,
  frames: number,
  mouseDownAt: (frame: number) => boolean,
  seed = 1,
): FrameState[] => {
  const originalRandom = Math.random
  Math.random = seededRandom(seed)
  try {
    vm.greenFlag()
    const states: FrameState[] = []
    for (let frame = 0; frame < frames; frame++) {
      vm.runtime.ioDevices.mouse.postData({
        isDown: mouseDownAt(frame),
        x: 240,
        y: 180,
        canvasWidth: 480,
        canvasHeight: 360,
      })
      vm.runtime._step()
      const state: FrameState = {}
      for (const target of vm.runtime.targets) {
        const variables: Record<string, unknown> = {}
        for (const variable of Object.values<{ name: string; value: unknown }>(target.variables)) {
          variables[variable.name] = variable.value
        }
        state[target.getName()] = { x: target.x, y: target.y, direction: target.direction, variables }
      }
      states.push(state)
    }
    return states
  } finally {
    Math.random = originalRandom
  }
}
