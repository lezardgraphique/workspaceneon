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
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob: https:",
  "media-src 'self'",
  // Have I Been Pwned (new passwords: only 5 characters of a hash are sent).
  "connect-src 'self' https://api.pwnedpasswords.com",
  "frame-src 'self' about: data: blob:",
  "worker-src 'self'",
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
  if (res && /text\/html/i.test(res.headers.get('content-type') ?? '') && !res.headers.has('Content-Security-Policy')) {
    // Pages: every inline script of this very page is allowed by its SHA-256
    // fingerprint. Browsers that know hashes then ignore 'unsafe-inline', so an
    // injected script can't run; the oldest ones still get the page working.
    const html = await res.text()
    const hashes = await inlineScriptHashes(html)
    const page = new Response(html, { status: res.status, statusText: res.statusText, headers: res.headers })
    page.headers.delete('content-length')
    page.headers.set('Content-Security-Policy', CSP.replace("script-src 'self' 'unsafe-inline'", `script-src 'self' 'unsafe-inline' ${hashes.join(' ')}`))
    ;(result as { response?: Response }).response = page
    if (anonymousPublicPage(request, url, method, page)) {
      // Same HTML for every visitor without a session: kept by Netlify's CDN,
      // so the sign-in and legal pages show at once instead of waiting for the
      // server. A signed-in visitor (nf_jwt cookie) never shares this copy;
      // a new deploy empties the cache, so the copy can live a day (a week stale
      // while it is refreshed): the first visitor after a deploy is the only slow one.
      page.headers.set('Cache-Control', 'public, max-age=0, must-revalidate')
      page.headers.set('Netlify-CDN-Cache-Control', 'public, durable, s-maxage=86400, stale-while-revalidate=604800')
      page.headers.set('Netlify-Vary', 'cookie=nf_jwt')
    }
    return withHeaders(result, page, url, method)
  }
  if (res) return withHeaders(result, res, url, method)
  return result
})

// Pages anyone sees the same way when signed out.
const CDN_PAGES = /^\/(connexion|mentions-legales)\/?$/

function anonymousPublicPage(request: Request, url: URL, method: string, res: Response): boolean {
  if (method !== 'GET' || res.status !== 200 || url.search || !CDN_PAGES.test(url.pathname)) return false
  if (res.headers.has('Set-Cookie')) return false
  return !/(^|;\s*)nf_jwt=/.test(request.headers.get('cookie') ?? '')
}

// The inline <script> elements of a page (no src), fingerprinted for the CSP.
async function inlineScriptHashes(html: string): Promise<string[]> {
  const out = new Set<string>()
  const re = /<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(m[1]))
    out.add(`'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`)
  }
  // At least one source, so 'unsafe-inline' is always disabled by modern browsers.
  if (!out.size) out.add("'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='")
  return [...out]
}

function withHeaders<T>(result: T, res: Response, url: URL, method: string): T {
  {
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
}

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
