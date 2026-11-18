// Images of a module copied from another tool (HubSpot, Mailchimp, a web page…)
// are brought into Neon Sandbox Pro: downloaded by the server, checked, kept in
// Netlify Blobs (store `images`, like uploaded images) and served from
// /api/images/<key>, so the module no longer depends on the other tool's links.
//
// Security: the server fetches addresses chosen by the user, so it must never
// be turned against private networks (SSRF):
// - http(s) only, ports 80/443 only, no user:password@ in the address;
// - the host name is resolved and every address must be public (no loopback,
//   private, link-local, carrier-grade NAT, multicast, metadata 169.254.x…);
// - redirects are followed by hand (3 at most), each one checked the same way;
// - 5 MB at most per image, 10 s per image, 40 images per request;
// - only real JPEG, PNG and GIF are kept (checked on the first bytes, not on
//   what the remote server claims), never SVG or HTML.
// Keys: imp-<owner tag>_<SHA-256 of the content>.<ext>: the same image imported
// twice by the same account is stored once.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { getStore } from '@netlify/blobs'

import { ownerTag } from '@/server/file-owner'

export const MAX_IMAGES = 40
const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 3

export interface ImportedImage {
  url?: string
  error?: string
}

function privateV4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number)
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  )
}

export function privateAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return privateV4(ip)
  if (v !== 6) return true
  const low = ip.toLowerCase()
  // IPv4 written as IPv6 (::ffff:10.0.0.1)
  const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
  if (mapped) return privateV4(mapped[1])
  return low === '::' || low === '::1' || /^f[cd]/.test(low) || /^fe[89ab]/.test(low) || low.startsWith('ff') || low.startsWith('64:ff9b') || low.startsWith('2001:db8')
}

// The address as a URL the server may fetch, or a French reason why not.
export async function checkAddress(raw: string): Promise<URL | string> {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return 'adresse invalide'
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'adresse non web'
  if (u.username || u.password) return 'adresse avec identifiants'
  const localTest = process.env.NODE_ENV === 'development' && process.env.NEON_IMPORT_LOCAL === '1'
  if (u.port && u.port !== '80' && u.port !== '443' && !localTest) return 'port non autorisé'
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const local = !host.includes('.') && !isIP(host) || /(^|\.)(localhost|local|internal|lan|home|corp)$/i.test(host)
  if (local && !localTest) return 'serveur local'
  const ips = isIP(host) ? [host] : await lookup(host, { all: true }).then((r) => r.map((x) => x.address)).catch(() => [])
  if (!ips.length) return 'serveur introuvable'
  // Local tests only (NODE_ENV=development and NEON_IMPORT_LOCAL=1): a picture server on this machine.
  if (!localTest && ips.some(privateAddress)) return 'réseau privé'
  return u
}

function kindOf(b: Uint8Array): 'jpg' | 'png' | 'gif' | 'webp' | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  const head = String.fromCharCode(...b.slice(0, 12))
  if (head.startsWith('GIF87a') || head.startsWith('GIF89a')) return 'gif'
  if (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP') return 'webp'
  return null
}

async function readCapped(res: Response): Promise<Uint8Array | null> {
  if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) return null
  const reader = res.body?.getReader()
  if (!reader) return new Uint8Array(0)
  const parts: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => {})
      return null
    }
    parts.push(value)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

async function download(raw: string): Promise<Uint8Array | string> {
  let address = raw
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ok = await checkAddress(address)
    if (typeof ok === 'string') return ok
    const res = await fetch(ok, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Formats every e-mail client shows; some CDNs send WebP otherwise.
      headers: { Accept: 'image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1', 'User-Agent': 'NeonSandboxPro-ImageImport/1.0' },
    }).catch(() => null)
    if (!res) return 'serveur injoignable'
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location')
      await res.body?.cancel().catch(() => {})
      if (!next) return 'redirection invalide'
      address = new URL(next, ok).href
      continue
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      return `introuvable (${res.status})`
    }
    const bytes = await readCapped(res).catch(() => null)
    return bytes ?? 'image trop lourde (5 Mo maximum)'
  }
  return 'trop de redirections'
}

const TYPES = { jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif' } as const

async function importOne(raw: string, tag: string, origin: string): Promise<ImportedImage> {
  const got = await download(raw)
  if (typeof got === 'string') return { error: got }
  const kind = kindOf(got)
  if (!kind) return { error: "ce n'est pas une image" }
  if (kind === 'webp') return { error: 'format WebP, mal affiché par les messageries' }
  const buf = got.buffer.slice(got.byteOffset, got.byteOffset + got.byteLength) as ArrayBuffer
  const digest = await crypto.subtle.digest('SHA-256', buf)
  const hash = [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  const key = `imp-${tag}_${hash}.${kind}`
  const store = getStore('images')
  if (!(await store.getMetadata(key).catch(() => null))) await store.set(key, buf, { metadata: { from: raw.slice(0, 500), type: TYPES[kind] } })
  return { url: `${origin}/api/images/${key}` }
}

// Every address → its new address in the tool, or why it was left as it was.
export async function importImages(urls: string[], userId: string, origin: string): Promise<Record<string, ImportedImage>> {
  const tag = await ownerTag(userId)
  const list = [...new Set(urls)].slice(0, MAX_IMAGES)
  const out: Record<string, ImportedImage> = {}
  // 4 at a time: quick, without hammering the other site.
  for (let i = 0; i < list.length; i += 4) {
    const batch = list.slice(i, i + 4)
    const done = await Promise.all(batch.map((u) => importOne(u, tag, origin).catch(() => ({ error: 'échec du téléchargement' }))))
    batch.forEach((u, k) => (out[u] = done[k]))
  }
  return out
}

