/**
 * The assistant's conversation: sends the learner's messages to Claude from the browser with the learner's own
 * API key, runs the tools Claude asks for against the editor's VM, and streams the reply.
 */
import type Anthropic from '@anthropic-ai/sdk'
import { type ConsoleCapture } from './console-capture'
import { describeProject } from './project-summary'
import { ASSISTANT_SYSTEM_PROMPT, turnContext } from './system-prompt'
import { type ProjectEditor, runTool, type ToolContext, type ToolOutput, toolsFor } from './tools'
import type { AssistantVm } from './vm-types'

/** The Claude models the learner can choose from; Haiku is the default. */
export const ASSISTANT_MODELS = {
  haiku: 'claude-haiku-5-5',
  sonnet: 'claude-sonnet-5-5',
  opus: 'claude-opus-5-5',
} as const
export type AssistantModelChoice = keyof typeof ASSISTANT_MODELS
export const ASSISTANT_MODEL = ASSISTANT_MODELS.haiku

/**
 * Opus 5.5 and Sonnet 5.5 can decline a request in their safety classifiers; with server-side fallbacks the API
 * re-runs a declined request on a model suited to it inside the same call. Haiku 5.5 has no server-side fallback.
 */
const fallbackParams = (model: string): Pick<Anthropic.Beta.MessageCreateParams, 'betas' | 'fallbacks'> =>
  model === ASSISTANT_MODELS.haiku ? {} : { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }
/** Model calls per learner message; each call after the first follows tool results. */
const MAX_STEPS = 12

export interface ToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface AssistantCallbacks {
  /** A piece of Claude's reply text. `step` counts model calls within this message, from 0. */
  onText?: (delta: string, step: number) => void
  onToolStart?: (call: ToolCall) => void
  /** `image` is set when the tool returned a picture (a costume). */
  onToolEnd?: (call: ToolCall, result: { ok: boolean } & ToolOutput) => void
}

/** Why a reply ended early, for the panel to explain. */
export type StopNotice = 'refusal' | 'max_tokens' | 'too_many_steps' | 'aborted'

export type AssistantErrorKind = 'auth' | 'permission' | 'rate_limit' | 'overloaded' | 'connection' | 'other'

export class AssistantError extends Error {
  readonly kind: AssistantErrorKind

  constructor(kind: AssistantErrorKind, message: string) {
    super(message)
    this.name = 'AssistantError'
    this.kind = kind
  }
}

type Sdk = typeof import('@anthropic-ai/sdk')

/**
 * The SDK is loaded on the first message: it is only needed once someone uses the assistant, and it needs browser
 * APIs (TextEncoder) at import time that test environments such as jsdom lack.
 */
const loadSdk = (): Promise<Sdk> => import('@anthropic-ai/sdk')

const classifyError = ({ default: Anthropic }: Sdk, error: unknown): AssistantError => {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof Anthropic.AuthenticationError) return new AssistantError('auth', message)
  if (error instanceof Anthropic.PermissionDeniedError) return new AssistantError('permission', message)
  if (error instanceof Anthropic.RateLimitError) return new AssistantError('rate_limit', message)
  if (error instanceof Anthropic.InternalServerError) return new AssistantError('overloaded', message)
  if (error instanceof Anthropic.APIConnectionError) return new AssistantError('connection', message)
  return new AssistantError('other', message)
}

/** The part of the SDK client the assistant uses, so tests can pass a stand-in. */
export interface AssistantClient {
  beta: {
    messages: {
      stream: (
        params: Anthropic.Beta.MessageCreateParamsNonStreaming,
        options?: { signal?: AbortSignal },
      ) => {
        on: (event: 'text', listener: (delta: string) => void) => unknown
        finalMessage: () => Promise<Anthropic.Beta.BetaMessage>
      }
    }
  }
}

export interface AssistantOptions {
  vm: AssistantVm
  apiKey?: string
  client?: AssistantClient
  /** The model to use, read on every message so the learner can switch models mid-conversation. */
  model?: () => string
  /** The editor mode shown to the learner, sent as context with each message. */
  editorMode?: () => string
  capture?: ConsoleCapture
  runOptions?: ToolContext['runOptions']
  renderCostume?: ToolContext['renderCostume']
  /** The editor to change the project with, or null while editing is off. Read on every message. */
  editor?: () => ProjectEditor | null | undefined
}

export interface Assistant {
  /** Send a learner message and resolve when the reply is complete. Throws AssistantError for API failures. */
  send: (text: string, callbacks?: AssistantCallbacks) => Promise<{ notice?: StopNotice }>
  /** Stop the reply in progress, including a test run. */
  abort: () => void
  /** Forget the conversation. */
  reset: () => void
}

export const createAssistant = (options: AssistantOptions): Assistant => {
  let client = options.client
  let messages: Anthropic.Beta.BetaMessageParam[] = []
  let controller: AbortController | undefined

  const runToolCall = async (
    call: ToolCall,
    callbacks: AssistantCallbacks,
    signal: AbortSignal,
    editor: ProjectEditor | undefined,
  ) => {
    callbacks.onToolStart?.(call)
    let result: { ok: boolean } & ToolOutput
    try {
      const output = await runTool(call.name, call.input, {
        vm: options.vm,
        capture: options.capture,
        signal,
        runOptions: options.runOptions,
        renderCostume: options.renderCostume,
        editor,
      })
      result = { ok: true, ...output }
    } catch (error) {
      result = { ok: false, text: error instanceof Error ? error.message : String(error) }
    }
    callbacks.onToolEnd?.(call, result)
    const block: Anthropic.Beta.BetaToolResultBlockParam = {
      type: 'tool_result',
      tool_use_id: call.id,
      content: result.image
        ? [
            { type: 'text', text: result.text },
            {
              type: 'image',
              source: { type: 'base64', media_type: result.image.mediaType, data: result.image.data },
            },
          ]
        : result.text,
      ...(result.ok ? {} : { is_error: true }),
    }
    return block
  }

  const send: Assistant['send'] = async (text, callbacks = {}) => {
    controller = new AbortController()
    const { signal } = controller
    const sdk = await loadSdk()
    client ??= new sdk.default({ apiKey: options.apiKey, dangerouslyAllowBrowser: true })
    const model = options.model?.() ?? ASSISTANT_MODEL
    // Turning editing on or off in Settings applies from the next message.
    const editor = options.editor?.() ?? undefined
    const context = turnContext({
      editingSprite: options.vm.editingTarget?.getName() ?? null,
      editorMode: options.editorMode?.() ?? 'custom',
      canEdit: Boolean(editor),
      overview: JSON.stringify(describeProject(options.vm)),
    })
    const historyLength = messages.length
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: context },
        { type: 'text', text },
      ],
    })

    for (let step = 0; step < MAX_STEPS; step++) {
      let message: Anthropic.Beta.BetaMessage
      try {
        const stream = client.beta.messages.stream(
          {
            model,
            ...fallbackParams(model),
            max_tokens: 64000,
            cache_control: { type: 'ephemeral' },
            system: ASSISTANT_SYSTEM_PROMPT,
            tools: toolsFor(Boolean(editor)),
            messages,
          },
          { signal },
        )
        stream.on('text', (delta) => callbacks.onText?.(delta, step))
        message = await stream.finalMessage()
      } catch (error) {
        if (signal.aborted) return { notice: 'aborted' }
        // Drop a message that never got a reply, so sending it again does not repeat it.
        if (step === 0) messages.splice(historyLength)
        throw classifyError(sdk, error)
      }
      messages.push({ role: 'assistant', content: message.content })

      if (message.stop_reason === 'refusal') return { notice: 'refusal' }
      if (message.stop_reason === 'max_tokens') return { notice: 'max_tokens' }
      if (message.stop_reason !== 'tool_use') return {}

      const calls: ToolCall[] = message.content
        .filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use')
        .map((block) => ({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> }))
      // Every tool_use needs its result in the next message, even when the learner stopped the reply.
      const results = []
      for (const call of calls) results.push(await runToolCall(call, callbacks, signal, editor))
      messages.push({ role: 'user', content: results })
      if (signal.aborted) return { notice: 'aborted' }
    }
    return { notice: 'too_many_steps' }
  }

  return {
    send,
    abort: () => controller?.abort(),
    reset: () => {
      controller?.abort()
      messages = []
    },
  }
}
