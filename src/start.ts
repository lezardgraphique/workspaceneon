import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'

import { RULES, hit } from '@/server/rate-limit'

// Everything here runs on every request, before routes and server functions.

// Content-Security-Policy. The app renders untrusted HTML only through the
// sanitizer, but the policy is the second wall: nothing from another origin
// can run, and the page can't be framed or post elsewhere.
// Inline scripts are needed by the SSR bootstrap; the email preview is a
// script-less sandboxed iframe that inherits this policy (hence the open
// img/style/font sources: emails load remote images and web fonts).
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' about: data: blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ')

const HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

// Uploaded files are public by design (URLs are pasted in emails): they must
// stay loadable from other sites, so only that header differs.
const PUBLIC = /^\/api\/(images|files)\/[^/]+$/

const securityHeaders = createMiddleware({ type: 'request' }).server(async ({ request, next }) => {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()

  for (const { test, rule } of RULES) {
    if (!test(url.pathname, method)) continue
    const wait = hit(request, rule)
    if (wait) {
      return new Response(JSON.stringify({ error: 'Trop de requêtes, réessaie dans un instant.' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(wait), ...HEADERS },
      })
    }
    // A request is counted once, by the most specific rule.
    break
  }

  const result = await next()
  const res = (result as { response?: Response }).response
  if (res) {
    for (const [k, v] of Object.entries(HEADERS)) {
      // Routes that set their own policy (file downloads) keep it.
      if (!res.headers.has(k)) res.headers.set(k, v)
    }
    if (PUBLIC.test(url.pathname) && method === 'GET') res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
  }
  return result
})

export const startInstance = createStart(() => ({
  requestMiddleware: [
    // Writes must come from this site (Sec-Fetch-Site / Origin / Referer): a
    // page on another domain can't make a visitor's browser edit or delete.
    createCsrfMiddleware({ filter: ({ request }) => !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase()) }),
    securityHeaders,
  ],
}))
