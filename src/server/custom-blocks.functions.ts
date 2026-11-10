import { createServerFn } from '@tanstack/react-start'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import { customBlocks } from '../../db/schema.js'
import { legacyOwner, requireUser } from '@/server/auth.server'
import { storeCustomBlock, toBlock } from '@/server/custom-blocks.server'
import type { SaveStatus } from '@/server/custom-blocks.server'
import { stripTags } from '@/lib/sanitize'
import { section as cleanSection } from '@/lib/sanitize-tree'
import type { CustomBlock } from '@/lib/custom-blocks'
import type { Section } from '@/lib/types'

const sectionSchema = z
  .object({ type: z.literal('section'), cells: z.array(z.array(z.any())).min(1).max(3) })
  .passthrough()
  .refine((s) => JSON.stringify(s).length < 100_000, 'Bloc trop volumineux')
  // Rebuilt like a module: nothing unchecked is stored.
  .transform((s, ctx) => {
    const clean = cleanSection(s)
    if (!clean) ctx.addIssue({ code: 'custom', message: 'Bloc invalide' })
    return clean as Section
  })

export const listCustomBlocks = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser()
  await legacyOwner(user)
  const rows = await db.select().from(customBlocks).where(eq(customBlocks.userId, user.id)).orderBy(asc(customBlocks.name))
  return rows.map(toBlock)
})

export type { SaveStatus }

// Never creates a duplicate (see storeCustomBlock).
export const saveCustomBlock = createServerFn({ method: 'POST' })
  .validator(z.object({
      name: z.string().trim().min(1).max(80).transform((n) => stripTags(n).trim() || 'Bloc'),
      description: z.string().max(300).default('').transform((d) => stripTags(d)),
      section: sectionSchema,
    }))
  .handler(async ({ data }): Promise<{ status: SaveStatus; block: CustomBlock }> => {
    const user = await requireUser()
    return storeCustomBlock(user.id, data)
  })

export const deleteCustomBlock = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser()
    await db.delete(customBlocks).where(and(eq(customBlocks.id, data.id), eq(customBlocks.userId, user.id)))
    return { ok: true }
  })
