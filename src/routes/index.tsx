import { useEffect, useState } from 'react'
import { Link, createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowRight, BookOpen, ChevronDown, Columns3, Code2, Download, Eye, FolderOpen, Heart, Layers, LayoutTemplate, Loader2, MailCheck, MousePointerClick, Sparkles, Trash2, Wand2, X } from 'lucide-react'

import { AccountMenu } from '@/components/AccountMenu'
import { BackupPanel } from '@/components/BackupPanel'
import { AppHeader, headerButton } from '@/components/AppHeader'
import { EmailFrame } from '@/components/EmailFrame'
import { Maily } from '@/components/Maily'
import { NeonCube } from '@/components/NeonCube'
import { previewEmail } from '@/lib/hubl'
import { KOFI_URL } from '@/lib/links'
import { STARTERS } from '@/lib/templates'
import { countBlocks } from '@/lib/tree'
import { adoptServerList, createLocalFirst, loadModules, removeModule } from '@/lib/data'
import { GUIDE_HIDDEN_KEY } from '@/lib/settings-keys'
import { SETTINGS_EVENT, getPref, setPref } from '@/lib/settings-sync'

export const Route = createFileRoute('/')({
  loader: () => loadModules(),
  component: Library,
})

const FEATURES = [
  { icon: Code2, title: 'Visuel et code liés', text: 'Clique dans l\'aperçu ou écris le code : les deux restent identiques. Un HTML collé devient des blocs que tu modifies à la souris.' },
  { icon: Columns3, title: '1, 2 ou 3 colonnes', text: 'Les colonnes se placent côte à côte sur ordinateur et s\'empilent sur téléphone, section par section.' },
  { icon: Layers, title: 'Cartes imbriquées', text: 'Une carte peut en contenir d\'autres : catalogues, grilles de formations, blocs produits.' },
  { icon: MailCheck, title: 'Test des messageries', text: 'Vois le rendu dans Outlook, Gmail, Apple Mail, en mode sombre ou images bloquées, avant l\'envoi.' },
  { icon: Sparkles, title: 'Maily, ton assistante', text: 'Elle crée un module à partir d\'une phrase ou d\'une capture, réécrit tes textes et te conseille.' },
]

// « Premiers pas »: what a newcomer does, in order, and where it is in the editor.
const STEPS = [
  {
    icon: LayoutTemplate,
    title: 'Pars d\'un modèle ou d\'une idée',
    text: 'Choisis un modèle plus bas, ou décris ton besoin à Maily (« une carte produit avec image, prix et bouton ») : le module s\'ouvre dans l\'éditeur.',
  },
  {
    icon: MousePointerClick,
    title: 'Modifie en cliquant',
    text: 'Au centre, l\'aperçu : clique sur un titre ou un texte pour l\'écrire directement. À droite, les Réglages de l\'élément choisi (couleurs, tailles, liens, images). À gauche, la Structure pour ajouter, déplacer ou supprimer des blocs. Sur téléphone, ces panneaux sont des onglets en bas de l\'écran.',
  },
  {
    icon: MailCheck,
    title: 'Vérifie le rendu',
    text: '« Aperçu » montre la version ordinateur et téléphone, en clair et en sombre. « Clients » simule les messageries et liste ce qui pourrait mal s\'afficher, bloc par bloc.',
  },
  {
    icon: Download,
    title: 'Exporte',
    text: '« Exporter » donne le code du module, ses styles, la liste de ses champs et une page HTML de test, à copier ou télécharger pour ton outil d\'envoi ou ton site.',
  },
]

const FAQ = [
  {
    q: 'C\'est quoi, un module ?',
    a: 'Un morceau d\'e-mail ou de page web prêt à réutiliser : un bandeau, une carte, un bouton, un pied de page… Ses textes, images et liens deviennent des champs que l\'on remplit ensuite à chaque envoi, sans toucher au code.',
  },
  {
    q: 'Faut-il savoir coder ?',
    a: 'Non. Tout se fait en cliquant dans l\'aperçu et dans les Réglages, ou en demandant à Maily. Le code reste visible dans l\'onglet Code pour celles et ceux qui préfèrent l\'écrire : les deux restent synchronisés.',
  },
  {
    q: 'J\'ai déjà un module : comment le reprendre ?',
    a: 'Ouvre un module vide, puis dans l\'onglet Code choisis « Importer » : colle ou dépose ton code et son fichier de champs (fields.json). Les champs sont reconnus et le module devient modifiable comme les autres. Tu peux aussi simplement le coller à Maily.',
  },
  {
    q: 'Où sont enregistrés mes modules ?',
    a: 'Sur ton compte, automatiquement, une seconde après chaque modification. Tu les retrouves sur tous tes appareils, et même sans connexion : ils se synchronisent au retour du réseau. Une sauvegarde complète se télécharge en bas de cette page.',
  },
  {
    q: 'Comment l\'utiliser dans mon outil d\'envoi ?',
    a: '« Exporter » dans l\'éditeur : copie le code du module et de ses styles dans ton outil, et importe le fichier de champs si ton outil en utilise. La page HTML de test sert à vérifier ou à envoyer un essai.',
  },
  {
    q: 'Je suis bloqué·e, que faire ?',
    a: 'Demande à Maily : elle connaît chaque écran et chaque bouton de l\'application, et peut lancer des tests internes pour vérifier que tout fonctionne. Tu peux aussi m\'écrire via « Laisser un commentaire ».',
  },
]

function Library() {
  const loaded = Route.useLoaderData()
  const [overlay, setOverlay] = useState<typeof loaded | null>(null)
  const modules = overlay ?? loaded
  useEffect(() => {
    setOverlay(null)
    void adoptServerList(loaded).then(setOverlay)
  }, [loaded])
  const navigate = useNavigate()
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // « Premiers pas »: shown until hidden (choice kept on the account). Undecided
  // until the page runs in the browser, so a hidden guide never flashes.
  const [guide, setGuide] = useState<boolean | null>(null)
  useEffect(() => {
    const read = () => setGuide(getPref(GUIDE_HIDDEN_KEY) !== '1')
    read()
    window.addEventListener(SETTINGS_EVENT, read)
    return () => window.removeEventListener(SETTINGS_EVENT, read)
  }, [])
  const showGuide = (on: boolean) => {
    setPref(GUIDE_HIDDEN_KEY, on ? null : '1')
    setGuide(on)
    if (on) requestAnimationFrame(() => document.getElementById('premiers-pas')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const start = async (key: string, withMaily = false) => {
    const starter = STARTERS.find((s) => s.key === key)!
    setBusy(key)
    setError(null)
    try {
      const mod = await createLocalFirst(starter.key === 'blank' ? 'Nouveau module' : starter.name, starter.build())
      await navigate({ to: '/editor/$moduleId', params: { moduleId: mod.id }, search: withMaily ? { maily: 1 } : {} })
    } catch {
      setError('Impossible de créer le module pour le moment. Vérifie ta connexion puis réessaie.')
    } finally {
      setBusy(null)
    }
  }

  // « Nouveau module » from the home-screen widget or the app icon's shortcut menu.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get('action') !== 'nouveau') return
    window.history.replaceState(null, '', '/')
    void start('blank')
  }, [])

  const remove = async (id: string, name: string) => {
    if (!confirm(`Supprimer « ${name} » ? Cette action est définitive.`)) return
    setBusy(id)
    try {
      await removeModule(id)
      await router.invalidate()
    } catch {
      setError('Suppression impossible pour le moment. Réessaie dans un instant.')
    }
    setBusy(null)
  }

  return (
    <div className="min-h-screen neon-grid">
      <AppHeader web>
        <Link to="/fichiers" aria-label="Fichiers" className={`${headerButton} hover:border-cyan hover:text-white`}>
          <FolderOpen className="size-4 text-cyan" /> <span className="hidden sm:inline">Fichiers</span>
        </Link>
        <a
          href={KOFI_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Laisser un commentaire"
          className={`${headerButton} hover:border-pink hover:text-white`}
        >
          <Heart className="size-4 text-pink" /> <span className="hidden sm:inline">Laisser un commentaire</span>
        </a>
        <AccountMenu />
      </AppHeader>

      <main className="mx-auto max-w-6xl px-6 pb-24">
        <section className="relative grid items-center gap-10 py-12 max-md:overflow-x-clip md:grid-cols-[1.4fr_1fr] md:py-20">
          <div>
            <p className="mb-4 font-mono text-xs uppercase tracking-[0.25em] text-cyan">Modules email & web · HTML · HuBL</p>
            <h1 className="font-display text-4xl leading-[1.05] font-bold md:text-6xl">
              Construis tes modules email &amp; web <span className="neon-text">à la vitesse de la lumière.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-mute">
              Un <strong className="font-semibold text-white">module</strong>, c'est un morceau d'e-mail ou de page web prêt à
              réutiliser : bandeau, carte produit, bouton, pied de page. Ici, tu le construis en cliquant dans l'aperçu ou en
              écrivant le code, les deux restent synchronisés, puis tu l'exportes vers ton outil d'envoi ou ton site.
            </p>
            <p className="mt-3 max-w-xl text-sm text-mute">Pas besoin de savoir coder : Maily, ton assistante, peut tout faire avec toi.</p>
            {error && (
              <p role="alert" className="mt-6 max-w-xl rounded-lg border border-pink/50 bg-pink/10 px-4 py-3 text-sm text-pink">
                {error}
              </p>
            )}
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                onClick={() => start('newsletter')}
                disabled={!!busy}
                className="glow-pink inline-flex items-center gap-2 rounded-lg bg-pink-fill px-5 py-3 font-display font-semibold text-white transition hover:brightness-110 disabled:opacity-60"
              >
                {busy === 'newsletter' ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
                Créer un module
              </button>
              <button
                onClick={() => start('blank', true)}
                disabled={!!busy}
                className="inline-flex items-center gap-2 rounded-lg border border-cyan/60 px-5 py-3 font-display font-semibold text-cyan transition hover:bg-cyan/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan disabled:opacity-60"
              >
                {busy === 'blank' ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                Parler à Maily
              </button>
              {/* On a phone the guide and « Mes modules » share one row. */}
              {(guide === false || modules.length > 0) && (
                <div className="flex gap-3 max-sm:w-full sm:contents">
                  {guide === false && (
                    <button
                      type="button"
                      onClick={() => showGuide(true)}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-5 py-3 font-display font-semibold hover:border-cyan max-sm:min-w-0 max-sm:flex-1 max-sm:px-3 max-sm:text-sm"
                    >
                      <BookOpen className="size-4 shrink-0 text-cyan" /> <span className="truncate">Guide de démarrage</span>
                    </button>
                  )}
                  {modules.length > 0 && (
                    <a
                      href="#mes-modules"
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-line px-5 py-3 font-display font-semibold whitespace-nowrap hover:border-cyan max-sm:shrink-0 max-sm:px-3 max-sm:text-sm"
                    >
                      Mes modules ({modules.length})
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="relative mx-auto flex aspect-square w-full max-w-sm items-center justify-center">
            <div className="absolute inset-6 rounded-full bg-violet/25 blur-3xl max-md:opacity-50" />
            <NeonCube className="neon-home" />
            <button
              type="button"
              onClick={() => start('blank', true)}
              disabled={!!busy}
              aria-label="Parler à Maily : crée un module vide et ouvre son chat"
              className="relative rounded-[28%] transition hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan active:scale-95 disabled:opacity-60 motion-reduce:transition-none motion-reduce:hover:scale-100"
            >
              <Maily size={260} mood="happy" decorative />
            </button>
            <p className="absolute -bottom-2 left-1/2 w-max max-w-full -translate-x-1/2 rounded-full border border-line bg-night/90 px-4 py-1.5 text-sm">
              Salut, moi c'est <span className="font-semibold text-cyan">Maily</span> 👋 <span className="text-mute">Touche-moi pour discuter</span>
            </p>
          </div>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-xl border border-line bg-night/70 p-5">
              <f.icon className="mb-3 size-5 text-cyan" />
              <h2 className="font-display font-semibold">{f.title}</h2>
              <p className="mt-1 text-sm text-mute">{f.text}</p>
            </div>
          ))}
        </section>

        {guide && (
          <section id="premiers-pas" aria-labelledby="premiers-pas-titre" className="mt-20 scroll-mt-24">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.25em] text-cyan">Nouveau ici ?</p>
                <h2 id="premiers-pas-titre" className="mt-2 font-display text-2xl font-semibold">
                  Premiers pas, en 4 étapes
                </h2>
              </div>
              <button
                type="button"
                onClick={() => showGuide(false)}
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-mute hover:text-white"
              >
                <X className="size-4" /> Masquer le guide
              </button>
            </div>
            <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((step, i) => (
                <li key={step.title} className="relative rounded-xl border border-line bg-night/70 p-5">
                  <span className="flex items-center gap-3">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-pink-fill font-display text-sm font-bold text-white">
                      {i + 1}
                    </span>
                    <step.icon className="size-5 text-cyan" aria-hidden />
                  </span>
                  <h3 className="mt-3 font-display font-semibold">{step.title}</h3>
                  <p className="mt-1 text-sm text-mute">{step.text}</p>
                </li>
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
              <button
                type="button"
                onClick={() => start('newsletter')}
                disabled={!!busy}
                className="inline-flex items-center gap-2 rounded-lg border border-pink/60 px-4 py-2 font-semibold text-pink hover:bg-pink/10 disabled:opacity-60"
              >
                <Wand2 className="size-4" /> Essayer avec un exemple
              </button>
              <span className="text-mute">Rien n'est perdu : chaque modification s'enregistre seule, et « Annuler » revient en arrière.</span>
            </div>

            <h3 className="mt-10 font-display text-lg font-semibold">Questions fréquentes</h3>
            <div className="mt-3 divide-y divide-line rounded-xl border border-line bg-night/70">
              {FAQ.map((f) => (
                <details key={f.q} className="group px-5 py-1">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 font-semibold [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <ChevronDown className="size-4 shrink-0 text-mute transition group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                  </summary>
                  <p className="pb-4 text-sm text-mute">{f.a}</p>
                </details>
              ))}
            </div>
          </section>
        )}

        <section className="mt-20">
          <h2 className="font-display text-2xl font-semibold">Partir d'un modèle</h2>
          <p className="mt-2 text-sm text-mute">Un clic crée une copie à ton nom et l'ouvre dans l'éditeur : tout se modifie ensuite.</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STARTERS.map((s) => (
              <button
                key={s.key}
                onClick={() => start(s.key)}
                disabled={!!busy}
                className="group rounded-xl border border-line bg-panel/60 p-5 text-left transition hover:-translate-y-0.5 hover:border-pink disabled:opacity-60"
              >
                <span className="flex items-center justify-between">
                  <span className="font-display font-semibold">{s.name}</span>
                  {busy === s.key ? (
                    <Loader2 className="size-4 animate-spin text-pink" />
                  ) : (
                    <ArrowRight className="size-4 text-mute transition group-hover:translate-x-0.5 group-hover:text-pink" />
                  )}
                </span>
                <span className="mt-2 block text-sm text-mute">{s.description}</span>
              </button>
            ))}
          </div>
        </section>

        <section id="mes-modules" className="mt-20 scroll-mt-24">
          <h2 className="font-display text-2xl font-semibold">Mes modules</h2>
          {modules.length === 0 ? (
            <div className="mt-5 flex items-center gap-4 rounded-xl border border-dashed border-line p-6 text-mute">
              <Maily size={56} mood="thinking" decorative />
              <p>
                Aucun module pour l'instant. Choisis un modèle ci-dessus, ou touche « Parler à Maily » et décris ce que tu
                veux : ton premier module apparaîtra ici, enregistré sur ton compte.
              </p>
            </div>
          ) : (
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map((m) => (
                <li key={m.id} className="group flex flex-col overflow-hidden rounded-xl border border-line bg-night/70 transition hover:border-pink">
                  {/* The thumbnail (an iframe) sits beside the link covering it: an iframe may not be inside a link. */}
                  <div className="relative block h-56 overflow-hidden border-b border-line bg-white">
                    <div aria-hidden>
                      <EmailFrame html={previewEmail(m.tree, m.name)} width={m.tree.width + 40} maxHeight={900} title={`Vignette de ${m.name}`} />
                    </div>
                    <span className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-black/25 to-transparent" />
                    <Link to="/editor/$moduleId" params={{ moduleId: m.id }} aria-label={`Ouvrir ${m.name}`} tabIndex={-1} className="absolute inset-0" />
                  </div>
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

        <BackupPanel />
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
