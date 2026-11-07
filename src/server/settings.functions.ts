import { createServerFn } from '@tanstack/react-start'
import { eq, sql } from 'drizzle-orm'
import { z } from 'zod'

import { db } from '../../db/index.js'
import { userSettings } from '../../db/schema.js'
import { requireUser } from '@/server/auth.server'
import { SYNC_KEY_RE } from '@/lib/settings-keys'
import type { Prefs } from '@/lib/settings-keys'

// Account preferences shared by every device (see settings-sync.ts).
// Always scoped by the caller's id; entries merge per key, latest change wins.

const MAX_KEYS = 400

const entry = z.object({ v: z.string().max(4000).nullable(), t: z.number().int().nonnegative() })
const prefsSchema = z
  .record(z.string().max(120).regex(SYNC_KEY_RE), entry)
  .refine((p) => Object.keys(p).length <= MAX_KEYS, 'Trop de préférences')

async function read(userId: string): Promise<Prefs> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId))
  return (row?.prefs as Prefs | undefined) ?? {}
}

export const getSettings = createServerFn({ method: 'GET' }).handler(async () => {
  const user = await requireUser()
  return read(user.id)
})

export const pushSettings = createServerFn({ method: 'POST' })
  .validator(z.object({ prefs: prefsSchema }))
  .handler(async ({ data }): Promise<Prefs> => {
    const user = await requireUser()
    // Clocks a little ahead are tolerated, not the far future.
    const limit = Date.now() + 60_000
    const incoming: Prefs = {}
    for (const [k, e] of Object.entries(data.prefs)) incoming[k] = { v: e.v, t: Math.min(e.t, limit) }
    // One atomic upsert: per key, the entry with the latest time wins, so two
    // devices pushing at once never drop each other's changes.
    const rows = await db.execute<{ prefs: Prefs }>(sql`
      INSERT INTO user_settings (user_id, prefs) VALUES (${user.id}, ${JSON.stringify(incoming)}::jsonb)
      ON CONFLICT (user_id) DO UPDATE SET
        prefs = (
          SELECT coalesce(jsonb_object_agg(key, CASE
            WHEN n.value IS NULL THEN o.value
            WHEN o.value IS NULL THEN n.value
            WHEN (n.value->>'t')::bigint > (o.value->>'t')::bigint THEN n.value
            ELSE o.value END), '{}'::jsonb)
          FROM jsonb_each(user_settings.prefs) o FULL JOIN jsonb_each(EXCLUDED.prefs) n USING (key)
        ),
        updated_at = now()
      RETURNING prefs`)
    const list = (Array.isArray(rows) ? rows : (rows as { rows: { prefs: Prefs }[] }).rows) as { prefs: Prefs }[]
    let merged: Prefs = list[0]?.prefs ?? incoming
    // Too many keys on the account: keep the newest (old folded sections go first).
    const keys = Object.keys(merged)
    if (keys.length > MAX_KEYS) {
      keys.sort((a, b) => merged[b].t - merged[a].t)
      merged = Object.fromEntries(keys.slice(0, MAX_KEYS).map((k) => [k, merged[k]]))
      await db.update(userSettings).set({ prefs: merged }).where(eq(userSettings.userId, user.id))
    }
    return merged
  })
