import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

// One row per email module. `tree` holds the full section/block structure
// (see src/lib/types.ts — ModuleTree); HuBL is always regenerated from it.
export const modules = pgTable('modules', {
  id: uuid().primaryKey().defaultRandom(),
  name: text().notNull(),
  tree: jsonb().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
