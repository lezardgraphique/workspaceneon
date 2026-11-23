import { useEffect, useRef, useState } from 'react'
import { ChevronDown, FileCode2, Play, X } from 'lucide-react'

import { useEscape } from '@/hooks/use-escape'
import { previewEmail } from '@/lib/hubl'
import type { ModuleTree } from '@/lib/types'

// The module's JavaScript (module.js of a web module): edited below the code,
// exported with the module, and tried out in an isolated window. E-mails never
// run JavaScript, so the e-mail preview never runs it either.
export function ModuleScript({ tree, name, commit, defaultOpen = false }: { tree: ModuleTree; name: string; commit: (t: ModuleTree) => void; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const [text, setText] = useState(tree.js ?? '')
  const [run, setRun] = useState(false)
  useEffect(() => setText(tree.js ?? ''), [tree.js])
  const save = () => {
    if ((tree.js ?? '') !== text) commit({ ...tree, js: text.trim() ? text : '' })
  }
  const lines = tree.js ? tree.js.trim().split('\n').length : 0
  return (
    <div className="shrink-0 border-t border-line bg-night">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-mute hover:text-white"
      >
        <FileCode2 className="size-3.5 text-violet" />
        <span className="flex-1">
          JavaScript du module (module.js, pages web){lines ? ` · ${lines} ligne${lines > 1 ? 's' : ''}` : ' · aucun'}
        </span>
        <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={save}
            spellCheck={false}
            placeholder={'// module.js : exécuté sur les pages web, jamais dans un e-mail.\ndocument.querySelectorAll(".cta").forEach((b) => …)'}
            aria-label="JavaScript du module"
            className="block max-h-[40vh] min-h-28 w-full rounded-md border border-line bg-void px-3 py-2 font-mono text-base text-white outline-none focus:border-cyan lg:text-xs"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!text.trim()}
              onClick={() => {
                save()
                setRun(true)
              }}
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan/60 px-2.5 py-1.5 text-xs font-semibold text-cyan hover:bg-cyan/10 disabled:opacity-40"
            >
              <Play className="size-3.5" /> Tester le JavaScript
            </button>
            <span className="text-[11px] text-mute">Exporté dans module.js. L’aperçu e-mail ne l’exécute pas (aucune messagerie ne le fait).</span>
          </div>
        </div>
      )}
      {run && <ScriptRunner html={previewEmail({ ...tree, js: undefined }, name)} js={text} onClose={() => setRun(false)} />}
    </div>
  )
}

interface Line {
  type: string
  text: string
}

// The module rendered as a web page with its script, in the isolated sandbox
// page (/bac-a-sable: no origin, no network calls, can't touch the app).
function ScriptRunner({ html, js, onClose }: { html: string; js: string; onClose: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [log, setLog] = useState<Line[]>([])
  useEscape(onClose)
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.current?.contentWindow || !e.data?.neonSandbox) return
      if (e.data.type === 'ready') frame.current?.contentWindow?.postMessage({ neonRun: true, html, js }, '*')
      else if (e.data.type !== 'done') setLog((l) => [...l.slice(-199), { type: String(e.data.type), text: String(e.data.text) }])
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [html, js])
  const errors = log.filter((l) => l.type === 'error').length
  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/70 p-0 sm:p-4" onClick={onClose} role="presentation">
      <div role="dialog" aria-modal="true" aria-label="Tester le JavaScript du module" className="flex w-full max-w-5xl flex-col overflow-hidden bg-night sm:rounded-2xl sm:border sm:border-line" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
          <Play className="size-4 text-cyan" />
          <h2 className="flex-1 font-display text-base font-semibold">Test du JavaScript · page web</h2>
          <button onClick={onClose} aria-label="Fermer" className="rounded-md p-1.5 text-mute hover:text-white">
            <X className="size-4" />
          </button>
        </div>
        <iframe ref={frame} title="Module avec son JavaScript" src="/bac-a-sable" sandbox="allow-scripts" className="min-h-0 flex-1 bg-white" />
        <div className="max-h-40 shrink-0 overflow-y-auto border-t border-line bg-void px-3 py-2 font-mono text-[11px]" aria-live="polite">
          <p className={`mb-1 font-sans text-xs ${errors ? 'text-pink' : 'text-cyan'}`}>
            {errors ? `${errors} erreur${errors > 1 ? 's' : ''}` : 'Aucune erreur'} · console du module (fenêtre isolée : pas d’accès à ton compte ni au réseau)
          </p>
          {log.map((l, i) => (
            <p key={i} className={l.type === 'error' ? 'text-pink' : l.type === 'warn' ? 'text-[#fbbf24]' : 'text-[#d9d9ec]'}>
              {l.text}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}
