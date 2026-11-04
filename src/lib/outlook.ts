// Per-element adjustments that only Outlook for Windows (Word engine) reads.
// They are written as `mso-*` inline properties (ignored everywhere else) and,
// for images, as the pixel `width` attribute, so every other client keeps the
// normal values. Stored in the tree as `outlook` and in the code as `data-ol`.
import type { OutlookTweaks } from './types'

export const OL_KEYS = ['mt', 'mb', 'lh', 'h', 'w', 'pad'] as const
type Key = (typeof OL_KEYS)[number]
const RANGE: Record<Key, [number, number]> = { mt: [0, 200], mb: [0, 200], lh: [8, 120], h: [0, 400], w: [20, 1200], pad: [0, 120] }

export const olEmpty = (o?: OutlookTweaks) => !o || OL_KEYS.every((k) => o[k] == null)

// `mb:20,lh:24` (data-ol) <-> { mb: 20, lh: 24 }
export function olSerialize(o?: OutlookTweaks): string {
  return o ? OL_KEYS.filter((k) => o[k] != null).map((k) => `${k}:${o[k]}`).join(',') : ''
}

export function olClean(raw: unknown): OutlookTweaks | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const out: OutlookTweaks = {}
  for (const k of OL_KEYS) {
    const v = (raw as Record<string, unknown>)[k]
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(Math.min(RANGE[k][1], Math.max(RANGE[k][0], v)))
  }
  return olEmpty(out) ? undefined : out
}

export function olParse(s: string | null): { outlook?: OutlookTweaks } {
  if (!s) return {}
  const raw: Record<string, number> = {}
  for (const part of s.split(',')) {
    const [k, v] = part.split(':')
    if ((OL_KEYS as readonly string[]).includes(k)) raw[k] = Number(v)
  }
  const outlook = olClean(raw)
  return outlook ? { outlook } : {}
}

export const olAttr = (o?: OutlookTweaks): Record<string, string> => (olEmpty(o) ? {} : { ol: olSerialize(o) })

// Margins and exact line height, appended to an element's inline style.
export function olStyle(o?: OutlookTweaks, opts: { line?: boolean } = {}): string {
  if (!o) return ''
  return (
    (o.mt != null ? `mso-margin-top-alt:${o.mt}px;` : '') +
    (o.mb != null ? `mso-margin-bottom-alt:${o.mb}px;` : '') +
    (opts.line && o.lh != null ? `mso-line-height-alt:${o.lh}px;mso-line-height-rule:exactly;` : '')
  )
}
