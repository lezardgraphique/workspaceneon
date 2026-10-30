// Best-effort rate limiting, kept in memory per server instance. It slows down
// scripted abuse (AI quota drain, upload floods) without any external service;
// a determined attacker spreading over many instances needs a platform-level
// limit (Netlify rate limiting rules) on top.

interface Bucket {
  count: number
  reset: number
}

const buckets = new Map<string, Bucket>()

export interface Rule {
  // Name of the limit, shared by every route that uses it.
  name: string
  max: number
  windowMs: number
}

export function clientIp(request: Request): string {
  const h = request.headers
  return h.get('x-nf-client-connection-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

// Returns the seconds to wait when the limit is exceeded, otherwise 0.
export function hit(request: Request, rule: Rule): number {
  const now = Date.now()
  if (buckets.size > 5000) for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k)
  const key = `${rule.name}:${clientIp(request)}`
  let b = buckets.get(key)
  if (!b || b.reset <= now) {
    b = { count: 0, reset: now + rule.windowMs }
    buckets.set(key, b)
  }
  b.count++
  return b.count > rule.max ? Math.ceil((b.reset - now) / 1000) : 0
}

const MIN = 60_000

// Matched against the path of write requests (and the costly AI routes).
export const RULES: Array<{ test: (path: string, method: string) => boolean; rule: Rule }> = [
  { test: (p) => p === '/api/maily' || p === '/api/generate', rule: { name: 'ai', max: 20, windowMs: MIN } },
  { test: (p, m) => (p === '/api/images' || p === '/api/files') && m === 'POST', rule: { name: 'upload', max: 30, windowMs: MIN } },
  { test: (p, m) => p.startsWith('/api/files/') && m === 'DELETE', rule: { name: 'delete', max: 60, windowMs: MIN } },
  { test: (_p, m) => m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS', rule: { name: 'write', max: 240, windowMs: MIN } },
]
