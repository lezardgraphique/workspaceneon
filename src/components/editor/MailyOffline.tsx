import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { CloudOff, Cpu, Loader2 } from 'lucide-react'

import { checkOfflineAi, getOfflineAiState, prepareOfflineAi, removeOfflineAi, subscribeOfflineAi } from '@/lib/offline-ai'
import type { OfflineAiState } from '@/lib/offline-ai'

export function useOfflineAi(): OfflineAiState {
  const [s, setS] = useState<OfflineAiState>(getOfflineAiState)
  useEffect(() => {
    const off = subscribeOfflineAi(setS)
    void checkOfflineAi()
    return off
  }, [])
  return s
}

const size = (s: OfflineAiState) => (s.engine === 'nano' ? 'géré par le navigateur' : s.model?.includes('1B') ? 'environ 700 Mo' : 'environ 2 Go')

// "Maily hors ligne" strip of the Maily panel: prepare (download once, online),
// state of the on-device model, remove it.
export function MailyOffline({ offline }: { offline: boolean }) {
  const s = useOfflineAi()
  const [confirm, setConfirm] = useState(false)

  const btn = 'tap-auto min-h-6 shrink-0 rounded-md border border-cyan/50 px-2 py-1 text-[11px] font-semibold text-cyan hover:bg-cyan/10'
  let body: ReactNode
  if (s.status === 'checking') {
    body = (
      <>
        <Loader2 className="size-3.5 shrink-0 animate-spin text-mute" aria-hidden />
        <span className="min-w-0 flex-1">Maily hors ligne : je regarde ce que ton navigateur peut faire tourner…</span>
      </>
    )
  } else if (s.status === 'ready') {
    body = (
      <>
        <span className="min-w-0 flex-1">
          {offline ? (
            <>Hors ligne : je réponds avec <strong className="text-white">{s.model}</strong> sur ton appareil, sans recherche web.</>
          ) : (
            <>Maily hors ligne prête ({s.model}) : je prends le relais sur l'appareil si la connexion tombe.</>
          )}
        </span>
        {!offline &&
          (confirm ? (
            <button type="button" className={btn} onClick={() => void removeOfflineAi().finally(() => setConfirm(false))}>
              Confirmer
            </button>
          ) : (
            <button type="button" className={btn} onClick={() => setConfirm(true)}>
              Retirer
            </button>
          ))}
      </>
    )
  } else if (s.status === 'downloading') {
    const pct = s.progress === null ? null : Math.round(s.progress * 100)
    body = (
      <>
        <Loader2 className="size-3.5 shrink-0 animate-spin text-cyan" aria-hidden />
        <span className="min-w-0 flex-1">
          Préparation de {s.model ?? 'Maily hors ligne'}
          {pct !== null && ` : ${pct} %`}
          <progress className="mt-1 block h-1 w-full accent-cyan" max={100} value={pct ?? undefined} aria-label="Téléchargement du modèle local" />
        </span>
      </>
    )
  } else if (s.status === 'unsupported') {
    body = (
      <span>
        Maily hors ligne n'est pas disponible dans ce navigateur (ni Gemini Nano ni WebGPU) : ouvre l'application dans Chrome ou Edge récents pour la préparer.
      </span>
    )
  } else if (offline) {
    body = <span>Pas de connexion. Prépare « Maily hors ligne » la prochaine fois que tu es en ligne pour me parler sans réseau.</span>
  } else {
    body = (
      <>
        <span className="min-w-0 flex-1">
          {s.status === 'error' && s.message ? `${s.message} ` : ''}
          Maily hors ligne : télécharge {s.model} sur cet appareil ({size(s)}) pour me parler sans connexion.
        </span>
        <button type="button" className={btn} onClick={() => void prepareOfflineAi()}>
          {s.status === 'error' ? 'Réessayer' : 'Préparer'}
        </button>
      </>
    )
  }

  return (
    <div role="status" className="flex items-center gap-2 border-b border-line bg-void/40 px-4 py-2 text-[11px] text-mute">
      {s.status === 'ready' || s.status === 'downloading' || s.status === 'checking' ? null : offline ? (
        <CloudOff className="size-3.5 shrink-0 text-pink" aria-hidden />
      ) : (
        <Cpu className="size-3.5 shrink-0 text-cyan" aria-hidden />
      )}
      {s.status === 'ready' && <Cpu className="size-3.5 shrink-0 text-cyan" aria-hidden />}
      {body}
    </div>
  )
}
