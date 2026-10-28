import { useMemo, useState } from 'react'
import { AlertOctagon, AlertTriangle, ArrowLeft, ChevronRight, ImageOff, Info, MailCheck, Monitor, Smartphone, X } from 'lucide-react'

import { EmailFrame } from '@/components/EmailFrame'
import { CLIENTS, auditModule, renderForClient } from '@/lib/clients'
import type { ClientId, EmailClient, Issue } from '@/lib/clients'
import { previewEmail } from '@/lib/hubl'
import type { ModuleTree } from '@/lib/types'

// Litmus-style test: the module as rendered by the main email clients, side by
// side, with the issues each of them will show.

const LEVEL = {
  error: { icon: AlertOctagon, cls: 'text-pink', label: 'Bloquant' },
  warn: { icon: AlertTriangle, cls: 'text-[#ffd479]', label: 'À corriger' },
  info: { icon: Info, cls: 'text-cyan', label: 'Bon à savoir' },
} as const

const clientLabel = (c: EmailClient) => `${c.name} · ${c.platform}`
const byId = Object.fromEntries(CLIENTS.map((c) => [c.id, c])) as Record<ClientId, EmailClient>

function Counts({ issues }: { issues: Issue[] }) {
  const errors = issues.filter((i) => i.level === 'error').length
  const warns = issues.filter((i) => i.level === 'warn').length
  if (!errors && !warns)
    return <span className="rounded-full bg-cyan/15 px-2 py-0.5 text-[10px] font-semibold text-cyan">OK</span>
  return (
    <span className="flex gap-1">
      {errors > 0 && <span className="rounded-full bg-pink/15 px-2 py-0.5 text-[10px] font-semibold text-pink">{errors}</span>}
      {warns > 0 && <span className="rounded-full bg-[#ffd479]/15 px-2 py-0.5 text-[10px] font-semibold text-[#ffd479]">{warns}</span>}
    </span>
  )
}

export function ClientsDialog({
  tree,
  name,
  onClose,
  onSelect,
}: {
  tree: ModuleTree
  name: string
  onClose: () => void
  /** Selects the block concerned by an issue in the editor. */
  onSelect?: (id: string) => void
}) {
  const [imagesOff, setImagesOff] = useState(false)
  const [focus, setFocus] = useState<ClientId | null>(null)

  const page = useMemo(() => previewEmail(tree, name), [tree, name])
  const renders = useMemo(
    () => Object.fromEntries(CLIENTS.map((c) => [c.id, renderForClient(page, c, { imagesOff })])) as Record<ClientId, string>,
    [page, imagesOff],
  )
  const { issues, bytes } = useMemo(() => auditModule(tree, name), [tree, name])
  const issuesFor = (id: ClientId) => issues.filter((i) => i.clients.includes(id))
  const shown = focus ? issuesFor(focus) : issues
  const current = focus ? byId[focus] : null

  return (
    <div role="dialog" aria-modal="true" aria-label="Test clients de messagerie" className="fixed inset-0 z-50 flex flex-col bg-void/97 backdrop-blur-sm">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b border-line bg-space px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <MailCheck className="size-5 text-cyan" />
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-lg leading-tight font-semibold">Test clients de messagerie</h2>
          <p className="truncate text-xs text-mute">Rendu simulé de « {name} » dans {CLIENTS.length} clients</p>
        </div>
        <button
          onClick={() => setImagesOff(!imagesOff)}
          aria-pressed={imagesOff}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm ${
            imagesOff ? 'border-cyan bg-cyan/10 text-cyan' : 'border-line text-mute hover:text-white'
          }`}
        >
          <ImageOff className="size-4" /> Images bloquées
        </button>
        <button onClick={onClose} aria-label="Fermer" className="rounded p-1.5 text-mute hover:bg-white/10 hover:text-white">
          <X className="size-5" />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <main className="neon-grid min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
          {current ? (
            <>
              <div className="mb-4 flex items-center gap-2 overflow-x-auto pb-1">
                <button
                  onClick={() => setFocus(null)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm hover:border-cyan"
                >
                  <ArrowLeft className="size-4" /> Tous les clients
                </button>
                {CLIENTS.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setFocus(c.id)}
                    className={`shrink-0 rounded-full px-3 py-1.5 text-xs whitespace-nowrap ${
                      c.id === focus ? 'bg-pink text-white' : 'border border-line text-mute hover:text-white'
                    }`}
                  >
                    {clientLabel(c)}
                  </button>
                ))}
              </div>
              <div
                className={`mx-auto overflow-hidden border border-line bg-white shadow-[0_20px_60px_-20px_rgba(0,229,255,0.3)] ${
                  current.mobile ? 'rounded-[28px] border-[6px] border-[#2a2a40]' : 'rounded-lg'
                }`}
                style={{ maxWidth: current.width + (current.mobile ? 12 : 2) }}
              >
                <ClientChrome client={current} name={name} />
                <EmailFrame html={renders[current.id]} width={current.width} interactive title={`Rendu ${clientLabel(current)}`} />
              </div>
            </>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {CLIENTS.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setFocus(c.id)}
                  className="group flex flex-col overflow-hidden rounded-xl border border-line bg-night text-left transition hover:-translate-y-0.5 hover:border-pink"
                >
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    {c.mobile ? <Smartphone className="size-4 shrink-0 text-mute" /> : <Monitor className="size-4 shrink-0 text-mute" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{c.name}</span>
                      <span className="block text-[11px] text-mute">{c.platform}</span>
                    </span>
                    <Counts issues={issuesFor(c.id)} />
                    <ChevronRight className="size-4 text-mute transition group-hover:translate-x-0.5 group-hover:text-pink" />
                  </div>
                  <div className={`border-t border-line bg-[#1b1b2c] ${c.mobile ? 'px-10 py-3' : 'p-3'}`}>
                    <div className={`overflow-hidden bg-white ${c.mobile ? 'rounded-xl' : 'rounded'}`}>
                      <EmailFrame html={renders[c.id]} width={c.width} maxHeight={c.mobile ? 780 : 560} title={`Vignette ${clientLabel(c)}`} />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </main>

        <aside className="flex max-h-[45dvh] shrink-0 flex-col border-t border-line bg-space lg:max-h-none lg:w-[360px] lg:border-t-0 lg:border-l">
          <div className="border-b border-line px-4 py-3">
            <h3 className="font-display font-semibold">{current ? `Points à vérifier · ${clientLabel(current)}` : 'Points à vérifier'}</h3>
            <div className="mt-2">
              <div className="flex justify-between text-[11px] text-mute">
                <span>Poids du HTML</span>
                <span className={bytes > 102 * 1024 ? 'text-pink' : ''}>
                  {(bytes / 1024).toFixed(1)} Ko / 102 Ko (limite Gmail)
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line">
                <div
                  className={`h-full rounded-full ${bytes > 102 * 1024 ? 'bg-pink' : 'bg-cyan'}`}
                  style={{ width: `${Math.min(100, (bytes / (102 * 1024)) * 100)}%` }}
                />
              </div>
            </div>
          </div>
          <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {shown.length === 0 && (
              <li className="rounded-lg border border-cyan/40 bg-cyan/5 p-4 text-sm text-cyan">Rien à signaler pour ce client.</li>
            )}
            {shown.map((i) => {
              const L = LEVEL[i.level]
              return (
                <li key={i.key} className="rounded-lg border border-line bg-night p-3">
                  <div className="flex items-start gap-2">
                    <L.icon className={`mt-0.5 size-4 shrink-0 ${L.cls}`} aria-label={L.label} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{i.title}</p>
                      <p className="mt-0.5 text-xs text-mute">{i.detail}</p>
                      <p className="mt-1.5 flex flex-wrap gap-1">
                        {(i.clients.length === CLIENTS.length ? ['Tous les clients'] : i.clients.map((id) => clientLabel(byId[id]))).map((l) => (
                          <span key={l} className="rounded border border-line px-1.5 py-0.5 text-[10px] text-mute">
                            {l}
                          </span>
                        ))}
                      </p>
                      {i.blockId && onSelect && (
                        <button
                          onClick={() => {
                            onSelect(i.blockId!)
                            onClose()
                          }}
                          className="mt-2 text-xs font-semibold text-cyan hover:underline"
                        >
                          Voir l'élément dans l'éditeur
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
            <li className="px-1 pt-1 text-[11px] text-mute">
              Simulation des principales limites de chaque client (moteur Word d'Outlook, CSS filtré, modes sombres). Avant un envoi
              important, envoie-toi un vrai test.
            </li>
          </ul>
        </aside>
      </div>
    </div>
  )
}

// Inbox header above the rendering, to recognise the client at a glance.
function ClientChrome({ client, name }: { client: EmailClient; name: string }) {
  const dark = !!client.dark
  return (
    <div
      className={`flex items-center gap-2.5 border-b px-4 py-2.5 font-sans ${dark ? 'border-[#333] bg-[#1f1f1f] text-[#e8e8e8]' : 'border-[#e6e6ee] bg-[#f7f7fa] text-[#202030]'}`}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#ff007f] text-xs font-bold text-white">N</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className={`block truncate text-xs ${dark ? 'text-[#a0a0a0]' : 'text-[#6a6a80]'}`}>
          Neon Sandbox &lt;bonjour@exemple.fr&gt; · {clientLabel(client)}
        </span>
      </span>
    </div>
  )
}
