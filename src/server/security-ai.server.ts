// Daily security analysis: an AI (Gemini, through Netlify AI Gateway) reads
// the last 24 hours of the firewall journal and proposes blocks. What it may
// do is bounded here, not left to the model ("without mistakes"):
// - it can only name addresses, URL texts and software names that really
//   appear in the journal (nothing invented);
// - only an address that already made at least 2 unmistakable attacks can
//   be blocked at once ("evidente"), for 7 days at most;
// - everything else (URL texts, software, doubtful addresses) waits for the
//   admin's decision on the Security page;
// - nothing that would also match the site's own pages, files, browsers or
//   search engines is ever accepted;
// - nothing the admin refused or lifted is proposed again.
// Run by the scheduled function netlify/functions/securite-quotidienne.mts,
// or from the Security page. Relative imports only (bundled for both).
import { GoogleGenAI, Type } from '@google/genai'
import { and, desc, eq, gte, inArray, lt, sql } from 'drizzle-orm'

import { db } from '../../db/index.js'
import { securityBlocks, securityEvents, securityReports } from '../../db/schema.js'

const MODEL = 'gemini-3-flash-preview'
const DAY = 24 * 3600_000
const KEEP_DAYS = 30
const MAX_PROPOSALS = 20
const MAX_BLOCK_HOURS = 7 * 24

export interface Proposal {
  type: 'ip' | 'chemin' | 'agent'
  valeur: string
  raison: string
  certitude: 'evidente' | 'douteuse'
  duree_heures: number
}

// URLs and browsers the site must always serve: a URL text or a software name
// matching one of these is refused, whatever the AI says.
const OWN_URLS = [
  '/',
  '/?q=module',
  '/editor/0c1d2e3f-aaaa-bbbb-cccc-1234567890ab',
  '/apercu/0c1d2e3f-aaaa-bbbb-cccc-1234567890ab',
  '/compte',
  '/connexion',
  '/connexion#invite_token=abc',
  '/fichiers',
  '/api/maily',
  '/api/generate',
  '/api/widget',
  '/api/images/abc-123.png',
  '/api/files/abc-123.pdf',
  '/api/files?page=2',
  '/mcp/',
  '/_serverfn/abc?payload=%7B%7D',
  '/assets/index-abc123.js',
  '/assets/index-abc123.css',
  '/sw.js',
  '/manifest.webmanifest',
  '/asset-manifest.json',
  '/countdown.gif?date=2026-12-01',
  '/modele-local/gemma',
  '/favicon.ico',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/img/neon-hero.png',
  '/robots.txt',
  '/.well-known/security.txt',
]
const GOOD_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (iPad; CPU OS 15_8 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/13.1.1 Safari/605.1.15 (Applebot/0.1)',
  'DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)',
  'Netlify',
  'Claude-User',
  'Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0)',
  'HubSpot Connect 2.0 (http://dev.hubspot.com/)',
  'GoogleImageProxy',
  'node',
]

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/
const IPV6 = /^[0-9a-f:]{3,45}$/i
const isPrivate = (ip: string) => /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|fc|fd|fe80)/i.test(ip)

interface Seen {
  ips: Map<string, { attacks: number; total: number }>
  where: string[]
  agents: string[]
}

/** Keeps only what is safe to apply; says what becomes active and what waits. */
export function vetProposals(raw: unknown, seen: Seen, known: Set<string>): { active: Proposal[]; pending: Proposal[]; rejected: string[] } {
  const active: Proposal[] = []
  const pending: Proposal[] = []
  const rejected: string[] = []
  const list = Array.isArray(raw) ? raw.slice(0, MAX_PROPOSALS * 2) : []
  for (const r of list) {
    if (active.length + pending.length >= MAX_PROPOSALS) break
    if (!r || typeof r !== 'object') continue
    const p = r as Partial<Proposal>
    const type = p.type
    const value = typeof p.valeur === 'string' ? p.valeur.trim().toLowerCase().slice(0, 120) : ''
    const reason = typeof p.raison === 'string' ? p.raison.trim().slice(0, 300) : ''
    if ((type !== 'ip' && type !== 'chemin' && type !== 'agent') || !value || !reason) continue
    const key = `${type}:${value}`
    if (known.has(key)) {
      rejected.push(`${value} : déjà traité`)
      continue
    }
    const hours = Math.max(1, Math.min(MAX_BLOCK_HOURS, Math.round(Number(p.duree_heures) || 24)))
    const prop: Proposal = { type, valeur: value, raison: reason, certitude: p.certitude === 'evidente' ? 'evidente' : 'douteuse', duree_heures: hours }
    if (type === 'ip') {
      if (!(IPV4.test(value) || (IPV6.test(value) && value.includes(':'))) || isPrivate(value)) {
        rejected.push(`${value} : adresse invalide ou privée`)
        continue
      }
      const s = seen.ips.get(value)
      if (!s) {
        rejected.push(`${value} : absente du journal`)
        continue
      }
      // At once only for an address that really attacked (twice or more).
      if (prop.certitude === 'evidente' && s.attacks >= 2) active.push(prop)
      else pending.push(prop)
    } else if (type === 'chemin') {
      if (value.length < 4 || OWN_URLS.some((u) => u.toLowerCase().includes(value))) {
        rejected.push(`${value} : toucherait des pages du site`)
        continue
      }
      if (!seen.where.some((w) => w.includes(value))) {
        rejected.push(`${value} : absent du journal`)
        continue
      }
      pending.push(prop)
    } else {
      if (value.length < 4 || GOOD_AGENTS.some((a) => a.toLowerCase().includes(value))) {
        rejected.push(`${value} : toucherait des navigateurs ou des robots utiles`)
        continue
      }
      if (!seen.agents.some((a) => a.includes(value))) {
        rejected.push(`${value} : absent du journal`)
        continue
      }
      pending.push(prop)
    }
    known.add(key)
  }
  return { active, pending, rejected }
}

const PROMPT = `Tu es l'analyste sécurité expérimenté d'un site web (éditeur de modules e-mail, sans PHP ni WordPress). Voici le journal de son pare-feu sur les dernières 24 heures, déjà agrégé (JSON).
- "attaque" = requête bloquée car c'était sans ambiguïté une attaque (sonde .env, .php, injection…).
- "abus" = trop de requêtes en peu de temps (limité).
- "suspect" = page introuvable demandée (peut être un robot qui cherche des failles, ou un simple lien cassé).

Réponds en JSON :
- "resume" : 3 à 6 phrases en français simple pour le propriétaire (pas un expert) : ce qui s'est passé, si c'est grave, ce qui a été fait.
- "propositions" : blocages utiles, 0 à ${MAX_PROPOSALS}. Chacun : type ("ip" = une adresse, "chemin" = un texte présent dans l'adresse des pages visées, "agent" = un nom de logiciel dans le User-Agent), valeur (copiée telle qu'elle apparaît dans le journal), raison (une phrase), certitude ("evidente" seulement si c'est sans doute possible une attaque répétée, sinon "douteuse"), duree_heures (24 à 168).
Règles : sois prudent, ne propose rien pour un simple lien cassé ou une visite normale ; ne propose jamais un navigateur courant, un moteur de recherche, ni une page du site ; ne propose pas ce qui est déjà bloqué. Mieux vaut ne rien proposer que bloquer un vrai visiteur.`

async function aggregate(since: Date) {
  const rows = await db
    .select()
    .from(securityEvents)
    .where(gte(securityEvents.at, since))
    .orderBy(desc(securityEvents.at))
    .limit(5000)
  const ips = new Map<string, { attacks: number; total: number; rules: Set<string>; paths: Set<string>; agent: string }>()
  const bySeverity: Record<string, number> = {}
  const suspectPaths = new Map<string, number>()
  for (const e of rows) {
    bySeverity[e.severity] = (bySeverity[e.severity] ?? 0) + 1
    const s = ips.get(e.ip) ?? { attacks: 0, total: 0, rules: new Set(), paths: new Set(), agent: e.userAgent }
    s.total++
    if (e.severity === 'attaque') s.attacks++
    s.rules.add(e.rule)
    if (s.paths.size < 6) s.paths.add(e.path)
    ips.set(e.ip, s)
    if (e.severity === 'suspect') suspectPaths.set(e.path, (suspectPaths.get(e.path) ?? 0) + 1)
  }
  const top = [...ips.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 25)
  const seen: Seen = {
    ips: new Map([...ips.entries()].map(([ip, s]) => [ip.toLowerCase(), { attacks: s.attacks, total: s.total }])),
    where: rows.map((e) => e.path.toLowerCase()),
    agents: rows.map((e) => e.userAgent.toLowerCase()),
  }
  const forAi = {
    total: rows.length,
    parGravite: bySeverity,
    adresses: top.map(([ip, s]) => ({ ip, attaques: s.attacks, total: s.total, regles: [...s.rules].slice(0, 6), exemples: [...s.paths], logiciel: s.agent.slice(0, 120) })),
    pagesIntrouvables: [...suspectPaths.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([path, n]) => ({ path, n })),
  }
  return { rows: rows.length, seen, forAi, addresses: ips.size }
}

async function askAi(data: unknown, blocked: string[]): Promise<{ resume: string; propositions: unknown }> {
  const ai = new GoogleGenAI({})
  const res = await ai.models.generateContent({
    model: MODEL,
    contents: `${PROMPT}\n\nDéjà bloqué ou déjà décidé (ne pas reproposer) : ${JSON.stringify(blocked.slice(0, 200))}\n\nJournal :\n${JSON.stringify(data)}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          resume: { type: Type.STRING },
          propositions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                type: { type: Type.STRING, enum: ['ip', 'chemin', 'agent'] },
                valeur: { type: Type.STRING },
                raison: { type: Type.STRING },
                certitude: { type: Type.STRING, enum: ['evidente', 'douteuse'] },
                duree_heures: { type: Type.NUMBER },
              },
              required: ['type', 'valeur', 'raison', 'certitude', 'duree_heures'],
            },
          },
        },
        required: ['resume', 'propositions'],
      },
    },
  })
  const parsed = JSON.parse(res.text ?? '{}') as { resume?: unknown; propositions?: unknown }
  return { resume: typeof parsed.resume === 'string' ? parsed.resume.slice(0, 2000) : '', propositions: parsed.propositions }
}

export interface ReportStats {
  events: number
  addresses: number
  attacks: number
  activated: number
  pending: number
  rejected: string[]
  trigger: string
  error?: string
}

/** One analysis: housekeeping, AI reading, vetted blocks, saved report. */
export async function runDailyAnalysis(trigger: 'planifiée' | 'manuelle', ask: typeof askAi = askAi) {
  const now = new Date()
  // Housekeeping: old journal lines go, finished blocks are marked as such.
  await db.delete(securityEvents).where(lt(securityEvents.at, new Date(now.getTime() - KEEP_DAYS * DAY)))
  await db
    .update(securityBlocks)
    .set({ status: 'expire', decidedAt: now })
    .where(and(eq(securityBlocks.status, 'actif'), lt(securityBlocks.expiresAt, now)))

  const agg = await aggregate(new Date(now.getTime() - DAY))
  const decided = await db
    .select({ kind: securityBlocks.kind, value: securityBlocks.value })
    .from(securityBlocks)
    .where(inArray(securityBlocks.status, ['actif', 'en_attente', 'refuse', 'leve']))
  const known = new Set(decided.map((d) => `${d.kind}:${d.value.toLowerCase()}`))
  const attacks = [...agg.seen.ips.values()].reduce((n, s) => n + s.attacks, 0)
  const stats: ReportStats = { events: agg.rows, addresses: agg.addresses, attacks, activated: 0, pending: 0, rejected: [], trigger }

  let summary: string
  if (!agg.rows) {
    summary = "Rien à signaler sur les dernières 24 heures : aucune attaque, aucun abus, aucune requête suspecte n'a été vue par le pare-feu."
  } else {
    try {
      const out = await ask(agg.forAi, [...known])
      const vetted = vetProposals(out.propositions, agg.seen, known)
      for (const p of vetted.active)
        await db.insert(securityBlocks).values({ kind: p.type, value: p.valeur, reason: p.raison, source: 'ia', status: 'actif', expiresAt: new Date(now.getTime() + p.duree_heures * 3600_000) })
      for (const p of vetted.pending) await db.insert(securityBlocks).values({ kind: p.type, value: p.valeur, reason: p.raison, source: 'ia', status: 'en_attente' })
      stats.activated = vetted.active.length
      stats.pending = vetted.pending.length
      stats.rejected = vetted.rejected.slice(0, 20)
      summary = out.resume || `${agg.rows} événements analysés.`
    } catch (e) {
      // The AI is unreachable: the firewall keeps working, the report says so.
      stats.error = e instanceof Error ? e.message.slice(0, 200) : 'erreur inconnue'
      summary = `L'analyse IA n'a pas pu se faire cette fois (service IA momentanément indisponible) : elle reprendra à la prochaine analyse. Le pare-feu, lui, a continué de bloquer : ${attacks} attaque${attacks > 1 ? 's' : ''} refusée${attacks > 1 ? 's' : ''} sur ${agg.rows} événements.`
    }
  }
  const [report] = await db.insert(securityReports).values({ summary, stats }).returning()
  // Keep the last 60 reports.
  await db.execute(sql`delete from security_reports where id not in (select id from security_reports order by at desc limit 60)`)
  return report
}
