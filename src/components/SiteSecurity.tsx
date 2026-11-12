import { useEffect, useState } from 'react'
import { Ban, Check, Loader2, RefreshCw, ShieldAlert, ShieldCheck, Sparkles, Undo2, X } from 'lucide-react'

import { analyseNow, blockAddress, decideBlock, securityOverview } from '@/server/security.functions'
import type { BlockInfo, SecurityOverview } from '@/server/security.functions'

// « Sécurité du site » (account page, admin only): what the firewall blocked,
// the AI's daily report, its proposals waiting for a decision, the active
// blocks (lift them) and the journal (block an address from it).

const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
const KIND: Record<string, string> = { ip: 'Adresse', chemin: 'Texte dans l’adresse de page', agent: 'Logiciel' }
const SOURCE: Record<string, string> = { auto: 'pare-feu', ia: 'IA', admin: 'toi' }
const STATUS: Record<string, string> = { leve: 'levé', refuse: 'refusé', expire: 'expiré', actif: 'expiré' }
const PLURAL: Record<string, string> = { attaque: 'Attaques bloquées', abus: 'Abus limités', suspect: 'Requêtes suspectes' }
const SEV: Record<string, { label: string; cls: string }> = {
  attaque: { label: 'Attaque bloquée', cls: 'bg-pink/15 text-pink' },
  abus: { label: 'Abus limité', cls: 'bg-[#ffd166]/15 text-[#ffd166]' },
  suspect: { label: 'Suspect', cls: 'bg-cyan/10 text-cyan' },
}

export function SiteSecurity() {
  const [data, setData] = useState<SecurityOverview | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [showAll, setShowAll] = useState(false)

  const load = () =>
    securityOverview()
      .then(setData)
      .catch(() => setData(null))
  useEffect(() => {
    void load()
  }, [])

  if (!data?.admin) return null

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setError('')
    setBusy(key)
    try {
      await fn()
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action impossible pour le moment.')
    } finally {
      setBusy('')
    }
  }
  const decide = (b: BlockInfo, action: 'activer' | 'refuser' | 'lever') => act(b.id + action, () => decideBlock({ data: { id: b.id, action } }))
  const total = (data.counts.attaque ?? 0) + (data.counts.abus ?? 0) + (data.counts.suspect ?? 0)
  const events = showAll ? data.events : data.events.slice(0, 12)
  const blockedIps = new Set(data.active.filter((b) => b.kind === 'ip').map((b) => b.value))

  return (
    <section aria-labelledby="secu-titre" className="mx-auto mt-2 max-w-4xl px-6 pb-20 max-sm:px-4">
      <div className="space-y-6 rounded-xl border border-line bg-panel/80 p-6 max-sm:p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 id="secu-titre" className="flex items-center gap-2 font-display text-lg font-semibold">
            <ShieldCheck className="size-5 text-cyan" /> Sécurité du site
          </h2>
          <span className="rounded-full bg-cyan/10 px-2 py-0.5 text-xs text-cyan">réservé à toi</span>
          <button
            type="button"
            onClick={() => act('ia', () => analyseNow())}
            disabled={!!busy}
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-violet/60 bg-violet/10 px-3 py-1.5 text-xs font-semibold text-[#e3a6ff] hover:bg-violet/20 disabled:opacity-60"
          >
            {busy === 'ia' ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Analyser maintenant
          </button>
        </div>
        <p className="text-sm text-mute">
          Le pare-feu bloque tout de suite les attaques sans ambiguïté (sondes de fichiers, injections, outils de piratage) et bannit 24 h une
          adresse qui attaque 3 fois en 10 minutes. Chaque jour, l’IA relit le journal : elle bloque elle-même une adresse qui a clairement
          attaqué (7 jours au plus) et te laisse décider du reste ci-dessous. Une personne connectée n’est jamais bloquée par son adresse.
        </p>

        <dl className="grid grid-cols-3 gap-3 text-center max-sm:gap-2">
          {(['attaque', 'abus', 'suspect'] as const).map((s) => (
            <div key={s} className="rounded-lg border border-line bg-void/50 p-3 max-sm:p-2">
              <dt className="text-xs text-mute">{PLURAL[s]} · 24 h</dt>
              <dd className="mt-1 font-display text-2xl font-semibold">{data.counts[s] ?? 0}</dd>
            </div>
          ))}
        </dl>

        {error && (
          <p role="alert" className="rounded-md border border-pink/40 bg-pink/10 px-3 py-2 text-sm text-pink">
            {error}
          </p>
        )}

        <div className="rounded-lg border border-violet/40 bg-violet/5 p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="size-4 text-[#e3a6ff]" /> Dernier rapport de l’IA
            {data.report && <span className="font-normal text-mute">· {when(data.report.at)}</span>}
          </h3>
          <p className="mt-2 text-sm whitespace-pre-line text-[#d9d9ec]">
            {data.report ? data.report.summary : 'Pas encore de rapport : la première analyse a lieu chaque jour automatiquement, ou maintenant avec « Analyser maintenant ».'}
          </p>
          {data.report && (data.report.activated > 0 || data.report.pending > 0) && (
            <p className="mt-2 text-xs text-mute">
              Ce jour-là : {data.report.activated} blocage{data.report.activated > 1 ? 's' : ''} appliqué{data.report.activated > 1 ? 's' : ''} par l’IA, {data.report.pending} proposition
              {data.report.pending > 1 ? 's' : ''} à décider.
            </p>
          )}
          {data.report && data.report.rejected.length > 0 && (
            <details className="mt-2 text-xs text-mute">
              <summary className="cursor-pointer">Propositions de l’IA écartées par les garde-fous ({data.report.rejected.length})</summary>
              <ul className="mt-1 list-disc pl-5">
                {data.report.rejected.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </details>
          )}
        </div>

        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldAlert className="size-4 text-[#ffd166]" /> À décider ({data.pending.length})
          </h3>
          {data.pending.length === 0 ? (
            <p className="mt-1 text-sm text-mute">Rien en attente.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {data.pending.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-void/50 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-mute">
                      {KIND[b.kind] ?? b.kind} · proposé par {SOURCE[b.source] ?? b.source} · {when(b.createdAt)}
                    </span>
                    <span className="block font-mono text-sm break-all">{b.value}</span>
                    <span className="block text-xs text-mute">{b.reason}</span>
                  </span>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => decide(b, 'activer')}
                    className="inline-flex items-center gap-1 rounded-md border border-pink/60 bg-pink/10 px-2.5 py-1.5 text-xs font-semibold text-pink hover:bg-pink/20 disabled:opacity-60"
                  >
                    <Ban className="size-3.5" /> Bloquer 7 jours
                  </button>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => decide(b, 'refuser')}
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-mute hover:text-white disabled:opacity-60"
                  >
                    <X className="size-3.5" /> Ignorer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Ban className="size-4 text-pink" /> Blocages actifs ({data.active.length})
          </h3>
          {data.active.length === 0 ? (
            <p className="mt-1 text-sm text-mute">Aucun blocage en cours.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {data.active.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-void/50 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-mute">
                      {KIND[b.kind] ?? b.kind} · par {SOURCE[b.source] ?? b.source}
                      {b.expiresAt ? ` · jusqu’au ${when(b.expiresAt)}` : ''} · {b.hits} requête{b.hits > 1 ? 's' : ''} refusée{b.hits > 1 ? 's' : ''}
                    </span>
                    <span className="block font-mono text-sm break-all">{b.value}</span>
                    <span className="block text-xs text-mute">{b.reason}</span>
                  </span>
                  <button
                    type="button"
                    disabled={!!busy}
                    onClick={() => decide(b, 'lever')}
                    className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-mute hover:border-cyan hover:text-white disabled:opacity-60"
                  >
                    <Undo2 className="size-3.5" /> Débloquer
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Journal ({total} sur 24 h)</h3>
            <button type="button" onClick={() => void load()} aria-label="Actualiser" className="rounded p-1 text-mute hover:text-white">
              <RefreshCw className="size-3.5" />
            </button>
          </div>
          {data.events.length === 0 ? (
            <p className="mt-1 text-sm text-mute">Rien de suspect pour l’instant.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-lg border border-line text-xs">
              {events.map((e, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
                  <span className={`rounded px-1.5 py-0.5 ${SEV[e.severity]?.cls ?? ''}`}>{SEV[e.severity]?.label ?? e.severity}</span>
                  <span className="text-mute">{when(e.at)}</span>
                  <span className="font-mono">{e.ip}</span>
                  <span className="min-w-0 flex-1 basis-full font-mono break-all text-[#c9c9de] sm:basis-auto">
                    {e.method} {e.path}
                  </span>
                  <span className="text-mute">{e.rule}</span>
                  {e.ip !== data.myIp && !blockedIps.has(e.ip) && e.ip !== 'unknown' && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => act('ip' + e.ip, () => blockAddress({ data: { ip: e.ip, reason: `Bloquée depuis le journal (${e.rule})` } }))}
                      className="ml-auto inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-mute hover:border-pink hover:text-pink disabled:opacity-60"
                    >
                      <Ban className="size-3" /> Bloquer
                    </button>
                  )}
                  {e.ip === data.myIp && <span className="ml-auto text-cyan">ton adresse</span>}
                </li>
              ))}
            </ul>
          )}
          {data.events.length > 12 && (
            <button type="button" onClick={() => setShowAll((s) => !s)} className="mt-2 text-xs text-cyan hover:underline">
              {showAll ? 'Voir moins' : `Voir les ${data.events.length} dernières lignes`}
            </button>
          )}
        </div>

        {data.history.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-mute">Historique (levés, refusés, expirés)</summary>
            <ul className="mt-2 space-y-1 text-xs text-mute">
              {data.history.map((b) => (
                <li key={b.id} className="flex flex-wrap gap-x-2">
                  <Check className="size-3.5 shrink-0" />
                  <span className="font-mono break-all text-[#c9c9de]">{b.value}</span>
                  <span>
                    {KIND[b.kind] ?? b.kind} · {STATUS[b.status] ?? b.status} · {b.reason}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  )
}
