/**
 * Projects kept as Git bundle files in a folder on the user's computer, through the File System Access API
 * (Chrome and Edge). Old .sb3 files in the folder are listed too, for importing. The chosen folder is remembered
 * between visits; the browser asks again for permission after a reload. Thumbnails are PNG files in a
 * `.thumbnails` subfolder, named after their project file.
 */
import { bundleToken } from '../vcs/bundle'
import { getSetting, setSetting } from './indexeddb-store'
import { fileNameFor, formatOf, type ProjectInfo, type ProjectStore, projectNameFor } from './types'

/** Parts of the File System Access API that TypeScript's DOM types do not include yet. */
interface PermissionDescriptor {
  mode: 'read' | 'readwrite'
}
export interface DirectoryHandle {
  name: string
  values: () => AsyncIterable<{ kind: 'file' | 'directory'; name: string }>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileHandle>
  getDirectoryHandle: (name: string, options?: { create?: boolean }) => Promise<DirectoryHandle>
  removeEntry: (name: string) => Promise<void>
  queryPermission: (descriptor: PermissionDescriptor) => Promise<PermissionState>
  requestPermission: (descriptor: PermissionDescriptor) => Promise<PermissionState>
}
export interface FileHandle {
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<{
    write: (data: ArrayBuffer | Uint8Array | Blob) => Promise<void>
    close: () => Promise<void>
  }>
}
type ShowDirectoryPicker = (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>

const FOLDER_SETTING = 'folderStore.directory'
const THUMBNAIL_FOLDER = '.thumbnails'
const READ_WRITE: PermissionDescriptor = { mode: 'readwrite' }

const picker = (): ShowDirectoryPicker | undefined =>
  (globalThis as { showDirectoryPicker?: ShowDirectoryPicker }).showDirectoryPicker

export interface FolderStore extends ProjectStore {
  /** The name of the chosen folder, if one has been chosen. */
  folderName: () => Promise<string | undefined>
  /** Let the user pick a (different) folder. Must be called from a user gesture. */
  chooseFolder: () => Promise<void>
}

export const createFolderStore = (
  options: {
    showDirectoryPicker?: ShowDirectoryPicker
    savedDirectory?: () => Promise<DirectoryHandle | undefined>
  } = {},
): FolderStore => {
  const showDirectoryPicker = options.showDirectoryPicker ?? picker()
  const savedDirectory = options.savedDirectory ?? (() => getSetting<DirectoryHandle>(FOLDER_SETTING))

  const directory = async (): Promise<DirectoryHandle> => {
    const handle = await savedDirectory()
    if (!handle) throw new Error('No folder chosen yet')
    if ((await handle.queryPermission(READ_WRITE)) !== 'granted') {
      throw new Error(`Permission to use the folder "${handle.name}" is needed again`)
    }
    return handle
  }

  const thumbnailName = (fileName: string) => `${fileName}.png`

  /** `undefined` when `action` fails because the file or folder is missing; other failures are rethrown. */
  const unlessMissing = async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await action()
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return undefined
      throw error
    }
  }

  const existingThumbnailFolder = async () =>
    unlessMissing(async () => (await directory()).getDirectoryHandle(THUMBNAIL_FOLDER))

  const removeThumbnail = async (fileName: string) => {
    const thumbnails = await existingThumbnailFolder()
    if (thumbnails) await unlessMissing(() => thumbnails.removeEntry(thumbnailName(fileName)))
  }

  const chooseFolder = async () => {
    if (!showDirectoryPicker) throw new Error('This browser cannot open folders; use Chrome or Edge')
    const chosen = await showDirectoryPicker({ id: 'scratch-customized-projects', mode: 'readwrite' })
    if (!options.savedDirectory) await setSetting(FOLDER_SETTING, chosen)
  }

  return {
    kind: 'folder',
    isSupported: () => Boolean(showDirectoryPicker),
    isConnected: async () => {
      const handle = await savedDirectory()
      return Boolean(handle && (await handle.queryPermission(READ_WRITE)) === 'granted')
    },
    connect: async () => {
      const handle = await savedDirectory()
      // Re-granting access to the remembered folder is one click; picking a new folder is only needed once.
      if (handle && (await handle.requestPermission(READ_WRITE)) === 'granted') return
      await chooseFolder()
    },
    chooseFolder,
    folderName: async () => (await savedDirectory())?.name,
    list: async () => {
      const handle = await directory()
      const projects: ProjectInfo[] = []
      for await (const entry of handle.values()) {
        const format = formatOf(entry.name)
        if (entry.kind !== 'file' || !format) continue
        const file = await (await handle.getFileHandle(entry.name)).getFile()
        projects.push({
          id: entry.name,
          name: projectNameFor(entry.name),
          format,
          modified: file.lastModified,
          size: file.size,
        })
      }
      return projects.sort((a, b) => b.modified - a.modified)
    },
    load: async (id) => {
      const file = await (await (await directory()).getFileHandle(id)).getFile()
      return file.arrayBuffer()
    },
    save: async (name, data, { id, thumbnail } = {}) => {
      const handle = await directory()
      const fileName = id ?? fileNameFor(name)
      const writable = await (await handle.getFileHandle(fileName, { create: true })).createWritable()
      await writable.write(data)
      await writable.close()
      if (thumbnail) {
        const thumbnails = await handle.getDirectoryHandle(THUMBNAIL_FOLDER, { create: true })
        const image = await (
          await thumbnails.getFileHandle(thumbnailName(fileName), { create: true })
        ).createWritable()
        await image.write(thumbnail)
        await image.close()
      } else {
        await removeThumbnail(fileName)
      }
      return {
        id: fileName,
        name: projectNameFor(fileName),
        format: 'bundle',
        modified: Date.now(),
        size: data.byteLength,
      }
    },
    // The file is on this computer, so its token is computed from the bundle itself.
    token: async (id) => {
      if (formatOf(id) !== 'bundle') return undefined
      const file = await unlessMissing(async () => (await (await directory()).getFileHandle(id)).getFile())
      return file && bundleToken(new Uint8Array(await file.arrayBuffer()))
    },
    thumbnail: async (id) => {
      const thumbnails = await existingThumbnailFolder()
      return thumbnails && unlessMissing(async () => (await thumbnails.getFileHandle(thumbnailName(id))).getFile())
    },
    remove: async (id) => {
      await (await directory()).removeEntry(id)
      await removeThumbnail(id)
    },
  }
}
