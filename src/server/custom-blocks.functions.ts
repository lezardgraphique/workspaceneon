import { createServerFn } from '@tanstack/react-start'
import { asc, eq, or } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import { customBlocks } from '../../db/schema.js'
import { signature, slugify } from '@/lib/custom-blocks'
import type { CustomBlock } from '@/lib/custom-blocks'
import type { Section } from '@/lib/types'

const toBlock = (row: typeof customBlocks.$inferSelect): CustomBlock => ({
  id: row.id,
  name: row.name,
  description: row.description,
  section: row.section as Section,
  createdAt: row.createdAt.toISOString(),
})

const sectionSchema = z
  .object({ type: z.literal('section'), cells: z.array(z.array(z.any())).min(1).max(3) })
  .passthrough()
  .refine((s) => JSON.stringify(s).length < 100_000, 'Bloc trop volumineux')

export const listCustomBlocks = createServerFn({ method: 'GET' }).handler(async () => {
  const rows = await db.select().from(customBlocks).orderBy(asc(customBlocks.name))
  return rows.map(toBlock)
})

export type SaveStatus = 'created' | 'updated' | 'exists'

// Never creates a duplicate: a block with the same structure is reused whatever
// its name, and a block with the same name is updated instead of doubled.
export const saveCustomBlock = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().trim().min(1).max(80), description: z.string().max(300).default(''), section: sectionSchema }))
  .handler(async ({ data }): Promise<{ status: SaveStatus; block: CustomBlock }> => {
    const section = data.section as unknown as Section
    const slug = slugify(data.name) || 'bloc'
    const sig = signature(section)
    const find = async () => {
      const rows = await db.select().from(customBlocks).where(or(eq(customBlocks.signature, sig), eq(customBlocks.slug, slug)))
      return { sameContent: rows.find((r) => r.signature === sig), sameName: rows.find((r) => r.slug === slug) }
    }

    const { sameContent, sameName } = await find()
    if (sameContent) return { status: 'exists', block: toBlock(sameContent) }
    if (sameName) {
      const [row] = await db
        .update(customBlocks)
        .set({ section, signature: sig, description: data.description || sameName.description })
        .where(eq(customBlocks.id, sameName.id))
        .returning()
      return { status: 'updated', block: toBlock(row) }
    }
    try {
      const [row] = await db.insert(customBlocks).values({ name: data.name, slug, description: data.description, signature: sig, section }).returning()
      return { status: 'created', block: toBlock(row) }
    } catch {
      // Lost a race with a concurrent save of the same block.
      const again = await find()
      const row = again.sameContent ?? again.sameName
      if (!row) throw new Error('Enregistrement du bloc impossible')
      return { status: 'exists', block: toBlock(row) }
    }
  })

export const deleteCustomBlock = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    await db.delete(customBlocks).where(eq(customBlocks.id, data.id))
    return { ok: true }
  })
