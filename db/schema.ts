import { jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

// One row per email module. `tree` holds the full section/block structure
// (see src/lib/types.ts — ModuleTree); HuBL is always regenerated from it.
export const modules = pgTable('modules', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  tree: jsonb().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Reusable sections offered in Structure > Ajouter and created by Maily.
// `slug` (normalised name) and `signature` (structure without ids) are unique,
// so the same block can't be saved twice.
export const customBlocks = pgTable(
  'custom_blocks',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    slug: text().notNull(),
    description: text().notNull().default(''),
    signature: text().notNull(),
    section: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('custom_blocks_slug_unique').on(t.slug), unique('custom_blocks_signature_unique').on(t.signature)],
)
