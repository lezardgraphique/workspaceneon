/* Neon Sandbox Pro: service worker.
   - build files (/assets/*, listed in /asset-manifest.json) are stored at install
     so the whole app, lazy chunks included, runs without a connection;
   - the home page is kept as the app shell: offline, any page opens through it
     and the router then loads the module from the local copy (IndexedDB);
   - fonts and images are stored as they are used.
   Data never goes through here (server functions and /api are not touched). */
const VERSION = 'nsp-v1'
const SHELL = VERSION + '-shell'
const ASSETS = VERSION + '-assets'
const RUNTIME = VERSION + '-runtime'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const res = await fetch('/asset-manifest.json', { cache: 'no-store' })
        if (res.ok) {
          const { files } = await res.json()
          const cache = await caches.open(ASSETS)
          await Promise.all(files.map((f) => cache.add(f).catch(() => {})))
          for (const req of await cache.keys()) if (!files.includes(new URL(req.url).pathname)) await cache.delete(req)
        }
        await (await caches.open(SHELL)).add('/offline.html').catch(() => {})
      } catch (e) {
        /* offline install: nothing to store */
      }
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k)
      await self.clients.claim()
    })(),
  )
})

// Signing out wipes what was stored for the account.
self.addEventListener('message', (event) => {
  if (event.data === 'clear') event.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))))
  // The first visit isn't controlled by the worker yet: the page asks it to keep
  // the app shell (the home page) once, then at most once a day.
  if (event.data === 'prime') {
    event.waitUntil(
      (async () => {
        const shell = await caches.open(SHELL)
        const hit = await shell.match('/')
        if (hit && Date.now() - (Date.parse(hit.headers.get('date') || '') || 0) < 86400000) return
        try {
          const res = await fetch('/', { credentials: 'same-origin' })
          if (res.ok && !res.redirected) await shell.put('/', res)
        } catch (e) {
          /* offline: keep what we have */
        }
      })(),
    )
  }
})

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com']

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith('/assets/')) return event.respondWith(cacheFirst(req, ASSETS))
    if (req.mode === 'navigate') return event.respondWith(navigate(req, url))
    if (/^\/(favicon\.svg|icon-.*\.png|img\/|social\/|manifest\.webmanifest)/.test(url.pathname) || url.pathname.startsWith('/api/images/')) {
      return event.respondWith(staleWhileRevalidate(req, RUNTIME))
    }
    return
  }
  if (FONT_HOSTS.includes(url.hostname)) event.respondWith(staleWhileRevalidate(new Request(req.url, { mode: 'cors', credentials: 'omit' }), RUNTIME))
})

async function cacheFirst(req, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) cache.put(req, res.clone())
  return res
}

async function staleWhileRevalidate(req, name) {
  const cache = await caches.open(name)
  const hit = await cache.match(req)
  const net = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone())
      return res
    })
    .catch(() => null)
  if (hit) {
    net.catch(() => {})
    return hit
  }
  return (await net) || Response.error()
}

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))

async function navigate(req, url) {
  const shell = await caches.open(SHELL)
  const home = url.pathname === '/'
  const cached = await shell.match('/')
  try {
    const net = fetch(req)
    const res = await (cached ? Promise.race([net, timeout(5000)]) : net)
    if (home && res.ok && !res.redirected && !url.search) shell.put('/', res.clone())
    return res
  } catch (e) {
    if (cached) {
      if (home) return cached
      if (!url.pathname.startsWith('/connexion')) {
        return Response.redirect('/?offline-go=' + encodeURIComponent(url.pathname + url.search), 302)
      }
    }
    return (await shell.match('/offline.html')) || Response.error()
  }
}
