import { createFileRoute } from '@tanstack/react-router'

import { sessionUser, unauthorized } from '@/server/auth.server'
import { MAX_IMAGES, importImages } from '@/server/import-images.server'

// POST {urls: string[]} → {images: {[url]: {url} | {error}}}: brings the
// images of an imported module into the tool (see import-images.server.ts).
export const Route = createFileRoute('/api/import-images')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await sessionUser()
        if (!user) return unauthorized()
        const body = (await request.json().catch(() => null)) as { urls?: unknown } | null
        const urls = Array.isArray(body?.urls) ? body.urls.filter((u): u is string => typeof u === 'string' && u.length <= 2048) : []
        if (!urls.length || urls.length > MAX_IMAGES) return Response.json({ error: `Entre 1 et ${MAX_IMAGES} images à la fois` }, { status: 400 })
        const images = await importImages(urls, user.id, new URL(request.url).origin)
        return Response.json({ images })
      },
    },
  },
})
