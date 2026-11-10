// Personal access tokens of the MCP server. A token is `nsp_` + 32 random
// bytes (base64url): unguessable, shown once, stored only as its SHA-256.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'

import { db } from '../../db/index.js'
import { apiTokens } from '../../db/schema.js'

export const TOKEN_PREFIX = 'nsp_'
export const MAX_TOKENS = 10
const TOKEN_RE = /^nsp_[A-Za-z0-9_-]{43}$/

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export function newToken(): { token: string; hash: string; prefix: string } {
  const token = TOKEN_PREFIX + randomBytes(32).toString('base64url')
  return { token, hash: hashToken(token), prefix: token.slice(0, 10) }
}

export interface TokenOwner {
  userId: string
  tokenId: string
}

// Last use is written at most once per minute per token (no write per call).
const touched = new Map<string, number>()

/** Account behind a token, or null (unknown, revoked, malformed). */
export async function tokenOwner(token: string): Promise<TokenOwner | null> {
  if (!TOKEN_RE.test(token)) return null
  const hash = hashToken(token)
  const [row] = await db
    .select({ id: apiTokens.id, userId: apiTokens.userId, tokenHash: apiTokens.tokenHash })
    .from(apiTokens)
    .where(and(eq(apiTokens.tokenHash, hash), isNull(apiTokens.revokedAt)))
  // The lookup is by hash; compare again in constant time all the same.
  if (!row || !timingSafeEqual(Buffer.from(row.tokenHash), Buffer.from(hash))) return null
  const now = Date.now()
  if ((touched.get(row.id) ?? 0) < now - 60_000) {
    touched.set(row.id, now)
    await db.update(apiTokens).set({ lastUsedAt: new Date(now) }).where(eq(apiTokens.id, row.id)).catch(() => {})
  }
  return { userId: row.userId, tokenId: row.id }
}
