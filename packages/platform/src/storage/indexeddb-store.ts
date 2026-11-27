/**
 * The platform's IndexedDB database: small settings kept between visits, and the .sb3 projects this browser kept
 * before projects were stored in Git (read once, to move them into repositories).
 */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import type { ProjectInfo } from './types'

interface StorageSchema extends DBSchema {
  /** Metadata of the old .sb3 projects, separate from the data so listing does not read every file. */
  projects: { key: string; value: Omit<ProjectInfo, 'format'> }
  data: { key: string; value: ArrayBuffer }
  thumbnails: { key: string; value: Blob }
  /** Small values other parts of the platform keep between visits (e.g. a chosen folder handle). */
  settings: { key: string; value: unknown }
}

export const DATABASE_NAME = 'scratch-customized'

let databasePromise: Promise<IDBPDatabase<StorageSchema>> | undefined

/** The platform's IndexedDB database, opened once. */
export const openDatabase = (): Promise<IDBPDatabase<StorageSchema>> => {
  databasePromise ??= openDB<StorageSchema>(DATABASE_NAME, 2, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        db.createObjectStore('projects', { keyPath: 'id' })
        db.createObjectStore('data')
        db.createObjectStore('settings')
      }
      if (oldVersion < 2) db.createObjectStore('thumbnails')
    },
  })
  return databasePromise
}

/** Close and forget the open database, so tests can delete it between runs. */
export const resetDatabaseConnection = async (): Promise<void> => {
  const open = databasePromise
  databasePromise = undefined
  if (open) (await open).close()
}

export const getSetting = async <T>(key: string): Promise<T | undefined> =>
  (await (await openDatabase()).get('settings', key)) as T | undefined

export const setSetting = async (key: string, value: unknown): Promise<void> => {
  await (await openDatabase()).put('settings', value, key)
}

/**
 * Projects saved as .sb3 files in this browser before projects were kept in Git. They are only read, to move each
 * one into a Git repository (see `vcs/browser-fs.ts`), and then removed.
 */
export interface LegacyBrowserProjects {
  list: () => Promise<ProjectInfo[]>
  load: (id: string) => Promise<ArrayBuffer>
  thumbnail: (id: string) => Promise<Blob | undefined>
  remove: (id: string) => Promise<void>
}

export const legacyBrowserProjects = (): LegacyBrowserProjects => ({
  list: async () => {
    const projects = await (await openDatabase()).getAll('projects')
    return projects.map((p): ProjectInfo => ({ ...p, format: 'sb3' })).sort((a, b) => b.modified - a.modified)
  },
  load: async (id) => {
    const data = await (await openDatabase()).get('data', id)
    if (!data) throw new Error(`No project with ID ${id} in this browser`)
    return data
  },
  thumbnail: async (id) => (await openDatabase()).get('thumbnails', id),
  remove: async (id) => {
    const db = await openDatabase()
    const tx = db.transaction(['projects', 'data', 'thumbnails'], 'readwrite')
    await Promise.all([
      tx.objectStore('projects').delete(id),
      tx.objectStore('data').delete(id),
      tx.objectStore('thumbnails').delete(id),
      tx.done,
    ])
  },
})
