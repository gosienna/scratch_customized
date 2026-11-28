/**
 * Where projects can be kept. A store reads and writes opaque project files: Git bundles holding a project's whole
 * history (see `vcs/bundle.ts`), and, for importing, plain .sb3 files saved before projects were kept in Git.
 */

export type StoreKind = 'browser' | 'folder' | 'drive'

/** What a stored file holds: a project's Git history, or a single .sb3 (only ever read, to import it). */
export type ProjectFormat = 'bundle' | 'sb3'

export interface ProjectInfo {
  /** Identifies the project within its store (a key, a file name, or a Drive file ID). */
  id: string
  name: string
  format: ProjectFormat
  /** Last modification time, in milliseconds since the epoch. */
  modified: number
  /** Size of the file in bytes, when the store knows it. */
  size?: number
}

export interface ProjectStore {
  readonly kind: StoreKind
  /**
   * Whether this browser can use the store at all (for example, the File System Access API is missing in
   * Firefox and Safari).
   */
  isSupported: () => boolean
  /** Whether the store is ready without asking the user anything (signed in, folder permission granted). */
  isConnected: () => Promise<boolean>
  /** Ask the user for whatever the store needs (pick a folder, sign in). Must be called from a user gesture. */
  connect: () => Promise<void>
  list: () => Promise<ProjectInfo[]>
  load: (id: string) => Promise<ArrayBuffer>
  /**
   * Save a project bundle. Without `id` a new file is created; with `id` that file is replaced. `thumbnail` is a
   * picture of the stage (PNG), kept beside the file. `token` identifies the bundle's contents (see
   * `bundleToken`); `token(id)` returns it later without downloading the file.
   */
  save: (name: string, data: Uint8Array, options?: SaveOptions) => Promise<ProjectInfo>
  /** The token the file was last saved with, or undefined for files without one (e.g. .sb3 files). */
  token: (id: string) => Promise<string | undefined>
  /** The project's thumbnail, if one was saved with it. */
  thumbnail: (id: string) => Promise<Blob | undefined>
  /** Remove a project. Stores that have a trash (Google Drive) move the project there instead of deleting it. */
  remove: (id: string) => Promise<void>
}

export interface SaveOptions {
  id?: string
  thumbnail?: Blob
  token?: string
}

export const SB3_MIME_TYPE = 'application/x.scratch.sb3'
export const BUNDLE_MIME_TYPE = 'application/x-git-bundle'
export const BUNDLE_EXTENSION = '.scratch.bundle'

/** A name without characters that file systems reject (and without trailing dots and spaces). */
export const safeFileName = (name: string): string =>
  name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\s.]+$/, '')
    .trim() || 'Project'

/** The bundle file name for a project. */
export const fileNameFor = (projectName: string): string => `${safeFileName(projectName)}${BUNDLE_EXTENSION}`

/** The format of a stored file, from its name; undefined for files that are not projects. */
export const formatOf = (fileName: string): ProjectFormat | undefined => {
  const lower = fileName.toLowerCase()
  if (lower.endsWith(BUNDLE_EXTENSION)) return 'bundle'
  if (lower.endsWith('.sb3')) return 'sb3'
  return undefined
}

/** The project name for a file name: the name without its extension. */
export const projectNameFor = (fileName: string): string => {
  const format = formatOf(fileName)
  if (!format) return fileName
  return fileName.slice(0, fileName.length - (format === 'bundle' ? BUNDLE_EXTENSION.length : '.sb3'.length))
}
