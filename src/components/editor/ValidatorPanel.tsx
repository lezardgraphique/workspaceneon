import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, Wrench, XCircle } from 'lucide-react'

import { fixCode, validateSyntax } from '@/lib/validator'

// Live code validator under the code editor: lists errors and warnings with
// their line, jumps to a line on click and repairs what is mechanical.
export function ValidatorPanel({
  code,
  onFix,
  onJump,
}: {
  code: string
  onFix: (code: string) => void
  onJump: (line: number) => void
}) {
  const res = useMemo(() => validateSyntax(code), [code])
  const [open, setOpen] = useState(false)
  const fixable = res.issues.filter((i) => i.fixable).length
  const none = res.issues.length === 0

  return (
    <div className="border-t border-line bg-night text-xs">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => !none && setOpen((o) => !o)}
          aria-expanded={open}
          className={`flex min-w-0 flex-1 items-center gap-1.5 text-left ${res.errors ? 'text-pink' : none ? 'text-cyan' : 'text-[#ffd166]'}`}
        >
          {res.errors ? <XCircle className="size-3.5 shrink-0" /> : none ? <CheckCircle2 className="size-3.5 shrink-0" /> : <AlertTriangle className="size-3.5 shrink-0" />}
          <span className="truncate font-semibold">
            {none
              ? 'Validateur : code correct'
              : `Validateur : ${res.errors} erreur${res.errors > 1 ? 's' : ''} · ${res.warnings} avertissement${res.warnings > 1 ? 's' : ''}`}
          </span>
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
      </div>
      {open && !none && (
        <ul className="max-h-40 divide-y divide-line overflow-y-auto border-t border-line">
          {res.issues.map((i, k) => (
            <li key={k}>
              <button type="button" onClick={() => onJump(i.line)} className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-void">
                <span className={`mt-0.5 size-1.5 shrink-0 rounded-full ${i.severity === 'error' ? 'bg-pink' : 'bg-[#ffd166]'}`} />
                <span className="shrink-0 font-mono text-mute">L{i.line}</span>
                <span className="text-[#d9d9ec]">{i.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
