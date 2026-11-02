import gifenc from 'gifenc'

const { GIFEncoder } = gifenc

// Animated countdown image, drawn from scratch (no canvas, no fonts): four
// tiles (days, hours, minutes, seconds) in a small pixel font. An e-mail
// cannot run code, so the usual way to get a live countdown is an image the
// server draws at the moment it is opened: 60 frames, one per second, showing
// the time left from then on.

const W = 468
const H = 96
const TILE_W = 108
const GAP = 12
const FRAMES = 60

const GLYPHS: Record<string, string[]> = {
  '0': [' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '],
  '1': ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  '2': [' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'],
  '3': [' ### ', '#   #', '    #', '  ## ', '    #', '#   #', ' ### '],
  '4': ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '],
  '5': ['#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '],
  '6': ['  ## ', ' #   ', '#    ', '#### ', '#   #', '#   #', ' ### '],
  '7': ['#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '],
  '8': [' ### ', '#   #', '#   #', ' ### ', '#   #', '#   #', ' ### '],
  '9': [' ### ', '#   #', '#   #', ' ####', '    #', '   # ', ' ##  '],
  J: ['  ###', '   # ', '   # ', '   # ', '   # ', '#  # ', ' ##  '],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  U: ['#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '# # #', '#   #', '#   #', '#   #'],
  I: [' ### ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #', '#   #', '#   #'],
  C: [' ### ', '#   #', '#    ', '#    ', '#    ', '#   #', ' ### '],
}
const LABELS = ['JOURS', 'HEURES', 'MIN', 'SEC']

export interface CountdownStyle {
  tile: string
  digits: string
  label: string
}

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]

// Draws `text` with its top-left corner at (x, y); returns the drawn width.
function text(px: Uint8Array, s: string, x: number, y: number, scale: number, color: number, gap = 1): number {
  let cx = x
  for (const ch of s) {
    const g = GLYPHS[ch]
    if (!g) continue
    g.forEach((row, r) => {
      for (let c = 0; c < 5; c++) {
        if (row[c] !== '#') continue
        for (let dy = 0; dy < scale; dy++) px.fill(color, (y + r * scale + dy) * W + cx + c * scale, (y + r * scale + dy) * W + cx + (c + 1) * scale)
      }
    })
    cx += 5 * scale + gap * scale
  }
  return cx - x - gap * scale
}
const widthOf = (s: string, scale: number, gap = 1) => s.length * 5 * scale + (s.length - 1) * gap * scale

// The four tiles, with rounded corners, on a transparent background (index 0).
function base(): Uint8Array {
  const px = new Uint8Array(W * H)
  const r = 10
  for (let t = 0; t < 4; t++) {
    const x0 = t * (TILE_W + GAP)
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < TILE_W; x++) {
        const dx = Math.max(r - x, x - (TILE_W - 1 - r), 0)
        const dy = Math.max(r - y, y - (H - 1 - r), 0)
        if (dx * dx + dy * dy <= r * r) px[y * W + x0 + x] = 1
      }
    }
  }
  return px
}

export function countdownGif(target: number, now: number, style: CountdownStyle): Uint8Array {
  const gif = GIFEncoder()
  const palette = [[0, 0, 0], rgb(style.tile), rgb(style.digits), rgb(style.label)]
  const frame0 = base()
  // Labels never change: draw them once.
  LABELS.forEach((label, t) => {
    const x0 = t * (TILE_W + GAP)
    text(frame0, label, x0 + Math.round((TILE_W - widthOf(label, 2)) / 2), 66, 2, 3)
  })

  for (let k = 0; k < FRAMES; k++) {
    const left = Math.max(0, Math.floor((target - (now + k * 1000)) / 1000))
    const days = Math.min(999, Math.floor(left / 86400))
    const parts = [String(days).padStart(2, '0'), String(Math.floor((left % 86400) / 3600)).padStart(2, '0'), String(Math.floor((left % 3600) / 60)).padStart(2, '0'), String(left % 60).padStart(2, '0')]
    const px = frame0.slice()
    parts.forEach((p, t) => {
      const x0 = t * (TILE_W + GAP)
      text(px, p, x0 + Math.round((TILE_W - widthOf(p, 6)) / 2), 14, 6, 2)
    })
    gif.writeFrame(px, W, H, { palette, delay: 1000, transparent: true, transparentIndex: 0, repeat: k === 0 ? -1 : undefined })
  }
  gif.finish()
  return gif.bytes()
}

export const COUNTDOWN_SIZE = { width: W, height: H }
