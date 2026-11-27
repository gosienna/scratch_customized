/**
 * Keeps the recent browser console output and uncaught errors so the assistant can read them. Errors thrown
 * while a VM thread runs are tagged with the block and sprite that was running.
 */
import type { AssistantVm } from './vm-types'

export type LogLevel = 'error' | 'warn' | 'log'

export interface LogEntry {
  seq: number
  time: number
  level: LogLevel
  text: string
  sprite?: string
  blockId?: string
}

const MAX_ENTRIES = 300
const MAX_TEXT = 2000

const describeValue = (value: unknown): string => {
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  if (typeof value === 'string') return value
  try {
    // JSON.stringify gives undefined for undefined and functions.
    const json = JSON.stringify(value) as string | undefined
    return json ?? String(value)
  } catch {
    return String(value)
  }
}

export class ConsoleCapture {
  private entries: LogEntry[] = []
  private nextSeq = 1
  private vm: AssistantVm | undefined
  private installed = false

  /** Tag later errors with the VM thread that was running when they were thrown. */
  setVm(vm: AssistantVm): void {
    this.vm = vm
  }

  /** The sequence number the next entry will get. */
  get cursor(): number {
    return this.nextSeq
  }

  record(level: LogLevel, values: unknown[], tagThread = false): LogEntry {
    const text = values.map(describeValue).join(' ')
    const entry: LogEntry = {
      seq: this.nextSeq++,
      time: Date.now(),
      level,
      text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text,
    }
    const thread = tagThread ? this.vm?.runtime.sequencer.activeThread : undefined
    if (thread) {
      entry.sprite = thread.target.getName()
      const blockId = thread.peekStack()
      if (blockId) entry.blockId = blockId
    }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.shift()
    return entry
  }

  getLogs(options: { sinceSeq?: number; levels?: LogLevel[]; limit?: number } = {}): LogEntry[] {
    const { sinceSeq = 0, levels, limit = 50 } = options
    const matching = this.entries.filter(
      (entry) => entry.seq >= sinceSeq && (!levels || levels.includes(entry.level)),
    )
    return matching.slice(-limit)
  }

  /** Wrap console.error/warn/log (the originals still run) and listen for uncaught errors. */
  install(win: Window & typeof globalThis): void {
    if (this.installed) return
    this.installed = true
    const levels: LogLevel[] = ['error', 'warn', 'log']
    for (const level of levels) {
      const original = win.console[level].bind(win.console)
      win.console[level] = (...values: unknown[]) => {
        this.record(level, values, level === 'error')
        original(...values)
      }
    }
    win.addEventListener('error', (event) => {
      this.record('error', [event.error ?? event.message], true)
    })
    win.addEventListener('unhandledrejection', (event) => {
      this.record('error', ['Unhandled promise rejection:', event.reason], true)
    })
  }
}

/** The capture shared by the editor page. */
export const consoleCapture = new ConsoleCapture()

export const installConsoleCapture = (win: Window & typeof globalThis, vm?: AssistantVm): ConsoleCapture => {
  consoleCapture.install(win)
  if (vm) consoleCapture.setVm(vm)
  return consoleCapture
}
