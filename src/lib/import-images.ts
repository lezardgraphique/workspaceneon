// Images of a module copied from another tool: their addresses are found in the
// imported code / fields, the server copies them into the tool
// (/api/import-images, see src/server/import-images.server.ts) and the
// addresses are swapped for the new ones. An image that can't be copied keeps
// its original address, and the note says which and why.

import { guard } from '@/lib/session-guard'

const URL_RE = /(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}(?::\d+)?\/[^\s"'<>()\\{}|^`]*/gi
const IMAGE_PATH = /\.(jpe?g|png|gif|webp|bmp)$/i
// Places where an address is an image even without an image extension.
const IMAGE_CONTEXT = /(src|srcset|background|poster|data-src)\s*=\s*["']?\s*$|url\(\s*["']?\s*$|"(src|image|img|background_image|backgroundImage)"\s*:\s*"$|background(-image)?\s*:[^;]*$/i

const OWN = /\/api\/(images|files)\//

// The address to download for a token as written in the code ("&amp;" decoded,
// "//cdn…" given https).
export const fetchable = (token: string) => (token.startsWith('//') ? `https:${token}` : token).replace(/&amp;/g, '&')

export function findImageUrls(text: string, origin = typeof location !== 'undefined' ? location.origin : ''): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(URL_RE)) {
    let token = m[0].replace(/(&quot;|&#39;|&#x27;|[.,;]+)$/i, '')
    if (!token) continue
    // "//" inside a longer word (a comment, a path) is not an address.
    if (token.startsWith('//') && /[\w:]$/.test(text.slice(Math.max(0, m.index! - 1), m.index))) continue
    const url = fetchable(token)
    if ((origin && url.startsWith(origin)) || OWN.test(url)) continue
    const path = url.split(/[?#]/)[0]
    const before = text.slice(Math.max(0, m.index! - 80), m.index)
    if (IMAGE_PATH.test(path) || IMAGE_CONTEXT.test(before)) out.add(token)
  }
  return [...out]
}

// Strings of a value (tree, fields), one per line: where addresses are looked for.
export function textsOf(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) v.forEach((x) => textsOf(x, out))
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => textsOf(x, out))
  return out
}

// Every string inside `value` (code, tree, field definitions, values) with the
// old addresses replaced by the new ones.
export function swapUrls<T>(value: T, map: Record<string, string>): T {
  const tokens = Object.keys(map).sort((a, b) => b.length - a.length)
  if (!tokens.length) return value
  const swap = (s: string) => tokens.reduce((acc, t) => (acc.includes(t) ? acc.split(t).join(map[t]) : acc), s)
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return swap(v)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return walk(value) as T
}

export interface BroughtImages {
  map: Record<string, string>
  saved: number
  failed: Array<{ url: string; error: string }>
}

// Copies the images found in `text` into the tool. Never throws: offline or
// on error, nothing is swapped and the note says so.
export async function bringImages(text: string): Promise<BroughtImages> {
  const tokens = findImageUrls(text).slice(0, 40)
  const none: BroughtImages = { map: {}, saved: 0, failed: [] }
  if (!tokens.length) return none
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { ...none, failed: tokens.map((url) => ({ url, error: 'hors ligne' })) }
  try {
    const res = guard(
      await fetch('/api/import-images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: tokens.map(fetchable) }),
      }),
    )
    const json = (await res.json().catch(() => ({}))) as { images?: Record<string, { url?: string; error?: string }>; error?: string }
    if (!res.ok || !json.images) return { ...none, failed: tokens.map((url) => ({ url, error: json.error ?? 'service indisponible' })) }
    const out: BroughtImages = { map: {}, saved: 0, failed: [] }
    for (const t of tokens) {
      const r = json.images[fetchable(t)]
      if (r?.url) {
        out.map[t] = r.url
        out.saved++
      } else out.failed.push({ url: t, error: r?.error ?? 'non traitée' })
    }
    return out
  } catch {
    return { ...none, failed: tokens.map((url) => ({ url, error: 'service injoignable' })) }
  }
}

const host = (u: string) => {
  try {
    return new URL(fetchable(u)).hostname
  } catch {
    return u.slice(0, 40)
  }
}

// One French sentence for the editor, or null when there were no images.
export function imagesNote(r: BroughtImages): string | null {
  if (!r.saved && !r.failed.length) return null
  const s = (n: number) => (n > 1 ? 's' : '')
  const parts: string[] = []
  if (r.saved) parts.push(`${r.saved} image${s(r.saved)} copiée${s(r.saved)} dans Neon Sandbox Pro : le module ne dépend plus des liens de l'autre outil.`)
  if (r.failed.length) {
    const first = r.failed[0]
    parts.push(
      `${r.failed.length} image${s(r.failed.length)} non copiée${s(r.failed.length)}, lien d'origine gardé (${host(first.url)} : ${first.error}${r.failed.length > 1 ? '…' : ''}).`,
    )
  }
  return parts.join(' ')
}

// ── Images listed in the import dialog, before anything is applied ──────────

export type ImageStatus = 'copy' | 'own' | 'data' | 'format' | 'relative'

export interface FoundImage {
  /** As written in the code / JSON (what « Remplacer » swaps). */
  token: string
  status: ImageStatus
  /** Address to show the thumbnail, '' when there is none. */
  thumb: string
  /** alt of the <img> tags using it in the code; null when no <img> uses it. */
  alt: string | null
  where: Array<'code' | 'champs'>
}

const IMG_TAG = /<img\b[^>]*>/gi
const ATTR = (name: string) => new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i')
const attrOf = (tag: string, name: string): string | null => {
  const m = tag.match(ATTR(name))
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null
}
// Formats the e-mail clients don't all show: kept as a link, never copied.
const REFUSED = /\.(webp|svg|avif|bmp|tiff?|heic)$/i

function statusOf(token: string, origin: string): ImageStatus {
  if (/^data:image\//i.test(token)) return 'data'
  const url = fetchable(token)
  if (/^https?:\/\//i.test(url)) {
    if ((origin && url.startsWith(origin)) || OWN.test(url)) return 'own'
    return REFUSED.test(url.split(/[?#]/)[0]) ? 'format' : 'copy'
  }
  if (OWN.test(url)) return 'own'
  return 'relative'
}

// Every image of the pasted code and JSON: <img src>, srcset, background=,
// url(), image keys of a JSON, and any address with an image extension.
// Addresses made of HuBL ({{ }}) are fields: managed in the Champs tab.
export function listImages(code: string, fields: string, origin = typeof location !== 'undefined' ? location.origin : ''): FoundImage[] {
  const found = new Map<string, FoundImage>()
  const add = (raw: string | null | undefined, where: 'code' | 'champs', alt: string | null = null) => {
    const token = (raw ?? '').trim()
    if (!token || /\{\{|\{%|^#|^about:|^javascript:/i.test(token) || token.length > 2000) return
    if (!/^data:image\//i.test(token) && !/\.(jpe?g|png|gif|webp|svg|avif|bmp|tiff?|heic)(\?|#|$)/i.test(token) && !/^(https?:)?\/\//i.test(token) && !OWN.test(token)) return
    const status = statusOf(token, origin)
    const seen = found.get(token)
    if (seen) {
      if (!seen.where.includes(where)) seen.where.push(where)
      if (alt !== null && seen.alt === null) seen.alt = alt
      return
    }
    if (found.size >= 60) return
    const thumb = status === 'relative' ? '' : status === 'data' ? token : fetchable(token)
    found.set(token, { token, status, thumb, alt, where: [where] })
  }
  for (const [text, where] of [
    [code, 'code'],
    [fields, 'champs'],
  ] as const) {
    if (!text.trim()) continue
    for (const m of text.matchAll(IMG_TAG)) {
      const tag = m[0]
      add(attrOf(tag, 'src'), where, attrOf(tag, 'alt') ?? '')
      for (const part of (attrOf(tag, 'srcset') ?? '').split(',')) add(part.trim().split(/\s+/)[0], where)
    }
    for (const m of text.matchAll(/\s(?:background|poster|data-src)\s*=\s*["']([^"']+)["']/gi)) add(m[1], where)
    for (const m of text.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) add(m[1], where)
    for (const m of text.matchAll(/"(?:src|image|img|url|background_image|backgroundImage|thumbnail|logo)"\s*:\s*"([^"]+)"/gi)) add(m[1].replace(/\\\//g, '/'), where)
    for (const t of findImageUrls(text, origin)) add(t, where)
  }
  return [...found.values()]
}

// The address swapped everywhere it is written (also as "&amp;" in HTML and
// "\/" in JSON).
export function replaceImage(text: string, token: string, next: string): string {
  if (!text || !token) return text
  const variants = new Set([token, token.replace(/&(?!amp;)/g, '&amp;'), token.replace(/&amp;/g, '&'), token.replace(/\//g, '\\/')])
  let out = text
  for (const v of variants) if (v && out.includes(v)) out = out.split(v).join(v.includes('\\/') ? next.replace(/\//g, '\\/') : next)
  return out
}

// The alt text of every <img> of the code showing this address.
export function setImageAlt(code: string, token: string, alt: string): string {
  const safe = alt.replace(/"/g, '&quot;').replace(/</g, '&lt;')
  return code.replace(IMG_TAG, (tag) => {
    const src = attrOf(tag, 'src')
    if (src === null || (src !== token && src.replace(/&amp;/g, '&') !== token.replace(/&amp;/g, '&'))) return tag
    const re = ATTR('alt')
    return re.test(tag) ? tag.replace(re, ` alt="${safe}"`) : tag.replace(/^<img\b/i, `<img alt="${safe}"`)
  })
}
