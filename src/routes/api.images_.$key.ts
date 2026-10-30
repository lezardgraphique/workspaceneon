import { createFileRoute } from '@tanstack/react-router'
import { getStore } from '@netlify/blobs'

import { IMAGE_TYPES } from '@/lib/images'

export const Route = createFileRoute('/api/images_/$key')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const type = IMAGE_TYPES[params.key.split('.').pop() ?? '']
        const data = type && /^[\w-]+\.\w+$/.test(params.key) ? await getStore('images').get(params.key, { type: 'arrayBuffer' }) : null
        if (!data) return new Response('Image introuvable', { status: 404 })
        // Keys are random and never rewritten, so the image can be cached forever.
        return new Response(data, {
          headers: {
            'Content-Type': type,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
            'Cross-Origin-Resource-Policy': 'cross-origin',
          },
        })
      },
    },
  },
})
