import { useMemo, useState } from 'react'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import { Check, Link2, MailCheck, Monitor, Moon, Pencil, Smartphone, Sun } from 'lucide-react'

import { EmailFrame } from '@/components/EmailFrame'
import { NeonLogo } from '@/components/Maily'
import { ClientsDialog } from '@/components/editor/ClientsDialog'
import { CLIENTS, renderForClient } from '@/lib/clients'
import { standaloneEmail } from '@/lib/hubl'
import { getModule } from '@/server/modules.functions'

// Module preview: the exported HTML exactly as it will be sent or published,
// on desktop or mobile, light or dark. Shareable by URL like the editor.
export const Route = createFileRoute('/apercu/$moduleId')({
  loader: async ({ params }) => {
    const mod = await getModule({ data: { id: params.moduleId } }).catch(() => null)
    if (!mod) throw notFound()
    return mod
  },
  head: ({ loaderData }) => ({ meta: [{ title: `Aperçu · ${loaderData?.name ?? 'Module'} · Neon Sandbox Pro` }] }),
  component: ModulePreview,
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <p className="font-display text-2xl">Module introuvable</p>
      <Link to="/" className="text-cyan hover:underline">
        Retour à mes modules
      </Link>
    </div>
  ),
})

const DARK = CLIENTS.find((c) => c.id === 'outlook-com-dark')!

function ModulePreview() {
  const mod = Route.useLoaderData()
  const [mobile, setMobile] = useState(false)
  const [dark, setDark] = useState(false)
  const [testing, setTesting] = useState(false)
  const [copied, setCopied] = useState(false)

  const page = useMemo(() => standaloneEmail(mod.tree, mod.name), [mod])
  // Dark mode needs the DOM (DOMParser): computed on the client only.
  const html = useMemo(
    () => (dark && typeof DOMParser !== 'undefined' ? renderForClient(page, DARK, { imagesOff: false }) : page),
    [page, dark],
  )
  const width = mobile ? 375 : Math.max(mod.tree.width + 120, 760)

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const toggle = (active: boolean) => `rounded p-1.5 ${active ? 'bg-cyan/15 text-cyan' : 'text-mute hover:text-white'}`

  return (
    <div className="flex min-h-dvh flex-col bg-void">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-2 border-b border-line bg-space/95 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur sm:px-4">
        <Link to="/" title="Mes modules" className="rounded-md p-1 hover:bg-white/5">
          <NeonLogo size={28} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan">Aperçu du module</p>
          <h1 className="truncate font-display text-base font-semibold">{mod.name}</h1>
        </div>
        <div className="flex rounded-md border border-line p-0.5">
          <button onClick={() => setMobile(false)} className={toggle(!mobile)} aria-label="Aperçu bureau" title="Bureau">
            <Monitor className="size-4" />
          </button>
          <button onClick={() => setMobile(true)} className={toggle(mobile)} aria-label="Aperçu mobile" title="Mobile">
            <Smartphone className="size-4" />
          </button>
        </div>
        <div className="flex rounded-md border border-line p-0.5">
          <button onClick={() => setDark(false)} className={toggle(!dark)} aria-label="Mode clair" title="Mode clair">
            <Sun className="size-4" />
          </button>
          <button onClick={() => setDark(true)} className={toggle(dark)} aria-label="Mode sombre" title="Mode sombre (simulé)">
            <Moon className="size-4" />
          </button>
        </div>
        <button onClick={copyLink} title="Copier le lien de l'aperçu" className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm hover:border-cyan">
          {copied ? <Check className="size-4 text-cyan" /> : <Link2 className="size-4" />}
          <span className="hidden sm:inline">{copied ? 'Copié' : 'Lien'}</span>
        </button>
        <button onClick={() => setTesting(true)} className="inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-sm hover:border-cyan">
          <MailCheck className="size-4" /> <span className="hidden sm:inline">Clients</span>
        </button>
        <Link
          to="/editor/$moduleId"
          params={{ moduleId: mod.id }}
          className="glow-pink inline-flex items-center gap-1.5 rounded-md bg-pink px-2.5 py-1.5 text-sm font-semibold text-white sm:px-3"
        >
          <Pencil className="size-4" /> <span className="hidden sm:inline">Modifier</span>
        </Link>
      </header>

      <main className="neon-grid flex-1 p-3 sm:p-8">
        <div
          className={`mx-auto overflow-hidden bg-white shadow-[0_0_0_1px_#262642,0_30px_80px_-30px_rgba(188,19,254,0.45)] transition-[max-width] ${
            mobile ? 'rounded-[32px] border-[8px] border-[#22223a]' : 'rounded-xl'
          }`}
          style={{ maxWidth: width + (mobile ? 16 : 0) }}
        >
          <EmailFrame key={`${mobile}`} html={html} width={width} interactive title={`Aperçu de ${mod.name}`} />
        </div>
        <p className="mx-auto mt-4 max-w-xl text-center text-xs text-mute">
          Rendu final du HTML exporté, liens cliquables. Dernière sauvegarde le{' '}
          {new Date(mod.updatedAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}.
        </p>
      </main>

      {testing && <ClientsDialog tree={mod.tree} name={mod.name} onClose={() => setTesting(false)} />}
    </div>
  )
}
