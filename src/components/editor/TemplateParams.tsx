import { useEffect, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'

import { setTemplateParam, templateParams } from '@/lib/template-params'
import type { TemplateParam } from '@/lib/template-params'
import type { RawBlock } from '@/lib/types'

const input = 'w-full rounded-md border border-line bg-void px-2.5 py-2 text-base text-white outline-none focus:border-cyan lg:py-1.5 lg:text-sm'

// « Réglages du modèle »: the values written in a kept template itself (CSS
// variables, data-* settings read by its script), adjusted without the code.
export function TemplateParams({ b, onChange }: { b: RawBlock; onChange: (next: RawBlock) => void }) {
  const params = templateParams(b)
  if (!params.length) return null
  return (
    <div className="rounded-lg border border-line p-3">
      <h3 className="flex items-center gap-1.5 font-display text-sm font-semibold">
        <SlidersHorizontal className="size-4 text-violet" aria-hidden /> Réglages du modèle
      </h3>
      <p className="mb-2 mt-1 text-xs text-mute">
        Valeurs écrites dans le module lui-même (variables de sa CSS, réglages lus par son script) : tailles, espacements, vitesse… Seule la valeur changée est modifiée à l’export.
      </p>
      <div className="grid gap-2">
        {params.map((p) => (
          <Param key={p.kind + p.key} p={p} onSet={(v) => onChange(setTemplateParam(b, p, v))} />
        ))}
      </div>
    </div>
  )
}

function Param({ p, onSet }: { p: TemplateParam; onSet: (v: string) => void }) {
  const [draft, setDraft] = useState(p.value)
  useEffect(() => setDraft(p.value), [p.value])
  const commit = (v: string) => v.trim() && v.trim() !== p.value && onSet(v)
  const num = p.input === 'number' ? parseFloat(p.value) : NaN
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] items-center gap-2">
      <span className="min-w-0 text-xs">
        <span className="block truncate text-white">{p.label}</span>
        <code className="block truncate font-mono text-[10px] text-mute">{p.key}</code>
      </span>
      {p.input === 'number' ? (
        <span className="flex items-center gap-1">
          <input
            type="number"
            step={Math.abs(num) < 5 && !Number.isInteger(num) ? 0.1 : 1}
            className={input}
            value={parseFloat(draft) || 0}
            onChange={(e) => setDraft(`${e.target.value}${p.unit}`)}
            onBlur={(e) => commit(`${e.target.value}${p.unit}`)}
            onKeyDown={(e) => e.key === 'Enter' && commit(`${(e.target as HTMLInputElement).value}${p.unit}`)}
            aria-label={`${p.label} (${p.key})`}
          />
          {p.unit && <span className="shrink-0 font-mono text-[10px] text-mute">{p.unit}</span>}
        </span>
      ) : p.input === 'color' && /^#[0-9a-f]{6}$/i.test(p.value) ? (
        <span className="flex items-center gap-1">
          <input type="color" value={draft.slice(0, 7)} onChange={(e) => setDraft(e.target.value)} onBlur={(e) => commit(e.target.value)} className="size-9 shrink-0 rounded border border-line bg-void" aria-label={`${p.label} (${p.key})`} />
          <span className="truncate font-mono text-[10px] text-mute">{draft}</span>
        </span>
      ) : (
        <input className={input} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={(e) => commit(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)} aria-label={`${p.label} (${p.key})`} />
      )}
    </div>
  )
}
