import { createFileRoute } from '@tanstack/react-router'

import { countdownGif } from '@/server/countdown-gif'

// Public on purpose: the image is loaded by e-mail clients, whenever a message
// is opened. Everything comes from the query string and is validated; the
// image is computed from the clock, never stored, and identical requests within
// two seconds share one drawing.
//   /countdown.gif?to=<ms timestamp or ISO date>&bg=f4f4fa&fg=ff007f&lb=3a3a52
const HEX = /^[0-9a-f]{6}$/i
const cache = new Map<string, Uint8Array>()

function parseTarget(v: string | null): number | null {
  if (!v) return null
  const t = /^\d{10,13}$/.test(v) ? Number(v.length <= 10 ? Number(v) * 1000 : v) : Date.parse(v)
  // Between 2020 and 2100: anything else is a typo or an attempt to waste CPU.
  return Number.isFinite(t) && t > 1_577_836_800_000 && t < 4_102_444_800_000 ? t : null
}

export const Route = createFileRoute('/countdown.gif')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = new URL(request.url).searchParams
        const target = parseTarget(q.get('to'))
        if (target === null) return new Response('Date invalide', { status: 400 })
        const pick = (k: string, d: string) => (HEX.test(q.get(k) ?? '') ? q.get(k)!.toLowerCase() : d)
        const style = { tile: pick('bg', 'f4f4fa'), digits: pick('fg', 'ff007f'), label: pick('lb', '3a3a52') }

        const now = Math.floor(Date.now() / 2000) * 2000
        const key = `${target}|${style.tile}|${style.digits}|${style.label}|${now}`
        let bytes = cache.get(key)
        if (!bytes) {
          bytes = countdownGif(target, now, style)
          if (cache.size > 40) cache.delete(cache.keys().next().value!)
          cache.set(key, bytes)
        }
        return new Response(bytes as BodyInit, {
          headers: {
            'Content-Type': 'image/gif',
            // The picture depends on the moment it is opened.
            'Cache-Control': 'no-store, max-age=0',
            'X-Content-Type-Options': 'nosniff',
            'Cross-Origin-Resource-Policy': 'cross-origin',
          },
        })
      },
    },
  },
})
