import { useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { CloudOff, Loader2, RefreshCw, X } from 'lucide-react'

import { dismissNotice, isOffline, markOnline, refreshPending, syncAll, useDataStatus } from '@/lib/data'

// Registers the service worker, keeps the local copy in sync with the server
// when the connection is there, and shows a small status pill when it isn't.
export function OfflineManager() {
  const router = useRouter()
  const st = useDataStatus()
  const pendingRef = useRef(st.pending)
  pendingRef.current = st.pending

  useEffect(() => {
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      navigator.serviceWorker
        .register('/sw.js')
        .then(() => navigator.serviceWorker.ready)
        .then((reg) => {
          if (!isOffline()) reg.active?.postMessage('prime')
        })
        .catch(() => {})
    }

    // Opened offline through the app shell: go to the page that was asked for,
    // and reload data from the local copy rather than from the cached HTML.
    const go = new URLSearchParams(location.search).get('offline-go')
    if (go && go.startsWith('/') && !go.startsWith('//')) void router.navigate({ to: go, replace: true })
    else if (isOffline()) void router.invalidate()

    const sync = () => {
      if (document.visibilityState !== 'visible') return
      markOnline()
      // Don't wake the network every 30 seconds when there are no edits queued.
      if (!isOffline() && pendingRef.current > 0) void syncAll()
    }
    const onOffline = () => markOnline()
    const onOnline = () => {
      markOnline()
      void refreshPending().then((pending) => {
        if (!isOffline() && document.visibilityState === 'visible' && pending > 0) void syncAll()
      })
      void router.invalidate()
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') sync()
    }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    const timer = setInterval(sync, 30000)
    markOnline()
    void refreshPending().then((pending) => {
      if (!isOffline() && document.visibilityState === 'visible' && pending > 0) void syncAll()
    })
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(timer)
    }
  }, [router])

  useEffect(() => {
    if (!st.notice) return
    const t = setTimeout(dismissNotice, 12000)
    return () => clearTimeout(t)
  }, [st.notice])

  const pill = 'fixed right-3 bottom-20 z-40 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-lg lg:bottom-3'
  return (
    <div aria-live="polite">
      {st.notice && (
        <div role="status" className={`${pill} bottom-32 border-pink/60 bg-night/95 text-white lg:bottom-14`}>
          <span>{st.notice}</span>
          <button onClick={dismissNotice} aria-label="Fermer le message" className="text-mute hover:text-white">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {!st.online ? (
        <div role="status" className={`${pill} border-cyan/50 bg-night/95 text-white`}>
          <CloudOff className="size-3.5 text-cyan" />
          <span>Hors ligne{st.pending ? ` · ${st.pending} modification${st.pending > 1 ? 's' : ''} sur cet appareil` : ' · tes modules restent disponibles'}</span>
        </div>
      ) : st.syncing ? (
        <div role="status" className={`${pill} border-line bg-night/95 text-mute`}>
          <Loader2 className="size-3.5 animate-spin" /> Synchronisation…
        </div>
      ) : st.pending > 0 ? (
        <button onClick={() => void syncAll()} className={`${pill} border-pink/60 bg-night/95 text-white hover:border-pink`}>
          <RefreshCw className="size-3.5 text-pink" /> Synchroniser ({st.pending})
        </button>
      ) : null}
    </div>
  )
}
