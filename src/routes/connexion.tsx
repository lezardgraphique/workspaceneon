import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { AuthError, acceptInvite, getUser, handleAuthCallback, login, refreshSession, requestPasswordRecovery, signup, updateUser } from '@netlify/identity'
import { Loader2, LogIn } from 'lucide-react'

import { AuthIllustration } from '@/components/AuthIllustration'
import { Maily, NeonLogo } from '@/components/Maily'
import { getSession } from '@/server/session.functions'

export const Route = createFileRoute('/connexion')({
  head: () => ({ meta: [{ title: 'Connexion · Neon Sandbox Pro' }] }),
  component: Connexion,
})

type Mode = 'login' | 'signup' | 'forgot' | 'reset' | 'invite'

const MIN_PASSWORD = 8

// Netlify's messages come in English; the common cases are translated.
function message(err: unknown): string {
  const raw = err instanceof Error ? err.message.toLowerCase() : ''
  if (raw.includes('invalid') && (raw.includes('grant') || raw.includes('credential') || raw.includes('password'))) return 'E-mail ou mot de passe incorrect.'
  if (raw.includes('not confirmed') || raw.includes('confirm')) return 'Confirme ton adresse avec le lien reçu par e-mail avant de te connecter.'
  if (raw.includes('already') || raw.includes('registered') || raw.includes('exists')) return 'Un compte existe déjà avec cette adresse.'
  if (raw.includes('signup') && raw.includes('disabled')) return 'Les inscriptions sont fermées : demande une invitation.'
  if (raw.includes('weak') || raw.includes('password')) return `Mot de passe refusé : ${MIN_PASSWORD} caractères minimum.`
  if (raw.includes('expired') || raw.includes('token')) return 'Ce lien a expiré : recommence la demande.'
  if (err instanceof AuthError && err.status === 429) return 'Trop de tentatives, réessaie dans un instant.'
  return 'Opération impossible pour le moment. Réessaie dans un instant.'
}

// The access token lasts about an hour; the refresh token kept by the browser
// lasts much longer. Coming back later, the server only sees an expired token
// and sends us here: renew it silently instead of asking for the password again.
// Tried once per 30 s so a refusal can never loop.
async function restoreSession() {
  try {
    const last = Number(sessionStorage.getItem('neon-restore') ?? 0)
    if (Date.now() - last < 30_000) return
    sessionStorage.setItem('neon-restore', String(Date.now()))
  } catch {
    return
  }
  const user = await getUser().catch(() => null)
  if (!user) return
  await refreshSession().catch(() => null)
  window.location.replace('/')
}

const field =
  'w-full rounded-md border border-line bg-void px-3 py-2.5 text-base text-white placeholder:text-mute focus:border-cyan focus:outline-none lg:text-sm'

function Connexion() {
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [inviteToken, setInviteToken] = useState('')

  // Links in e-mails (confirmation, recovery, invitation) land here with a token in the URL hash.
  useEffect(() => {
    handleAuthCallback()
      .then(async (res) => {
        if (!res) {
          // No e-mail link to process: signed in already → home, otherwise try to renew a lapsed session.
          if (await getSession().catch(() => null)) window.location.replace('/')
          else await restoreSession()
          return
        }
        if (res.type === 'recovery') {
          setMode('reset')
          setInfo('Choisis ton nouveau mot de passe.')
        } else if (res.type === 'invite') {
          setInviteToken(res.token ?? '')
          setMode('invite')
          setInfo('Bienvenue ! Choisis un mot de passe pour créer ton compte.')
        } else window.location.replace('/')
      })
      .catch((e) => setError(message(e)))
  }, [])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setInfo('')
    if ((mode === 'signup' || mode === 'reset' || mode === 'invite') && password.length < MIN_PASSWORD) {
      setError(`Choisis un mot de passe d'au moins ${MIN_PASSWORD} caractères.`)
      return
    }
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(email.trim(), password)
        window.location.replace('/')
      } else if (mode === 'signup') {
        const user = await signup(email.trim(), password)
        if (user && (user as { confirmedAt?: unknown }).confirmedAt) window.location.replace('/')
        else {
          setMode('login')
          setPassword('')
          setInfo('Compte créé ! Clique sur le lien envoyé par e-mail pour le confirmer, puis connecte-toi.')
        }
      } else if (mode === 'forgot') {
        await requestPasswordRecovery(email.trim())
        setInfo('Si un compte existe pour cette adresse, un lien de réinitialisation vient d\'être envoyé.')
      } else if (mode === 'reset') {
        await updateUser({ password })
        window.location.replace('/')
      } else {
        await acceptInvite(inviteToken, password)
        window.location.replace('/')
      }
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const title = { login: 'Connexion', signup: 'Créer un compte', forgot: 'Mot de passe oublié', reset: 'Nouveau mot de passe', invite: 'Créer ton compte' }[mode]
  const needsEmail = mode === 'login' || mode === 'signup' || mode === 'forgot'
  const needsPassword = mode !== 'forgot'
  const go = (m: Mode) => {
    setMode(m)
    setError('')
    setInfo('')
  }

  return (
    <div className="neon-grid relative min-h-screen overflow-x-hidden">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <span className="auth-tile left-[6%] top-[8%] size-14" style={{ '--tile': '#ff007f', '--r': '-8deg' } as React.CSSProperties} />
        <span className="auth-tile right-[8%] top-[14%] h-10 w-20" style={{ '--tile': '#00e5ff', '--r': '6deg', animationDelay: '1.2s' } as React.CSSProperties} />
        <span className="auth-tile bottom-[10%] left-[10%] h-12 w-24" style={{ '--tile': '#bc13fe', '--r': '5deg', animationDelay: '2.4s' } as React.CSSProperties} />
        <span className="auth-tile bottom-[16%] right-[6%] size-16" style={{ '--tile': '#ff007f', '--r': '-4deg', animationDelay: '0.6s' } as React.CSSProperties} />
      </div>
      <div className="relative mx-auto grid min-h-screen max-w-6xl items-center gap-12 px-4 py-10 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:px-8">
        <div className="auth-rise mx-auto w-full max-w-sm">
          <div className="mb-6 flex items-center justify-center gap-3">
            <NeonLogo size={34} />
            <span className="font-display text-lg font-semibold tracking-wide">
              Neon Sandbox <span className="text-pink">Pro</span>
            </span>
          </div>
          <div className="mb-5 flex justify-center lg:hidden" aria-hidden="true">
            <Maily size={96} mood="happy" />
          </div>

          <form onSubmit={submit} className="auth-card auth-rise auth-rise-2 space-y-4 p-6">
            <h1 className="font-display text-xl font-bold">{title}</h1>

            {needsEmail && (
              <label className="block text-sm">
                <span className="mb-1 block text-mute">Adresse e-mail</span>
                <input type="email" name="email" id="email" required autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
              </label>
            )}
            {needsPassword && (
              <label className="block text-sm">
                <span className="mb-1 block text-mute">{mode === 'login' ? 'Mot de passe' : `Mot de passe (${MIN_PASSWORD} caractères minimum)`}</span>
                <input
                  type="password"
                  name="password"
                  id="password"
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={field}
                />
              </label>
            )}

            {error && (
              <p role="alert" className="rounded-md border border-pink/40 bg-pink/10 px-3 py-2 text-sm text-pink">
                {error}
              </p>
            )}
            {info && (
              <p role="status" className="rounded-md border border-cyan/40 bg-cyan/10 px-3 py-2 text-sm text-cyan">
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-pink px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
              {{ login: 'Se connecter', signup: 'Créer mon compte', forgot: 'Envoyer le lien', reset: 'Enregistrer', invite: 'Créer mon compte' }[mode]}
            </button>

            <div className="flex flex-wrap justify-between gap-2 text-sm text-mute">
              {mode === 'login' ? (
                <>
                  <button type="button" onClick={() => go('signup')} className="hover:text-white">
                    Créer un compte
                  </button>
                  <button type="button" onClick={() => go('forgot')} className="hover:text-white">
                    Mot de passe oublié ?
                  </button>
                </>
              ) : (
                (mode === 'signup' || mode === 'forgot') && (
                  <button type="button" onClick={() => go('login')} className="hover:text-white">
                    ← Retour à la connexion
                  </button>
                )
              )}
            </div>
          </form>

          <p className="mt-4 text-center text-xs text-mute">Chaque compte a son propre espace : personne d'autre ne voit tes modules ni tes fichiers.</p>
        </div>

        <div className="auth-rise auth-rise-3 hidden pb-12 lg:block">
          <h2 className="mb-10 max-w-md font-display text-3xl leading-tight font-bold">
            Tes modules, <span className="neon-text">à la vitesse de la lumière.</span>
          </h2>
          <AuthIllustration />
        </div>
      </div>
    </div>
  )
}
