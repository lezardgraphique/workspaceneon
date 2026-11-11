import { useMemo, useState } from 'react'
import { AlertTriangle, Braces, CheckCircle2, ChevronDown, Info, Sparkles, Wrench, XCircle } from 'lucide-react'

import { explainIssue, fixCode, validateSyntax } from '@/lib/validator'
import type { PreviewNote } from '@/lib/preview-check'

// Live code validator under the code editor: lists errors and warnings with
// their line and an explanation, jumps to a line on click, repairs what is
// mechanical, adds what the preview shows (empty preview, example items…)
// and can hand everything to Maily to fix.
export function ValidatorPanel({
  code,
  notes = [],
  onFix,
  onJump,
  onAskMaily,
  onReimport,
}: {
  code: string
  notes?: PreviewNote[]
  onFix: (code: string) => void
  onJump: (line: number) => void
  onAskMaily?: (request: string) => void
  onReimport?: () => void
}) {
  const res = useMemo(() => validateSyntax(code), [code])
  const [open, setOpen] = useState(false)
  const fixable = res.issues.filter((i) => i.fixable).length
  const errors = res.errors + notes.filter((n) => n.severity === 'error').length
  const warnings = res.warnings + notes.filter((n) => n.severity === 'warning').length
  const infos = notes.filter((n) => n.severity === 'info').length
  const none = res.issues.length === 0 && notes.length === 0
  const problems = errors + warnings > 0

  const askMaily = () => {
    const lines = [
      ...res.issues.map((i) => `- Ligne ${i.line} (${i.severity === 'error' ? 'erreur' : 'avertissement'}) : ${i.message}`),
      ...notes.filter((n) => n.severity !== 'info').map((n) => `- Aperçu (${n.severity === 'error' ? 'erreur' : 'avertissement'}) : ${n.message}. ${n.help}`),
    ]
    onAskMaily?.(
      `Le validateur signale ces problèmes dans le module ouvert :\n${lines.join('\n')}\n\nExplique-moi chaque problème en une phrase simple, puis corrige le code pour que tout s'affiche correctement dans l'aperçu et dans HubSpot, sans changer ce qui fonctionne déjà.`,
    )
  }

  const label = none
    ? 'Validateur : code correct'
    : !problems
      ? `Validateur : code correct · ${infos} remarque${infos > 1 ? 's' : ''}`
      : `Validateur : ${errors} erreur${errors > 1 ? 's' : ''} · ${warnings} avertissement${warnings > 1 ? 's' : ''}`

  return (
    <div className="border-t border-line bg-night text-xs">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => !none && setOpen((o) => !o)}
          aria-expanded={open}
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-left ${errors ? 'text-pink' : !problems ? 'text-cyan' : 'text-[#ffd166]'}`}
        >
          {errors ? <XCircle className="size-3.5 shrink-0" /> : !problems ? <CheckCircle2 className="size-3.5 shrink-0" /> : <AlertTriangle className="size-3.5 shrink-0" />}
          <span className="truncate font-semibold">{label}</span>
          {!none && <ChevronDown className={`ml-auto size-3.5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />}
        </button>
        {fixable > 0 && (
          <button
            type="button"
            onClick={() => onFix(fixCode(code).code)}
            title="Supprime les fermetures en trop et ajoute celles qui manquent"
            className="inline-flex shrink-0 items-center gap-1 rounded border border-cyan bg-cyan/10 px-2 py-1.5 text-cyan lg:py-1"
          >
            <Wrench className="size-3" /> Corriger ({fixable})
          </button>
        )}
        {problems && onAskMaily && (
          <button
            type="button"
            onClick={askMaily}
            title="Maily explique chaque problème et corrige le code"
            className="inline-flex shrink-0 items-center gap-1 rounded border border-violet bg-violet/10 px-2 py-1.5 text-[#e3a6ff] lg:py-1"
          >
            <Sparkles className="size-3" /> Maily
          </button>
        )}
      </div>
      {open && !none && (
        <ul className="max-h-56 divide-y divide-line overflow-y-auto border-t border-line">
          {notes.map((n, k) => (
            <li key={`n${k}`} className="flex items-start gap-2 px-3 py-1.5">
              {n.severity === 'info' ? (
                <Info className="mt-0.5 size-3 shrink-0 text-cyan" />
              ) : (
                <span className={`mt-1 size-1.5 shrink-0 rounded-full ${n.severity === 'error' ? 'bg-pink' : 'bg-[#ffd166]'}`} />
              )}
              <span className="shrink-0 font-mono text-mute">Aperçu</span>
              <span className="min-w-0">
                <span className="block text-[#d9d9ec]">{n.message}</span>
                <span className="mt-0.5 block text-mute">{n.help}</span>
                {n.action === 'reimport' && onReimport && (
                  <button type="button" onClick={onReimport} className="mt-1 inline-flex items-center gap-1 rounded border border-cyan bg-cyan/10 px-2 py-1 text-cyan">
                    <Braces className="size-3" /> Réimporter
                  </button>
                )}
              </span>
            </li>
          ))}
          {res.issues.map((i, k) => {
            const help = explainIssue(i.message)
            return (
              <li key={k}>
                <button type="button" onClick={() => onJump(i.line)} className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-void">
                  <span className={`mt-1 size-1.5 shrink-0 rounded-full ${i.severity === 'error' ? 'bg-pink' : 'bg-[#ffd166]'}`} />
                  <span className="shrink-0 font-mono text-mute">L{i.line}</span>
                  <span className="min-w-0">
                    <span className="block text-[#d9d9ec]">{i.message}</span>
                    {help && <span className="mt-0.5 block text-mute">{help}</span>}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
