import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, createFileRoute, useRouteContext } from '@tanstack/react-router'
import { AuthError, login, updateUser } from '@netlify/identity'
import { Check, Loader2, KeyRound } from 'lucide-react'

import { AccountMenu } from '@/components/AccountMenu'
import { AppHeader } from '@/components/AppHeader'

export const Route = createFileRoute('/compte')({
  head: () => ({ meta: [{ title: 'Mon compte · Neon Sandbox Pro' }] }),
  component: Compte,
})

const MIN_PASSWORD = 8
const field =
  'w-full rounded-md border border-line bg-void px-3 py-2.5 text-base text-white placeholder:text-mute focus:border-cyan focus:outline-none lg:text-sm'

function Compte() {
  const user = useRouteContext({ from: '__root__', select: (c) => c.user })
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setDone(false)
    if (next.length < MIN_PASSWORD) return setError(`Le nouveau mot de passe doit faire au moins ${MIN_PASSWORD} caractères.`)
    if (next !== again) return setError('Les deux mots de passe ne correspondent pas.')
    if (next === current) return setError('Choisis un mot de passe différent de l\'actuel.')
    setBusy(true)
    try {
      // The current password is checked again: a session left open on a shared computer can't lock the owner out.
      if (user?.email) await login(user.email, current)
      await updateUser({ password: next })
      setDone(true)
      setCurrent('')
      setNext('')
      setAgain('')
    } catch (err) {
      const raw = err instanceof Error ? err.message.toLowerCase() : ''
      setError(
        raw.includes('invalid') || raw.includes('credential') || raw.includes('grant')
          ? 'Le mot de passe actuel est incorrect.'
          : err instanceof AuthError && err.status === 429
            ? 'Trop de tentatives, réessaie dans un instant.'
            : 'Impossible de changer le mot de passe pour le moment. Réessaie dans un instant.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="neon-grid min-h-screen">
      <AppHeader>
        <Link to="/" className="hidden text-sm text-mute hover:text-white sm:inline">
          ← Mes modules
        </Link>
        <AccountMenu />
      </AppHeader>

      <main className="mx-auto max-w-md px-6 pb-20">
        <h1 className="font-display text-3xl font-bold">Mon compte</h1>
        <p className="mt-1 text-sm text-mute">{user?.email}</p>

        <form onSubmit={submit} className="mt-6 space-y-4 rounded-xl border border-line bg-panel/80 p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-semibold">
            <KeyRound className="size-5 text-cyan" /> Changer le mot de passe
          </h2>
          {/* Hidden username so password managers attach the new password to this account. */}
          <input type="email" name="email" autoComplete="username" value={user?.email ?? ''} readOnly hidden />
          <label className="block text-sm">
            <span className="mb-1 block text-mute">Mot de passe actuel</span>
            <input type="password" name="current-password" required autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={field} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-mute">Nouveau mot de passe ({MIN_PASSWORD} caractères minimum)</span>
            <input type="password" name="new-password" required autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={field} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-mute">Confirme le nouveau mot de passe</span>
            <input type="password" name="confirm-password" required autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={field} />
          </label>

          {error && (
            <p role="alert" className="rounded-md border border-pink/40 bg-pink/10 px-3 py-2 text-sm text-pink">
              {error}
            </p>
          )}
          {done && (
            <p role="status" className="flex items-center gap-2 rounded-md border border-cyan/40 bg-cyan/10 px-3 py-2 text-sm text-cyan">
              <Check className="size-4" /> Mot de passe changé. Utilise-le à ta prochaine connexion.
            </p>
          )}

          <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-pink px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60">
            {busy && <Loader2 className="size-4 animate-spin" />} Enregistrer le nouveau mot de passe
          </button>
        </form>
      </main>
    </div>
  )
}
