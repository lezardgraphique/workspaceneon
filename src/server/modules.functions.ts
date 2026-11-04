import { createServerFn } from '@tanstack/react-start'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import { modules } from '../../db/schema.js'
import { legacyOwner, requireUser } from '@/server/auth.server'
import { sanitizeTree } from '@/lib/sanitize-tree'
import { stripTags } from '@/lib/sanitize'
import type { ModuleRecord, ModuleTree } from '@/lib/types'

const toRecord = (row: typeof modules.$inferSelect): ModuleRecord => ({
  id: row.id,
  name: row.name,
  tree: row.tree as ModuleTree,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

// Anyone can call these endpoints, so the tree is never trusted: it is rebuilt
// block by block (known types, clamped values, sanitized HTML and URLs) before
// being stored, whatever the editor sends.
const treeSchema = z
  .object({
    width: z.number(),
    bg: z.string(),
    font: z.string(),
    sections: z.array(z.any()).max(200),
    // Optional parts of the tree: without them zod would drop them before sanitizeTree sees them.
    fields: z.array(z.any()).max(100).optional(),
    vml: z.boolean().optional(),
    pad: z.number().optional(),
  })
  .refine((t) => JSON.stringify(t).length < 500_000, 'Module trop volumineux')
  .transform((t) => sanitizeTree(t))

const nameSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .transform((n) => stripTags(n).trim() || 'Sans titre')

// Every query below is scoped to the signed-in account: an id belonging to
// someone else behaves exactly like an id that doesn't exist.
export const listModules = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser()
  await legacyOwner(user)
  const rows = await db.select().from(modules).where(eq(modules.userId, user.id)).orderBy(desc(modules.updatedAt))
  return rows.map(toRecord)
})

export const getModule = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await legacyOwner(user)
    const [row] = await db.select().from(modules).where(and(eq(modules.id, data.id), eq(modules.userId, user.id)))
    return row ? toRecord(row) : null
  })

export const createModule = createServerFn({ method: 'POST' })
  .validator(z.object({ name: nameSchema, tree: treeSchema }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    const [row] = await db.insert(modules).values({ userId: user.id, name: data.name, tree: data.tree }).returning()
    return toRecord(row)
  })

export const saveModule = createServerFn({ method: 'POST' })
  .validator(
    z.object({ id: z.uuid(), name: nameSchema, tree: treeSchema }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser()
    const [row] = await db
      .update(modules)
      .set({ name: data.name, tree: data.tree, updatedAt: new Date() })
      .where(and(eq(modules.id, data.id), eq(modules.userId, user.id)))
      .returning()
    return row ? toRecord(row) : null
  })

export const deleteModule = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await db.delete(modules).where(and(eq(modules.id, data.id), eq(modules.userId, user.id)))
    return { ok: true }
  })

// Offline sync: the browser keeps a local copy and pushes it back here. `base`
// is the server's updatedAt the local copy started from: if the row changed
// elsewhere since, nothing is overwritten and the local version becomes a copy.
export type SyncStatus = 'created' | 'updated' | 'conflict'

export const syncModule = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid(), name: nameSchema, tree: treeSchema, base: z.string().nullable() }))
  .handler(async ({ data }): Promise<{ status: SyncStatus; record: ModuleRecord; copy?: ModuleRecord }> => {
    const user = await requireUser()
    const [row] = await db.select().from(modules).where(and(eq(modules.id, data.id), eq(modules.userId, user.id)))
    if (!row) {
      const [made] = await db.insert(modules).values({ id: data.id, userId: user.id, name: data.name, tree: data.tree }).returning()
      return { status: 'created', record: toRecord(made) }
    }
    if (data.base && row.updatedAt.getTime() > new Date(data.base).getTime()) {
      const name = `${data.name.slice(0, 96)} (copie hors ligne)`
      const [copy] = await db.insert(modules).values({ userId: user.id, name, tree: data.tree }).returning()
      return { status: 'conflict', record: toRecord(row), copy: toRecord(copy) }
    }
    const [done] = await db
      .update(modules)
      .set({ name: data.name, tree: data.tree, updatedAt: new Date() })
      .where(and(eq(modules.id, data.id), eq(modules.userId, user.id)))
      .returning()
    return { status: 'updated', record: toRecord(done) }
  })
