// Settings written in a kept template itself, not in its fields: the CSS
// variables of its module.css (--ls-gap: 48px) and the fixed data-* values of
// its markup (data-speed="40"). Shown as « Réglages du modèle » so they can be
// adjusted without opening the code; each change edits that one value in the
// exact source (the export changes only there).

import { verbatimBlock } from './hubl'
import type { Block, ModuleTree, RawBlock } from './types'

export interface TemplateParam {
  /** 'css' = a CSS variable of module.css, 'data' = a data-* attribute of the markup. */
  kind: 'css' | 'data'
  /** --ls-gap / data-speed */
  key: string
  value: string
  /** How to edit it. */
  input: 'number' | 'color' | 'text'
  /** Unit after a number (px, s, %…), '' when none. */
  unit: string
  label: string
  /** A CSS variable the module uses but never defines (var(--x)): setting it defines it. */
  missing?: boolean
}

// Attributes that are not settings (accessibility, tracking, HubSpot's own).
const SKIP_DATA = /^data-(neon|nsp|hs-|hubspot|field|label|testid|test|id$|key$|index$|track|ga|gtm|analytics)/i

// Words of setting names, in French for the labels.
const WORDS: Record<string, string> = {
  gap: 'espacement', spacing: 'espacement', space: 'espace', padding: 'marge intérieure', margin: 'marge',
  speed: 'vitesse', duration: 'durée', delay: 'délai', interval: 'intervalle', autoplay: 'lecture auto',
  height: 'hauteur', width: 'largeur', size: 'taille', max: 'max', min: 'min', radius: 'arrondi',
  color: 'couleur', bg: 'fond', background: 'fond', text: 'texte', border: 'bordure', opacity: 'opacité',
  logo: 'logo', image: 'image', img: 'image', columns: 'colonnes', cols: 'colonnes', items: 'éléments', count: 'nombre',
  font: 'police', title: 'titre', loop: 'boucle', direction: 'sens', offset: 'décalage',
}

const PROPS = new Set(['height', 'width', 'size', 'color', 'radius', 'gap', 'speed', 'opacity'])

const NUM = /^(-?\d+(?:\.\d+)?)(px|rem|em|%|s|ms|deg|vh|vw|fr)?$/i
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\))$/i

function describe(kind: 'css' | 'data', key: string, value: string): TemplateParam {
  const n = NUM.exec(value.trim())
  const input = n ? 'number' : COLOR.test(value.trim()) ? 'color' : 'text'
  const words = key.replace(/^--|^data-/, '').replace(/^[a-z]{1,4}-(?=\w{3,})/i, (m) => (kind === 'css' ? '' : m)).replace(/[-_]+/g, ' ')
  const parts = words.split(' ').filter(Boolean)
  // logo height → hauteur du logo
  if (parts.length === 2 && PROPS.has(parts[1].toLowerCase())) parts.reverse().splice(1, 0, 'du')
  const fr = parts.map((w) => WORDS[w.toLowerCase()] ?? w).join(' ')
  return { kind, key, value: value.trim(), input, unit: n?.[2] ?? '', label: fr.charAt(0).toUpperCase() + fr.slice(1) }
}

/** The kept template of the module (the only block of a HubSpot import), or null. */
export function keptTemplate(tree: ModuleTree): RawBlock | null {
  const all: Block[] = []
  const walk = (list: Block[]) => list.forEach((b) => (all.push(b), b.type === 'section' && b.cells.forEach(walk)))
  tree.sections.forEach((s) => s.cells.forEach(walk))
  const t = all.find((b): b is RawBlock => b.type === 'raw' && !!b.verbatim && b.source != null)
  return t ?? null
}

export function templateParams(b: RawBlock): TemplateParam[] {
  const out: TemplateParam[] = []
  const seen = new Set<string>()
  // CSS variables: the first definition of each (later ones are media variants).
  for (const m of (b.sourceCss ?? '').matchAll(/(--[\w-]+)\s*:\s*([^;{}]+?)\s*(?=;|\})/g)) {
    if (seen.has(m[1]) || /\{\{|\{%/.test(m[2])) continue
    seen.add(m[1])
    out.push(describe('css', m[1], m[2]))
  }
  // Variables used (var(--x)) but defined nowhere: the module falls back to its
  // default (or to nothing at all), so they are offered too, with that default.
  const plain = (t: string) => t.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, ' ')
  const all = `${b.sourceCss ?? ''}\n${plain(b.source ?? '')}`
  for (const m of all.matchAll(/var\(\s*(--[\w-]+)\s*(?:,\s*([^()]+?))?\s*\)/g)) {
    if (seen.has(m[1]) || new RegExp(`${esc(m[1])}\\s*:`).test(all)) continue
    seen.add(m[1])
    const d = describe('css', m[1], (m[2] ?? '').trim())
    if (!m[2] && /gap|space|height|width|size|radius|margin|padding|offset/i.test(m[1])) {
      d.input = 'number'
      d.unit = 'px'
    }
    out.push({ ...d, missing: true })
  }
  // Fixed data-* values of the markup (not HuBL, not tracking).
  for (const m of (b.source ?? '').matchAll(/\s(data-[\w-]+)\s*=\s*"([^"{}<>]*)"/g)) {
    if (seen.has(m[1]) || SKIP_DATA.test(m[1]) || !m[2].trim() || m[2].length > 60) continue
    seen.add(m[1])
    out.push(describe('data', m[1], m[2]))
  }
  return out.slice(0, 30)
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The block with one setting changed (first definition only), preview copy rebuilt. */
export function setTemplateParam(b: RawBlock, p: TemplateParam, value: string): RawBlock {
  const v = value.replace(/[;{}<>"]/g, '').trim()
  if (!v) return b
  let source = b.source ?? ''
  let css = b.sourceCss ?? ''
  if (p.kind === 'css' && p.missing) css = `${css.replace(/\s+$/, '')}${css.trim() ? '\n' : ''}:root { ${p.key}: ${v}; }`
  else if (p.kind === 'css') css = css.replace(new RegExp(`(${esc(p.key)}\\s*:\\s*)[^;{}]+?(\\s*(?:;|\\}))`), (_m, a: string, z: string) => `${a}${v}${z}`)
  else source = source.replace(new RegExp(`(\\s${esc(p.key)}\\s*=\\s*")[^"]*(")`), (_m, a: string, z: string) => `${a}${v}${z}`)
  const next = verbatimBlock(source, b.cols, css || undefined)
  return { ...b, html: next.html, css: next.css, source: next.source, sourceCss: next.sourceCss }
}
