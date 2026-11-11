import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { acceptInvite, getUser, handleAuthCallback, login, refreshSession, requestPasswordRecovery, signup, updateUser } from '@netlify/identity'
import { ArrowRight, Loader2, LogIn } from 'lucide-react'

import { AuthIllustration } from '@/components/AuthIllustration'
import { Maily, NeonLogo } from '@/components/Maily'
import { NeonCube } from '@/components/NeonCube'
import { MIN_PASSWORD, checkPassword, leakCount } from '@/lib/password'
import { getSession } from '@/server/session.functions'

export const Route = createFileRoute('/connexion')({
  head: () => ({ meta: [{ title: 'Connexion · Neon Sandbox Pro' }] }),
  component: Connexion,
})

type Mode = 'login' | 'signup' | 'forgot' | 'reset' | 'invite'


// HTTP status of an Identity error. In the browser the library wraps GoTrue's
// error without its status: it is on `cause`.
function statusOf(err: unknown): number | undefined {
  const e = err as { status?: number; cause?: { status?: number } } | null
  return e?.status ?? e?.cause?.status
}

// Netlify's messages come in English; the common cases are translated.
function message(err: unknown): string {
  if (statusOf(err) === 429) return 'Trop de tentatives, réessaie dans un instant.'
  const raw = err instanceof Error ? err.message.toLowerCase() : ''
  if (raw.includes('invalid') && (raw.includes('grant') || raw.includes('credential') || raw.includes('password'))) return 'E-mail ou mot de passe incorrect.'
  if (raw.includes('not confirmed') || raw.includes('confirm')) return 'Confirme ton adresse avec le lien reçu par e-mail avant de te connecter.'
  if (raw.includes('already') || raw.includes('registered') || raw.includes('exists')) return 'Un compte existe déjà avec cette adresse.'
  if (raw.includes('signup') && raw.includes('disabled')) return 'Les inscriptions sont fermées : demande une invitation.'
  if (raw.includes('weak') || raw.includes('password')) return `Mot de passe refusé : choisis-en un plus long (${MIN_PASSWORD} caractères minimum).`
  if (raw.includes('expired') || raw.includes('token')) return 'Ce lien a expiré : recommence la demande.'
  return 'Opération impossible pour le moment. Réessaie dans un instant.'
}

// Repeated wrong passwords on this device: from the 5th failure, wait 30 s,
// then twice as long each time (15 min at most). Netlify Identity limits
// attempts on its side too; this stops a guessing script run in the page and
// tells the person why nothing happens.
const FAILS = 'nsp-login-fails'
function lockedFor(): number {
  try {
    const { until = 0 } = JSON.parse(localStorage.getItem(FAILS) ?? '{}') as { until?: number }
    return Math.max(0, Math.ceil((until - Date.now()) / 1000))
  } catch {
    return 0
  }
}
function noteFailure() {
  try {
    const { n = 0 } = JSON.parse(localStorage.getItem(FAILS) ?? '{}') as { n?: number }
    const count = n + 1
    const until = count >= 5 ? Date.now() + Math.min(30_000 * 2 ** (count - 5), 15 * 60_000) : 0
    localStorage.setItem(FAILS, JSON.stringify({ n: count, until }))
  } catch {
    /* private mode: Identity's own limit still applies */
  }
}
function clearFailures() {
  try {
    localStorage.removeItem(FAILS)
  } catch {
    /* nothing to clear */
  }
}
const wait = (s: number) => (s >= 60 ? `${Math.ceil(s / 60)} min` : `${s} s`)

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
  // Phones and tablets first see the presentation (the side shown next to the
  // form on wide screens), then slide to the form. 'leaving' = transition running.
  const [intro, setIntro] = useState<'on' | 'leaving' | 'off'>('on')
  const enter = (m: Mode) => {
    setMode(m)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return setIntro('off')
    setIntro('leaving')
    window.setTimeout(() => setIntro('off'), 380)
  }

  // The sign-in screen never scrolls: lock the page behind it.
  useEffect(() => {
    const els = [document.documentElement, document.body]
    const prev = els.map((e) => e.style.overflow)
    els.forEach((e) => (e.style.overflow = 'hidden'))
    return () => els.forEach((e, i) => (e.style.overflow = prev[i]))
  }, [])

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
        // The token stays out of the address bar and the history.
        history.replaceState(null, '', location.pathname)
        if (res.type === 'recovery') {
          setIntro('off')
          setMode('reset')
          setInfo('Choisis ton nouveau mot de passe.')
        } else if (res.type === 'invite') {
          setInviteToken(res.token ?? '')
          setIntro('off')
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
    const fresh = mode === 'signup' || mode === 'reset' || mode === 'invite'
    if (fresh) {
      const check = checkPassword(password, email)
      if (!check.ok) return setError(check.reason)
    }
    if (mode === 'login' && lockedFor()) return setError(`Trop d'essais : réessaie dans ${wait(lockedFor())}.`)
    setBusy(true)
    try {
      if (fresh) {
        // Known leaks: refused (the check gives up after 4 s or offline).
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 4000)
        const leaks = await leakCount(password, ctl.signal)
        clearTimeout(timer)
        if (leaks) {
          setError(`Ce mot de passe figure dans ${leaks.toLocaleString('fr-FR')} fuite${leaks > 1 ? 's' : ''} de données connue${leaks > 1 ? 's' : ''} : choisis-en un autre.`)
          return
        }
      }
      if (mode === 'login') {
        try {
          await login(email.trim(), password)
        } catch (err) {
          // Only a refused password counts (not a network error or the server's own limit).
          const status = statusOf(err)
          if (status === 400 || status === 401) noteFailure()
          throw err
        }
        clearFailures()
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
        // Same answer whether the address has an account or not (no way to test addresses).
        try {
          await requestPasswordRecovery(email.trim())
        } catch (err) {
          if (statusOf(err) === 429) throw err
        }
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
    <main className="neon-grid fixed inset-0 overflow-hidden overscroll-none">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <span className="auth-tile left-[6%] top-[8%] size-14" style={{ '--tile': '#ff007f', '--r': '-8deg' } as React.CSSProperties} />
        <span className="auth-tile right-[8%] top-[14%] h-10 w-20" style={{ '--tile': '#00e5ff', '--r': '6deg', animationDelay: '1.2s' } as React.CSSProperties} />
        <span className="auth-tile bottom-[10%] left-[10%] h-12 w-24" style={{ '--tile': '#bc13fe', '--r': '5deg', animationDelay: '2.4s' } as React.CSSProperties} />
        <span className="auth-tile bottom-[16%] right-[6%] size-16" style={{ '--tile': '#ff007f', '--r': '-4deg', animationDelay: '0.6s' } as React.CSSProperties} />
        <div className="neon-auth-floor-wrap lg:hidden">
          <NeonCube className="neon-auth-floor" />
        </div>
      </div>
      <div className="relative mx-auto grid h-full max-w-6xl items-center gap-6 px-4 py-4 lg:grid-cols-[1fr_1.1fr] lg:gap-16 lg:px-8">
        {intro !== 'off' && (
          <div
            className={`relative mx-auto flex h-full w-full max-w-md flex-col justify-center gap-6 lg:hidden [@media(max-height:500px)]:max-w-3xl [@media(max-height:500px)]:flex-row [@media(max-height:500px)]:items-center ${intro === 'leaving' ? 'auth-intro-out' : ''}`}
          >
            <div className="auth-rise [@media(max-height:500px)]:w-[44%] [@media(max-height:500px)]:shrink-0">
              <div className="mb-4 flex items-center gap-3 [@media(max-height:600px)]:mb-2">
                <NeonLogo size={30} />
                <span className="font-display text-base font-semibold tracking-wide">
                  Neon Sandbox <span className="text-pink">Pro</span>
                </span>
              </div>
              <h1 className="font-display text-[1.75rem] leading-tight font-bold [@media(max-height:600px)]:text-2xl">
                Tes modules, <span className="neon-text">à la vitesse de la lumière.</span>
              </h1>
              <div className="mt-5 hidden gap-2 [@media(max-height:500px)]:grid">
                <IntroButtons onEnter={enter} />
              </div>
            </div>
            <div className="auth-rise auth-rise-2 auth-intro-art px-3 pb-14 [@media(max-height:500px)]:min-w-0 [@media(max-height:500px)]:flex-1">
              <AuthIllustration />
            </div>
            <div className="auth-rise auth-rise-3 grid gap-2 [@media(max-height:500px)]:hidden">
              <IntroButtons onEnter={enter} />
            </div>
          </div>
        )}

        <div className={`auth-rise mx-auto w-full max-w-sm ${intro === 'off' ? 'auth-form-in' : 'max-lg:hidden'}`}>
          <div className="mb-3 flex items-center justify-center gap-3 [@media(max-height:600px)]:hidden">
            <NeonLogo size={34} />
            <span className="font-display text-lg font-semibold tracking-wide">
              Neon Sandbox <span className="text-pink">Pro</span>
            </span>
          </div>
          <div className="mb-3 flex justify-center lg:hidden [@media(max-height:740px)]:hidden" aria-hidden="true">
            <Maily size={96} mood="happy" />
          </div>

          <form onSubmit={submit} className="auth-card auth-rise auth-rise-2 space-y-3 p-5 [@media(max-height:600px)]:space-y-2 [@media(max-height:600px)]:p-4 sm:space-y-4 sm:p-6">
            <h1 className="font-display text-xl font-bold">{title}</h1>

            {needsEmail && (
              <label className="block text-sm">
                <span className="mb-1 block text-mute">Adresse e-mail</span>
                <input type="email" name="email" id="email" required autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
              </label>
            )}
            {needsPassword && (
              <label className="block text-sm">
                <span className="mb-1 block text-mute">{mode === 'login' ? 'Mot de passe' : `Nouveau mot de passe (${MIN_PASSWORD} caractères minimum)`}</span>
                <input
                  type="password"
                  name="password"
                  id="password"
                  required
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  maxLength={128}
                  aria-describedby={mode === 'login' ? undefined : 'password-meter'}
                  className={field}
                />
              </label>
            )}
            {needsPassword && mode !== 'login' && <PasswordMeter id="password-meter" password={password} email={email} />}

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
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-pink-fill px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
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

          <p className="mt-3 text-center text-xs text-mute">Chaque compte a son propre espace : personne d'autre ne voit tes modules ni tes fichiers.</p>
        </div>

        <div className="auth-rise auth-rise-3 relative isolate hidden lg:block">
          <NeonCube className="neon-auth-side -z-10" />
          <h2 className="mb-10 max-w-md font-display text-3xl leading-tight font-bold">
            Tes modules, <span className="neon-text">à la vitesse de la lumière.</span>
          </h2>
          <AuthIllustration />
        </div>
      </div>
    </main>
  )
}

function IntroButtons({ onEnter }: { onEnter: (m: Mode) => void }) {
  return (
    <>
      <button
        type="button"
        onClick={() => onEnter('login')}
        className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-pink-fill px-4 py-3 text-sm font-semibold text-white hover:brightness-110"
      >
        Se connecter <ArrowRight className="size-4" />
      </button>
      <button type="button" onClick={() => onEnter('signup')} className="w-full rounded-md border border-line bg-void/80 px-4 py-2.5 text-sm text-mute hover:border-cyan hover:text-white">
        Créer un compte
      </button>
    </>
  )
}

const LEVELS = ['Très faible', 'Faible', 'Correct', 'Bon', 'Excellent']
const COLORS = ['bg-pink-fill', 'bg-pink-fill', 'bg-violet', 'bg-cyan', 'bg-cyan']

function PasswordMeter({ id, password, email }: { id: string; password: string; email: string }) {
  const check = checkPassword(password, email)
  const level = password ? check.score : -1
  return (
    <div id={id} className="-mt-1 text-xs text-mute" aria-live="polite">
      <div className="mb-1 flex gap-1" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${i <= level ? COLORS[Math.max(level, 0)] : 'bg-line'}`} />
        ))}
      </div>
      {password
        ? check.ok
          ? `Solidité : ${LEVELS[check.score]}.`
          : check.reason
        : 'Une phrase de quelques mots est plus sûre et plus facile à retenir. Vérifié contre les fuites de données connues.'}
    </div>
  )
}
