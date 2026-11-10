import { useState } from 'react'
import { Link2, Link2Off } from 'lucide-react'

// Margins and paddings of an element in one place, drawn like a browser's
// inspector: the outer box is the margin around the element, the inner box its
// inner margin (padding). Each side has a number field; empty = the default
// (shown greyed). The chain button types one value into all four sides.

export type Side = 't' | 'r' | 'b' | 'l'
export type Sides = Record<Side, number | undefined>
export const SIDE_NAMES: Record<Side, string> = { t: 'haut', r: 'droite', b: 'bas', l: 'gauche' }

export interface BoxLayer {
  /** Values set by the person (undefined = default). */
  values: Sides
  /** What each side is worth when not set (placeholder). */
  base: Record<Side, number>
  /** Sides that can't be changed for this element, with the reason. */
  locked?: Partial<Record<Side, string>>
  max: number
  onChange: (side: Side, v: number | undefined) => void
  /** Same value on every free side (chain button). */
  onAll: (v: number | undefined) => void
  /** Differs from the defaults (shows « Revenir aux valeurs par défaut »); by default: a side is set. */
  custom?: boolean
}

const ORDER: Side[] = ['t', 'r', 'b', 'l']

function SideInput({ side, layer, name, linked }: { side: Side; layer: BoxLayer; name: string; linked: boolean }) {
  const locked = layer.locked?.[side]
  const v = layer.values[side]
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      max={layer.max}
      step={1}
      disabled={!!locked}
      title={locked}
      value={locked ? '' : (v ?? '')}
      placeholder={locked ? '—' : String(layer.base[side])}
      aria-label={`${name} ${SIDE_NAMES[side]}${locked ? ` (${locked})` : ''}`}
      onChange={(e) => {
        const raw = e.target.value.trim()
        const n = raw === '' ? undefined : Math.min(layer.max, Math.max(0, Math.round(Number(raw))))
        if (n != null && Number.isNaN(n)) return
        if (linked) layer.onAll(n)
        else layer.onChange(side, n)
      }}
      className="w-12 [appearance:textfield] rounded border border-line bg-void px-1 py-1 text-center font-mono [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none text-base text-white tabular-nums outline-none placeholder:text-mute/70 focus:border-cyan disabled:opacity-40 lg:text-xs"
    />
  )
}

function LinkButton({ on, toggle, name }: { on: boolean; toggle: () => void; name: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={toggle}
      title={on ? 'Les 4 côtés changent ensemble' : 'Chaque côté se règle à part'}
      className={`rounded p-1 ${on ? 'text-cyan' : 'text-mute hover:text-white'}`}
    >
      {on ? <Link2 className="size-3.5" /> : <Link2Off className="size-3.5" />}
      <span className="sr-only">Même {name.toLowerCase()} des 4 côtés</span>
    </button>
  )
}

export function BoxModel({ margin, padding, label, note }: { margin: BoxLayer; padding?: BoxLayer; label: string; note?: string }) {
  const [linkM, setLinkM] = useState(false)
  const [linkP, setLinkP] = useState(false)
  const anySet = (l?: BoxLayer) => !!l && (l.custom ?? ORDER.some((s) => l.values[s] != null))

  const inner = padding ? (
    <div role="group" aria-label="Marge intérieure" className="rounded-md border border-dashed border-violet/60 bg-violet/10 p-1.5">
      <div className="flex items-center justify-between gap-1 px-0.5">
        <span className="font-mono text-[9px] tracking-wider text-[#e3a6ff] uppercase">Intérieure</span>
        <LinkButton on={linkP} toggle={() => setLinkP((v) => !v)} name="Marge intérieure" />
      </div>
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-1">
        <span />
        <span className="flex justify-center">
          <SideInput side="t" layer={padding} name="Marge intérieure" linked={linkP} />
        </span>
        <span />
        <SideInput side="l" layer={padding} name="Marge intérieure" linked={linkP} />
        <span className="truncate rounded bg-void/80 px-1 py-2 text-center text-[10px] text-mute">{label}</span>
        <SideInput side="r" layer={padding} name="Marge intérieure" linked={linkP} />
        <span />
        <span className="flex justify-center">
          <SideInput side="b" layer={padding} name="Marge intérieure" linked={linkP} />
        </span>
        <span />
      </div>
    </div>
  ) : (
    <span className="block truncate rounded-md border border-line bg-void/80 px-2 py-4 text-center text-xs text-mute">{label}</span>
  )

  return (
    <div className="space-y-1.5">
      <div role="group" aria-label="Marges" className="rounded-lg border border-dashed border-cyan/50 bg-cyan/5 p-2">
        <div className="flex items-center justify-between gap-1 px-0.5">
          <span className="font-mono text-[9px] tracking-wider text-cyan uppercase">Marge extérieure</span>
          <LinkButton on={linkM} toggle={() => setLinkM((v) => !v)} name="Marge extérieure" />
        </div>
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-1.5">
          <span />
          <span className="flex justify-center">
            <SideInput side="t" layer={margin} name="Marge extérieure" linked={linkM} />
          </span>
          <span />
          <SideInput side="l" layer={margin} name="Marge extérieure" linked={linkM} />
          {inner}
          <SideInput side="r" layer={margin} name="Marge extérieure" linked={linkM} />
          <span />
          <span className="flex justify-center">
            <SideInput side="b" layer={margin} name="Marge extérieure" linked={linkM} />
          </span>
          <span />
        </div>
      </div>
      <p className="text-[11px] text-mute">
        En pixels. Une case vide garde la valeur par défaut (en gris).{note ? ` ${note}` : ''}
      </p>
      {(anySet(margin) || anySet(padding)) && (
        <button
          type="button"
          onClick={() => {
            margin.onAll(undefined)
            padding?.onAll(undefined)
          }}
          className="text-xs text-mute underline hover:text-white"
        >
          Revenir aux valeurs par défaut
        </button>
      )}
    </div>
  )
}
