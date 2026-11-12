import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'

import { RULES, hit } from '@/server/rate-limit'

// Everything here runs on every request, before routes and server functions.

// Content-Security-Policy. The app renders untrusted HTML only through the
// sanitizer, but the policy is the second wall: nothing from another origin
// can run, and the page can't be framed (except by Netlify's dashboard) or post elsewhere.
// Inline scripts are needed by the SSR bootstrap; the email preview is a
// script-less sandboxed iframe that inherits this policy (hence the open
// img/style/font sources: emails load remote images and web fonts).
const CSP = [
  "default-src 'self'",
  // 'wasm-unsafe-eval': WebAssembly of the on-device Maily model (WebLLM), no JS eval.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self'",
  // Offline Maily (Gemma through WebLLM): model files downloaded once from
  // Hugging Face and the GPU kernels from the MLC repository, on the user's request.
  // + Have I Been Pwned (new passwords: only 5 characters of a hash are sent).
  "connect-src 'self' https://huggingface.co https://*.hf.co https://*.huggingface.co https://raw.githubusercontent.com https://api.pwnedpasswords.com",
  "frame-src 'self' about: data: blob:",
  // Offline Maily on the processor (llama.cpp in WebAssembly) runs in workers built from blob: URLs.
  "worker-src 'self' blob:",
  // Only Netlify's dashboard may show the app in a frame (deploy previews);
  // any other site still can't frame it (clickjacking).
  "frame-ancestors 'self' https://app.netlify.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  'upgrade-insecure-requests',
].join('; ')

const HEADERS: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  // Older browsers only; current ones follow frame-ancestors above.
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

// Uploaded files are public by design (URLs are pasted in emails): they must
// stay loadable from other sites, so only that header differs.
const PUBLIC = /^(\/api\/(images|files)\/[^/]+|\/countdown\.gif)$/

const securityHeaders = createMiddleware({ type: 'request' }).server(async ({ request, next }) => {
  const url = new URL(request.url)
  const method = request.method.toUpperCase()

  for (const { test, rule } of RULES) {
    if (!test(url.pathname, method)) continue
    const wait = hit(request, rule)
    if (wait) {
      // Floods go to the security journal (one line a minute per address).
      await import('@/server/firewall.server').then((f) => f.logEvent(request, `trop de requêtes (${rule.name})`, 'abus')).catch(() => {})
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
  // A page that doesn't exist, asked for by a script: noted (scans show up there).
  if (res?.status === 404 && method === 'GET') {
    await import('@/server/firewall.server').then((f) => f.logEvent(request, 'page introuvable', 'suspect')).catch(() => {})
  }
  if (res) {
    for (const [k, v] of Object.entries(HEADERS)) {
      // Routes that set their own policy (file downloads) keep it.
      if (!res.headers.has(k)) res.headers.set(k, v)
    }
    if (PUBLIC.test(url.pathname) && method === 'GET') res.headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
    // Pages and server functions carry an account's data: never kept by a
    // shared cache (CDN, proxy); the browser checks again before reusing them.
    else if (!res.headers.has('Cache-Control')) res.headers.set('Cache-Control', 'private, no-cache')
  }
  return result
})

// Firewall first: attacks and blocked addresses never reach the app
// (src/server/firewall.server.ts). Loaded on the server only.
const firewall = createMiddleware({ type: 'request' }).server(async ({ request, next }) => {
  const f = await import('@/server/firewall.server')
  const refused = await f.guard(request, async () => {
    const { sessionUser } = await import('@/server/auth.server')
    return !!(await sessionUser())
  })
  if (refused) {
    for (const [k, v] of Object.entries(HEADERS)) if (!refused.headers.has(k)) refused.headers.set(k, v)
    return refused
  }
  return next()
})

export const startInstance = createStart(() => ({
  requestMiddleware: [
    firewall,
    // Writes must come from this site (Sec-Fetch-Site / Origin / Referer): a
    // page on another domain can't make a visitor's browser edit or delete.
    // The MCP server (/mcp/…) is called by AI services from their own servers,
    // with no Origin: it only accepts a personal token, never the session
    // cookie, so a forged cross-site request has nothing to ride on.
    createCsrfMiddleware({
      filter: ({ request }) =>
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase()) && !new URL(request.url).pathname.startsWith('/mcp/'),
    }),
    securityHeaders,
  ],
}))
