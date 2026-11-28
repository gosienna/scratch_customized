import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createDriveStore, parseDriveFolderId } from '../src/storage/drive-store'
import { createFolderStore, type DirectoryHandle, type FileHandle } from '../src/storage/folder-store'
import { legacyBrowserProjects, openDatabase, resetDatabaseConnection } from '../src/storage/indexeddb-store'
import { fileNameFor, formatOf, projectNameFor } from '../src/storage/types'

const bytes = (...values: number[]) => new Uint8Array(values)

/** The start of a Git bundle with one branch, as stores see it (they never look past the header). */
const bundleBytes = (oid: string) => new TextEncoder().encode(`# v2 git bundle\n${oid} refs/heads/main\n\nPACK`)

describe('file names', () => {
  test('removes characters file systems reject', () => {
    expect(fileNameFor('My: game / v2?')).toBe('My_ game _ v2_.scratch.bundle')
    expect(fileNameFor('  ')).toBe('Project.scratch.bundle')
    expect(fileNameFor('trailing dots...')).toBe('trailing dots.scratch.bundle')
  })

  test('tells bundles from .sb3 files and strips the extension', () => {
    expect(formatOf('Game.scratch.bundle')).toBe('bundle')
    expect(formatOf('Game.SB3')).toBe('sb3')
    expect(formatOf('notes.txt')).toBeUndefined()
    expect(projectNameFor('Game.scratch.bundle')).toBe('Game')
    expect(projectNameFor('Game.sb3')).toBe('Game')
    expect(projectNameFor('notes.txt')).toBe('notes.txt')
  })
})

describe('old .sb3 projects in IndexedDB', () => {
  beforeEach(async () => {
    await resetDatabaseConnection()
    indexedDB.deleteDatabase('scratch-customized')
  })

  test('are listed newest first, loaded with their thumbnails, and removed', async () => {
    const db = await openDatabase()
    await db.put('projects', { id: 'a', name: 'Older', modified: 1, size: 3 })
    await db.put('projects', { id: 'b', name: 'Newer', modified: 2, size: 1 })
    await db.put('data', new Uint8Array([1, 2, 3]).buffer, 'a')
    await db.put('thumbnails', new Blob(['png']), 'a')

    const projects = legacyBrowserProjects()
    expect((await projects.list()).map((p) => [p.name, p.format])).toEqual([
      ['Newer', 'sb3'],
      ['Older', 'sb3'],
    ])
    expect(new Uint8Array(await projects.load('a'))).toEqual(new Uint8Array([1, 2, 3]))
    expect(await (await projects.thumbnail('a'))?.text()).toBe('png')
    await projects.remove('a')
    expect((await projects.list()).map((p) => p.id)).toEqual(['b'])
    await expect(projects.load('a')).rejects.toThrow('No project')
    expect(await projects.thumbnail('a')).toBeUndefined()
  })
})

type FakeFiles = Map<string, { data: ArrayBuffer | Uint8Array | Blob; lastModified: number }>

const notFound = (name: string) => new DOMException(`missing ${name}`, 'NotFoundError')

interface FakeDirectory {
  directory: DirectoryHandle
  files: FakeFiles
  folders: Map<string, FakeDirectory>
}

/** An in-memory stand-in for a folder chosen with showDirectoryPicker. */
const fakeDirectory = (permission: PermissionState = 'granted', name = 'My Projects'): FakeDirectory => {
  const files: FakeFiles = new Map()
  const folders = new Map<string, FakeDirectory>()
  const fileHandle = (fileName: string): FileHandle => ({
    name: fileName,
    getFile: () => {
      const file = files.get(fileName)
      if (!file) return Promise.reject(notFound(fileName))
      return Promise.resolve(new File([file.data], fileName, { lastModified: file.lastModified }))
    },
    createWritable: () => {
      let data: ArrayBuffer | Blob = new ArrayBuffer(0)
      return Promise.resolve({
        write: (chunk: ArrayBuffer | Blob) => {
          data = chunk
          return Promise.resolve()
        },
        close: () => {
          files.set(fileName, { data, lastModified: Date.now() })
          return Promise.resolve()
        },
      })
    },
  })
  const directory: DirectoryHandle = {
    name,
    // eslint-disable-next-line @typescript-eslint/require-await -- must match the async iterator API
    values: async function* () {
      for (const fileName of files.keys()) yield { kind: 'file' as const, name: fileName }
      yield { kind: 'directory' as const, name: 'subfolder' }
      for (const folderName of folders.keys()) yield { kind: 'directory' as const, name: folderName }
    },
    getFileHandle: (fileName, options) => {
      if (!files.has(fileName) && !options?.create) return Promise.reject(notFound(fileName))
      return Promise.resolve(fileHandle(fileName))
    },
    getDirectoryHandle: (folderName, options) => {
      let folder = folders.get(folderName)
      if (!folder) {
        if (!options?.create) return Promise.reject(notFound(folderName))
        folder = fakeDirectory(permission, folderName)
        folders.set(folderName, folder)
      }
      return Promise.resolve(folder.directory)
    },
    removeEntry: (entryName) => {
      if (!files.delete(entryName)) return Promise.reject(notFound(entryName))
      return Promise.resolve()
    },
    queryPermission: () => Promise.resolve(permission),
    requestPermission: () => Promise.resolve('granted'),
  }
  return { directory, files, folders }
}

describe('folder store', () => {
  test('reads and writes bundle files in the chosen folder, and lists .sb3 files to import', async () => {
    const { directory, files } = fakeDirectory()
    const store = createFolderStore({
      showDirectoryPicker: () => Promise.resolve(directory),
      savedDirectory: () => Promise.resolve(directory),
    })
    expect(store.isSupported()).toBe(true)
    expect(await store.isConnected()).toBe(true)
    files.set('notes.txt', { data: bytes(0), lastModified: 1 })
    files.set('Old.sb3', { data: bytes(1), lastModified: 2 })

    const data = bundleBytes('a'.repeat(40))
    const saved = await store.save('Space Game', data)
    expect(saved).toMatchObject({ id: 'Space Game.scratch.bundle', name: 'Space Game', format: 'bundle' })
    expect((await store.list()).map((p) => [p.name, p.format])).toEqual([
      ['Space Game', 'bundle'],
      ['Old', 'sb3'],
    ])
    expect(new Uint8Array(await store.load(saved.id))).toEqual(data)
    // The token comes from the bundle's header; other files have none.
    expect(await store.token(saved.id)).toMatch(/^[0-9a-f]{40}$/)
    expect(await store.token('Old.sb3')).toBeUndefined()
    expect(await store.token('Missing.scratch.bundle')).toBeUndefined()
    await store.remove(saved.id)
    expect((await store.list()).map((p) => p.id)).toEqual(['Old.sb3'])
  })

  test('keeps thumbnails in a .thumbnails folder beside the projects', async () => {
    const { directory, folders } = fakeDirectory()
    const store = createFolderStore({ savedDirectory: () => Promise.resolve(directory) })
    const id = 'Game.scratch.bundle'
    expect(await store.thumbnail(id)).toBeUndefined()

    await store.save('Game', bytes(1), { thumbnail: new Blob(['png']) })
    expect(folders.get('.thumbnails')?.files.has(`${id}.png`)).toBe(true)
    expect(await (await store.thumbnail(id))?.text()).toBe('png')
    expect((await store.list()).map((p) => p.id)).toEqual([id])

    await store.save('Game', bytes(2), { id })
    expect(await store.thumbnail(id)).toBeUndefined()
    await store.save('Game', bytes(2), { id, thumbnail: new Blob(['png']) })
    await store.remove(id)
    expect(folders.get('.thumbnails')?.files.size).toBe(0)
  })

  test('chooses a different folder on request', async () => {
    const { directory } = fakeDirectory()
    const showDirectoryPicker = vi.fn(() => Promise.resolve(directory))
    const store = createFolderStore({ showDirectoryPicker, savedDirectory: () => Promise.resolve(directory) })
    await store.connect()
    expect(showDirectoryPicker).not.toHaveBeenCalled()
    await store.chooseFolder()
    expect(showDirectoryPicker).toHaveBeenCalledTimes(1)
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

describe('parseDriveFolderId', () => {
  test('finds the folder ID in Drive links', () => {
    const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-123'
    expect(parseDriveFolderId(`https://drive.google.com/drive/folders/${id}?usp=sharing`)).toBe(id)
    expect(parseDriveFolderId(`https://drive.google.com/drive/u/0/folders/${id}`)).toBe(id)
    expect(parseDriveFolderId(`https://drive.google.com/open?id=${id}`)).toBe(id)
    expect(parseDriveFolderId(`  ${id}  `)).toBe(id)
    expect(parseDriveFolderId('my class folder')).toBeUndefined()
  })
})

describe('Google Drive store', () => {
  const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
  const folder = { id: 'folder1234', name: 'Class 5B', mimeType: 'application/vnd.google-apps.folder' }

  beforeEach(async () => {
    await resetDatabaseConnection()
    indexedDB.deleteDatabase('scratch-customized')
  })

  test('links a folder from a pasted link and rejects files', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const store = createDriveStore({
      getToken: () => Promise.resolve({ token: 't', expiresAt: Date.now() + 3_600_000 }),
      fetch: fetchMock,
    })
    await store.connect()
    await expect(store.linkFolder('not a link')).rejects.toThrow('does not look like a Google Drive folder link')

    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'doc1', name: 'Notes', mimeType: 'text/plain' }))
    await expect(store.linkFolder('doc1234567890')).rejects.toThrow('"Notes" is a file, not a folder')
    expect(await store.folder()).toBeUndefined()

    fetchMock.mockResolvedValueOnce(jsonResponse({ ...folder, trashed: true }))
    await expect(store.linkFolder('folder1234')).rejects.toThrow('The folder "Class 5B" is in the Google Drive trash')
    expect(await store.folder()).toBeUndefined()

    fetchMock.mockResolvedValueOnce(jsonResponse(folder))
    expect(await store.linkFolder('https://drive.google.com/drive/folders/folder1234?usp=sharing')).toEqual({
      id: 'folder1234',
      name: 'Class 5B',
    })
    expect(fetchMock.mock.calls[2][0] as string).toContain('/drive/v3/files/folder1234?')
    expect(await store.folder()).toEqual({ id: 'folder1234', name: 'Class 5B' })
  })

  test('needs a linked folder to list or create projects', async () => {
    const store = createDriveStore({
      getToken: () => Promise.resolve({ token: 't', expiresAt: Date.now() + 3_600_000 }),
      fetch: vi.fn<typeof fetch>(),
    })
    await store.connect()
    await expect(store.list()).rejects.toThrow('No Google Drive folder linked yet')
    await expect(store.save('Game', bytes(1))).rejects.toThrow('No Google Drive folder linked yet')
  })

  test('creates, lists, loads, updates and trashes files in the linked folder', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const getToken = vi.fn(() => Promise.resolve({ token: 'token-1', expiresAt: Date.now() + 3_600_000 }))
    const store = createDriveStore({ getToken, fetch: fetchMock })
    await store.connect()
    expect(getToken).toHaveBeenCalledWith(true)
    fetchMock.mockResolvedValueOnce(jsonResponse(folder))
    await store.linkFolder('folder1234')
    fetchMock.mockClear()

    const file = {
      id: 'f1',
      name: 'Game.scratch.bundle',
      modifiedTime: '2026-11-25T10:00:00.000Z',
      size: '2',
      thumbnailLink: 'https://lh3.googleusercontent.com/thumb',
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(file))
    expect(
      await store.save('Game', bytes(1, 2), {
        thumbnail: new Blob(['\u00ff\u00fe'], { type: 'image/png' }),
        token: 'tok1',
      }),
    ).toEqual({
      id: 'f1',
      name: 'Game',
      format: 'bundle',
      modified: Date.parse(file.modifiedTime),
      size: 2,
    })
    const [createUrl, createInit] = fetchMock.mock.calls[0]
    expect(createUrl).toContain('/upload/drive/v3/files?uploadType=multipart')
    expect(createInit?.method).toBe('POST')
    expect((createInit?.headers as Record<string, string>).Authorization).toBe('Bearer token-1')
    const body = await (createInit?.body as Blob).text()
    expect(body).toContain('"parents":["folder1234"]')
    expect(body).toContain('"contentHints":{"thumbnail":{"image":"w7_Dvg","mimeType":"image/png"}}')
    expect(body).toContain('"name":"Game.scratch.bundle","mimeType":"application/x-git-bundle"')
    expect(body).toContain('"appProperties":{"token":"tok1"}')
    expect(body).toContain('Content-Type: application/x-git-bundle')

    const oldFile = {
      id: 'f0',
      name: 'Old.sb3',
      mimeType: 'application/x.scratch.sb3',
      modifiedTime: file.modifiedTime,
    }
    fetchMock.mockResolvedValueOnce(jsonResponse({ trashed: false }))
    fetchMock.mockResolvedValueOnce(jsonResponse({ files: [file, oldFile] }))
    expect((await store.list()).map((p) => [p.name, p.format])).toEqual([
      ['Game', 'bundle'],
      ['Old', 'sb3'],
    ])
    const listParams = new URL(fetchMock.mock.calls[2][0] as string).searchParams
    expect(listParams.get('q')).toBe(
      "'folder1234' in parents and trashed=false and (name contains '.scratch.bundle' or name contains '.sb3' or " +
        "mimeType='application/x-git-bundle' or mimeType='application/x.scratch.sb3')",
    )
    expect(listParams.get('supportsAllDrives')).toBe('true')

    fetchMock.mockResolvedValueOnce(jsonResponse({ appProperties: { token: 'tok1' } }))
    expect(await store.token('f1')).toBe('tok1')
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    expect(await store.token('f0')).toBeUndefined()

    fetchMock.mockResolvedValueOnce(new Response('png'))
    expect(await (await store.thumbnail('f1'))?.text()).toBe('png')
    expect(fetchMock.mock.calls[5][0]).toBe(file.thumbnailLink)
    expect(await store.thumbnail('unknown')).toBeUndefined()
    fetchMock.mockClear()

    fetchMock.mockResolvedValueOnce(new Response(bytes(1, 2)))
    expect(new Uint8Array(await store.load('f1'))).toEqual(new Uint8Array([1, 2]))

    fetchMock.mockResolvedValueOnce(jsonResponse(file))
    await store.save('Game', bytes(3), { id: 'f1' })
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PATCH')
    expect(fetchMock.mock.calls[1][0] as string).toContain('/upload/drive/v3/files/f1?')
    expect(await (fetchMock.mock.calls[1][1]?.body as Blob).text()).not.toContain('parents')

    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    await store.remove('f1')
    expect(fetchMock.mock.calls[2][1]?.body).toBe('{"trashed":true}')
  })

  test('says so when the linked folder has been moved to the trash', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const store = createDriveStore({
      getToken: () => Promise.resolve({ token: 't', expiresAt: Date.now() + 3_600_000 }),
      fetch: fetchMock,
    })
    await store.connect()
    fetchMock.mockResolvedValueOnce(jsonResponse(folder))
    await store.linkFolder('folder1234')
    fetchMock.mockResolvedValueOnce(jsonResponse({ trashed: true }))
    await expect(store.list()).rejects.toThrow('The folder "Class 5B" is in the Google Drive trash')
  })

  test('reports the signed-in account', async () => {
    const fetchMock = vi.fn<typeof fetch>()
    const store = createDriveStore({
      getToken: () => Promise.resolve({ token: 't', expiresAt: Date.now() + 3_600_000 }),
      fetch: fetchMock,
    })
    await store.connect()
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        user: { displayName: 'Ada Lovelace', emailAddress: 'ada@example.com', photoLink: 'https://lh3/photo' },
      }),
    )
    expect(await store.account()).toEqual({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      photoUrl: 'https://lh3/photo',
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress,photoLink)')
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer t')
  })

  test('reports API errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response('quota exceeded', { status: 403 }))
    const store = createDriveStore({
      getToken: () => Promise.resolve({ token: 't', expiresAt: Date.now() + 3_600_000 }),
      fetch: fetchMock,
    })
    await store.connect()
    await expect(store.linkFolder('folder1234')).rejects.toThrow('Google Drive request failed (403): quota exceeded')
  })
})
