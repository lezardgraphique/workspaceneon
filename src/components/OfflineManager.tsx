import { useEffect, useRef, useState } from 'react'
import { useRouter, useRouterState } from '@tanstack/react-router'
import { Check, ChevronUp, CloudOff, Cpu, Loader2, RefreshCw, Sparkles, X } from 'lucide-react'

import { dismissNotice, isOffline, markOnline, refreshPending, showNotice, syncAll, useDataStatus } from '@/lib/data'
import { checkOfflineAi, getOfflineAiState, subscribeOfflineAi } from '@/lib/offline-ai'
import type { OfflineAiState } from '@/lib/offline-ai'

/** Window event asking the editor to show Maily's panel. */
export const OPEN_MAILY_EVENT = 'nsp:open-maily'
const TIP_KEY = 'nsp-offline-ai-tip'

// Registers the service worker, keeps the local copy in sync with the server
// when the connection is there, and shows a small status pill when it isn't:
// a button opening what works offline, Maily's on-device state included.
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

  // Maily on the device: only looked at once the connection is gone (or a model
  // is being downloaded), so normal pages never wake WebGPU or the model files.
  const ai = useOfflineAiState()
  useEffect(() => {
    if (!st.online) void checkOfflineAi().catch(() => {})
  }, [st.online])

  // Back online after a cut while Maily couldn't follow: suggest preparing her, once.
  const wasOffline = useRef(false)
  useEffect(() => {
    if (!st.online) {
      wasOffline.current = true
      return
    }
    if (!wasOffline.current) return
    wasOffline.current = false
    const a = getOfflineAiState()
    if ((a.status === 'available' || a.status === 'error') && !localStorage.getItem(TIP_KEY)) {
      try {
        localStorage.setItem(TIP_KEY, '1')
      } catch {
        /* private mode */
      }
      showNotice('De retour en ligne. Pour la prochaine coupure, prépare « Maily hors ligne » dans l’onglet Maily.')
    }
  }, [st.online])

  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (st.online) setOpen(false)
  }, [st.online])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  const inEditor = useRouterState({ select: (r) => r.location.pathname.startsWith('/editor/') })
  const mailyReady = ai.status === 'ready'
  const pendingText = st.pending ? `${st.pending} modification${st.pending > 1 ? 's' : ''} en attente` : null
  const pct = ai.status === 'downloading' && ai.progress !== null ? Math.round(ai.progress * 100) : null

  const pill = 'fixed right-3 bottom-20 z-40 flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-lg lg:bottom-3'
  return (
    <div aria-live="polite">
      {st.notice && (
        <div role="status" className={`${pill} bottom-32 border-pink/60 bg-night/95 text-white lg:bottom-14`}>
          <span>{st.notice}</span>
          <button type="button" onClick={dismissNotice} aria-label="Fermer le message" className="text-mute hover:text-white">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {!st.online ? (
        <div ref={boxRef}>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="nsp-offline-panel"
            onClick={() => setOpen((o) => !o)}
            className={`${pill} tap-auto border-cyan/50 bg-night/95 text-white hover:border-cyan`}
          >
            <CloudOff className="size-3.5 shrink-0 text-cyan" aria-hidden />
            <span className="truncate">
              Hors ligne · {[pendingText, mailyReady ? 'Maily sur l’appareil' : null].filter(Boolean).join(' · ') || 'tes modules restent disponibles'}
            </span>
            {mailyReady && <Cpu className="size-3.5 shrink-0 text-cyan" aria-hidden />}
            <ChevronUp className={`size-3.5 shrink-0 text-mute transition-transform ${open ? '' : 'rotate-180'}`} aria-hidden />
          </button>
          <div
            id="nsp-offline-panel"
            hidden={!open}
            className="fixed right-3 bottom-30 z-40 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-cyan/40 bg-night/95 p-4 text-xs text-mute shadow-xl backdrop-blur lg:bottom-13"
          >
            <p className="mb-3 font-display text-sm font-semibold text-white">Tu travailles hors ligne</p>
            <ul className="space-y-3">
              <li className="flex gap-2">
                <Check className="mt-0.5 size-3.5 shrink-0 text-cyan" aria-hidden />
                <span>
                  Accueil, éditeur, aperçu et test clients fonctionnent.{' '}
                  {st.pending
                    ? `${st.pending} modification${st.pending > 1 ? 's sont gardées' : ' est gardée'} sur cet appareil et partira au retour du réseau.`
                    : 'Tes modifications sont gardées sur cet appareil et envoyées au retour du réseau.'}
                </span>
              </li>
              <li className="flex gap-2">
                {mailyReady ? (
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-cyan" aria-hidden />
                ) : ai.status === 'checking' || ai.status === 'downloading' ? (
                  <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-mute" aria-hidden />
                ) : (
                  <Sparkles className="mt-0.5 size-3.5 shrink-0 text-pink" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  {mailyReady ? (
                    <>
                      Maily répond avec <strong className="text-white">{ai.model}</strong> sur ton appareil : elle crée et modifie tes modules, sans recherche web.
                    </>
                  ) : ai.status === 'checking' ? (
                    'Vérification de Maily hors ligne…'
                  ) : ai.status === 'downloading' ? (
                    'Maily hors ligne est en cours de préparation.'
                  ) : ai.status === 'unsupported' ? (
                    'Ce navigateur ne peut pas faire tourner Maily sur l’appareil : Chrome ou Edge récents (ou un navigateur WebGPU) le permettent.'
                  ) : (
                    'Maily n’est pas préparée pour le hors ligne : à ta prochaine connexion, onglet Maily > « Préparer » (une seule fois).'
                  )}
                  {mailyReady && inEditor && (
                    <button
                      type="button"
                      onClick={() => {
                        window.dispatchEvent(new Event(OPEN_MAILY_EVENT))
                        setOpen(false)
                      }}
                      className="tap-auto mt-2 flex min-h-6 items-center gap-1 rounded-md border border-cyan/50 px-2 py-1 text-[11px] font-semibold text-cyan hover:bg-cyan/10"
                    >
                      <Sparkles className="size-3" aria-hidden /> Parler à Maily
                    </button>
                  )}
                </span>
              </li>
              <li className="flex gap-2">
                <CloudOff className="mt-0.5 size-3.5 shrink-0 text-mute" aria-hidden />
                <span>Demandent une connexion : les fichiers, l’envoi d’images, le GIF du compte à rebours et la recherche web de Maily.</span>
              </li>
            </ul>
          </div>
        </div>
      ) : st.syncing ? (
        <div role="status" className={`${pill} border-line bg-night/95 text-mute`}>
          <Loader2 className="size-3.5 animate-spin" /> Synchronisation…
        </div>
      ) : st.pending > 0 ? (
        <button type="button" onClick={() => void syncAll()} className={`${pill} border-pink/60 bg-night/95 text-white hover:border-pink`}>
          <RefreshCw className="size-3.5 text-pink" /> Synchroniser ({st.pending})
        </button>
      ) : pct !== null ? (
        <div role="status" className={`${pill} border-cyan/50 bg-night/95 text-white`}>
          <Loader2 className="size-3.5 animate-spin text-cyan" aria-hidden /> Préparation de Maily hors ligne : {pct} %
        </div>
      ) : null}
    </div>
  )
}

// Subscribes without checking: the check happens only when it's useful.
function useOfflineAiState(): OfflineAiState {
  const [s, setS] = useState<OfflineAiState>(getOfflineAiState)
  useEffect(() => subscribeOfflineAi(setS), [])
  return s
}
