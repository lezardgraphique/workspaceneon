import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, createFileRoute, useRouteContext } from '@tanstack/react-router'
import { AuthError, login, updateUser } from '@netlify/identity'
import { Bot, Check, Copy, KeyRound, Loader2, Plus, Trash2 } from 'lucide-react'

import { AccountMenu } from '@/components/AccountMenu'
import { AppHeader } from '@/components/AppHeader'
import { SiteSecurity } from '@/components/SiteSecurity'
import { MIN_PASSWORD, checkPassword } from '@/lib/password'
import { createToken, listTokens, revokeToken } from '@/server/api-tokens.functions'
import type { TokenInfo } from '@/server/api-tokens.functions'

export const Route = createFileRoute('/compte')({
  head: () => ({ meta: [{ title: 'Mon compte · Neon Sandbox Pro' }] }),
  component: Compte,
})

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
    const check = checkPassword(next, user?.email ?? '')
    if (!check.ok) return setError(check.reason)
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

          <button type="submit" disabled={busy} className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-pink-fill px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60">
            {busy && <Loader2 className="size-4 animate-spin" />} Enregistrer le nouveau mot de passe
          </button>
        </form>

        <McpTokens />
      </main>
      <SiteSecurity />
    </div>
  )
}

const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })

// « Connexion IA (MCP) »: personal tokens an AI client (Claude…) uses to work
// in this account through /mcp. The address with the token is shown once.
function McpTokens() {
  const [tokens, setTokens] = useState<TokenInfo[] | null>(null)
  const [label, setLabel] = useState('Claude')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fresh, setFresh] = useState<{ url: string; token: string } | null>(null)
  const [copied, setCopied] = useState('')

  useEffect(() => {
    listTokens()
      .then(setTokens)
      .catch(() => setError('Impossible de charger tes connexions pour le moment.'))
  }, [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { token, info } = await createToken({ data: { name: label } })
      setFresh({ url: `${window.location.origin}/mcp/${token}`, token })
      setTokens((t) => [info, ...(t ?? [])])
    } catch (err) {
      setError(err instanceof Error && /au plus/.test(err.message) ? err.message : 'Création impossible pour le moment. Réessaie dans un instant.')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (t: TokenInfo) => {
    if (!confirm(`Révoquer « ${t.name} » ? L'IA qui l'utilise n'aura plus accès à ton compte.`)) return
    try {
      await revokeToken({ data: { id: t.id } })
      setTokens((list) => (list ?? []).filter((x) => x.id !== t.id))
      if (fresh && fresh.token.startsWith(t.prefix)) setFresh(null)
    } catch {
      setError('Révocation impossible pour le moment. Réessaie dans un instant.')
    }
  }

  const copy = async (what: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(''), 2000)
    } catch {
      /* the field stays selectable */
    }
  }

  return (
    <section aria-labelledby="mcp-titre" className="mt-6 space-y-4 rounded-xl border border-line bg-panel/80 p-6">
      <h2 id="mcp-titre" className="flex items-center gap-2 font-display text-lg font-semibold">
        <Bot className="size-5 text-cyan" /> Connexion IA (MCP)
      </h2>
      <p className="text-sm text-mute">
        Branche Neon Sandbox Pro à Claude (ou à une autre IA compatible MCP) : elle pourra lister, lire, créer et modifier tes modules
        et tes blocs, les exporter et tester leur rendu. Elle ne peut rien supprimer.
      </p>

      <form onSubmit={create} className="flex gap-2">
        <label className="min-w-0 flex-1 text-sm">
          <span className="sr-only">Nom de la connexion</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} required placeholder="Nom (ex. Claude)" className={field} />
        </label>
        <button type="submit" disabled={busy} className="inline-flex shrink-0 items-center gap-2 rounded-md bg-pink-fill px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Créer
        </button>
      </form>

      {fresh && (
        <div role="status" className="space-y-3 rounded-md border border-cyan/40 bg-cyan/10 p-3 text-sm">
          <p className="font-semibold text-cyan">Connexion créée. Copie l'adresse maintenant : elle ne sera plus affichée.</p>
          <div className="flex gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">Adresse du serveur MCP</span>
              <input readOnly value={fresh.url} onFocus={(e) => e.currentTarget.select()} className={`${field} font-mono text-xs lg:text-xs`} />
            </label>
            <button type="button" onClick={() => copy('url', fresh.url)} className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-cyan/60 px-3 text-cyan hover:bg-cyan/10">
              {copied === 'url' ? <Check className="size-4" /> : <Copy className="size-4" />} {copied === 'url' ? 'Copié' : 'Copier'}
            </button>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-mute">
            <li>
              Dans Claude : <span className="text-white">Paramètres › Connecteurs › Ajouter un connecteur personnalisé</span>.
            </li>
            <li>Donne-lui un nom (Neon Sandbox Pro) et colle cette adresse comme URL du serveur, sans rien d'autre.</li>
            <li>Demande par exemple : « Liste mes modules Neon » ou « Crée un module témoignage dans Neon ».</li>
          </ol>
          <p className="text-xs text-mute">
            Cette adresse donne accès à ton compte : ne la partage pas. Pour un outil qui accepte un en-tête, utilise plutôt{' '}
            <code className="text-white">{fresh.url.replace(/\/mcp\/.*$/, '/mcp/')}</code> avec <code className="text-white">Authorization: Bearer</code> et le jeton{' '}
            <button type="button" onClick={() => copy('token', fresh.token)} className="text-cyan underline">
              {copied === 'token' ? 'copié' : 'à copier'}
            </button>
            .
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-pink/40 bg-pink/10 px-3 py-2 text-sm text-pink">
          {error}
        </p>
      )}

      {tokens === null ? (
        <p className="flex items-center gap-2 text-sm text-mute">
          <Loader2 className="size-4 animate-spin" /> Chargement…
        </p>
      ) : tokens.length === 0 ? (
        <p className="text-sm text-mute">Aucune connexion pour l'instant.</p>
      ) : (
        <ul className="divide-y divide-line rounded-md border border-line">
          {tokens.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{t.name}</span>
                <span className="block truncate text-xs text-mute">
                  <code>{t.prefix}…</code> · créée le {when(t.createdAt)} · {t.lastUsedAt ? `utilisée le ${when(t.lastUsedAt)}` : 'jamais utilisée'}
                </span>
              </span>
              <button type="button" onClick={() => revoke(t)} aria-label={`Révoquer ${t.name}`} className="rounded-md p-2 text-mute hover:bg-pink/10 hover:text-pink">
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
