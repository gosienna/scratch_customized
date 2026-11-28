/** The AI assistant panel's engine: project context, test runs, console capture and the Claude conversation. */
export { ASSISTANT_MODEL, ASSISTANT_MODELS, AssistantError, createAssistant } from './chat'
export type {
  Assistant,
  AssistantCallbacks,
  AssistantClient,
  AssistantErrorKind,
  AssistantModelChoice,
  AssistantOptions,
  StopNotice,
  ToolCall,
} from './chat'
export { ConsoleCapture, consoleCapture, installConsoleCapture } from './console-capture'
export type { LogEntry, LogLevel } from './console-capture'
export { describeProject, describeScripts } from './project-summary'
export type { ProjectOverview, ScriptDescription } from './project-summary'
export { runProject, runScript } from './run'
export type { RunClock, RunOptions, RunReport } from './run'
export { ASSISTANT_TOOLS, EDIT_TOOLS, runTool, toolsFor, VIEW_TOOLS } from './tools'
export type { CommentRequest, EditorView, ProjectEditor, ToolContext, ToolOutput, WorkspacePlace } from './tools'
export { MAX_IMAGE_SIDE, renderCostumeInBrowser } from './costume-image'
export type { CostumeImage, CostumeRenderer } from './costume-image'
export type { AssistantVm } from './vm-types'
