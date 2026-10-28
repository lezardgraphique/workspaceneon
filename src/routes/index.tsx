import { useState } from 'react'
import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowRight, Columns3, Code2, Eye, Heart, Layers, Loader2, MailCheck, Sparkles, Trash2, Wand2 } from 'lucide-react'

import { EmailFrame } from '@/components/EmailFrame'
import { Maily, NeonLogo } from '@/components/Maily'
import { previewEmail } from '@/lib/hubl'
import { KOFI_URL } from '@/lib/links'
import { STARTERS } from '@/lib/templates'
import { countBlocks } from '@/lib/tree'
import { createModule, deleteModule, listModules } from '@/server/modules.functions'

export const Route = createFileRoute('/')({
  loader: () => listModules(),
  component: Library,
})

const FEATURES = [
  { icon: Code2, title: 'Sync bidirectionnelle', text: 'Édite le code ou clique dans l\'aperçu : les deux restent alignés, et ton HTML collé devient des blocs modifiables.' },
  { icon: Columns3, title: '1, 2 ou 3 colonnes', text: 'Côte à côte ou empilées sur mobile, au choix pour chaque section.' },
  { icon: Layers, title: 'Cards imbriquées', text: 'Des sections dans des sections, pour les structures les plus riches.' },
  { icon: MailCheck, title: 'Test multi-clients', text: 'Vérifie le rendu dans Outlook, Gmail, Apple Mail et les modes sombres avant l\'envoi.' },
  { icon: Sparkles, title: 'Maily, ton IA', text: 'Génère un module, réécris un texte, demande un conseil marketing.' },
]

function Library() {
  const modules = Route.useLoaderData()
  const navigate = useNavigate()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  const start = async (key: string) => {
    const starter = STARTERS.find((s) => s.key === key)!
    setBusy(key)
    try {
      const mod = await createModule({ data: { name: starter.key === 'blank' ? 'Nouveau module' : starter.name, tree: starter.build() } })
      await navigate({ to: '/editor/$moduleId', params: { moduleId: mod.id } })
    } finally {
      setBusy(null)
    }
  }

  const remove = async (id: string, name: string) => {
    if (!confirm(`Supprimer « ${name} » ? Cette action est définitive.`)) return
    setBusy(id)
    await deleteModule({ data: { id } })
    await router.invalidate()
    setBusy(null)
  }

  return (
    <div className="min-h-screen neon-grid">
      <header className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-5">
        <NeonLogo size={34} />
        <span className="font-display text-lg font-semibold tracking-wide">
          Neon Sandbox <span className="text-pink">Pro</span>
        </span>
        <span className="ml-1 rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-mute">WEB</span>
        <a
          href={KOFI_URL}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-mute hover:border-pink hover:text-white"
        >
          <Heart className="size-4 text-pink" /> <span className="hidden sm:inline">Laisser un commentaire</span>
        </a>
      </header>

      <main className="mx-auto max-w-6xl px-6 pb-24">
        <section className="relative grid items-center gap-10 py-12 md:grid-cols-[1.4fr_1fr] md:py-20">
          <div>
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.25em] text-cyan">Modules email & web · HTML · HuBL</p>
            <h1 className="font-display text-4xl leading-[1.05] font-bold md:text-6xl">
              Construis tes modules email &amp; web <span className="neon-text">à la vitesse de la lumière.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-mute">
              Un éditeur visuel et un éditeur de code synchronisés en temps réel, des layouts responsives et un export prêt
              à intégrer dans tes emails comme sur le web.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={() => start('newsletter')}
                disabled={!!busy}
                className="glow-pink inline-flex items-center gap-2 rounded-lg bg-pink px-5 py-3 font-display font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {busy === 'newsletter' ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                Créer un module
              </button>
              {modules.length > 0 && (
                <a href="#mes-modules" className="inline-flex items-center gap-2 rounded-lg border border-line px-5 py-3 font-display font-semibold hover:border-cyan">
                  Mes modules ({modules.length})
                </a>
              )}
            </div>
          </div>
          <div className="relative mx-auto flex aspect-square w-full max-w-sm items-center justify-center">
            <div className="absolute inset-6 rounded-full bg-violet/25 blur-3xl" />
            <div className="absolute inset-0 rounded-[28%] border border-cyan/20" />
            <Maily size={260} mood="happy" />
            <div className="absolute -bottom-2 left-1/2 w-max -translate-x-1/2 rounded-full border border-line bg-night/90 px-4 py-1.5 text-sm">
              Salut, moi c'est <span className="font-semibold text-cyan">Maily</span> 👋
            </div>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-line bg-night/70 p-5">
              <f.icon className="mb-3 size-5 text-cyan" />
              <h3 className="font-display font-semibold">{f.title}</h3>
              <p className="mt-1 text-sm text-mute">{f.text}</p>
            </div>
          ))}
        </section>

        <section className="mt-20">
          <h2 className="font-display text-2xl font-semibold">Partir d'un modèle</h2>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STARTERS.map((s) => (
              <button
                key={s.key}
                onClick={() => start(s.key)}
                disabled={!!busy}
                className="group rounded-xl border border-line bg-panel/60 p-5 text-left transition hover:-translate-y-0.5 hover:border-pink disabled:opacity-60"
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-semibold">{s.name}</h3>
                  {busy === s.key ? (
                    <Loader2 className="size-4 animate-spin text-pink" />
                  ) : (
                    <ArrowRight className="size-4 text-mute transition group-hover:translate-x-0.5 group-hover:text-pink" />
                  )}
                </div>
                <p className="mt-2 text-sm text-mute">{s.description}</p>
              </button>
            ))}
          </div>
        </section>

        <section id="mes-modules" className="mt-20">
          <h2 className="font-display text-2xl font-semibold">Mes modules</h2>
          {modules.length === 0 ? (
            <div className="mt-5 flex items-center gap-4 rounded-xl border border-dashed border-line p-6 text-mute">
              <Maily size={56} mood="thinking" />
              <p>Aucun module pour l'instant. Choisis un modèle ci-dessus pour commencer.</p>
            </div>
          ) : (
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map((m) => (
                <li key={m.id} className="group flex flex-col overflow-hidden rounded-xl border border-line bg-night/70 transition hover:border-pink">
                  <Link
                    to="/editor/$moduleId"
                    params={{ moduleId: m.id }}
                    aria-label={`Ouvrir ${m.name}`}
                    className="relative block h-56 overflow-hidden border-b border-line bg-white"
                  >
                    <EmailFrame html={previewEmail(m.tree, m.name)} width={m.tree.width + 40} maxHeight={900} title={`Vignette de ${m.name}`} />
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/25 to-transparent" />
                  </Link>
                  <div className="flex items-center gap-2 px-4 py-3">
                    <Link to="/editor/$moduleId" params={{ moduleId: m.id }} className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{m.name}</p>
                      <p className="truncate text-xs text-mute">
                        {countBlocks(m.tree)} éléments · modifié le{' '}
                        {new Date(m.updatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}
                      </p>
                    </Link>
                    <Link
                      to="/apercu/$moduleId"
                      params={{ moduleId: m.id }}
                      title="Aperçu du module"
                      aria-label={`Aperçu de ${m.name}`}
                      className="rounded-md p-2 text-mute hover:bg-cyan/10 hover:text-cyan"
                    >
                      <Eye className="size-4" />
                    </Link>
                    <button
                      onClick={() => remove(m.id, m.name)}
                      disabled={busy === m.id}
                      aria-label={`Supprimer ${m.name}`}
                      className="rounded-md p-2 text-mute hover:bg-pink/10 hover:text-pink"
                    >
                      {busy === m.id ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="mx-auto max-w-6xl px-6 pb-10 text-center text-sm text-mute">
        Un avis, une idée, un coup de pouce ?{' '}
        <a href={KOFI_URL} target="_blank" rel="noreferrer" className="text-pink hover:underline">
          Écris-moi sur Ko-fi
        </a>
      </footer>
    </div>
  )
}
