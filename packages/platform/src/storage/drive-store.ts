/**
 * Projects kept in the user's Google Drive. Uses the `drive.file` scope, so the app can only see files it
 * created itself. Signing in uses Google Identity Services in the browser; no server is involved.
 */
import { type ProjectInfo, type ProjectStore, SB3_MIME_TYPE, fileNameFor, projectNameFor } from './types'

const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3'
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client'
/** Marks files made by this app, so listing finds them even if their name or type changes. */
const APP_PROPERTY = 'scratchCustomized'

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
  modifiedTime: string
  size?: string
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

const multipartBody = (metadata: object, data: ArrayBuffer, boundary: string): Blob =>
  new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${SB3_MIME_TYPE}\r\n\r\n`,
    data,
    `\r\n--${boundary}--`,
  ])

const toInfo = (file: DriveFile): ProjectInfo => ({
  id: file.id,
  name: projectNameFor(file.name),
  modified: Date.parse(file.modifiedTime),
  size: file.size === undefined ? undefined : Number(file.size),
})

export const createDriveStore = (options: { getToken: TokenProvider; fetch?: typeof fetch }): ProjectStore => {
  const fetchFn = options.fetch ?? globalThis.fetch.bind(globalThis)
  let token: AccessToken | undefined

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

  const upload = async (method: 'POST' | 'PATCH', url: string, metadata: object, data: ArrayBuffer) => {
    const boundary = `scratch-customized-${Math.random().toString(36).slice(2)}`
    const response = await request(url, {
      method,
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body: multipartBody(metadata, data, boundary),
    })
    return toInfo((await response.json()) as DriveFile)
  }

  return {
    kind: 'drive',
    isSupported: () => typeof fetchFn === 'function',
    isConnected: () => Promise.resolve(Boolean(token && token.expiresAt > Date.now())),
    connect: async () => {
      token = await options.getToken(true)
    },
    list: async () => {
      const query = `appProperties has { key='${APP_PROPERTY}' and value='1' } and trashed=false`
      const params = new URLSearchParams({
        q: query,
        orderBy: 'modifiedTime desc',
        fields: 'files(id,name,modifiedTime,size)',
        pageSize: '200',
      })
      const response = await request(`${API}/files?${params.toString()}`)
      const { files } = (await response.json()) as { files: DriveFile[] }
      return files.map(toInfo)
    },
    load: async (id) => (await request(`${API}/files/${encodeURIComponent(id)}?alt=media`)).arrayBuffer(),
    save: (name, data, id) => {
      const fields = 'fields=id,name,modifiedTime,size'
      const metadata = { name: fileNameFor(name), mimeType: SB3_MIME_TYPE }
      if (id) {
        return upload(
          'PATCH',
          `${UPLOAD_API}/files/${encodeURIComponent(id)}?uploadType=multipart&${fields}`,
          metadata,
          data,
        )
      }
      return upload(
        'POST',
        `${UPLOAD_API}/files?uploadType=multipart&${fields}`,
        { ...metadata, appProperties: { [APP_PROPERTY]: '1' } },
        data,
      )
    },
    remove: async (id) => {
      await request(`${API}/files/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trashed: true }),
      })
    },
  }
}
