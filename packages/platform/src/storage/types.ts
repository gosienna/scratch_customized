/** Where projects can be kept. Every store reads and writes complete .sb3 files. */

export type StoreKind = 'browser' | 'folder' | 'drive'

export interface ProjectInfo {
  /** Identifies the project within its store (a key, a file name, or a Drive file ID). */
  id: string
  name: string
  /** Last modification time, in milliseconds since the epoch. */
  modified: number
  /** Size of the .sb3 file in bytes, when the store knows it. */
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
  /** Save a project. Without `id` a new project is created; with `id` that project is replaced. */
  save: (name: string, data: ArrayBuffer, id?: string) => Promise<ProjectInfo>
  /** Remove a project. Stores that have a trash (Google Drive) move the project there instead of deleting it. */
  remove: (id: string) => Promise<void>
}

export const SB3_MIME_TYPE = 'application/x.scratch.sb3'

/** A file name for a project: its name without characters that file systems reject, plus `.sb3`. */
export const fileNameFor = (projectName: string): string => {
  const cleaned = projectName
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\s.]+$/, '')
    .trim()
  return `${cleaned || 'Project'}.sb3`
}

/** The project name for a file name: the name without its `.sb3` extension. */
export const projectNameFor = (fileName: string): string => fileName.replace(/\.sb3$/i, '')
