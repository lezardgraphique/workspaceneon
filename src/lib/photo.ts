// Mini photo editor engine (browser only): rotate, flip, crop, light and
// colour adjustments, ready-made looks, output size for e-mails. Pixels are
// worked on directly (getImageData): `ctx.filter` doesn't exist in Safari 15.

export type Rotation = 0 | 90 | 180 | 270
export type Look = 'none' | 'bw' | 'sepia' | 'vivid' | 'soft' | 'warm' | 'cool'

export interface Rect {
  /** Fractions (0–1) of the rotated image. */
  x: number
  y: number
  w: number
  h: number
}

export interface PhotoEdit {
  rot: Rotation
  flipH: boolean
  flipV: boolean
  crop: Rect
  /** −100 … 100 */
  bright: number
  contrast: number
  sat: number
  warm: number
  look: Look
}

export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 }
export const NO_EDIT: PhotoEdit = { rot: 0, flipH: false, flipV: false, crop: FULL, bright: 0, contrast: 0, sat: 0, warm: 0, look: 'none' }

export const LOOKS: { id: Look; label: string }[] = [
  { id: 'none', label: 'Aucun' },
  { id: 'vivid', label: 'Éclatant' },
  { id: 'soft', label: 'Doux' },
  { id: 'warm', label: 'Chaud' },
  { id: 'cool', label: 'Froid' },
  { id: 'bw', label: 'Noir et blanc' },
  { id: 'sepia', label: 'Sépia' },
]

/** Crop ratios useful in e-mails (width / height); null = free. */
export const RATIOS: { label: string; value: number | null }[] = [
  { label: 'Libre', value: null },
  { label: 'Carré 1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:2', value: 3 / 2 },
  { label: '16:9', value: 16 / 9 },
  { label: 'Bannière 2:1', value: 2 },
  { label: 'Bandeau 3:1', value: 3 },
]

export const isEdited = (e: PhotoEdit) => JSON.stringify(e) !== JSON.stringify(NO_EDIT)

/** Size of the image once rotated. */
export const orientedSize = (w: number, h: number, rot: Rotation) => (rot % 180 ? { w: h, h: w } : { w, h })

/** Largest crop of the given ratio centred in an image of w × h pixels. */
export function centredCrop(w: number, h: number, ratio: number | null): Rect {
  if (!ratio) return FULL
  const imgRatio = w / h
  if (imgRatio > ratio) {
    const cw = ratio / imgRatio
    return { x: (1 - cw) / 2, y: 0, w: cw, h: 1 }
  }
  const ch = imgRatio / ratio
  return { x: 0, y: (1 - ch) / 2, w: 1, h: ch }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** Keeps a crop inside the image, at least 4 % wide and high. */
export function fitCrop(r: Rect): Rect {
  const w = clamp(r.w, 0.04, 1)
  const h = clamp(r.h, 0.04, 1)
  return { x: clamp(r.x, 0, 1 - w), y: clamp(r.y, 0, 1 - h), w, h }
}

/** The whole image rotated and flipped, scaled so its width is at most maxW. */
export function drawOriented(img: CanvasImageSource & { naturalWidth: number; naturalHeight: number }, e: PhotoEdit, maxW = Infinity): HTMLCanvasElement {
  const { w, h } = orientedSize(img.naturalWidth, img.naturalHeight, e.rot)
  const scale = Math.min(1, maxW / w)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w * scale))
  c.height = Math.max(1, Math.round(h * scale))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((e.rot * Math.PI) / 180)
  ctx.scale(e.flipH ? -1 : 1, e.flipV ? -1 : 1)
  const dw = (e.rot % 180 ? c.height : c.width)
  const dh = (e.rot % 180 ? c.width : c.height)
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
  return c
}

/** Applies light, colour and look to a canvas, in place. */
export function adjust(canvas: HTMLCanvasElement, e: PhotoEdit) {
  let { bright, contrast, sat, warm } = e
  if (e.look === 'vivid') (sat += 35), (contrast += 15)
  if (e.look === 'soft') (contrast -= 20), (bright += 8), (sat -= 10)
  if (e.look === 'warm') warm += 35
  if (e.look === 'cool') warm -= 35
  if (e.look === 'bw' || e.look === 'sepia') sat = -100
  const neutral = !bright && !contrast && !sat && !warm && e.look !== 'sepia'
  if (neutral) return
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const px = data.data
  const b = bright * 1.28
  const c = clamp(contrast, -99, 99) * 2.55
  const f = (259 * (c + 255)) / (255 * (259 - c))
  const s = 1 + clamp(sat, -100, 100) / 100
  const t = warm * 0.35
  const sepia = e.look === 'sepia'
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i]
    let g = px[i + 1]
    let bl = px[i + 2]
    r = f * (r + b - 128) + 128
    g = f * (g + b - 128) + 128
    bl = f * (bl + b - 128) + 128
    const grey = 0.299 * r + 0.587 * g + 0.114 * bl
    r = grey + (r - grey) * s
    g = grey + (g - grey) * s
    bl = grey + (bl - grey) * s
    if (sepia) {
      r = grey * 1.07 + 20
      g = grey * 0.9 + 8
      bl = grey * 0.7
    }
    px[i] = r + t
    px[i + 1] = g
    px[i + 2] = bl - t
  }
  ctx.putImageData(data, 0, 0)
}

/** Final image: cropped, adjusted, `outW` pixels wide at most (never enlarged). */
export function renderPhoto(img: CanvasImageSource & { naturalWidth: number; naturalHeight: number }, e: PhotoEdit, outW: number): HTMLCanvasElement {
  const full = drawOriented(img, e)
  const sx = Math.round(e.crop.x * full.width)
  const sy = Math.round(e.crop.y * full.height)
  const sw = Math.max(1, Math.round(e.crop.w * full.width))
  const sh = Math.max(1, Math.round(e.crop.h * full.height))
  const scale = Math.min(1, outW / sw)
  const out = document.createElement('canvas')
  out.width = Math.max(1, Math.round(sw * scale))
  out.height = Math.max(1, Math.round(sh * scale))
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height)
  adjust(out, e)
  return out
}

/** Does the canvas use transparency (then it stays a PNG)? */
export function hasTransparency(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const step = Math.max(1, Math.floor((canvas.width * canvas.height) / 40_000))
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data
  for (let i = 3; i < px.length; i += 4 * step) if (px[i] < 250) return true
  return false
}

export const toBlob = (canvas: HTMLCanvasElement, type: 'image/jpeg' | 'image/png', quality = 0.85) =>
  new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export impossible'))), type, quality))

/**
 * Loads an image for editing. Images of other sites only work when they allow
 * it (CORS); otherwise the canvas would be locked.
 */
export function loadForEdit(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('cors'))
    img.src = src
  })
}
