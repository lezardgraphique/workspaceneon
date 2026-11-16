import { useState } from 'react'
import { logout } from '@netlify/identity'
import { Loader2, UserX } from 'lucide-react'

import { deleteAccount } from '@/server/account.functions'
import { isOffline } from '@/lib/data'
import { wipeLocal } from '@/lib/local-store'
import { rememberUser } from '@/lib/session-cache'
import { clearSyncedPrefs } from '@/lib/settings-sync'

// « Supprimer mon compte » (required by Google Play and the App Store): typed
// confirmation, then every module, block, file, version, setting and token of
// the account is erased, its sign-in too, and this device is cleaned.
export function DeleteAccount() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async () => {
    if (isOffline()) return setError('Tu es hors ligne : reconnecte-toi pour supprimer ton compte.')
    setBusy(true)
    setError('')
    try {
      const r = await deleteAccount({ data: { confirm: 'SUPPRIMER' } })
      try {
        await logout()
      } catch {
        // The sign-in may already be gone.
      }
      rememberUser(null)
      clearSyncedPrefs()
      await wipeLocal()
      navigator.serviceWorker?.controller?.postMessage('clear')
      navigator.serviceWorker?.controller?.postMessage('widgets')
      window.location.replace(`/connexion?compte=${r.signInDeleted ? 'supprime' : 'donnees-supprimees'}`)
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'La suppression a échoué. Réessaie dans un instant.')
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="suppr-titre" className="mt-6 space-y-3 rounded-xl border border-pink/40 bg-panel/80 p-6">
      <h2 id="suppr-titre" className="flex items-center gap-2 font-display text-lg font-semibold">
        <UserX className="size-5 text-pink" aria-hidden /> Supprimer mon compte
      </h2>
      <p className="text-sm text-mute">
        Efface définitivement tes modules (et leurs versions), tes blocs, tes fichiers, tes réglages, tes accès IA, puis ton identifiant de connexion. Pense à exporter ta base avant (« Hors ligne
        et base portable » sur l’accueil) si tu veux la garder. Les images insérées dans des e-mails restent en ligne, car elles apparaissent dans des e-mails déjà envoyés.
      </p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="rounded-md border border-pink/60 px-3 py-2 text-sm text-pink hover:bg-pink/10">
          Supprimer mon compte…
        </button>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-mute">Pour confirmer, écris SUPPRIMER</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              className="w-full rounded-md border border-line bg-void px-3 py-2.5 text-base text-white focus:border-pink focus:outline-none lg:text-sm"
            />
          </label>
          {error && (
            <p role="alert" className="rounded-md border border-pink/40 bg-pink/10 px-3 py-2 text-sm text-pink">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy || typed.trim().toUpperCase() !== 'SUPPRIMER'}
              className="inline-flex items-center gap-2 rounded-md bg-pink-fill px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />} Supprimer définitivement
            </button>
            <button type="button" onClick={() => (setOpen(false), setTyped(''), setError(''))} className="rounded-md border border-line px-3 py-2 text-sm text-mute hover:text-white">
              Garder mon compte
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
