// Saving a reusable block for an account, shared by the editor (server
// function) and the MCP server. Never creates a duplicate: a block with the
// same structure is reused whatever its name, and a block with the same name
// is updated instead of doubled.
import { and, eq, or } from 'drizzle-orm'

import { db } from '../../db/index.js'
import { customBlocks } from '../../db/schema.js'
import { signature, slugify } from '@/lib/custom-blocks'
import type { CustomBlock } from '@/lib/custom-blocks'
import type { Section } from '@/lib/types'

export type SaveStatus = 'created' | 'updated' | 'exists'

export const toBlock = (row: typeof customBlocks.$inferSelect): CustomBlock => ({
  id: row.id,
  name: row.name,
  description: row.description,
  section: row.section as Section,
  createdAt: row.createdAt.toISOString(),
})

/** `section` must already be sanitized (sanitize-tree `section`). */
export async function storeCustomBlock(
  userId: string,
  data: { name: string; description: string; section: Section },
): Promise<{ status: SaveStatus; block: CustomBlock }> {
  const section = data.section
  const slug = slugify(data.name) || 'bloc'
  const sig = signature(section)
  const find = async () => {
    const rows = await db.select().from(customBlocks).where(and(eq(customBlocks.userId, userId), or(eq(customBlocks.signature, sig), eq(customBlocks.slug, slug))))
    return { sameContent: rows.find((r) => r.signature === sig), sameName: rows.find((r) => r.slug === slug) }
  }

  const { sameContent, sameName } = await find()
  if (sameContent) return { status: 'exists', block: toBlock(sameContent) }
  if (sameName) {
    const [row] = await db
      .update(customBlocks)
      .set({ section, signature: sig, description: data.description || sameName.description })
      .where(and(eq(customBlocks.id, sameName.id), eq(customBlocks.userId, userId)))
      .returning()
    return { status: 'updated', block: toBlock(row) }
  }
  try {
    const [row] = await db.insert(customBlocks).values({ userId, name: data.name, slug, description: data.description, signature: sig, section }).returning()
    return { status: 'created', block: toBlock(row) }
  } catch {
    // Lost a race with a concurrent save of the same block.
    const again = await find()
    const row = again.sameContent ?? again.sameName
    if (!row) throw new Error('Enregistrement du bloc impossible')
    return { status: 'exists', block: toBlock(row) }
  }
}
