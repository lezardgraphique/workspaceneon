// Firewall of the site, run before every page, API and server-function call
// (src/start.ts). It blocks on sight what can only be an attack against this
// site (it has no PHP, no WordPress, no hidden files to read), keeps a journal
// for the daily AI analysis (security-ai.server.ts) and applies the blocks
// decided by itself, the AI or the admin (security_blocks).
//
// "Without mistakes" rules:
// - Only unambiguous signatures block on sight; a single hit never bans an
//   address: 3 attacks in 10 minutes do, for 24 hours only.
// - A signed-in account is never stopped by an address block (an office or
//   a phone network shares one address between many people).
// - Server-function payloads and request bodies are never inspected (they
//   legitimately carry HTML and code); only the URL and the User-Agent are.
// - Any failure of the journal (database down) lets the request through: the
//   signatures still block, the site never goes down because of its guard.
import { and, eq, gte, sql } from 'drizzle-orm'

import { db } from '../../db/index.js'
import { securityBlocks, securityEvents } from '../../db/schema.js'
import { clientIp } from './rate-limit'

export type Severity = 'attaque' | 'abus' | 'suspect'

// --- Signatures --------------------------------------------------------------

const PATH_SIGNS: [RegExp, string][] = [
  [/(^|\/)\.env(\.[\w-]+)?(\/|$)/i, 'sonde de fichier .env'],
  [/(^|\/)\.git(\/|$)/i, 'sonde du dépôt .git'],
  [/(^|\/)\.(aws|ssh|docker|htaccess|htpasswd|ds_store|svn|hg|vscode|idea)(\/|$)/i, 'sonde de fichier caché'],
  [/\.(php\d?|phtml|asp|aspx|ashx|jsp|jspa|cgi|pl|bak|sql|old|swp|ini|log|cfg|conf)$/i, 'sonde de script ou de fichier serveur'],
  [
    /(^|\/)(wp-admin|wp-login|wp-content|wp-includes|wp-json|xmlrpc|phpmyadmin|pma|myadmin|cgi-bin|vendor\/phpunit|solr|actuator|server-status|boaform|hnap1|owa|ecp|autodiscover|telescope|_ignition|jenkins|manager\/html|console|admin\.php|setup\.cgi)(\/|\.|$)/i,
    "sonde d'application connue",
  ],
  [/(\.\.\/|\.\.\\|%2e%2e(%2f|%5c|\/|\\)|\.\.%2f|\.\.%5c|%252e%252e)/i, 'traversée de répertoires'],
  [/\/etc\/(passwd|shadow|hosts)|\/proc\/self|c:\\windows|boot\.ini|win\.ini/i, 'lecture de fichier système'],
]

const QUERY_SIGNS: [RegExp, string][] = [
  [
    /\bunion\b[\s\S]{0,40}\bselect\b|\binformation_schema\b|\b(sleep|benchmark|pg_sleep|waitfor\s+delay)\s*\(|'\s*(or|and)\s+'?\d+'?\s*=\s*'?\d+|\bor\s+1\s*=\s*1\b|;\s*drop\s+table\b/i,
    'injection SQL',
  ],
  [/<\s*script\b|javascript\s*:|\bon(error|load|mouseover|focus)\s*=|<\s*(iframe|svg|img)\b[^>]*\bon\w+\s*=/i, 'injection de script (XSS)'],
  [/\$\{\s*(jndi|env|sys|lower|upper|date)\s*:/i, 'attaque Log4Shell'],
  [/[;&|`]\s*(wget|curl|nc|ncat|bash|sh|chmod|rm\s+-rf)\b|\$\(\s*(wget|curl|id|whoami|uname)\b/i, 'injection de commande'],
  [/\b(file|gopher|dict|expect|php):\/\//i, 'inclusion de fichier / SSRF'],
]

const SCANNERS =
  /\b(sqlmap|nikto|nmap|masscan|zgrab|acunetix|wpscan|nuclei|dirbuster|gobuster|ffuf|feroxbuster|wfuzz|hydra|netsparker|appscan|openvas|w3af|havij|commix|jaeles|fimap|whatweb|zmeu|morfeus)\b/i

const BAD_METHODS = new Set(['TRACE', 'TRACK', 'CONNECT', 'DEBUG'])

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '))
  } catch {
    return s
  }
}

/** The attack this request carries, if it is unmistakable (else null). */
export function attackIn(request: Request): string | null {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()
  if (BAD_METHODS.has(method)) return `méthode ${method} interdite`
  const ua = request.headers.get('user-agent') ?? ''
  if (SCANNERS.test(ua)) return `outil d'attaque (${(SCANNERS.exec(ua)?.[1] ?? '').toLowerCase()})`
  // The raw path (encoded tricks) and its decoded form.
  const raw = url.pathname
  const path = safeDecode(raw)
  if (!/^\/\.well-known\//.test(path)) for (const [re, name] of PATH_SIGNS) if (re.test(raw) || re.test(path)) return name
  // Server functions carry their payload in the URL; it is legitimately code.
  if (raw.startsWith('/_serverFn')) return null
  const query = url.search ? safeDecode(url.search.slice(1)) : ''
  if (query) for (const [re, name] of QUERY_SIGNS) if (re.test(query)) return name
  return null
}

// --- Blocks (from the database, kept a minute in memory) ---------------------

interface ActiveBlock {
  id: string
  kind: string
  value: string
  expiresAt: number | null
}

let blocks: ActiveBlock[] = []
let loadedAt = 0
const RELOAD_MS = 60_000

async function activeBlocks(): Promise<ActiveBlock[]> {
  if (Date.now() - loadedAt < RELOAD_MS) return blocks
  loadedAt = Date.now()
  try {
    const rows = await db
      .select({ id: securityBlocks.id, kind: securityBlocks.kind, value: securityBlocks.value, expiresAt: securityBlocks.expiresAt })
      .from(securityBlocks)
      .where(eq(securityBlocks.status, 'actif'))
    blocks = rows.map((r) => ({ ...r, value: r.value.toLowerCase(), expiresAt: r.expiresAt ? r.expiresAt.getTime() : null }))
  } catch {
    // Journal unavailable: keep the last known blocks.
  }
  return blocks
}

/** Called after the admin or the AI changes a block, so it applies at once here. */
export const reloadBlocks = () => {
  loadedAt = 0
}

function matchingBlock(list: ActiveBlock[], ip: string, request: Request): ActiveBlock | null {
  const now = Date.now()
  const url = new URL(request.url)
  const where = (url.pathname + url.search).toLowerCase()
  const ua = (request.headers.get('user-agent') ?? '').toLowerCase()
  for (const b of list) {
    if (b.expiresAt && b.expiresAt <= now) continue
    if (b.kind === 'ip' && b.value === ip.toLowerCase()) return b
    if (b.kind === 'chemin' && b.value && where.includes(b.value)) return b
    if (b.kind === 'agent' && b.value && ua.includes(b.value)) return b
  }
  return null
}

// --- Journal -----------------------------------------------------------------

// At most one "abus"/"suspect" line per address and rule per minute (a flood
// must not flood the journal too); attacks are always written.
const recent = new Map<string, number>()

export async function logEvent(request: Request, rule: string, severity: Severity): Promise<void> {
  const ip = clientIp(request)
  const url = new URL(request.url)
  if (severity !== 'attaque') {
    const key = `${ip}|${rule}`
    const now = Date.now()
    if ((recent.get(key) ?? 0) > now) return
    if (recent.size > 5000) for (const [k, t] of recent) if (t <= now) recent.delete(k)
    recent.set(key, now + 60_000)
  }
  try {
    await db.insert(securityEvents).values({
      ip,
      method: request.method.toUpperCase().slice(0, 10),
      path: (url.pathname + url.search).slice(0, 300),
      rule: rule.slice(0, 120),
      severity,
      userAgent: (request.headers.get('user-agent') ?? '').slice(0, 200),
    })
  } catch {
    // Journal unavailable: the request is still handled.
  }
}

const isPrivate = (ip: string) =>
  ip === 'unknown' || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc|fd|fe80)/i.test(ip)

// 3 attacks in 10 minutes from one address: blocked 24 hours (source auto).
const AUTO = { attacks: 3, windowMs: 10 * 60_000, blockMs: 24 * 3600_000 }

async function autoBlock(ip: string, rule: string): Promise<void> {
  if (isPrivate(ip)) return
  try {
    const since = new Date(Date.now() - AUTO.windowMs)
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(securityEvents)
      .where(and(eq(securityEvents.ip, ip), eq(securityEvents.severity, 'attaque'), gte(securityEvents.at, since)))
    if (n < AUTO.attacks) return
    const [already] = await db
      .select({ id: securityBlocks.id })
      .from(securityBlocks)
      .where(and(eq(securityBlocks.kind, 'ip'), eq(securityBlocks.value, ip), eq(securityBlocks.status, 'actif')))
    if (already) return
    await db.insert(securityBlocks).values({
      kind: 'ip',
      value: ip,
      reason: `${n} attaques en 10 minutes (dernière : ${rule})`,
      source: 'auto',
      status: 'actif',
      expiresAt: new Date(Date.now() + AUTO.blockMs),
    })
    reloadBlocks()
  } catch {
    // Journal unavailable: the attack itself was still refused.
  }
}

// --- The guard ---------------------------------------------------------------

const refusal = (why: string) =>
  new Response(
    JSON.stringify({
      error: 'Accès refusé : cette requête a été bloquée par la protection du site.',
      raison: why,
    }),
    { status: 403, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } },
  )

/**
 * Checks a request. Returns a 403 response to send instead of the page, or
 * null to let it through. `signedIn` is only asked when an address block
 * matches (it reads the session cookie).
 */
export async function guard(request: Request, signedIn: () => Promise<boolean>): Promise<Response | null> {
  const attack = attackIn(request)
  const ip = clientIp(request)
  if (attack) {
    await logEvent(request, attack, 'attaque')
    await autoBlock(ip, attack)
    return refusal(attack)
  }
  const hit = matchingBlock(await activeBlocks(), ip, request)
  if (!hit) return null
  // An address shared by a signed-in person (office, phone network) is never shut out.
  if (hit.kind === 'ip' && (await signedIn().catch(() => false))) return null
  try {
    await db
      .update(securityBlocks)
      .set({ hits: sql`${securityBlocks.hits} + 1` })
      .where(eq(securityBlocks.id, hit.id))
  } catch {
    // Counter only.
  }
  return refusal(hit.kind === 'ip' ? 'adresse bloquée' : hit.kind === 'agent' ? 'logiciel bloqué' : 'adresse de page bloquée')
}

/** Admin of the site: the account whose e-mail is SECURITY_ADMIN_EMAIL (or LEGACY_OWNER_EMAIL). */
export function isSecurityAdmin(email: string | undefined | null): boolean {
  const admin = (process.env.SECURITY_ADMIN_EMAIL || process.env.LEGACY_OWNER_EMAIL || '').trim().toLowerCase()
  return !!admin && !!email && email.trim().toLowerCase() === admin
}
