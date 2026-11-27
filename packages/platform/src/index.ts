export * from './compat/opcodes'
export { assertStockProject, CompatibilityError, effectiveExpression, lowerProject } from './compat/lower'
export type { TransformContext } from './compat/lower'
export { raiseProject } from './compat/raise'
export type { RaiseOptions } from './compat/raise'
export { createProjectTransforms } from './compat/transforms'
export type { ProjectTransformOptions } from './compat/transforms'

export { parseExpression, printExpression, isBooleanNode, namesIn, formatName, ExprSyntaxError } from './expr/syntax'
export type { ExprNode } from './expr/syntax'
export { resolveName } from './expr/scope'
export type { ExprScope, ResolvedName, ParamType } from './expr/scope'
export { FUNCTIONS } from './expr/ops'

export * from './local-vars'
export { createPrimitives, installPrimitives } from './runtime/primitives'

export * from './storage/types'
export { getSetting, legacyBrowserProjects, setSetting } from './storage/indexeddb-store'
export type { LegacyBrowserProjects } from './storage/indexeddb-store'
export { createFolderStore } from './storage/folder-store'
export type { FolderStore } from './storage/folder-store'
export { createDriveStore, googleIdentityTokenProvider, parseDriveFolderId } from './storage/drive-store'
export type { AccessToken, DriveFolder, DriveStore, TokenProvider } from './storage/drive-store'
export { pickDriveFolder } from './storage/drive-picker'

export { applyText, targetToText, TextSyntaxError } from './text'
export type { TextDialect } from './text'

export {
  commitProject,
  createBranch,
  currentBranch,
  diffVersions,
  getRepoSetting,
  headVersion,
  listBranches,
  listProjectRepos,
  listVersions,
  openProjectRepo,
  pushToRemote,
  readVersion,
  setRepoSetting,
  switchBranch,
} from './vcs/repo'
export type { Author, ProjectRepo, RemoteOptions, RepoSetting, RepoSummary, Version, VersionDiff } from './vcs/repo'
export { deleteBrowserRepo, getBrowserGitFs, listBrowserRepos, newProjectId, repoDirFor } from './vcs/browser-fs'
export { bundleToken, cloneBundle, createBundle, parseBundle, repoToken, syncFromBundle } from './vcs/bundle'
export type { Bundle, ParsedBundle, SyncResult } from './vcs/bundle'
