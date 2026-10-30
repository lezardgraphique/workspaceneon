import { getUser } from '@netlify/identity'
import { eq, isNull } from 'drizzle-orm'

import { db } from '../../db/index.js'
import { customBlocks, legacyClaim, modules } from '../../db/schema.js'

// Who is calling. Accounts live in Netlify Identity (passwords, confirmation
// e-mails and recovery are handled there); the session is its `nf_jwt` cookie,
// checked here on every call, never trusted from the client.

export interface SessionUser {
  id: string
  email: string
}

export async function sessionUser(): Promise<SessionUser | null> {
  // Local development has no Identity: NEON_DEV_USER=<id> fakes one. Ignored in production.
  if (process.env.NODE_ENV !== 'production' && process.env.NEON_DEV_USER) {
    return { id: process.env.NEON_DEV_USER, email: 'dev@localhost' }
  }
  try {
    const u = await getUser()
    return u ? { id: u.id, email: u.email ?? '' } : null
  } catch {
    return null
  }
}

export const LOGIN_REQUIRED = 'Connexion requise : reconnecte-toi.'

// For server functions: throws, which the client sees as a failed call.
export async function requireUser(): Promise<SessionUser> {
  const user = await sessionUser()
  if (!user) throw new Error(LOGIN_REQUIRED)
  return user
}

// For API routes.
export const unauthorized = () => Response.json({ error: LOGIN_REQUIRED }, { status: 401, headers: { 'Cache-Control': 'no-store' } })

// ---------------------------------------------------------------------------
// Data created before accounts existed
// ---------------------------------------------------------------------------

// Modules, blocks and files from the single-user era have no owner. They go to
// one account, once: LEGACY_OWNER_EMAIL when set, otherwise the first account
// that opens the app. Atomic: the claim row can only be inserted once.
let owner: string | null | undefined

export async function legacyOwner(user?: SessionUser): Promise<string | null> {
  if (owner) return owner
  const [row] = await db.select().from(legacyClaim).where(eq(legacyClaim.id, 1))
  if (row) return (owner = row.userId)
  if (!user) return null
  const expected = process.env.LEGACY_OWNER_EMAIL?.trim().toLowerCase()
  if (expected && user.email.toLowerCase() !== expected) return null
  const [won] = await db.insert(legacyClaim).values({ id: 1, userId: user.id }).onConflictDoNothing().returning()
  if (!won) return legacyOwner()
  await db.update(modules).set({ userId: user.id }).where(isNull(modules.userId))
  await db.update(customBlocks).set({ userId: user.id }).where(isNull(customBlocks.userId))
  return (owner = user.id)
}
