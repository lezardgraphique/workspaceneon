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
import { lookup as lookupCb, type LookupAddress, type LookupAllOptions, type LookupOneOptions } from 'node:dns'
import { request as httpRequest, type IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
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
  const [a, b, c] = ip.split('.').map(Number)
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
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  )
}

// The 16 bytes of an IPv6 address (any spelling: ::, embedded IPv4, zone), or null.
function v6Bytes(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/%.*$/, '')
  const tail = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (tail) {
    if (isIP(tail[1]) !== 4) return null
    const [a, b, c, d] = tail[1].split('.').map(Number)
    s = s.slice(0, -tail[1].length) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const fill = halves.length === 2 ? 8 - head.length - rest.length : 0
  const groups = [...head, ...Array(Math.max(fill, 0)).fill('0'), ...rest]
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null
  return groups.flatMap((g) => {
    const n = parseInt(g, 16)
    return [n >> 8, n & 255]
  })
}

export function privateAddress(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return privateV4(ip)
  if (v !== 6) return true
  const b = v6Bytes(ip)
  if (!b) return true
  const v4 = (at: number) => b.slice(at, at + 4).join('.')
  const zero = (from: number, to: number) => b.slice(from, to).every((x) => x === 0)
  // IPv4 inside IPv6, whatever the spelling (::ffff:7f00:1 = 127.0.0.1): judged as IPv4.
  if (zero(0, 10) && b[10] === 0xff && b[11] === 0xff) return privateV4(v4(12)) // mapped ::ffff:0:0/96
  if (zero(0, 12)) return true // ::, ::1 and the old IPv4-compatible ::a.b.c.d
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true // NAT64 64:ff9b::/96 and /48
  if (b[0] === 0x20 && b[1] === 0x02) return privateV4(v4(2)) // 6to4 2002::/16
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true // Teredo 2001::/32
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true // documentation
  // Only global unicast (2000::/3) is public: excludes fc00::/7, fe80::/10, ff00::/8…
  return (b[0] & 0xe0) !== 0x20
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

async function readCapped(res: IncomingMessage): Promise<Uint8Array | null> {
  if (Number(res.headers['content-length'] ?? 0) > MAX_BYTES) return null
  const parts: Uint8Array[] = []
  let size = 0
  for await (const chunk of res as AsyncIterable<Buffer>) {
    size += chunk.byteLength
    if (size > MAX_BYTES) {
      res.destroy()
      return null
    }
    parts.push(chunk)
  }
  const out = new Uint8Array(size)
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.byteLength
  }
  return out
}

// Name resolution used for the connection itself: the addresses checked are the
// ones connected to, so a name that answers a public address to checkAddress and
// a private one a moment later (DNS rebinding) is refused.
type LookupCb = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void
function safeLookup(host: string, options: LookupOneOptions | LookupAllOptions, cb: LookupCb): void {
  lookupCb(host, { ...options, all: true }, (err, list: LookupAddress[]) => {
    if (err) return cb(err, '')
    const localTest = process.env.NODE_ENV === 'development' && process.env.NEON_IMPORT_LOCAL === '1'
    if (!list.length || (!localTest && list.some((x) => privateAddress(x.address)))) {
      const e: NodeJS.ErrnoException = new Error('réseau privé')
      e.code = 'EPRIVATE'
      return cb(e, '')
    }
    if ((options as LookupAllOptions).all) return cb(null, list)
    cb(null, list[0].address, list[0].family)
  })
}

function get(u: URL): Promise<IncomingMessage | null> {
  return new Promise((resolve) => {
    const send = u.protocol === 'https:' ? httpsRequest : httpRequest
    const req = send(
      u,
      {
        method: 'GET',
        lookup: safeLookup as never,
        timeout: TIMEOUT_MS,
        // Formats every e-mail client shows; some CDNs send WebP otherwise.
        headers: { Accept: 'image/png,image/jpeg,image/gif;q=0.9,*/*;q=0.1', 'User-Agent': 'NeonSandboxPro-ImageImport/1.0' },
      },
      (res) => resolve(res),
    )
    // Whole download limited too, not only the silences between packets.
    const timer = setTimeout(() => req.destroy(new Error('timeout')), TIMEOUT_MS)
    req.on('close', () => clearTimeout(timer))
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', () => resolve(null))
    req.end()
  })
}

async function download(raw: string): Promise<Uint8Array | string> {
  let address = raw
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const ok = await checkAddress(address)
    if (typeof ok === 'string') return ok
    const res = await get(ok)
    if (!res) return 'serveur injoignable'
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
      const next = res.headers.location
      res.resume()
      if (!next) return 'redirection invalide'
      address = new URL(next, ok).href
      continue
    }
    if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
      res.resume()
      return `introuvable (${res.statusCode})`
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

