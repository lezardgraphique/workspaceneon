import { createFileRoute } from '@tanstack/react-router'

import { DEFAULT_STYLE, LANGS, cleanEnd, countdownGif } from '@/server/countdown-gif'
import type { CountdownStyle, Lang } from '@/server/countdown-gif'

// Public on purpose: the image is loaded by e-mail clients, whenever a message
// is opened. Everything comes from the query string and is validated; the
// image is computed from the clock, never stored, and identical requests within
// two seconds share one drawing.
//   /countdown.gif?to=<ms timestamp or ISO date>
//     &bg=f4f4fa|none &fg=ff007f &lb=3a3a52 &bd=d9d9e8|none &al=e5322d|none
//     &r=10 (rounded corners) &bw=2 (border) &s=6 (digit size 2-8) &g=12 (gap)
//     &u=dhms (units shown) &lab=1 &lang=fr|en|es|de|it &sep=0 &urg=24 (hours)
//     &end=C'est parti ! (message once over)
const HEX = /^[0-9a-f]{6}$/i
const cache = new Map<string, Uint8Array>()

function parseTarget(v: string | null): number | null {
  if (!v) return null
  const t = /^\d{10,13}$/.test(v) ? Number(v.length <= 10 ? Number(v) * 1000 : v) : Date.parse(v)
  // Between 2020 and 2100: anything else is a typo or an attempt to waste CPU.
  return Number.isFinite(t) && t > 1_577_836_800_000 && t < 4_102_444_800_000 ? t : null
}

const int = (v: string | null, d: number, min: number, max: number) => {
  const n = v !== null && /^-?\d{1,4}$/.test(v) ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d
}
const color = (v: string | null, d: string | null): string | null => (v === 'none' ? null : v && HEX.test(v) ? v.toLowerCase() : d)
const flag = (v: string | null, d: boolean) => (v === '1' ? true : v === '0' ? false : d)

function parseStyle(q: URLSearchParams): CountdownStyle {
  const D = DEFAULT_STYLE
  const units = (['d', 'h', 'm', 's'] as const).filter((u) => (q.get('u') ?? '').toLowerCase().includes(u))
  const lang = (q.get('lang') ?? '').toLowerCase().slice(0, 2) as Lang
  return {
    tile: color(q.get('bg'), D.tile),
    digits: color(q.get('fg'), D.digits) ?? D.digits,
    label: color(q.get('lb'), D.label) ?? D.label,
    border: color(q.get('bd'), D.border),
    alert: color(q.get('al'), D.alert),
    alertHours: int(q.get('urg'), D.alertHours, 0, 720),
    radius: int(q.get('r'), D.radius, 0, 40),
    borderWidth: int(q.get('bw'), D.borderWidth, 1, 6),
    scale: int(q.get('s'), D.scale, 2, 8),
    gap: int(q.get('g'), D.gap, 0, 40),
    units: units.length ? units : D.units,
    labels: flag(q.get('lab'), D.labels),
    lang: LANGS.includes(lang) ? lang : D.lang,
    separator: flag(q.get('sep'), D.separator),
    end: cleanEnd((q.get('end') ?? '').slice(0, 60)),
  }
}

export const Route = createFileRoute('/countdown.gif')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const q = new URL(request.url).searchParams
        const target = parseTarget(q.get('to'))
        if (target === null) return new Response('Date invalide', { status: 400 })
        const style = parseStyle(q)

        const now = Math.floor(Date.now() / 2000) * 2000
        const key = `${target}|${JSON.stringify(style)}|${now}`
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
