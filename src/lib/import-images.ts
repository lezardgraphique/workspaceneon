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
