// « Sécurité du site » on the account page: for the site's admin only
// (SECURITY_ADMIN_EMAIL). Journal, blocks, decisions on what the AI proposed,
// and an analysis on demand. Every call checks the admin again.
import { createServerFn } from '@tanstack/react-start'
import { getRequest } from '@tanstack/react-start/server'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import { securityBlocks, securityEvents, securityReports } from '../../db/schema.js'
import { requireUser } from '@/server/auth.server'
import { isSecurityAdmin, reloadBlocks } from '@/server/firewall.server'
import { clientIp } from '@/server/rate-limit'
import { stripTags } from '@/lib/sanitize'

async function requireAdmin() {
  const user = await requireUser()
  if (!isSecurityAdmin(user.email)) throw new Error('Réservé à l\'administrateur du site.')
  return user
}

export interface BlockInfo {
  id: string
  kind: string
  value: string
  reason: string
  source: string
  status: string
  createdAt: string
  expiresAt: string | null
  hits: number
}
export interface EventInfo {
  at: string
  ip: string
  method: string
  path: string
  rule: string
  severity: string
  userAgent: string
}
export interface SecurityOverview {
  admin: boolean
  configured: boolean
  myIp: string
  counts: Record<string, number>
  pending: BlockInfo[]
  active: BlockInfo[]
  history: BlockInfo[]
  events: EventInfo[]
  report: { at: string; summary: string; rejected: string[]; activated: number; pending: number } | null
}

const block = (r: typeof securityBlocks.$inferSelect): BlockInfo => ({
  id: r.id,
  kind: r.kind,
  value: r.value,
  reason: r.reason,
  source: r.source,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  expiresAt: r.expiresAt?.toISOString() ?? null,
  hits: r.hits,
})

export const securityOverview = createServerFn({ method: 'GET' }).handler(async (): Promise<SecurityOverview> => {
  const user = await requireUser()
  const configured = !!(process.env.SECURITY_ADMIN_EMAIL || process.env.LEGACY_OWNER_EMAIL)
  const empty: SecurityOverview = { admin: false, configured, myIp: '', counts: {}, pending: [], active: [], history: [], events: [], report: null }
  if (!isSecurityAdmin(user.email)) return empty
  const since = new Date(Date.now() - 24 * 3600_000)
  const [counts, blocks, events, [report]] = await Promise.all([
    db
      .select({ severity: securityEvents.severity, n: sql<number>`count(*)::int` })
      .from(securityEvents)
      .where(gte(securityEvents.at, since))
      .groupBy(securityEvents.severity),
    db.select().from(securityBlocks).orderBy(desc(securityBlocks.createdAt)).limit(300),
    db.select().from(securityEvents).orderBy(desc(securityEvents.at)).limit(60),
    db.select().from(securityReports).orderBy(desc(securityReports.at)).limit(1),
  ])
  const now = Date.now()
  const live = (b: typeof securityBlocks.$inferSelect) => b.status === 'actif' && (!b.expiresAt || b.expiresAt.getTime() > now)
  return {
    admin: true,
    configured,
    myIp: clientIp(getRequest()),
    counts: Object.fromEntries(counts.map((c) => [c.severity, c.n])),
    pending: blocks.filter((b) => b.status === 'en_attente').map(block),
    active: blocks.filter(live).map(block),
    history: blocks.filter((b) => b.status !== 'en_attente' && !live(b)).slice(0, 20).map(block),
    events: events.map((e) => ({ at: e.at.toISOString(), ip: e.ip, method: e.method, path: e.path, rule: e.rule, severity: e.severity, userAgent: e.userAgent })),
    report: report
      ? (() => {
          const st = (report.stats ?? {}) as { rejected?: unknown; activated?: unknown; pending?: unknown }
          return {
            at: report.at.toISOString(),
            summary: report.summary,
            rejected: Array.isArray(st.rejected) ? st.rejected.filter((x): x is string => typeof x === 'string') : [],
            activated: Number(st.activated) || 0,
            pending: Number(st.pending) || 0,
          }
        })()
      : null,
  }
})

/** activer (a proposal, for `hours`), refuser (a proposal), lever (an active block). */
export const decideBlock = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().uuid(), action: z.enum(['activer', 'refuser', 'lever']), hours: z.number().int().min(1).max(24 * 90).optional() }))
  .handler(async ({ data }) => {
    await requireAdmin()
    const [row] = await db.select().from(securityBlocks).where(eq(securityBlocks.id, data.id))
    if (!row) throw new Error('Blocage introuvable.')
    if (data.action === 'activer' && row.kind === 'ip' && row.value === clientIp(getRequest())) throw new Error('C\'est ta propre adresse : elle ne peut pas être bloquée.')
    const now = new Date()
    const set =
      data.action === 'activer'
        ? { status: 'actif', decidedAt: now, expiresAt: new Date(now.getTime() + (data.hours ?? 24 * 7) * 3600_000) }
        : data.action === 'refuser'
          ? { status: 'refuse', decidedAt: now }
          : { status: 'leve', decidedAt: now }
    await db.update(securityBlocks).set(set).where(eq(securityBlocks.id, data.id))
    reloadBlocks()
    return { ok: true }
  })

/** Block an address seen in the journal (7 days, never the admin's own). */
export const blockAddress = createServerFn({ method: 'POST' })
  .validator(z.object({ ip: z.string().trim().min(3).max(45), reason: z.string().trim().max(200).optional() }))
  .handler(async ({ data }) => {
    await requireAdmin()
    if (data.ip === clientIp(getRequest())) throw new Error('C\'est ta propre adresse : elle ne peut pas être bloquée.')
    const [seen] = await db.select({ ip: securityEvents.ip }).from(securityEvents).where(eq(securityEvents.ip, data.ip)).limit(1)
    if (!seen) throw new Error('Adresse absente du journal.')
    const [already] = await db
      .select({ id: securityBlocks.id })
      .from(securityBlocks)
      .where(and(eq(securityBlocks.kind, 'ip'), eq(securityBlocks.value, data.ip), inArray(securityBlocks.status, ['actif', 'en_attente'])))
    if (already) await db.update(securityBlocks).set({ status: 'actif', decidedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 24 * 3600_000) }).where(eq(securityBlocks.id, already.id))
    else
      await db.insert(securityBlocks).values({
        kind: 'ip',
        value: data.ip,
        reason: stripTags(data.reason || 'Bloquée depuis le journal'),
        source: 'admin',
        status: 'actif',
        expiresAt: new Date(Date.now() + 7 * 24 * 3600_000),
      })
    reloadBlocks()
    return { ok: true }
  })

/** The AI analysis, now (at most once every 10 minutes). */
export const analyseNow = createServerFn({ method: 'POST' }).handler(async () => {
  await requireAdmin()
  const [last] = await db.select({ at: securityReports.at }).from(securityReports).orderBy(desc(securityReports.at)).limit(1)
  if (last && Date.now() - last.at.getTime() < 10 * 60_000) throw new Error('Une analyse vient d\'être faite : réessaie dans quelques minutes.')
  const { runDailyAnalysis } = await import('@/server/security-ai.server')
  await runDailyAnalysis('manuelle')
  reloadBlocks()
  return { ok: true }
})
