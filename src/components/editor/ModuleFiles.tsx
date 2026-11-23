import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Check, RefreshCw } from 'lucide-react'

import { CodeEditor } from './CodeEditor'
import { ModuleScript } from './ModuleScript'
import { ValidatorPanel } from './ValidatorPanel'
import { formatCss, formatTemplate } from '@/lib/code-format'
import { verbatimBlock } from '@/lib/hubl'
import { keptTemplate } from '@/lib/template-params'
import { updateNode } from '@/lib/tree'
import type { ModuleTree } from '@/lib/types'

type File = 'html' | 'css' | 'js' | 'tool'

const TABS: [File, string][] = [
  ['html', 'module.html'],
  ['css', 'module.css'],
  ['js', 'module.js'],
  ['tool', 'Code de l’outil'],
]

// Code tab of a module kept as written (an imported module): its own files in
// the order the platform uses them — module.html, module.css, module.js —
// each editable and reformatted on demand; the tool's own code stays one tab away.
export function ModuleFiles({
  tree,
  name,
  commit,
  tool,
  onAskMaily,
  onReimport,
}: {
  tree: ModuleTree
  name: string
  commit: (t: ModuleTree) => void
  tool: ReactNode
  onAskMaily?: (request: string) => void
  onReimport?: () => void
}) {
  const kept = keptTemplate(tree)!
  const [file, setFile] = useState<File>('html')
  const [html, setHtml] = useState(kept.source ?? '')
  const [css, setCss] = useState(kept.sourceCss ?? '')
  const [jump, setJump] = useState<{ line: number; n: number } | undefined>()
  const [note, setNote] = useState('')
  // Typed text waits a little before reaching the module (the preview follows).
  const typing = useRef(false)
  useEffect(() => {
    if (typing.current) return
    setHtml(kept.source ?? '')
    setCss(kept.sourceCss ?? '')
  }, [kept.source, kept.sourceCss])
  const apply = (nextHtml: string, nextCss: string) => {
    const v = verbatimBlock(nextHtml, kept.cols, nextCss.trim() ? nextCss : undefined)
    commit(updateNode(tree, kept.id, { html: v.html, css: v.css, source: v.source, sourceCss: v.sourceCss } as never))
  }
  useEffect(() => {
    if (!typing.current) return
    const t = setTimeout(() => {
      typing.current = false
      if (html !== (kept.source ?? '') || css !== (kept.sourceCss ?? '')) apply(html, css)
    }, 450)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, css])
  useEffect(() => {
    if (!note) return
    const t = setTimeout(() => setNote(''), 2500)
    return () => clearTimeout(t)
  }, [note])

  const reformat = () => {
    if (file === 'html') {
      const f = formatTemplate(html)
      setHtml(f)
      apply(f, css)
    } else if (file === 'css') {
      const f = formatCss(css)
      setCss(f)
      apply(html, f)
    }
    setNote('Remis en forme : seuls les espaces et les retours à la ligne ont changé.')
  }

  return (
    <>
      <div role="tablist" aria-label="Fichiers du module" className="flex items-center gap-1 overflow-x-auto border-b border-line px-2 py-1.5">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            id={`file-tab-${id}`}
            aria-selected={file === id}
            aria-controls="file-panel"
            onClick={() => setFile(id)}
            className={`shrink-0 rounded-md px-2.5 py-1 font-mono text-xs ${file === id ? 'bg-pink-fill text-white' : 'text-mute hover:text-white'} ${id === 'tool' ? 'ml-auto font-sans' : ''}`}
          >
            {label}
            {id === 'js' && !tree.js && <span className="text-[10px] opacity-70"> · vide</span>}
          </button>
        ))}
      </div>
      <div id="file-panel" role="tabpanel" aria-labelledby={`file-tab-${file}`} className="flex min-h-0 flex-1 flex-col">
        {file === 'tool' ? (
          tool
        ) : file === 'js' ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ModuleScript tree={tree} name={name} commit={commit} defaultOpen />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs">
              <span role="status" className="flex min-w-0 flex-1 items-center gap-1.5 text-cyan">
                <Check className="size-3.5 shrink-0" />
                <span className="truncate">{note || (file === 'html' ? 'Code du module, exporté tel quel' : 'CSS du module, exportée telle quelle')}</span>
              </span>
              <button
                type="button"
                onClick={reformat}
                title="Remettre en forme (indentation, une règle par bloc) sans rien changer d’autre"
                className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-2 py-1.5 text-mute hover:border-cyan hover:text-white lg:py-1"
              >
                <RefreshCw className="size-3" /> Reformater
              </button>
            </div>
            {file === 'html' ? (
              <>
                <CodeEditor
                  value={html}
                  onChange={(v) => {
                    typing.current = true
                    setHtml(v)
                  }}
                  jump={jump}
                />
                <ValidatorPanel
                  code={html}
                  onFix={(v) => {
                    setHtml(v)
                    apply(v, css)
                  }}
                  onJump={(line) => setJump((j) => ({ line, n: (j?.n ?? 0) + 1 }))}
                  onAskMaily={onAskMaily}
                  onReimport={onReimport}
                />
              </>
            ) : (
              <CodeEditor
                value={css}
                onChange={(v) => {
                  typing.current = true
                  setCss(v)
                }}
              />
            )}
          </>
        )}
      </div>
    </>
  )
}
