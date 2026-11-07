import { useState } from 'react'
import { Link, useRouteContext } from '@tanstack/react-router'
import { logout } from '@netlify/identity'
import { Loader2, LogOut, User } from 'lucide-react'

import { isOffline, refreshPending, syncAll } from '@/lib/data'
import { wipeLocal } from '@/lib/local-store'
import { rememberUser } from '@/lib/session-cache'
import { clearSyncedPrefs, pullSettings } from '@/lib/settings-sync'

// Signed-in account (from the root route) and the sign-out button.
export function AccountMenu() {
  const user = useRouteContext({ from: '__root__', select: (c) => c.user })
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const out = async () => {
    if (isOffline()) {
      alert('Tu es hors ligne : reconnecte-toi au réseau pour te déconnecter.')
      return
    }
    setBusy(true)
    // Unsent offline changes are pushed first; if that fails, ask before wiping them.
    await Promise.all([syncAll(), pullSettings()])
    const left = await refreshPending()
    if (left > 0 && !confirm(`${left} modification${left > 1 ? 's' : ''} hors ligne ne ${left > 1 ? 'sont' : 'est'} pas encore synchronisée${left > 1 ? 's' : ''} et ${left > 1 ? 'seront perdues' : 'sera perdue'} à la déconnexion. Te déconnecter quand même ?`)) {
      setBusy(false)
      return
    }
    try {
      await logout()
    } finally {
      // The local copy and the stored pages belong to this account only.
      rememberUser(null)
      clearSyncedPrefs()
      await wipeLocal()
      navigator.serviceWorker?.controller?.postMessage('clear')
      navigator.serviceWorker?.controller?.postMessage('widgets')
      // Full navigation: the server must see the cleared cookie.
      window.location.replace('/connexion')
    }
  }

  return (
    <div className="flex items-center gap-1.5 text-sm text-mute sm:gap-2">
      <Link to="/compte" className="inline-flex max-w-[14rem] items-center gap-1.5 truncate rounded-md border border-line px-2 py-1.5 hover:border-violet hover:text-white sm:px-3" title={`Mon compte · ${user.email}`}>
        <User className="size-4 shrink-0 text-violet" aria-hidden /> <span className="sr-only">Mon compte</span> <span className="sr-only truncate md:not-sr-only">{user.email}</span>
      </Link>
      <button
        onClick={out}
        disabled={busy}
        title="Se déconnecter"
        className="inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 hover:border-pink sm:px-3 hover:text-white disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4 text-pink" />}
        <span className="sr-only sm:not-sr-only">Déconnexion</span>
      </button>
    </div>
  )
}
