/** Costume pictures for the assistant: Claude reads PNG and JPEG, so vector costumes are drawn to a PNG first. */
import type { AssistantCostume } from './vm-types'

export interface CostumeImage {
  mediaType: 'image/png' | 'image/jpeg'
  /** Base64 image data. */
  data: string
  width: number
  height: number
}

export type CostumeRenderer = (costume: AssistantCostume) => Promise<CostumeImage>

/** The longest side of a picture sent to Claude; larger costumes are scaled down. */
export const MAX_IMAGE_SIDE = 512
/** Smaller costumes are scaled up to this longest side so Claude can make out their details. */
export const MIN_IMAGE_SIDE = 256

const MIME_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

/** Draw a costume onto a white canvas, scaled to MIN_IMAGE_SIDE..MAX_IMAGE_SIDE, and return it as a PNG. Browser only. */
export const renderCostumeInBrowser: CostumeRenderer = async (costume) => {
  const asset = costume.asset
  if (!asset) throw new Error(`Costume "${costume.name}" has no image data loaded`)
  const mimeType = MIME_TYPES[asset.dataFormat]
  if (!mimeType) throw new Error(`Costume "${costume.name}" is in an unsupported format (${asset.dataFormat})`)
  const url = URL.createObjectURL(new Blob([asset.data as BlobPart], { type: mimeType }))
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const [naturalWidth, naturalHeight] = costume.size ?? [image.naturalWidth, image.naturalHeight]
    const longest = Math.max(naturalWidth, naturalHeight, 1)
    const scale = Math.min(MAX_IMAGE_SIDE, Math.max(MIN_IMAGE_SIDE, longest)) / longest
    const width = Math.max(1, Math.round(naturalWidth * scale))
    const height = Math.max(1, Math.round(naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('renderCostumeInBrowser: no 2D canvas context')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
    context.drawImage(image, 0, 0, width, height)
    const data = canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '')
    return { mediaType: 'image/png', data, width, height }
  } finally {
    URL.revokeObjectURL(url)
  }
}
