import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core'

// One row per email module. `tree` holds the full section/block structure
// (see src/lib/types.ts — ModuleTree); HuBL is always regenerated from it.
// `user_id` is the Netlify Identity id of the owner: every query is scoped to
// it, so accounts never see each other's work. Rows created before accounts
// existed have no owner until the legacy claim (see legacyClaim).
export const modules = pgTable(
  'modules',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text('user_id'),
    name: text().notNull(),
    tree: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('modules_user_idx').on(t.userId, t.updatedAt)],
)

// Single row: the account that received the data created before accounts existed.
export const legacyClaim = pgTable('legacy_claim', {
  id: integer().primaryKey().default(1),
  userId: text('user_id').notNull(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
})

// Reusable sections offered in Structure > Ajouter and created by Maily.
// `slug` (normalised name) and `signature` (structure without ids) are unique
// per account, so the same block can't be saved twice by the same person.
export const customBlocks = pgTable(
  'custom_blocks',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text('user_id'),
    name: text().notNull(),
    slug: text().notNull(),
    description: text().notNull().default(''),
    signature: text().notNull(),
    section: jsonb().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('custom_blocks_user_slug_unique').on(t.userId, t.slug), unique('custom_blocks_user_signature_unique').on(t.userId, t.signature)],
)
