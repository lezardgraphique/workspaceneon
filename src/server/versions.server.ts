// Server-side safety net for modules (see moduleVersions in db/schema.ts):
// whatever the browser sends, the previous state is copied before it is
// overwritten (at most every 10 minutes of editing), before a restore and at
// deletion. Never blocks a save: a failure here only skips the copy.
import { and, desc, eq, lt, notInArray } from 'drizzle-orm'

import { db } from '../../db/index.js'
import { moduleVersions, type modules } from '../../db/schema.js'

// (NEON_VERSION_EVERY_MS shortens it for local tests only; never set on the site.)
export const EVERY_MS = Number(process.env.NEON_VERSION_EVERY_MS) || 10 * 60_000
export const KEEP_PER_MODULE = 30
export const KEEP_DAYS = 30

export type VersionReason = 'auto' | 'avant-restauration' | 'suppression' | 'ia'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Copies `row` (the state about to be replaced) when it is worth it. */
export async function snapshot(
  row: typeof modules.$inferSelect,
  reason: VersionReason,
  next?: { name: string; tree: unknown },
): Promise<void> {
  if (!row.userId) return
  if (next && next.name === row.name && same(next.tree, row.tree)) return
  try {
    const [last] = await db
      .select({ createdAt: moduleVersions.createdAt, name: moduleVersions.name, tree: moduleVersions.tree })
      .from(moduleVersions)
      .where(and(eq(moduleVersions.userId, row.userId), eq(moduleVersions.moduleId, row.id)))
      .orderBy(desc(moduleVersions.createdAt))
      .limit(1)
    if (last && last.name === row.name && same(last.tree, row.tree)) return
    if (reason === 'auto' && last && Date.now() - last.createdAt.getTime() < EVERY_MS) return
    await db.insert(moduleVersions).values({ moduleId: row.id, userId: row.userId, name: row.name, tree: row.tree, reason })
    await prune(row.userId, row.id)
  } catch {
    // The save itself goes on.
  }
}

async function prune(userId: string, moduleId: string): Promise<void> {
  const keep = await db
    .select({ id: moduleVersions.id })
    .from(moduleVersions)
    .where(and(eq(moduleVersions.userId, userId), eq(moduleVersions.moduleId, moduleId)))
    .orderBy(desc(moduleVersions.createdAt))
    .limit(KEEP_PER_MODULE)
  if (keep.length >= KEEP_PER_MODULE)
    await db.delete(moduleVersions).where(
      and(
        eq(moduleVersions.userId, userId),
        eq(moduleVersions.moduleId, moduleId),
        notInArray(
          moduleVersions.id,
          keep.map((k) => k.id),
        ),
      ),
    )
  await db.delete(moduleVersions).where(and(eq(moduleVersions.userId, userId), lt(moduleVersions.createdAt, new Date(Date.now() - KEEP_DAYS * 86_400_000))))
}

