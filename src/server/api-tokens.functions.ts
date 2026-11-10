// « Connexion IA (MCP) » of the account page: create, list and revoke the
// personal tokens. Every query is scoped to the signed-in account.
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import { apiTokens } from '../../db/schema.js'
import { MAX_TOKENS, newToken } from '@/server/api-tokens.server'
import { requireUser } from '@/server/auth.server'
import { stripTags } from '@/lib/sanitize'

export interface TokenInfo {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt: string | null
}

export const listTokens = createServerFn({ method: 'GET' }).handler(async (): Promise<TokenInfo[]> => {
  const user = await requireUser()
  const rows = await db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, user.id), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt))
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }))
})

/** The token itself is returned here only: it can't be read again later. */
export const createToken = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().min(1).max(60).transform((n) => stripTags(n).trim() || 'Connexion IA') }))
  .handler(async ({ data }): Promise<{ token: string; info: TokenInfo }> => {
    const user = await requireUser()
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(apiTokens)
      .where(and(eq(apiTokens.userId, user.id), isNull(apiTokens.revokedAt)))
    if (n >= MAX_TOKENS) throw new Error(`${MAX_TOKENS} connexions au plus : révoque celles qui ne servent plus.`)
    const t = newToken()
    const [row] = await db.insert(apiTokens).values({ userId: user.id, name: data.name, tokenHash: t.hash, prefix: t.prefix }).returning()
    return { token: t.token, info: { id: row.id, name: row.name, prefix: row.prefix, createdAt: row.createdAt.toISOString(), lastUsedAt: null } }
  })

export const revokeToken = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await db
      .update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.id, data.id), eq(apiTokens.userId, user.id), isNull(apiTokens.revokedAt)))
    return { ok: true }
  })
