import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createDriveStore } from '../src/storage/drive-store'
import { createFolderStore, type DirectoryHandle, type FileHandle } from '../src/storage/folder-store'
import { createIndexedDbStore, resetDatabaseConnection } from '../src/storage/indexeddb-store'
import { fileNameFor } from '../src/storage/types'

const bytes = (...values: number[]) => new Uint8Array(values).buffer

describe('fileNameFor', () => {
  test('removes characters file systems reject', () => {
    expect(fileNameFor('My: game / v2?')).toBe('My_ game _ v2_.sb3')
    expect(fileNameFor('  ')).toBe('Project.sb3')
    expect(fileNameFor('trailing dots...')).toBe('trailing dots.sb3')
  })
})

describe('IndexedDB store', () => {
  beforeEach(() => {
    indexedDB.deleteDatabase('scratch-customized')
    resetDatabaseConnection()
  })

  test('saves, lists newest first, loads, replaces and removes', async () => {
    const store = createIndexedDbStore()
    const first = await store.save('First', bytes(1, 2, 3))
    await new Promise((resolve) => setTimeout(resolve, 5))
    const second = await store.save('Second', bytes(4))
    expect((await store.list()).map((p) => p.name)).toEqual(['Second', 'First'])
    expect(new Uint8Array(await store.load(first.id))).toEqual(new Uint8Array([1, 2, 3]))

    await store.save('First renamed', bytes(9, 9), first.id)
    const list = await store.list()
    expect(list).toHaveLength(2)
    expect(list.find((p) => p.id === first.id)).toMatchObject({ name: 'First renamed', size: 2 })

    await store.remove(second.id)
    expect((await store.list()).map((p) => p.id)).toEqual([first.id])
    await expect(store.load(second.id)).rejects.toThrow('No project')
  })
})

/** An in-memory stand-in for a folder chosen with showDirectoryPicker. */
const fakeDirectory = (permission: PermissionState = 'granted') => {
  const files = new Map<string, { data: ArrayBuffer; lastModified: number }>()
  const fileHandle = (name: string): FileHandle => ({
    name,
    getFile: () => {
      const file = files.get(name)
      if (!file) return Promise.reject(new Error(`missing ${name}`))
      return Promise.resolve(new File([file.data], name, { lastModified: file.lastModified }))
    },
    createWritable: () => {
      let data = new ArrayBuffer(0)
      return Promise.resolve({
        write: (chunk: ArrayBuffer) => {
          data = chunk
          return Promise.resolve()
        },
        close: () => {
          files.set(name, { data, lastModified: Date.now() })
          return Promise.resolve()
        },
      })
    },
  })
  const directory: DirectoryHandle = {
    name: 'My Projects',
    // eslint-disable-next-line @typescript-eslint/require-await -- must match the async iterator API
    values: async function* () {
      for (const name of files.keys()) yield { kind: 'file' as const, name }
      yield { kind: 'directory' as const, name: 'subfolder' }
    },
    getFileHandle: (name, options) => {
      if (!files.has(name) && !options?.create) return Promise.reject(new Error(`missing ${name}`))
      return Promise.resolve(fileHandle(name))
    },
    removeEntry: (name) => {
      files.delete(name)
      return Promise.resolve()
    },
    queryPermission: () => Promise.resolve(permission),
    requestPermission: () => Promise.resolve('granted'),
  }
  return { directory, files }
}

describe('folder store', () => {
  test('reads and writes .sb3 files in the chosen folder', async () => {
    const { directory, files } = fakeDirectory()
    const store = createFolderStore({
      showDirectoryPicker: () => Promise.resolve(directory),
      savedDirectory: () => Promise.resolve(directory),
    })
    expect(store.isSupported()).toBe(true)
    expect(await store.isConnected()).toBe(true)
    files.set('notes.txt', { data: bytes(0), lastModified: 1 })

    const saved = await store.save('Space Game', bytes(7, 7))
    expect(saved.id).toBe('Space Game.sb3')
    expect((await store.list()).map((p) => p.name)).toEqual(['Space Game'])
    expect(new Uint8Array(await store.load(saved.id))).toEqual(new Uint8Array([7, 7]))
    await store.remove(saved.id)
    expect(await store.list()).toEqual([])
  })

  test('needs permission again after a reload', async () => {
    const { directory } = fakeDirectory('prompt')
    const store = createFolderStore({
      showDirectoryPicker: () => Promise.resolve(directory),
      savedDirectory: () => Promise.resolve(directory),
    })
    expect(await store.isConnected()).toBe(false)
    await expect(store.list()).rejects.toThrow('Permission to use the folder "My Projects" is needed again')
  })

  test('is unsupported without the File System Access API', () => {
    expect(createFolderStore({ savedDirectory: () => Promise.resolve(undefined) }).isSupported()).toBe(false)
  })
})

describe('Google Drive store', () => {
  const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

  test('creates, lists, loads, updates and trashes files through the Drive API', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const getToken = vi.fn(() => Promise.resolve({ token: 'token-1', expiresAt: Date.now() + 3_600_000 }))
    const store = createDriveStore({ getToken, fetch: fetchMock })
    await store.connect()
    expect(getToken).toHaveBeenCalledWith(true)

    const file = { id: 'f1', name: 'Game.sb3', modifiedTime: '2026-11-25T10:00:00.000Z', size: '2' }
    fetchMock.mockResolvedValueOnce(jsonResponse(file))
    expect(await store.save('Game', bytes(1, 2))).toEqual({
      id: 'f1',
      name: 'Game',
      modified: Date.parse(file.modifiedTime),
      size: 2,
    })
    const [createUrl, createInit] = fetchMock.mock.calls[0]
    expect(createUrl).toContain('/upload/drive/v3/files?uploadType=multipart')
    expect(createInit?.method).toBe('POST')
    expect((createInit?.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
    const body = await (createInit?.body as Blob).text()
    expect(body).toContain('"appProperties":{"scratchCustomized":"1"}')
    expect(body).toContain('application/x.scratch.sb3')

    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [file] }))
    expect((await store.list()).map((p) => p.name)).toEqual(['Game'])
    expect(new URL(fetchMock.mock.calls[1][0] as string).searchParams.get('q')).toBe(
      "appProperties has { key='scratchCustomized' and value='1' } and trashed=false",
    )

    fetchMock.mockResolvedValueOnce(new Response(bytes(1, 2)))
    expect(new Uint8Array(await store.load('f1'))).toEqual(new Uint8Array([1, 2]))

    fetchMock.mockResolvedValueOnce(jsonResponse(file))
    await store.save('Game', bytes(3), 'f1')
    expect(fetchMock.mock.calls[3][1]?.method).toBe('PATCH')
    expect(fetchMock.mock.calls[3][0] as string).toContain('/upload/drive/v3/files/f1?')

    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    await store.remove('f1')
    expect(fetchMock.mock.calls[4][1]?.body).toBe('{"trashed":true}')
  })

  test('reports API errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('quota exceeded', { status: 403 }))
    const store = createDriveStore({
      getToken: () => Promise.resolve({ token: 't', expiresAt: Date.now() + 3_600_000 }),
      fetch: fetchMock,
    })
    await store.connect()
    await expect(store.list()).rejects.toThrow('Google Drive request failed (403): quota exceeded')
  })
})
