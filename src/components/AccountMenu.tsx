import { useState } from 'react'
import { Link, useRouteContext } from '@tanstack/react-router'
import { logout } from '@netlify/identity'
import { Loader2, LogOut, User } from 'lucide-react'

// Signed-in account (from the root route) and the sign-out button.
export function AccountMenu() {
  const user = useRouteContext({ from: '__root__', select: (c) => c.user })
  const [busy, setBusy] = useState(false)
  if (!user) return null

  const out = async () => {
    setBusy(true)
    try {
      await logout()
    } finally {
      // Full navigation: the server must see the cleared cookie.
      window.location.replace('/connexion')
    }
  }

  return (
    <div className="flex items-center gap-2 text-sm text-mute">
      <Link to="/compte" className="inline-flex max-w-[14rem] items-center gap-1.5 truncate rounded-md border border-line px-3 py-1.5 hover:border-violet hover:text-white" title={`Mon compte · ${user.email}`}>
        <User className="size-4 shrink-0 text-violet" /> <span className="hidden truncate md:inline">{user.email}</span>
        <span className="md:hidden">Compte</span>
      </Link>
      <button
        onClick={out}
        disabled={busy}
        aria-label="Se déconnecter"
        className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 hover:border-pink hover:text-white disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4 text-pink" />}
        <span className="hidden sm:inline">Déconnexion</span>
      </button>
    </div>
  )
}
