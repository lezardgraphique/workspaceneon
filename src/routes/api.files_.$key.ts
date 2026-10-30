import { createFileRoute } from '@tanstack/react-router'
import { getStore } from '@netlify/blobs'

import { FILE_TYPES, INLINE_TYPES, extOf } from '@/lib/files'
import { sessionUser, unauthorized } from '@/server/auth.server'
import { FILE_KEY as KEY, ownsFile, readUsage, writeUsage } from '@/server/file-owner'


export const Route = createFileRoute('/api/files_/$key')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const type = FILE_TYPES[extOf(params.key)]
        const hit = type && KEY.test(params.key) ? await getStore('files').getWithMetadata(params.key, { type: 'arrayBuffer' }) : null
        if (!hit) return new Response('Fichier introuvable', { status: 404 })
        const name = String((hit.metadata as { name?: string }).name ?? params.key)
        return new Response(hit.data, {
          headers: {
            'Content-Type': type,
            // Only images and PDFs open in the browser; the rest downloads.
            'Content-Disposition': `${INLINE_TYPES.has(type) ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(name)}`,
            // Keys are random and never rewritten.
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
            // `sandbox` blocks the browser's PDF viewer, so PDFs get a policy
            // that forbids everything else instead.
            'Content-Security-Policy': type === 'application/pdf' ? "default-src 'none'; style-src 'unsafe-inline'" : "default-src 'none'; sandbox",
            'Cross-Origin-Resource-Policy': 'cross-origin',
          },
        })
      },

      DELETE: async ({ params }) => {
        const user = await sessionUser()
        if (!user) return unauthorized()
        if (!KEY.test(params.key)) return Response.json({ error: 'Clé invalide' }, { status: 400 })
        // Someone else's file behaves like a missing one.
        if (!(await ownsFile(params.key, user))) return Response.json({ ok: true })
        const store = getStore('files')
        const m = await store.getMetadata(params.key).catch(() => null)
        if (!m) return Response.json({ ok: true })
        await store.delete(params.key)
        await writeUsage(user, (await readUsage(user)) - Number((m.metadata as { size?: number }).size ?? 0))
        return Response.json({ ok: true })
      },
    },
  },
})
