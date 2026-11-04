// Spacing, visibility and the other optional looks shared by the generated code
// (hubl.ts) and the editor's preview (Preview.tsx), so both draw the same thing.
// Every value is optional: absent, the historical output is produced unchanged.
import type { Block, DividerBlock, HeadingBlock, Hide, ModuleTree, Section, Spacing, TextBlock } from './types'

export const MOBILE = 'only screen and (max-width: 480px)'

// Default margins (px) around an element: 12 under a block, 16 around a divider,
// 12 under a nested card, nothing around a top-level section or a spacer.
export function spacingOf(b: Block, nested = false): { t: number; b: number } {
  const def = b.type === 'divider' ? [16, 16] : b.type === 'section' ? [0, nested ? 12 : 0] : b.type === 'spacer' || b.type === 'raw' ? [0, b.type === 'raw' ? 12 : 0] : [0, 12]
  const s = b as Spacing
  return { t: s.mt ?? def[0], b: s.mb ?? def[1] }
}

const px = (n: number) => (n ? `${n}px` : '0')
export const marginCss = (t: number, b: number) => (t === b ? `margin:${px(t)} 0;` : `margin:${px(t)} 0 ${px(b)};`)

export const hasSpacing = (b: Spacing) => b.mt != null || b.mb != null

// Data attributes of the shared settings (sync code only).
export function spacingAttrs(b: Spacing): Record<string, string | number> {
  return { ...(b.mt != null ? { mt: b.mt } : {}), ...(b.mb != null ? { mb: b.mb } : {}), ...(b.hide ? { hide: b.hide } : {}) }
}

export function spacingParse(g: (k: string) => string | null): Spacing {
  const n = (k: string) => {
    const v = g(k)
    if (v == null || !/^\d{1,3}$/.test(v.trim())) return undefined
    return Math.min(200, Number(v))
  }
  const hide = g('hide')
  const out: Spacing = {}
  const mt = n('mt')
  const mb = n('mb')
  if (mt != null) out.mt = mt
  if (mb != null) out.mb = mb
  if (hide === 'mobile' || hide === 'desktop') out.hide = hide
  return out
}

export function spacingClean(raw: Record<string, unknown>): Spacing {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(200, Math.max(0, v))) : undefined)
  const out: Spacing = {}
  const mt = n(raw.mt)
  const mb = n(raw.mb)
  if (mt != null) out.mt = mt
  if (mb != null) out.mb = mb
  if (raw.hide === 'mobile' || raw.hide === 'desktop') out.hide = raw.hide
  return out
}

// Visibility: a class switched by the module's media query. "Phones only" is
// hidden inline (and from Outlook) and revealed by the query.
export const hideClass = (h?: Hide) => (h === 'mobile' ? 'neon-hide-m' : h === 'desktop' ? 'neon-only-m' : '')
export const hideStyle = (h?: Hide) => (h === 'desktop' ? 'display:none;max-height:0;overflow:hidden;mso-hide:all;' : '')
export const classAttr = (...names: string[]) => {
  const c = names.filter(Boolean).join(' ')
  return c ? ` class="${c}"` : ''
}

export const headingLine = (b: HeadingBlock) => b.lineHeight ?? 1.25
export const textLine = (b: TextBlock) => b.lineHeight ?? 1.6
export const headingWeight = (b: HeadingBlock) => b.weight ?? 700

export const dividerLine = (b: DividerBlock) => `${b.thickness ?? 1}px ${b.lineStyle ?? 'solid'} ${b.color}`

export const sectionPad = (s: Section) => ({ y: s.padY ?? s.padding, x: s.padX ?? s.padding })

// Column widths in % for a section: 2 columns can be split unevenly.
export function columnWidths(s: Section): number[] {
  if (s.columns === 2 && s.ratio && s.ratio !== 50) return [s.ratio, 100 - s.ratio]
  return Array.from({ length: s.columns }, () => Math.floor(100 / s.columns))
}

// A background image URL that can sit inside url('…') safely.
export const safeBgImage = (v?: string) => (v && /^https?:\/\/[^\s'"()<>\\]+$/i.test(v) ? v : '')

// Rules the module needs on phones, beyond the column stacking.
export function responsiveCss(tree: ModuleTree): string {
  const heights = new Set<number>()
  let hideM = false
  let onlyM = false
  const walk = (b: Block) => {
    const s = b as Spacing
    if (s.hide === 'mobile') hideM = true
    if (s.hide === 'desktop') onlyM = true
    if (b.type === 'spacer' && b.mobileHeight != null) heights.add(b.mobileHeight)
    if (b.type === 'section') b.cells.forEach((c) => c.forEach(walk))
  }
  tree.sections.forEach(walk)
  const rules: string[] = []
  if (hideM) rules.push('  .neon-hide-m { display: none !important; max-height: 0 !important; overflow: hidden !important; }')
  if (onlyM) rules.push('  .neon-only-m { display: block !important; max-height: none !important; overflow: visible !important; }', '  table.neon-only-m { display: table !important; }')
  for (const h of [...heights].sort((a, b) => a - b)) rules.push(`  .neon-mh-${h} { height: ${h}px !important; line-height: ${h}px !important; }`)
  return rules.length ? `\n@media ${MOBILE} {\n${rules.join('\n')}\n}` : ''
}
