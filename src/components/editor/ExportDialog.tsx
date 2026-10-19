import { useMemo, useState } from 'react'
import { Check, Copy, Download, X } from 'lucide-react'

import { standaloneEmail, treeToHubSpot } from '@/lib/hubl'
import type { ModuleTree } from '@/lib/types'

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'module'

export function ExportDialog({ tree, name, onClose }: { tree: ModuleTree; name: string; onClose: () => void }) {
  const files = useMemo(
    () => ({ 'page.html': standaloneEmail(tree, name), ...treeToHubSpot(tree, name) }),
    [tree, name],
  )
  const names = Object.keys(files) as (keyof typeof files)[]
  const [active, setActive] = useState<keyof typeof files>('page.html')
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(files[active])
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const download = (file: keyof typeof files) => {
    const blob = new Blob([files[file]], { type: file.endsWith('.json') ? 'application/json' : 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = file === 'page.html' ? `${slug(name)}.html` : file
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Exporter le module"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-line bg-night pb-[env(safe-area-inset-bottom)] shadow-2xl sm:max-h-[90vh] sm:rounded-2xl sm:pb-0"
      >
        <div className="flex items-start gap-3 border-b border-line p-5">
          <div className="flex-1">
            <h2 className="font-display text-xl font-semibold">Exporter le module</h2>
            <p className="mt-1 text-sm text-mute">
              <code className="font-mono text-cyan">page.html</code> contient le rendu complet, prêt pour un email ou une page web.
              Les fichiers <code className="font-mono text-cyan">module.html</code>, <code className="font-mono text-cyan">fields.json</code> et{' '}
              <code className="font-mono text-cyan">meta.json</code> forment un module réutilisable dont les textes, boutons et images
              deviennent des champs éditables.
            </p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded p-1.5 text-mute hover:bg-white/10 hover:text-white">
            <X className="size-5" />
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1 border-b border-line px-3 py-2">
          {names.map((f) => (
            <button
              key={f}
              onClick={() => setActive(f)}
              className={`rounded-md px-3 py-1.5 font-mono text-xs ${active === f ? 'bg-pink text-white' : 'text-mute hover:text-white'}`}
            >
              {f}
            </button>
          ))}
          <span className="flex-1" />
          <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs hover:border-cyan">
            {copied ? <Check className="size-3.5 text-cyan" /> : <Copy className="size-3.5" />} {copied ? 'Copié' : 'Copier'}
          </button>
          <button
            onClick={() => download(active)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-xs hover:border-cyan"
          >
            <Download className="size-3.5" /> Télécharger
          </button>
          <button
            onClick={() => names.forEach((f, i) => setTimeout(() => download(f), i * 250))}
            className="inline-flex items-center gap-1.5 rounded-md bg-pink px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Download className="size-3.5" /> Tout télécharger
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto bg-void p-4 font-mono text-xs leading-relaxed text-[#d9d9ec]">{files[active]}</pre>
      </div>
    </div>
  )
}
