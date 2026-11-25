/** Projects kept in the browser's IndexedDB. Always available, no setup, but tied to this browser profile. */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import type { ProjectInfo, ProjectStore } from './types'

interface StorageSchema extends DBSchema {
  /** Project metadata, separate from the data so listing does not read every project file. */
  projects: { key: string; value: ProjectInfo }
  data: { key: string; value: ArrayBuffer }
  /** Small values other parts of the platform keep between visits (e.g. a chosen folder handle). */
  settings: { key: string; value: unknown }
}

export const DATABASE_NAME = 'scratch-customized'

let databasePromise: Promise<IDBPDatabase<StorageSchema>> | undefined

/** The platform's IndexedDB database, opened once. */
export const openDatabase = (): Promise<IDBPDatabase<StorageSchema>> => {
  databasePromise ??= openDB<StorageSchema>(DATABASE_NAME, 1, {
    upgrade(db) {
      db.createObjectStore('projects', { keyPath: 'id' })
      db.createObjectStore('data')
      db.createObjectStore('settings')
    },
  })
  return databasePromise
}

/** Forget the open database (tests use this between runs). */
export const resetDatabaseConnection = (): void => {
  databasePromise = undefined
}

export const getSetting = async <T>(key: string): Promise<T | undefined> =>
  (await (await openDatabase()).get('settings', key)) as T | undefined

export const setSetting = async (key: string, value: unknown): Promise<void> => {
  await (await openDatabase()).put('settings', value, key)
}

const newId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export const createIndexedDbStore = (): ProjectStore => ({
  kind: 'browser',
  isSupported: () => typeof indexedDB !== 'undefined',
  isConnected: () => Promise.resolve(true),
  connect: () => Promise.resolve(),
  list: async () => {
    const projects = await (await openDatabase()).getAll('projects')
    return projects.sort((a, b) => b.modified - a.modified)
  },
  load: async (id) => {
    const data = await (await openDatabase()).get('data', id)
    if (!data) throw new Error(`No project with ID ${id} in this browser`)
    return data
  },
  save: async (name, data, id) => {
    const info: ProjectInfo = { id: id ?? newId(), name, modified: Date.now(), size: data.byteLength }
    const db = await openDatabase()
    const tx = db.transaction(['projects', 'data'], 'readwrite')
    await Promise.all([tx.objectStore('projects').put(info), tx.objectStore('data').put(data, info.id), tx.done])
    return info
  },
  remove: async (id) => {
    const db = await openDatabase()
    const tx = db.transaction(['projects', 'data'], 'readwrite')
    await Promise.all([tx.objectStore('projects').delete(id), tx.objectStore('data').delete(id), tx.done])
  },
})
