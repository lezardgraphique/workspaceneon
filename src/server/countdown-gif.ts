import gifenc from 'gifenc'

const { GIFEncoder } = gifenc

// Animated countdown image, drawn from scratch (no canvas, no fonts): four
// tiles (days, hours, minutes, seconds) in a small pixel font. An e-mail
// cannot run code, so the usual way to get a live countdown is an image the
// server draws at the moment it is opened: 60 frames, one per second, showing
// the time left from then on.

const W = 468
const H = 120
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
  A: [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  B: ['#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '],
  D: ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '],
  F: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '],
  G: [' ### ', '#   #', '#    ', '# ###', '#   #', '#   #', ' ### '],
  K: ['#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
  P: ['#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '],
  Q: [' ### ', '#   #', '#   #', '#   #', '# # #', '#  # ', ' ## #'],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  V: ['#   #', '#   #', '#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '#   #', '# # #', '# # #', '## ##', '#   #'],
  X: ['#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'],
  Y: ['#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '],
  Z: ['#####', '    #', '   # ', '  #  ', ' #   ', '#    ', '#####'],
  '!': ['  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '     ', '  #  '],
  '?': [' ### ', '#   #', '    #', '   # ', '  #  ', '     ', '  #  '],
  '-': ['     ', '     ', '     ', '#####', '     ', '     ', '     '],
  '.': ['     ', '     ', '     ', '     ', '     ', ' ##  ', ' ##  '],
  ':': ['     ', '  #  ', '  #  ', '     ', '  #  ', '  #  ', '     '],
  "'": ['  #  ', '  #  ', ' #   ', '     ', '     ', '     ', '     '],
  ' ': ['     ', '     ', '     ', '     ', '     ', '     ', '     '],
}

export type Unit = 'd' | 'h' | 'm' | 's'
export const LANGS = ['fr', 'en', 'es', 'de', 'it'] as const
export type Lang = (typeof LANGS)[number]
const LABELS: Record<Lang, Record<Unit, string>> = {
  fr: { d: 'JOURS', h: 'HEURES', m: 'MIN', s: 'SEC' },
  en: { d: 'DAYS', h: 'HOURS', m: 'MIN', s: 'SEC' },
  es: { d: 'DIAS', h: 'HORAS', m: 'MIN', s: 'SEG' },
  de: { d: 'TAGE', h: 'STD', m: 'MIN', s: 'SEK' },
  it: { d: 'GIORNI', h: 'ORE', m: 'MIN', s: 'SEC' },
}

export interface CountdownStyle {
  tile: string | null // null = no tile background
  digits: string
  label: string
  border: string | null
  alert: string | null // digits colour when little time is left
  alertHours: number // 0 = never
  radius: number
  borderWidth: number
  scale: number // size of the digits (pixels per dot)
  gap: number
  units: Unit[]
  labels: boolean
  lang: Lang
  separator: boolean
  end: string // shown once the time is over ('' = zeros)
}

export const DEFAULT_STYLE: CountdownStyle = {
  tile: 'f4f4fa',
  digits: 'ff007f',
  label: '3a3a52',
  border: null,
  alert: null,
  alertHours: 0,
  radius: 10,
  borderWidth: 2,
  scale: 6,
  gap: 12,
  units: ['d', 'h', 'm', 's'],
  labels: true,
  lang: 'fr',
  separator: false,
  end: '',
}

// Text allowed in the end message: what the font can draw.
export function cleanEnd(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 !?.:'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24)
}

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]

// Draws `text` with its top-left corner at (x, y).
function text(px: Uint8Array, s: string, x: number, y: number, scale: number, color: number, gap = 1): void {
  let cx = x
  for (const ch of s) {
    const g = GLYPHS[ch]
    if (!g) continue
    g.forEach((row, r) => {
      for (let c = 0; c < 5; c++) {
        if (row[c] !== '#') continue
        for (let dy = 0; dy < scale; dy++) {
          const yy = y + r * scale + dy
          if (yy < 0 || yy >= H) continue
          px.fill(color, yy * W + cx + c * scale, yy * W + cx + (c + 1) * scale)
        }
      }
    })
    cx += 5 * scale + gap * scale
  }
}
const widthOf = (s: string, scale: number, gap = 1) => (s.length ? s.length * 5 * scale + (s.length - 1) * gap * scale : 0)

// A rounded rectangle, optionally with a border ring (palette index `ring`).
function tile(px: Uint8Array, x0: number, y0: number, w: number, h: number, r: number, fill: number, ring: number | null, bw: number): void {
  const inside = (x: number, y: number, rx: number, ox: number, ww: number, hh: number) => {
    const dx = Math.max(rx - (x - ox), x - ox - (ww - 1 - rx), 0)
    const dy = Math.max(rx - (y - ox), y - ox - (hh - 1 - rx), 0)
    return dx * dx + dy * dy <= rx * rx
  }
  const rr = Math.min(r, Math.floor(Math.min(w, h) / 2))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y, rr, 0, w, h)) continue
      let idx = fill
      if (ring !== null) {
        const inner = x >= bw && y >= bw && x < w - bw && y < h - bw && inside(x - bw, y - bw, Math.max(0, rr - bw), 0, w - 2 * bw, h - 2 * bw)
        if (!inner) idx = ring
      }
      px[(y0 + y) * W + x0 + x] = idx
    }
  }
}

// Palette: 0 transparent, 1 tile, 2 digits, 3 labels, 4 border, 5 alert digits.
export function countdownGif(target: number, now: number, style: CountdownStyle): Uint8Array {
  const st = style
  const units = st.units.length ? st.units : DEFAULT_STYLE.units
  const labelOf = (u: Unit) => LABELS[st.lang][u]
  const left0 = Math.max(0, Math.floor((target - now) / 1000))
  const dayDigits = Math.max(2, String(Math.min(999, Math.floor(left0 / 86400))).length)
  const lenOf = (u: Unit) => (u === 'd' ? dayDigits : 2)

  // Pick the biggest digit size that still fits in the picture.
  const geometry = (s: number) => {
    const ls = s >= 5 ? 2 : 1
    const padX = 3 * s
    const padY = Math.round(s * 2.3)
    const sepScale = Math.max(2, Math.floor(s / 2))
    const gap = st.separator ? Math.max(st.gap, 5 * sepScale + 6) : st.gap
    const widths = units.map((u) => Math.max(widthOf('0'.repeat(lenOf(u)), s), st.labels ? widthOf(labelOf(u), ls) : 0) + 2 * padX)
    const tw = Math.max(...widths)
    const th = padY + 7 * s + (st.labels ? Math.round(s * 1.6) + 7 * ls : 0) + padY
    return { s, ls, padX, padY, sepScale, gap, tw, th, total: units.length * tw + (units.length - 1) * gap }
  }
  let g = geometry(Math.min(8, Math.max(2, st.scale)))
  while ((g.total > W || g.th > H) && g.s > 2) g = geometry(g.s - 1)

  const x0 = Math.max(0, Math.round((W - g.total) / 2))
  const y0 = Math.max(0, Math.round((H - g.th) / 2))
  const tileIdx = st.tile ? 1 : 0
  const ring = st.border ? 4 : null
  const palette = [[0, 0, 0], rgb(st.tile ?? '000000'), rgb(st.digits), rgb(st.label), rgb(st.border ?? '000000'), rgb(st.alert ?? st.digits)]

  const base = new Uint8Array(W * H)
  units.forEach((u, t) => {
    const tx = x0 + t * (g.tw + g.gap)
    tile(base, tx, y0, g.tw, g.th, st.radius, tileIdx, ring, st.borderWidth)
    if (st.labels) {
      const l = labelOf(u)
      text(base, l, tx + Math.round((g.tw - widthOf(l, g.ls)) / 2), y0 + g.padY + 7 * g.s + Math.round(g.s * 1.6), g.ls, 3)
    }
    if (st.separator && t < units.length - 1) {
      const sx = tx + g.tw + Math.round((g.gap - 5 * g.sepScale) / 2)
      text(base, ':', sx, y0 + g.padY + Math.round((7 * g.s - 7 * g.sepScale) / 2), g.sepScale, 2)
    }
  })

  // Expired: either zeros, or the end message on one wide tile.
  const endMsg = cleanEnd(st.end)
  const endFrame = (): Uint8Array => {
    const px = new Uint8Array(W * H)
    let es = Math.min(8, Math.max(2, st.scale))
    const pad = 3 * es
    while (es > 2 && widthOf(endMsg, es) + 2 * pad > W) es--
    const w = Math.min(W, widthOf(endMsg, es) + 2 * Math.round(es * 3))
    const h = Math.min(H, 7 * es + 2 * Math.round(es * 2.3))
    const ex = Math.round((W - w) / 2)
    const ey = Math.round((H - h) / 2)
    tile(px, ex, ey, w, h, st.radius, tileIdx, ring, st.borderWidth)
    text(px, endMsg, ex + Math.round((w - widthOf(endMsg, es)) / 2), ey + Math.round((h - 7 * es) / 2), es, st.alert ? 5 : 2)
    return px
  }

  const gif = GIFEncoder()
  const expiredAtStart = left0 === 0
  const frames = expiredAtStart ? 1 : FRAMES
  for (let k = 0; k < frames; k++) {
    const left = Math.max(0, Math.floor((target - (now + k * 1000)) / 1000))
    let px: Uint8Array
    if (left === 0 && endMsg) {
      px = endFrame()
    } else {
      px = base.slice()
      const value = (u: Unit) => (u === 'd' ? Math.min(999, Math.floor(left / 86400)) : u === 'h' ? Math.floor((left % 86400) / 3600) : u === 'm' ? Math.floor((left % 3600) / 60) : left % 60)
      // A unit that is not shown rolls into the next one (no days: hours go past 24).
      const shown = (u: Unit) => {
        if (u === 'h' && !units.includes('d')) return Math.min(999, Math.floor(left / 3600))
        if (u === 'm' && !units.includes('h')) return Math.min(999, Math.floor(left / 60))
        if (u === 's' && !units.includes('m')) return Math.min(999, left)
        return value(u)
      }
      const urgent = st.alert !== null && st.alertHours > 0 && left < st.alertHours * 3600
      units.forEach((u, t) => {
        const str = String(shown(u)).padStart(lenOf(u), '0')
        const tx = x0 + t * (g.tw + g.gap)
        text(px, str, tx + Math.round((g.tw - widthOf(str, g.s)) / 2), y0 + g.padY, g.s, urgent ? 5 : 2)
      })
    }
    gif.writeFrame(px, W, H, { palette, delay: 1000, transparent: true, transparentIndex: 0, repeat: k === 0 ? -1 : undefined })
  }
  gif.finish()
  return gif.bytes()
}

export const COUNTDOWN_SIZE = { width: W, height: H }
