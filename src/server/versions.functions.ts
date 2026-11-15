// Versions of a module and modules deleted in the last 30 days (see
// versions.server.ts). Read-only apart from bringing a deleted module back:
// a version is applied by the editor like any change (undoable, autosaved).
import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import { moduleVersions, modules } from '../../db/schema.js'
import { requireUser } from '@/server/auth.server'
import { sanitizeTree } from '@/lib/sanitize-tree'
import { snapshot } from '@/server/versions.server'
import type { ModuleRecord, ModuleTree } from '@/lib/types'

export interface VersionInfo {
  id: string
  name: string
  reason: string
  createdAt: string
  sections: number
}

export const listVersions = createServerFn({ method: 'GET' })
  .validator(z.object({ moduleId: z.uuid() }))
  .handler(async ({ data }): Promise<VersionInfo[]> => {
    const user = await requireUser()
    const rows = await db
      .select()
      .from(moduleVersions)
      .where(and(eq(moduleVersions.userId, user.id), eq(moduleVersions.moduleId, data.moduleId)))
      .orderBy(desc(moduleVersions.createdAt))
      .limit(30)
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      reason: r.reason,
      createdAt: r.createdAt.toISOString(),
      sections: Array.isArray((r.tree as ModuleTree | null)?.sections) ? (r.tree as ModuleTree).sections.length : 0,
    }))
  })

/** A version's content, to apply in the editor. The module as it is now is copied first. */
export const versionForRestore = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }): Promise<{ name: string; tree: ModuleTree }> => {
    const user = await requireUser()
    const [v] = await db.select().from(moduleVersions).where(and(eq(moduleVersions.id, data.id), eq(moduleVersions.userId, user.id)))
    if (!v) throw new Error('Version introuvable.')
    const [current] = await db.select().from(modules).where(and(eq(modules.id, v.moduleId), eq(modules.userId, user.id)))
    if (current) await snapshot(current, 'avant-restauration')
    return { name: v.name, tree: sanitizeTree(v.tree as ModuleTree) }
  })

export interface DeletedInfo {
  moduleId: string
  name: string
  deletedAt: string
}

/** Modules deleted in the last 30 days (their last copy). */
export const listDeleted = createServerFn({ method: 'GET' }).handler(async (): Promise<DeletedInfo[]> => {
  const user = await requireUser()
  const [gone, alive] = await Promise.all([
    db
      .select({ moduleId: moduleVersions.moduleId, name: moduleVersions.name, createdAt: moduleVersions.createdAt })
      .from(moduleVersions)
      .where(and(eq(moduleVersions.userId, user.id), eq(moduleVersions.reason, 'suppression')))
      .orderBy(desc(moduleVersions.createdAt))
      .limit(200),
    db.select({ id: modules.id }).from(modules).where(eq(modules.userId, user.id)),
  ])
  const exists = new Set(alive.map((m) => m.id))
  const seen = new Set<string>()
  const out: DeletedInfo[] = []
  for (const g of gone) {
    if (exists.has(g.moduleId) || seen.has(g.moduleId)) continue
    seen.add(g.moduleId)
    out.push({ moduleId: g.moduleId, name: g.name, deletedAt: g.createdAt.toISOString() })
  }
  return out.slice(0, 50)
})

/** Brings a deleted module back, with the same address, as it was when deleted. */
export const restoreDeleted = createServerFn({ method: 'POST' })
  .validator(z.object({ moduleId: z.uuid() }))
  .handler(async ({ data }): Promise<ModuleRecord> => {
    const user = await requireUser()
    const [already] = await db.select({ id: modules.id }).from(modules).where(eq(modules.id, data.moduleId))
    if (already) throw new Error('Ce module existe déjà.')
    const [v] = await db
      .select()
      .from(moduleVersions)
      .where(and(eq(moduleVersions.userId, user.id), eq(moduleVersions.moduleId, data.moduleId)))
      .orderBy(desc(moduleVersions.createdAt))
      .limit(1)
    if (!v) throw new Error('Module introuvable dans les versions.')
    const [row] = await db
      .insert(modules)
      .values({ id: v.moduleId, userId: user.id, name: v.name, tree: sanitizeTree(v.tree as ModuleTree) })
      .returning()
    return { id: row.id, name: row.name, tree: row.tree as ModuleTree, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }
  })
