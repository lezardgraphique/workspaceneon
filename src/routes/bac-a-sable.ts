import { createFileRoute } from '@tanstack/react-router'

// Sandbox page where a module's JavaScript (module.js of a web module) is
// tried out. It is only ever shown in an <iframe sandbox="allow-scripts">
// without allow-same-origin: the page has no origin of its own, so the script
// can't read the account's cookies, storage or pages. It may not call any
// server either (connect-src 'none') and may only be framed by the app.
// The page receives the rendered module and the script by postMessage from its
// parent, writes them, and sends back the console messages and errors.
const CSP = [
  "default-src 'none'",
  // The module's own script, and the libraries it loads (jQuery, Swiper…) from a CDN.
  "script-src 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'unsafe-inline' https:",
  'img-src https: data: blob:',
  'font-src https: data:',
  'media-src https: data:',
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
].join('; ')

const PAGE = `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>Bac à sable JavaScript</title></head>
<body><script>
(function () {
  // document.open() wipes the window's listeners: this part is written again
  // at the top of the module's page so its errors keep being reported.
  var hook = function () {
    var send = function (type, text) {
      try { parent.postMessage({ neonSandbox: true, type: type, text: String(text).slice(0, 2000) }, '*') } catch (e) {}
    }
    var show = function (a) { try { return typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a) } catch (e) { return String(a) } }
    window.addEventListener('error', function (e) { send('error', (e.message || 'Erreur') + (e.lineno ? ' (ligne ' + e.lineno + ')' : '')) })
    window.addEventListener('unhandledrejection', function (e) { send('error', 'Promesse rejetée : ' + show(e.reason)) })
    if (!console.__neon) {
      console.__neon = true
      ;['log', 'info', 'warn', 'error'].forEach(function (k) {
        var orig = console[k]
        console[k] = function () {
          send(k === 'info' ? 'log' : k, [].map.call(arguments, show).join(' '))
          if (orig) orig.apply(console, arguments)
        }
      })
    }
    return send
  }
  var send = hook()
  window.addEventListener('message', function (e) {
    if (e.source !== parent || !e.data || !e.data.neonRun) return
    var safe = function (t) { return String(t || '').replace(/<\\/(script)/gi, '<\\\\/$1') }
    var js = safe(e.data.js)
    document.open()
    document.write('<script>(' + hook.toString() + ')()<\\/script>' + String(e.data.html || '') + '<script>\\n' + js + '\\n<\\/script>')
    document.close()
  })
  send('ready', '')
})()
</script></body></html>`

export const Route = createFileRoute('/bac-a-sable')({
  server: {
    handlers: {
      GET: () =>
        new Response(PAGE, {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Content-Security-Policy': CSP,
            'X-Robots-Tag': 'noindex',
            'Cache-Control': 'public, max-age=300',
          },
        }),
    },
  },
})
