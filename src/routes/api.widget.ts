import { createFileRoute } from '@tanstack/react-router'
import { desc, eq, sql } from 'drizzle-orm'

import { db } from '../../db/index.js'
import { modules } from '../../db/schema.js'
import { legacyOwner, sessionUser } from '@/server/auth.server'

// Data of the home-screen widget (Windows 11 widgets board, see the manifest and
// public/sw.js): the last modules of the signed-in account. Read by the service
// worker with the session cookie; signed out, the widget offers to sign in.
export const Route = createFileRoute('/api/widget')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin
        const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' }
        const user = await sessionUser()
        if (!user) return new Response(JSON.stringify({ signedIn: false, count: 0, modules: [], newUrl: `${origin}/?action=nouveau`, homeUrl: `${origin}/connexion` }), { headers })
        await legacyOwner(user)
        const rows = await db
          .select({ id: modules.id, name: modules.name, updatedAt: modules.updatedAt })
          .from(modules)
          .where(eq(modules.userId, user.id))
          .orderBy(desc(modules.updatedAt))
          .limit(4)
        const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(modules).where(eq(modules.userId, user.id))
        const when = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', timeZone: 'Europe/Paris' })
        return new Response(
          JSON.stringify({
            signedIn: true,
            count: n,
            countLabel: n === 0 ? 'Aucun module' : n === 1 ? '1 module' : `${n} modules`,
            modules: rows.map((r) => ({ name: r.name, url: `${origin}/editor/${r.id}`, updated: `Modifié le ${when(r.updatedAt)}` })),
            newUrl: `${origin}/?action=nouveau`,
            homeUrl: `${origin}/`,
          }),
          { headers },
        )
      },
    },
  },
})
