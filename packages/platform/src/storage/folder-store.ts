/**
 * Projects kept as .sb3 files in a folder on the user's computer, through the File System Access API
 * (Chrome and Edge). The chosen folder is remembered between visits; the browser asks again for permission
 * after a reload.
 */
import { getSetting, setSetting } from './indexeddb-store'
import { fileNameFor, type ProjectInfo, type ProjectStore, projectNameFor } from './types'

/** Parts of the File System Access API that TypeScript's DOM types do not include yet. */
interface PermissionDescriptor {
  mode: 'read' | 'readwrite'
}
export interface DirectoryHandle {
  name: string
  values: () => AsyncIterable<{ kind: 'file' | 'directory'; name: string }>
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileHandle>
  removeEntry: (name: string) => Promise<void>
  queryPermission: (descriptor: PermissionDescriptor) => Promise<PermissionState>
  requestPermission: (descriptor: PermissionDescriptor) => Promise<PermissionState>
}
export interface FileHandle {
  name: string
  getFile: () => Promise<File>
  createWritable: () => Promise<{ write: (data: ArrayBuffer) => Promise<void>; close: () => Promise<void> }>
}
type ShowDirectoryPicker = (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandle>

const FOLDER_SETTING = 'folderStore.directory'
const READ_WRITE: PermissionDescriptor = { mode: 'readwrite' }

const picker = (): ShowDirectoryPicker | undefined =>
  (globalThis as { showDirectoryPicker?: ShowDirectoryPicker }).showDirectoryPicker

export interface FolderStore extends ProjectStore {
  /** The name of the chosen folder, if one has been chosen. */
  folderName: () => Promise<string | undefined>
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
      if (!showDirectoryPicker) throw new Error('This browser cannot open folders; use Chrome or Edge')
      const chosen = await showDirectoryPicker({ id: 'scratch-customized-projects', mode: 'readwrite' })
      if (!options.savedDirectory) await setSetting(FOLDER_SETTING, chosen)
    },
    folderName: async () => (await savedDirectory())?.name,
    list: async () => {
      const handle = await directory()
      const projects: ProjectInfo[] = []
      for await (const entry of handle.values()) {
        if (entry.kind !== 'file' || !/\.sb3$/i.test(entry.name)) continue
        const file = await (await handle.getFileHandle(entry.name)).getFile()
        projects.push({
          id: entry.name,
          name: projectNameFor(entry.name),
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
    save: async (name, data, id) => {
      const handle = await directory()
      const fileName = id ?? fileNameFor(name)
      const writable = await (await handle.getFileHandle(fileName, { create: true })).createWritable()
      await writable.write(data)
      await writable.close()
      return { id: fileName, name: projectNameFor(fileName), modified: Date.now(), size: data.byteLength }
    },
    remove: async (id) => {
      await (await directory()).removeEntry(id)
    },
  }
}
