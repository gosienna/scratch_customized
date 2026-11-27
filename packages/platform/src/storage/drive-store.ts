/**
 * Projects kept as Git bundle files in one Google Drive folder the user links, which may be a folder shared with them
 * or one in a shared drive. Uses the full `drive` scope, because a pasted folder link and files other people put
 * in the folder are outside what the narrower `drive.file` scope can see. Signing in uses Google Identity
 * Services in the browser; no server is involved. Old .sb3 files in the folder are listed too, for importing.
 * Each bundle carries its token (see `bundleToken`) in its `appProperties`, so a save can tell whether the file was
 * changed elsewhere without downloading it.
 */
import { getSetting, setSetting } from './indexeddb-store'
import {
  BUNDLE_EXTENSION,
  BUNDLE_MIME_TYPE,
  type ProjectInfo,
  type ProjectStore,
  SB3_MIME_TYPE,
  fileNameFor,
  formatOf,
  projectNameFor,
} from './types'

const SCOPE = 'https://www.googleapis.com/auth/drive'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client'
const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const FOLDER_SETTING = 'driveStore.folder'
const FILE_FIELDS = 'id,name,mimeType,modifiedTime,size,thumbnailLink'

export interface AccessToken {
  token: string
  /** Milliseconds since the epoch. */
  expiresAt: number
}

/** Something that can get an OAuth access token; `interactive` allows showing Google's consent popup. */
export type TokenProvider = (interactive: boolean) => Promise<AccessToken>

interface DriveFile {
  id: string
  name: string
  mimeType?: string
  modifiedTime: string
  size?: string
  thumbnailLink?: string
}

export interface DriveFolder {
  id: string
  name: string
}

export interface DriveStore extends ProjectStore {
  /** The linked folder, if one has been linked. */
  folder: () => Promise<DriveFolder | undefined>
  /** Link the folder with this ID or link (as copied from Drive's address bar or Share dialog). */
  linkFolder: (idOrUrl: string) => Promise<DriveFolder>
  /** The current access token, for Google APIs used beside the store (the folder Picker). */
  accessToken: () => Promise<string>
}

/** The folder ID in a Drive folder link (`…/folders/<id>`, `…?id=<id>`) or a bare ID; undefined otherwise. */
export const parseDriveFolderId = (text: string): string | undefined => {
  const trimmed = text.trim()
  const match = /\/folders\/([\w-]+)/.exec(trimmed) ?? /[?&]id=([\w-]+)/.exec(trimmed)
  if (match) return match[1]
  return /^[\w-]{10,}$/.test(trimmed) ? trimmed : undefined
}

interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface GoogleIdentity {
  accounts: {
    oauth2: {
      initTokenClient: (config: {
        client_id: string
        scope: string
        prompt?: string
        callback: (response: TokenResponse) => void
        error_callback?: (error: { type: string; message?: string }) => void
      }) => { requestAccessToken: (overrides?: { prompt?: string }) => void }
    }
  }
}

const loadGoogleIdentity = (): Promise<GoogleIdentity> => {
  const existing = (globalThis as { google?: GoogleIdentity }).google
  if (existing?.accounts.oauth2) return Promise.resolve(existing)
  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SCRIPT
    script.async = true
    script.onload = () => {
      const google = (globalThis as { google?: GoogleIdentity }).google
      if (google) resolve(google)
      else reject(new Error('Google sign-in did not load'))
    }
    script.onerror = () => reject(new Error('Could not load Google sign-in; check the network connection'))
    document.head.appendChild(script)
  })
}

/** Get access tokens with Google Identity Services' token client. */
export const googleIdentityTokenProvider = (clientId: string): TokenProvider => {
  let client: ReturnType<GoogleIdentity['accounts']['oauth2']['initTokenClient']> | undefined
  let pending: { resolve: (token: AccessToken) => void; reject: (error: Error) => void } | undefined

  return async (interactive) => {
    if (!interactive) throw new Error('Not signed in to Google Drive')
    const google = await loadGoogleIdentity()
    client ??= google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (response) => {
        if (response.access_token) {
          pending?.resolve({
            token: response.access_token,
            expiresAt: Date.now() + (response.expires_in ?? 3600) * 1000,
          })
        } else {
          pending?.reject(new Error(response.error_description ?? response.error ?? 'Google sign-in failed'))
        }
        pending = undefined
      },
      error_callback: (error) => {
        pending?.reject(new Error(error.message ?? `Google sign-in was not completed (${error.type})`))
        pending = undefined
      },
    })
    const tokenClient = client
    return new Promise<AccessToken>((resolve, reject) => {
      pending = { resolve, reject }
      tokenClient.requestAccessToken({ prompt: '' })
    })
  }
}

const multipartBody = (metadata: object, data: Uint8Array, boundary: string): Blob =>
  new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${BUNDLE_MIME_TYPE}\r\n\r\n`,
    data as Uint8Array<ArrayBuffer>,
    `\r\n--${boundary}--`,
  ])

/** Drive's `contentHints.thumbnail.image` wants URL-safe base64. */
const base64Url = async (blob: Blob): Promise<string> => {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const toInfo = (file: DriveFile): ProjectInfo => ({
  id: file.id,
  name: projectNameFor(file.name),
  format: formatOf(file.name) ?? (file.mimeType === SB3_MIME_TYPE ? 'sb3' : 'bundle'),
  modified: Date.parse(file.modifiedTime),
  size: file.size === undefined ? undefined : Number(file.size),
})

export const createDriveStore = (options: { getToken: TokenProvider; fetch?: typeof fetch }): DriveStore => {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis)
  let token: AccessToken | undefined
  /** Thumbnail links from the last listing, by file ID. */
  const thumbnailLinks = new Map<string, string>()

  let refreshing: Promise<AccessToken> | undefined

  const currentToken = (): Promise<string> => {
    // Refresh a minute early so a token does not expire during an upload.
    if (token && token.expiresAt - 60_000 >= Date.now()) return Promise.resolve(token.token)
    // Concurrent requests share one refresh.
    refreshing ??= options.getToken(false).then(
      (fresh) => {
        token = fresh
        refreshing = undefined
        return fresh
      },
      (error: unknown) => {
        refreshing = undefined
        throw error
      },
    )
    return refreshing.then((fresh) => fresh.token)
  }

  const request = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const response = await fetchFn(url, {
      ...init,
      headers: {
        ...(init.headers as Record<string, string> | undefined),
        Authorization: `Bearer ${await currentToken()}`,
      },
    })
    if (response.status === 401) token = undefined
    if (!response.ok) throw new Error(`Google Drive request failed (${response.status}): ${await response.text()}`)
    return response
  }

  const upload = async (method: 'POST' | 'PATCH', url: string, metadata: object, data: Uint8Array) => {
    const boundary = `scratch-customized-${Math.random().toString(36).slice(2)}`
    const response = await request(url, {
      method,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody(metadata, data, boundary),
    })
    return toInfo((await response.json()) as DriveFile)
  }

  const linkedFolder = async (): Promise<DriveFolder> => {
    const folder = await getSetting<DriveFolder>(FOLDER_SETTING)
    if (!folder) throw new Error('No Google Drive folder linked yet')
    return folder
  }

  const fileUrl = (id: string) => `${API}/files/${encodeURIComponent(id)}`

  return {
    kind: 'drive',
    isSupported: () => typeof fetchFn === 'function',
    isConnected: () => Promise.resolve(Boolean(token && token.expiresAt > Date.now())),
    connect: async () => {
      token = await options.getToken(true)
    },
    folder: () => getSetting<DriveFolder>(FOLDER_SETTING),
    linkFolder: async (idOrUrl) => {
      const id = parseDriveFolderId(idOrUrl)
      if (!id) throw new Error('That does not look like a Google Drive folder link')
      const response = await request(`${fileUrl(id)}?fields=id,name,mimeType,trashed&supportsAllDrives=true`)
      const file = (await response.json()) as DriveFile & { trashed?: boolean }
      if (file.mimeType !== FOLDER_MIME_TYPE) throw new Error(`"${file.name}" is a file, not a folder`)
      if (file.trashed) throw new Error(`The folder "${file.name}" is in the Google Drive trash`)
      const folder = { id: file.id, name: file.name }
      await setSetting(FOLDER_SETTING, folder)
      return folder
    },
    accessToken: () => currentToken(),
    list: async () => {
      const folder = await linkedFolder()
      // Saving into a trashed folder succeeds, but the files cannot be seen in Drive, so say so instead.
      const folderState = (await (
        await request(`${fileUrl(folder.id)}?fields=trashed&supportsAllDrives=true`)
      ).json()) as { trashed?: boolean }
      if (folderState.trashed) {
        throw new Error(
          `The folder "${folder.name}" is in the Google Drive trash. Restore it in Drive, or link another folder.`,
        )
      }
      const query =
        `'${folder.id}' in parents and trashed=false and (name contains '${BUNDLE_EXTENSION}' or ` +
        `name contains '.sb3' or mimeType='${BUNDLE_MIME_TYPE}' or mimeType='${SB3_MIME_TYPE}')`
      const params = new URLSearchParams({
        q: query,
        orderBy: 'modifiedTime desc',
        fields: `files(${FILE_FIELDS})`,
        pageSize: '200',
        corpora: 'allDrives',
        includeItemsFromAllDrives: 'true',
        supportsAllDrives: 'true',
      })
      const response = await request(`${API}/files?${params.toString()}`)
      const { files } = (await response.json()) as { files: DriveFile[] }
      thumbnailLinks.clear()
      for (const file of files) if (file.thumbnailLink) thumbnailLinks.set(file.id, file.thumbnailLink)
      return files.map(toInfo)
    },
    load: async (id) => (await request(`${fileUrl(id)}?alt=media&supportsAllDrives=true`)).arrayBuffer(),
    save: async (name, data, { id, thumbnail, token } = {}) => {
      const query = `uploadType=multipart&supportsAllDrives=true&fields=${FILE_FIELDS}`
      const metadata = {
        name: fileNameFor(name),
        mimeType: BUNDLE_MIME_TYPE,
        ...(token && { appProperties: { token } }),
        ...(thumbnail && {
          contentHints: { thumbnail: { image: await base64Url(thumbnail), mimeType: thumbnail.type || 'image/png' } },
        }),
      }
      if (id) return upload('PATCH', `${UPLOAD_API}/files/${encodeURIComponent(id)}?${query}`, metadata, data)
      const folder = await linkedFolder()
      return upload('POST', `${UPLOAD_API}/files?${query}`, { ...metadata, parents: [folder.id] }, data)
    },
    token: async (id) => {
      const response = await request(`${fileUrl(id)}?fields=appProperties&supportsAllDrives=true`)
      const { appProperties } = (await response.json()) as { appProperties?: Record<string, string> }
      return appProperties?.token
    },
    thumbnail: async (id) => {
      const link = thumbnailLinks.get(id)
      if (!link) return undefined
      try {
        const response = await fetchFn(link, { headers: { Authorization: `Bearer ${await currentToken()}` } })
        if (response.ok) return await response.blob()
        console.warn(`Google Drive thumbnail for ${id} failed (${response.status})`)
      } catch (error) {
        console.warn(`Google Drive thumbnail for ${id} could not be fetched`, error)
      }
      return undefined
    },
    remove: async (id) => {
      await request(`${fileUrl(id)}?supportsAllDrives=true`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      })
    },
  }
}
