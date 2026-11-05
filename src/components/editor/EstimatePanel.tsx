import { useState } from 'react'
import { Lightbulb, MousePointerClick, MailOpen, TrendingDown, TrendingUp, Minus } from 'lucide-react'

import { DEFAULT_SECTOR, SECTORS, estimateBlock, estimateModule } from '@/lib/estimate'
import type { Estimate, Sector } from '@/lib/estimate'
import type { Block, ModuleTree } from '@/lib/types'

const KEY = 'nsp-sector'
const read = (): Sector => {
  try {
    const v = localStorage.getItem(KEY)
    if (v && v in SECTORS) return v as Sector
  } catch {
    /* private mode */
  }
  return DEFAULT_SECTOR
}

const pct = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`

function Card({ e }: { e: Estimate }) {
  const Icon = e.kind === 'click' ? MousePointerClick : MailOpen
  const ratio = e.baseline ? e.value / e.baseline : 0
  const width = Math.min(100, (ratio / 2) * 100) // the middle of the bar = the sector average
  const tone = ratio >= 1.1 ? 'bg-emerald-400' : ratio >= 0.85 ? 'bg-cyan' : 'bg-pink-fill'
  return (
    <div className="rounded-lg border border-line bg-void/60 p-3">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-cyan" />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-mute">{e.title}</p>
          <p className="font-display text-2xl leading-tight font-bold">
            ≈ {pct(e.value)}
            <span className="ml-2 text-xs font-normal text-mute">
              {pct(e.low)} – {pct(e.high)}
            </span>
          </p>
        </div>
      </div>
      <div className="mt-2" role="img" aria-label={`Comparé à la moyenne du secteur (${pct(e.baseline)})`}>
        <div className="relative h-1.5 rounded-full bg-white/10">
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
          <span className="absolute top-[-3px] left-1/2 h-3 w-px bg-white/60" />
        </div>
        <p className="mt-1 text-[11px] text-mute">Moyenne du secteur : {pct(e.baseline)}</p>
      </div>
      {e.factors.length > 0 && (
        <ul className="mt-3 space-y-1">
          {e.factors.map((f) => (
            <li key={f.label} className="flex items-start gap-2 text-xs">
              {f.effect > 0 ? <TrendingUp className="mt-0.5 size-3.5 shrink-0 text-emerald-400" /> : f.effect < 0 ? <TrendingDown className="mt-0.5 size-3.5 shrink-0 text-pink" /> : <Minus className="mt-0.5 size-3.5 shrink-0 text-mute" />}
              <span>{f.label}</span>
            </li>
          ))}
        </ul>
      )}
      {e.tips.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
          {e.tips.slice(0, 5).map((t) => (
            <li key={t} className="flex items-start gap-2 text-xs text-mute">
              <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-amber-300" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}
      {e.note && <p className="mt-3 text-[11px] text-mute">{e.note}</p>}
    </div>
  )
}

// Estimated click / open rate of the selected block (or of the whole module),
// with advice. `node` null = the module.
export function EstimatePanel({ tree, node }: { tree: ModuleTree; node: Block | null }) {
  const [sector, setSector] = useState<Sector>(read)
  const choose = (s: Sector) => {
    setSector(s)
    try {
      localStorage.setItem(KEY, s)
    } catch {
      /* ignore */
    }
  }
  const list: Estimate[] = node ? [estimateBlock(tree, node, sector)].filter((x): x is Estimate => !!x) : (() => {
    const m = estimateModule(tree, sector)
    return [m.click, m.open]
  })()
  if (!list.length) return null
  return (
    <section aria-label="Performance estimée" className="space-y-3 border-t border-line pt-4">
      <div className="flex items-center gap-2">
        <h3 className="flex-1 font-display text-sm font-semibold">Performance estimée</h3>
        <select aria-label="Secteur de référence" value={sector} onChange={(e) => choose(e.target.value as Sector)} className="max-w-[9.5rem] rounded-md border border-line bg-void px-2 py-1.5 text-base text-white outline-none focus:border-cyan lg:py-1 lg:text-xs">
          {(Object.keys(SECTORS) as Sector[]).map((k) => (
            <option key={k} value={k}>
              {SECTORS[k].label}
            </option>
          ))}
        </select>
      </div>
      {list.map((e) => (
        <Card key={e.title} e={e} />
      ))}
      <p className="text-[11px] leading-snug text-mute">
        Estimation indicative : moyenne du secteur (benchmark Brevo 2026, données 2025, hors Apple Mail Privacy Protection) ajustée par des bonnes pratiques. Ce n’est pas une promesse de résultat : mesure le vrai taux dans ton outil d’envoi.
      </p>
    </section>
  )
}
