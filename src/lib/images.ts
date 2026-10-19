// Image upload (Netlify Blobs via /api/images). Only formats every email
// client displays are kept: WebP, HEIC… are converted to JPEG in the browser.

export const IMAGE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
}

// Twice the widest module, enough for retina screens without bloating emails.
const MAX_WIDTH = 1600

const loadImage = (file: File) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Image illisible'))
    img.src = URL.createObjectURL(file)
  })

// Downscales large images and converts unsupported formats. GIFs are kept as
// is so animations survive.
async function prepare(file: File): Promise<File> {
  if (file.type === 'image/gif') return file
  const supported = file.type === 'image/jpeg' || file.type === 'image/png'
  const img = await loadImage(file)
  URL.revokeObjectURL(img.src)
  if (supported && img.naturalWidth <= MAX_WIDTH && file.size < 1_000_000) return file
  const scale = Math.min(1, MAX_WIDTH / img.naturalWidth)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.naturalWidth * scale)
  canvas.height = Math.round(img.naturalHeight * scale)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.85))
  if (!blob) throw new Error('Conversion impossible')
  return new File([blob], file.name.replace(/\.\w+$/, type === 'image/png' ? '.png' : '.jpg'), { type })
}

export const isImageFile = (f: File) => f.type.startsWith('image/') && f.type !== 'image/svg+xml'

export async function uploadImage(file: File): Promise<string> {
  if (!isImageFile(file)) throw new Error('Choisis un fichier image (JPG, PNG, GIF, WebP…)')
  const body = new FormData()
  body.append('file', await prepare(file))
  const res = await fetch('/api/images', { method: 'POST', body })
  const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
  if (!res.ok || !json.url) throw new Error(json.error ?? 'Échec du téléversement')
  return json.url
}

export const firstImage = (files: FileList | null | undefined) => Array.from(files ?? []).find(isImageFile)
