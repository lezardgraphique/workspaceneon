import { createServerFn } from '@tanstack/react-start'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import { modules } from '../../db/schema.js'
import type { ModuleRecord, ModuleTree } from '@/lib/types'

const toRecord = (row: typeof modules.$inferSelect): ModuleRecord => ({
  id: row.id,
  name: row.name,
  tree: row.tree as ModuleTree,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
})

// The tree is validated structurally on the client (it is produced by our own
// editor); here we only bound its shape and size.
const treeSchema = z
  .object({
    width: z.number(),
    bg: z.string(),
    font: z.string(),
    sections: z.array(z.any()),
  })
  .refine((t) => JSON.stringify(t).length < 500_000, 'Module trop volumineux')

export const listModules = createServerFn({ method: 'GET' }).handler(async () => {
  const rows = await db.select().from(modules).orderBy(desc(modules.updatedAt))
  return rows.map(toRecord)
})

export const getModule = createServerFn({ method: 'GET' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const [row] = await db.select().from(modules).where(eq(modules.id, data.id))
    return row ? toRecord(row) : null
  })

export const createModule = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().min(1).max(120), tree: treeSchema }))
  .handler(async ({ data }) => {
    const [row] = await db.insert(modules).values({ name: data.name, tree: data.tree }).returning()
    return toRecord(row)
  })

export const saveModule = createServerFn({ method: 'POST' })
  .validator(
    z.object({ id: z.uuid(), name: z.string().trim().min(1).max(120), tree: treeSchema }),
  )
  .handler(async ({ data }) => {
    const [row] = await db
      .update(modules)
      .set({ name: data.name, tree: data.tree, updatedAt: new Date() })
      .where(eq(modules.id, data.id))
      .returning()
    return row ? toRecord(row) : null
  })

export const deleteModule = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    await db.delete(modules).where(eq(modules.id, data.id))
    return { ok: true }
  })
