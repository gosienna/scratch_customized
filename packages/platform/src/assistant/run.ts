/**
 * Test runs for the assistant: run the whole project (green flag) or one script, for at most a few seconds,
 * and report what happened.
 */
import { type ConsoleCapture, consoleCapture } from './console-capture'
import { findTarget, isProjectRunning, targetState, type TargetState } from './project-summary'
import type { AssistantThread, AssistantVm } from './vm-types'

export const DEFAULT_RUN_SECONDS = 3
export const MAX_RUN_SECONDS = 15
const MAX_LIST = 40
/** Lines of an error's stack trace kept in a report. */
const ERROR_LINES = 4

/** How a run waits: `now` in milliseconds, `wait` lets the VM run for a while. */
export interface RunClock {
  now: () => number
  wait: () => Promise<void>
}

export interface RunOptions {
  seconds?: number
  capture?: ConsoleCapture
  clock?: RunClock
  signal?: AbortSignal
}

export interface RunReport {
  /** True when everything the run started finished by itself; false when it was stopped at the time limit. */
  finished: boolean
  stoppedBy?: 'time limit' | 'user'
  seconds: number
  said: { sprite: string; kind: string; text: string }[]
  /** Values shown in a bubble when a reporter block is run on its own. */
  reported: { blockId: string; value: string }[]
  scriptsStarted: { sprite: string; topBlockId: string; hat: string }[]
  errors: { text: string; sprite?: string; blockId?: string; count: number }[]
  changes: { target: string; what: string; before: unknown; after: unknown }[]
}

const browserClock: RunClock = {
  now: () => Date.now(),
  wait: () => new Promise((resolve) => setTimeout(resolve, 50)),
}

const clampSeconds = (seconds: number | undefined): number =>
  Math.min(MAX_RUN_SECONDS, Math.max(0.1, seconds ?? DEFAULT_RUN_SECONDS))

const snapshot = (vm: AssistantVm): Map<string, TargetState> => {
  const states = new Map<string, TargetState>()
  for (const target of vm.runtime.targets) {
    if (!target.isOriginal) continue
    const clones = vm.runtime.targets.filter((t) => !t.isOriginal && t.getName() === target.getName()).length
    states.set(target.getName(), targetState(target, clones))
  }
  return states
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

const diffStates = (before: Map<string, TargetState>, after: Map<string, TargetState>): RunReport['changes'] => {
  const changes: RunReport['changes'] = []
  for (const [name, end] of after) {
    const start = before.get(name)
    if (!start) continue
    for (const what of ['x', 'y', 'direction', 'size', 'visible', 'costume', 'clones'] as const) {
      if (!same(start[what] ?? 0, end[what] ?? 0)) {
        changes.push({ target: name, what, before: start[what] ?? 0, after: end[what] ?? 0 })
      }
    }
    for (const kind of ['variables', 'lists'] as const) {
      for (const variable of end[kind]) {
        const old = start[kind].find((candidate) => candidate.name === variable.name)
        if (!old || !same(old.value, variable.value)) {
          changes.push({
            target: name,
            what: `${kind === 'lists' ? 'list' : 'variable'} ${variable.name}`,
            before: old?.value,
            after: variable.value,
          })
        }
      }
    }
  }
  return changes
}

const groupErrors = (capture: ConsoleCapture, sinceSeq: number): RunReport['errors'] => {
  const groups = new Map<string, RunReport['errors'][number]>()
  for (const entry of capture.getLogs({ sinceSeq, levels: ['error', 'warn'], limit: 300 })) {
    // A block that keeps failing throws each frame; the same message from the same block is one problem.
    const lines = entry.text.split('\n')
    const key = `${lines[0]}\u0000${entry.blockId ?? ''}`
    const group = groups.get(key)
    if (group) group.count++
    else {
      const text = lines.slice(0, ERROR_LINES).join('\n')
      groups.set(key, { text, sprite: entry.sprite, blockId: entry.blockId, count: 1 })
    }
  }
  return [...groups.values()].slice(0, MAX_LIST)
}

/**
 * Run `start`, let the VM run until `isDone` or the time limit, and report what happened. `stop` is called when
 * the run has to be cut short.
 */
const observeRun = async (
  vm: AssistantVm,
  options: RunOptions,
  start: (started: AssistantThread[]) => void,
  isDone: (started: AssistantThread[]) => boolean,
  stop: (started: AssistantThread[]) => void,
): Promise<RunReport> => {
  const capture = options.capture ?? consoleCapture
  const clock = options.clock ?? browserClock
  const limitMs = clampSeconds(options.seconds) * 1000
  const runtime = vm.runtime
  if (!runtime._steppingInterval && !options.clock) vm.start()

  const report: RunReport = {
    finished: false,
    seconds: 0,
    said: [],
    reported: [],
    scriptsStarted: [],
    errors: [],
    changes: [],
  }
  const before = snapshot(vm)
  const firstSeq = capture.cursor
  const started: AssistantThread[] = []

  const onSay = (target: { getName: () => string }, kind: string, text: unknown) => {
    if (report.said.length < MAX_LIST && text !== '') {
      report.said.push({ sprite: target.getName(), kind, text: String(text) })
    }
  }
  const onReport = (data: { id: string; value: string }) => {
    if (report.reported.length < MAX_LIST) report.reported.push({ blockId: data.id, value: data.value })
  }
  const pushThread = runtime._pushThread
  runtime._pushThread = (...args) => {
    const thread = pushThread.apply(runtime, args)
    if (!thread.updateMonitor) {
      started.push(thread)
      if (report.scriptsStarted.length < MAX_LIST) {
        report.scriptsStarted.push({
          sprite: thread.target.getName(),
          topBlockId: thread.topBlock,
          hat: thread.target.blocks.getBlock(thread.topBlock)?.opcode ?? '',
        })
      }
    }
    return thread
  }
  runtime.on('SAY', onSay)
  runtime.on('VISUAL_REPORT', onReport)

  const startTime = clock.now()
  try {
    start(started)
    while (!isDone(started)) {
      if (options.signal?.aborted) {
        report.stoppedBy = 'user'
        break
      }
      if (clock.now() - startTime >= limitMs) {
        report.stoppedBy = 'time limit'
        break
      }
      try {
        await clock.wait()
      } catch (error) {
        // A clock that steps the VM itself sees errors that the browser reports as uncaught.
        capture.record('error', [error], true)
      }
    }
    report.finished = !report.stoppedBy
    if (!report.finished) stop(started)
  } finally {
    runtime._pushThread = pushThread
    runtime.removeListener('SAY', onSay)
    runtime.removeListener('VISUAL_REPORT', onReport)
  }
  report.seconds = Math.round((clock.now() - startTime) / 100) / 10
  report.errors = groupErrors(capture, firstSeq)
  report.changes = diffStates(before, snapshot(vm)).slice(0, MAX_LIST * 2)
  return report
}

/** Click the green flag and watch the project until every script stops or the time limit is reached. */
export const runProject = (vm: AssistantVm, options: RunOptions = {}): Promise<RunReport> =>
  observeRun(
    vm,
    options,
    () => vm.greenFlag(),
    () => !isProjectRunning(vm),
    () => vm.stopAll(),
  )

/**
 * Run one sprite's script starting at `blockId`: a script's top block, or any block inside it (such as a loop),
 * in which case the run starts at that block and continues to the end of its stack. Scripts it starts (for
 * example by broadcasting) are watched too, and stopped with it at the time limit.
 */
export const runScript = (
  vm: AssistantVm,
  sprite: string,
  blockId: string,
  options: RunOptions = {},
): Promise<RunReport> => {
  const target = findTarget(vm, sprite)
  if (!target.blocks.getBlock(blockId)) {
    throw new Error(`Sprite "${sprite}" has no block with id "${blockId}". Use get_sprite_scripts to see the ids.`)
  }
  return observeRun(
    vm,
    options,
    () => {
      vm.runtime._pushThread(blockId, target, { stackClick: true })
    },
    (started) => started.every((thread) => !vm.runtime.isActiveThread(thread)),
    (started) => {
      for (const thread of started) if (vm.runtime.isActiveThread(thread)) vm.runtime._stopThread(thread)
    },
  )
}
