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

// Preferences that follow the account from one device to another (Maily
// hors ligne switched on, sector of the estimate, folded sections…). One row
// per account; `prefs` maps a key to `{ v, t }` (value or null = removed, time
// of the change in ms) so every device can merge, the latest change winning.
export const userSettings = pgTable('user_settings', {
  userId: text('user_id').primaryKey(),
  prefs: jsonb().notNull().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Personal access tokens for the MCP server (/mcp): an AI client (Claude…)
// acts on the account's modules and blocks with one. Only the SHA-256 of the
// token is stored (shown once at creation); `prefix` helps recognise it in the
// list. A revoked token stays listed (revokedAt) and never works again.
export const apiTokens = pgTable(
  'api_tokens',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: text('user_id').notNull(),
    name: text().notNull(),
    tokenHash: text('token_hash').notNull(),
    prefix: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [unique('api_tokens_hash_unique').on(t.tokenHash), index('api_tokens_user_idx').on(t.userId)],
)

// ---------------------------------------------------------------------------
// Site security (src/server/firewall.server.ts, src/server/security-ai.server.ts)
// ---------------------------------------------------------------------------

// What the firewall saw: blocked attacks, limited floods, suspicious requests.
// Kept 30 days (purged by the daily analysis). The IP is needed to block.
export const securityEvents = pgTable(
  'security_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    at: timestamp({ withTimezone: true }).notNull().defaultNow(),
    ip: text().notNull(),
    method: text().notNull(),
    path: text().notNull(),
    // Signature or limit that matched (e.g. "sonde .env", "trop de requêtes").
    rule: text().notNull(),
    // attaque = blocked on sight; abus = rate limited; suspect = only noted.
    severity: text().notNull(),
    userAgent: text('user_agent').notNull().default(''),
  },
  (t) => [index('security_events_at_idx').on(t.at), index('security_events_ip_idx').on(t.ip, t.at)],
)

// Blocks and rules. kind: ip (an address), chemin (a text in the URL), agent
// (a text in the User-Agent). status: actif, en_attente (waits for the admin),
// refuse, leve (lifted). source: auto (firewall), ia (daily analysis), admin.
export const securityBlocks = pgTable(
  'security_blocks',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().notNull(),
    value: text().notNull(),
    reason: text().notNull(),
    source: text().notNull(),
    status: text().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    hits: integer().notNull().default(0),
  },
  (t) => [index('security_blocks_status_idx').on(t.status)],
)

// The daily analyses (summary shown on the Security page).
export const securityReports = pgTable('security_reports', {
  id: uuid().primaryKey().defaultRandom(),
  at: timestamp({ withTimezone: true }).notNull().defaultNow(),
  summary: text().notNull(),
  // { events, ips, proposals, applied, error? }
  stats: jsonb().notNull().default({}),
})
