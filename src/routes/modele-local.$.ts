import { createFileRoute } from '@tanstack/react-router'
import { getStore } from '@netlify/blobs'

import { sessionUser, unauthorized } from '@/server/auth.server'

// The offline Maily model is gone (Maily answers offline without one): this
// route only frees the copy an earlier version kept on the account
// (store `offline-models`, keys u/<user id>/…). DELETE /modele-local/tout.
export const Route = createFileRoute('/modele-local/$')({
  server: {
    handlers: {
      DELETE: async () => {
        const user = await sessionUser()
        if (!user) return unauthorized()
        const store = getStore({ name: 'offline-models', consistency: 'strong' })
        let removed = 0
        for await (const page of store.list({ prefix: `u/${user.id}/`, paginate: true })) {
          for (const b of page.blobs) {
            await store.delete(b.key).catch(() => {})
            removed++
          }
        }
        return Response.json({ removed })
      },
      GET: () => new Response('Introuvable', { status: 404 }),
    },
  },
})
