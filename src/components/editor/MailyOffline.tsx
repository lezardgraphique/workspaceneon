import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { CloudOff, Cpu, Loader2 } from 'lucide-react'

import { checkOfflineAi, getOfflineAiState, offlineAiWanted, offlineAiWantedHere, prepareOfflineAi, removeOfflineAi, skipOfflineAiHere, subscribeOfflineAi } from '@/lib/offline-ai'
import type { OfflineAiState } from '@/lib/offline-ai'
import { SETTINGS_EVENT } from '@/lib/settings-sync'

export function useOfflineAi(): OfflineAiState {
  const [s, setS] = useState<OfflineAiState>(getOfflineAiState)
  useEffect(() => {
    const off = subscribeOfflineAi(setS)
    // Switched on or off from another device: show it.
    const on = () => setS({ ...getOfflineAiState() })
    window.addEventListener(SETTINGS_EVENT, on)
    void checkOfflineAi()
    return () => {
      off()
      window.removeEventListener(SETTINGS_EVENT, on)
    }
  }, [])
  return s
}

const size = (s: OfflineAiState) => s.size ?? (s.engine === 'nano' ? 'géré par le navigateur' : 'environ 2 Go')

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
            <>
              Hors ligne : je réponds avec <strong className="text-white">{s.model}</strong> sur ton appareil, sans recherche web
              {s.engine === 'cpu' ? ' (sur le processeur : la première réponse peut prendre une minute).' : '.'}
            </>
          ) : (
            <>Maily hors ligne prête ({s.model}) : je prends le relais sur l'appareil si la connexion tombe.</>
          )}
        </span>
        {!offline &&
          (confirm ? (
            <span role="group" aria-label="Retirer Maily hors ligne" className="flex shrink-0 flex-wrap justify-end gap-1">
              <button type="button" className={btn} onClick={() => void removeOfflineAi('here').finally(() => setConfirm(false))}>
                De cet appareil
              </button>
              <button type="button" className={btn} onClick={() => void removeOfflineAi('everywhere').finally(() => setConfirm(false))}>
                De tous mes appareils
              </button>
              <button type="button" className={btn} onClick={() => setConfirm(false)}>
                Annuler
              </button>
            </span>
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
        Ce navigateur est trop ancien pour faire tourner un modèle sur l'appareil. Sans connexion, je réponds quand même avec mon guide intégré ; mets ton navigateur à jour pour la version complète.
      </span>
    )
  } else if (offline) {
    body = <span>Pas de connexion : je réponds avec mon guide intégré. Prépare « Maily hors ligne » la prochaine fois que tu es en ligne pour que je puisse aussi rédiger et créer des modules sans réseau.</span>
  } else if (offlineAiWantedHere()) {
    // Switched on from another device: each device keeps its own copy of the model.
    body = (
      <>
        <span className="min-w-0 flex-1">
          {s.status === 'error' && s.message ? `${s.message} ` : ''}
          Maily hors ligne est activée sur ton compte. Pour l'avoir aussi ici, cet appareil télécharge sa propre copie de {s.model} ({size(s)}, de préférence en Wi-Fi).
        </span>
        <span className="flex shrink-0 flex-wrap justify-end gap-1">
          <button type="button" className={btn} onClick={() => void prepareOfflineAi()}>
            {s.status === 'error' ? 'Réessayer' : 'Préparer'}
          </button>
          <button type="button" className={btn} onClick={skipOfflineAiHere}>
            Pas ici
          </button>
        </span>
      </>
    )
  } else {
    body = (
      <>
        <span className="min-w-0 flex-1">
          {s.status === 'error' && s.message ? `${s.message} ` : ''}
          {offlineAiWanted() ? 'Maily hors ligne est activée sur ton compte, pas sur cet appareil. ' : ''}
          Maily hors ligne : télécharge {s.model} sur cet appareil ({size(s)}){s.engine === 'cpu' ? ', fonctionne dans tous les navigateurs récents' : ''} pour me parler sans connexion{offlineAiWanted() ? '' : ' (tes autres appareils te proposeront de la préparer aussi)'}.
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
