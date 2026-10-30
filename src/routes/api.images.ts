import { createFileRoute } from '@tanstack/react-router'
import { getStore } from '@netlify/blobs'

import { sessionUser, unauthorized } from '@/server/auth.server'
import { IMAGE_TYPES } from '@/lib/images'
import { matchesType, readHead } from '@/server/upload-check'

const MAX_BYTES = 5 * 1024 * 1024

// Uploaded images live in Netlify Blobs and are served by /api/images/<key>.
// The returned URL is absolute so the image keeps working once the module is
// pasted into an email tool or a web page.
export const Route = createFileRoute('/api/images')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await sessionUser())) return unauthorized()
        if (Number(request.headers.get('content-length') ?? 0) > MAX_BYTES + 64 * 1024) {
          return Response.json({ error: 'Image trop lourde (5 Mo maximum)' }, { status: 413 })
        }
        const form = await request.formData().catch(() => null)
        const file = form?.get('file')
        if (!(file instanceof File)) return Response.json({ error: 'Aucun fichier reçu' }, { status: 400 })
        const ext = Object.entries(IMAGE_TYPES).find(([, type]) => type === file.type)?.[0]
        if (!ext) return Response.json({ error: 'Format non pris en charge (JPG, PNG ou GIF)' }, { status: 415 })
        if (file.size > MAX_BYTES) return Response.json({ error: 'Image trop lourde (5 Mo maximum)' }, { status: 413 })

        if (!matchesType(await readHead(file), file.type)) return Response.json({ error: 'Le contenu ne correspond pas à une image valide' }, { status: 415 })

        const key = `${crypto.randomUUID()}.${ext}`
        await getStore('images').set(key, await file.arrayBuffer())
        return Response.json({ url: `${new URL(request.url).origin}/api/images/${key}` })
      },
    },
  },
})
