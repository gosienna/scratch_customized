/** Choose a Google Drive folder with Google Picker, which runs in the page with the user's access token. */
import type { DriveFolder } from './drive-store'

const GAPI_SCRIPT = 'https://apis.google.com/js/api.js'

/** The parts of the Picker API used here. */
interface PickerBuilder {
  addView: (view: unknown) => PickerBuilder
  enableFeature: (feature: string) => PickerBuilder
  setOAuthToken: (token: string) => PickerBuilder
  setDeveloperKey: (key: string) => PickerBuilder
  setAppId: (appId: string) => PickerBuilder
  setTitle: (title: string) => PickerBuilder
  setCallback: (callback: (data: PickerResponse) => void) => PickerBuilder
  build: () => { setVisible: (visible: boolean) => void }
}

interface PickerResponse {
  action: string
  docs?: { id: string; name: string }[]
}

interface GooglePicker {
  PickerBuilder: new () => PickerBuilder
  DocsView: new (viewId: string) => {
    setIncludeFolders: (include: boolean) => unknown
    setSelectFolderEnabled: (enabled: boolean) => unknown
    setMimeTypes: (mimeTypes: string) => unknown
  }
  ViewId: { FOLDERS: string }
  Feature: { SUPPORT_DRIVES: string }
  Action: { PICKED: string; CANCEL: string }
}

interface Gapi {
  load: (api: string, options: { callback: () => void; onerror: () => void }) => void
}

const loadPicker = async (): Promise<GooglePicker> => {
  const global = globalThis as { gapi?: Gapi; google?: { picker?: GooglePicker } }
  if (global.google?.picker) return global.google.picker
  if (!global.gapi) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = GAPI_SCRIPT
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Could not load Google Picker; check the network connection'))
      document.head.appendChild(script)
    })
  }
  const gapi = global.gapi
  if (!gapi) throw new Error('Google Picker did not load')
  await new Promise<void>((resolve, reject) => {
    gapi.load('picker', { callback: resolve, onerror: () => reject(new Error('Google Picker did not load')) })
  })
  const picker = global.google?.picker
  if (!picker) throw new Error('Google Picker did not load')
  return picker
}

/** Show the Picker; resolves with the chosen folder, or undefined when the user cancels. */
export const pickDriveFolder = async (options: {
  token: string
  apiKey: string
  appId?: string
  title?: string
}): Promise<DriveFolder | undefined> => {
  const picker = await loadPicker()
  const view = new picker.DocsView(picker.ViewId.FOLDERS)
  view.setIncludeFolders(true)
  view.setSelectFolderEnabled(true)
  view.setMimeTypes('application/vnd.google-apps.folder')
  return new Promise((resolve) => {
    let builder = new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.SUPPORT_DRIVES)
      .setOAuthToken(options.token)
      .setDeveloperKey(options.apiKey)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) {
          const doc = data.docs?.[0]
          resolve(doc && { id: doc.id, name: doc.name })
        } else if (data.action === picker.Action.CANCEL) {
          resolve(undefined)
        }
      })
    if (options.appId) builder = builder.setAppId(options.appId)
    if (options.title) builder = builder.setTitle(options.title)
    builder.build().setVisible(true)
  })
}
