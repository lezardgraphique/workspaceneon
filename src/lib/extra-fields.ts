import { collectFields } from './fields'
import { humanize } from './module-fields'
import type { FieldSpec } from './module-fields'
import type { ExtraField, ExtraFieldType, Json, ModuleTree } from './types'

// Finds every `module.<name>` the code uses and describes it as a module field
// (type guessed from how it is used, value ready for the preview and for
// fields.json). Pure text analysis: it works on pasted code of any origin.

interface Use {
  paths: Set<string> // first segment after the name: url, src, color, title…
  filters: Set<string>
  cond: number // used in an {% if %} / {% unless %} test
  out: number // printed or used in another statement
  ctx: string[] // text just before each {{ }} (inside a style or a URL?)
  loopVar?: string
  loopStart?: number
  loopEnd?: number
}

const REF = /\b(module|VAR)\.([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*)*)((?:\s*\|\s*[A-Za-z_]\w*(?:\([^)]*\))?)*)/g
const LINK_PATHS = new Set(['url', 'href', 'open_in_new_tab', 'no_follow', 'rel'])
const IMAGE_PATHS = new Set(['src', 'alt', 'width', 'height', 'loading', 'size_type', 'max_width', 'max_height'])
const COLOR_PATHS = new Set(['color', 'opacity'])
const DATE_FILTERS = new Set(['datetimeformat', 'format_date', 'format_datetime', 'between_times', 'unixtimestamp'])
const NUMBER_FILTERS = new Set(['int', 'float', 'round', 'abs', 'format_number', 'ceil', 'floor'])

const newUse = (): Use => ({ paths: new Set(), filters: new Set(), cond: 0, out: 0, ctx: [] })

function collect(text: string, root: string, base: number, into: Map<string, Use>, kind: 'cond' | 'out', ctx?: string) {
  const re = new RegExp(REF.source.replace('(module|VAR)', `(${root})`), 'g')
  for (const m of text.matchAll(re)) {
    const u = into.get(m[2]) ?? newUse()
    into.set(m[2], u)
    const first = m[3].split('.').filter(Boolean)[0]
    if (first) u.paths.add(first)
    for (const f of m[4].matchAll(/\|\s*([A-Za-z_]\w*)/g)) u.filters.add(f[1])
    if (kind === 'cond') u.cond++
    else {
      u.out++
      if (ctx !== undefined) u.ctx.push(ctx)
    }
    void base
  }
}

// Drop-down settings of the countdown picture, recognised by where the variable
// sits in the address (…&lang={{ module.langue }}), whatever its name.
const CHOICES: { re: RegExp; options: { value: string; label: string }[]; default: string }[] = [
  {
    re: /[?&;]u=$/,
    default: 'dhms',
    options: [
      { value: 'dhms', label: 'Jours, heures, minutes, secondes' },
      { value: 'hms', label: 'Heures, minutes, secondes' },
      { value: 'ms', label: 'Minutes, secondes' },
      { value: 'dhm', label: 'Jours, heures, minutes' },
      { value: 'dh', label: 'Jours, heures' },
    ],
  },
  {
    re: /[?&;]lang=$/,
    default: 'fr',
    options: [
      { value: 'fr', label: 'Français' },
      { value: 'en', label: 'English' },
      { value: 'es', label: 'Español' },
      { value: 'de', label: 'Deutsch' },
      { value: 'it', label: 'Italiano' },
    ],
  },
  {
    re: /[?&;]st=$/,
    default: 'plein',
    options: [
      { value: 'plein', label: 'Cases pleines' },
      { value: 'contour', label: 'Contour seul' },
      { value: 'sans_fond', label: 'Sans fond (chiffres seuls)' },
    ],
  },
]
const choiceOf = (u: Use) => CHOICES.find((c) => u.ctx.some((x) => c.re.test(x)))

function inferType(name: string, u: Use): ExtraFieldType {
  const paths = [...u.paths]
  if (paths.some((p) => IMAGE_PATHS.has(p))) return 'image'
  if (paths.some((p) => LINK_PATHS.has(p))) return 'link'
  if (paths.some((p) => COLOR_PATHS.has(p))) return 'color'
  if (paths.length) return 'group'
  if (u.ctx.some((c) => /countdown\.gif\?to=$/i.test(c))) return 'datetime'
  if (choiceOf(u)) return 'choice'
  if ([...u.filters].some((f) => DATE_FILTERS.has(f))) return 'date'
  if (!u.out && u.cond) return 'boolean'
  if ([...u.filters].some((f) => NUMBER_FILTERS.has(f)) || /^(nombre|count|qty|quantite|prix|price|montant|amount|number)\b|_(count|price|prix|nombre|montant)$/.test(name)) return 'number'
  if (u.filters.has('safe') || /(rich|body|corps|contenu|content|description|paragraph|paragraphe|html)/.test(name)) return 'richtext'
  return 'text'
}

const asJson = (v: unknown): Json | undefined => {
  try {
    return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Json)
  } catch {
    return undefined
  }
}

const LINK_DEFAULT: Json = { url: { type: 'EXTERNAL', href: 'https://example.com', content_id: null }, open_in_new_tab: false, no_follow: false }

// A believable colour for the preview: light for a background, dark for a text.
const colorFor = (name: string) =>
  /(bg|background|fond|cases)/i.test(name)
    ? '#f4f4fa'
    : /(text|texte|font|police)/i.test(name)
      ? '#3a3a52'
      : /(bordure|border)/i.test(name)
        ? '#d9d9e8'
        : /(alerte|alert|urgen)/i.test(name)
          ? '#e5322d'
          : '#ff007f'

// Believable starting values for the settings the presets expose (a radius, a
// size, a language…), so the preview looks right before anyone touches them.
const numberFor = (name: string) =>
  /(prix|price|montant|amount)/i.test(name) ? 49 : /(seuil|urgence)/i.test(name) ? 24 : /rayon|radius|arrondi/i.test(name) ? 10 : /taille|size/i.test(name) ? 6 : /ecart|espace|gap/i.test(name) ? 12 : /epaisseur|width/i.test(name) ? 2 : 1

export function defaultFor(f: Pick<ExtraField, 'name' | 'type' | 'children' | 'repeater' | 'default' | 'options'>): Json {
  const label = humanize(f.name)
  switch (f.type) {
    case 'text':
      return /(url|lien|link|href)/i.test(f.name)
        ? 'https://example.com'
        : /mail/i.test(f.name)
          ? 'contact@exemple.fr'
          : /(color|couleur)/i.test(f.name)
            ? colorFor(f.name)
            : /^(langue|lang)$/i.test(f.name)
              ? 'fr'
              : /^message_fin/i.test(f.name)
                ? "C'est parti !"
                : label
    case 'richtext':
      return `<p>${label}</p>`
    case 'number':
      return numberFor(f.name)
    case 'boolean':
      return !/(separateur|bordure|border)/i.test(f.name)
    case 'link':
      return LINK_DEFAULT
    case 'image':
      return { src: '', alt: label, width: 600, height: 300 }
    case 'color':
      return { color: colorFor(f.name), opacity: 100 }
    case 'choice':
      return f.default ?? f.options?.[0]?.value ?? ''
    case 'date':
    case 'datetime':
      // One week from now, to the minute.
      return Math.floor((Date.now() + 7 * 86_400_000) / 60_000) * 60_000
    case 'group': {
      const item: Json = Object.fromEntries((f.children ?? []).map((c) => [c.name, c.default ?? defaultFor(c)]))
      return f.repeater ? [item, item] : item
    }
  }
}

// Readable labels for the settings the countdown preset exposes.
const KNOWN_LABELS: Record<string, string> = {
  date_fin: 'Date et heure de fin',
  unites: 'Unités affichées',
  afficher_libelles: 'Afficher les libellés (jours, heures…)',
  langue: 'Langue des libellés',
  afficher_separateur: 'Séparateur « : » entre les cases',
  style_cases: 'Style des cases',
  couleur_cases: 'Couleur des cases',
  couleur_chiffres: 'Couleur des chiffres',
  couleur_texte: 'Couleur des libellés',
  rayon: 'Arrondi des cases (px)',
  taille: 'Taille des chiffres (2 à 8)',
  seuil_urgence_heures: 'Seuil d’urgence en heures (0 = aucun)',
  couleur_alerte: 'Couleur d’urgence',
  message_fin: 'Message affiché à la fin',
}

function build(name: string, u: Use, children?: ExtraField[], repeater?: boolean): ExtraField {
  const type: ExtraFieldType = repeater || children?.length ? 'group' : inferType(name, u)
  const field: ExtraField = { name, label: KNOWN_LABELS[name] && ['datetime', 'choice', 'boolean', 'color', 'number', 'text'].includes(type) && !children ? KNOWN_LABELS[name] : humanize(name), type }
  if (type === 'group') {
    field.children = children?.length ? children : [...u.paths].map((p) => ({ name: p, label: humanize(p), type: 'text' as const, default: humanize(p) }))
    if (!field.children.length) field.children = [{ name: 'texte', label: 'Texte', type: 'text', default: 'Texte' }]
    if (repeater) field.repeater = true
  }
  const choice = type === 'choice' ? choiceOf(u) : undefined
  if (choice) {
    field.options = choice.options
    field.default = choice.default
  } else field.default = defaultFor(field)
  return field
}

// fields.json types → ours.
const SPEC_TYPE: Record<string, ExtraFieldType> = {
  text: 'text', richtext: 'richtext', number: 'number', boolean: 'boolean', link: 'link', url: 'link', image: 'image',
  color: 'color', date: 'date', datetime: 'datetime', choice: 'choice', group: 'group',
}

export function analyzeFieldRefs(code: string, specs: FieldSpec[] = []): ExtraField[] {
  const clean = code.replace(/\{#[\s\S]*?#\}/g, '')
  const uses = new Map<string, Use>()
  const loops: { name: string; v: string; start: number; end: number }[] = []

  for (const m of clean.matchAll(/\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}/g)) {
    const at = m.index ?? 0
    if (m[1] !== undefined) {
      collect(m[1], 'module', at, uses, 'out', clean.slice(Math.max(0, at - 60), at))
    } else {
      const stmt = m[2].trim()
      const head = /^-?\s*(\w+)/.exec(stmt)?.[1]
      const body = stmt.replace(/^-?\s*\w+/, '')
      if (head === 'for') {
        const f = /^\s*([\w,\s]+?)\s+in\s+module\.([A-Za-z_]\w*)/.exec(body)
        if (f) {
          // Matching {% endfor %}, nested loops counted.
          let depth = 0
          let end = clean.length
          for (const e of clean.slice(at + m[0].length).matchAll(/\{%-?\s*(for|endfor)\b/g)) {
            if (e[1] === 'for') depth++
            else if (depth-- === 0) {
              end = at + m[0].length + (e.index ?? 0)
              break
            }
          }
          loops.push({ name: f[2], v: f[1].split(',')[0].trim(), start: at + m[0].length, end })
          const u = uses.get(f[2]) ?? newUse()
          uses.set(f[2], u)
          u.out++
        }
      } else collect(body, 'module', at, uses, head === 'if' || head === 'elif' || head === 'unless' ? 'cond' : 'out')
    }
  }

  const out: ExtraField[] = []
  for (const [name, u] of uses) {
    const loop = loops.find((l) => l.name === name)
    const spec = specs.find((s) => s.name === name)
    let children: ExtraField[] | undefined
    if (loop) {
      const item = new Map<string, Use>()
      const bodyText = clean.slice(loop.start, loop.end)
      for (const m of bodyText.matchAll(/\{\{([\s\S]*?)\}\}|\{%([\s\S]*?)%\}/g)) {
        const inner = m[1] ?? m[2].replace(/^\s*-?\s*\w+/, '')
        collect(inner, loop.v.replace(/[^\w]/g, ''), 0, item, m[1] !== undefined ? 'out' : /^\s*-?\s*(if|elif|unless)\b/.test(m[2]) ? 'cond' : 'out', m[1] !== undefined ? bodyText.slice(Math.max(0, (m.index ?? 0) - 60), m.index ?? 0) : undefined)
      }
      children = [...item].map(([n, iu]) => build(n, iu))
    } else if (!spec) {
      const paths = [...u.paths]
      if (paths.length && inferType(name, u) === 'group') {
        children = paths.map((p) => build(p, newUse()))
      }
    }
    let field = build(name, u, children, !!loop)
    if (spec) {
      const t = SPEC_TYPE[spec.type] ?? 'text'
      const kids = specs.filter((s) => s.name.startsWith(`${name}.`)).map((s) => ({ name: s.name.slice(name.length + 1), label: s.label, type: SPEC_TYPE[s.type] ?? ('text' as const), default: asJson(s.default) }))
      field = { ...field, type: t, label: spec.label || field.label, ...(t === 'group' ? { children: kids.length ? kids : field.children, repeater: field.repeater ?? false } : {}) }
      field.default = asJson(spec.default) ?? defaultFor(field)
    }
    out.push(field)
  }
  return out
}

// Names the blocks already expose ({{ module.heading_1 }}, cta_label, cta_link…).
export function exposedNames(tree: ModuleTree): Set<string> {
  const names = new Set<string>()
  for (const f of collectFields(tree)) {
    const b = f.block
    if (b.type === 'button') {
      names.add(b.field?.textName || `${f.name}_label`)
      names.add(b.field?.linkName || `${f.name}_link`)
    } else names.add(f.name)
  }
  return names
}

// Value the preview gives to `module.<name>` (same shape as fields.json defaults).
export function scopeValue(f: ExtraField): Json {
  if (f.type === 'group') {
    const item: Json = Object.fromEntries((f.children ?? []).map((c) => [c.name, scopeValue(c)]))
    return f.repeater ? [item, item] : item
  }
  return f.default ?? defaultFor(f)
}

// One entry of fields.json.
export function hubspotField(f: ExtraField): Record<string, unknown> {
  const base: Record<string, unknown> = { name: f.name, label: f.label, type: f.type, required: false, locked: false }
  if (f.type === 'group') {
    const item: Json = Object.fromEntries((f.children ?? []).map((c) => [c.name, c.default ?? defaultFor(c)]))
    return {
      ...base,
      ...(f.repeater ? { occurrence: { min: 0, max: 10, default: 2 } } : {}),
      children: (f.children ?? []).map(hubspotField),
      default: f.repeater ? [item, item] : item,
    }
  }
  if (f.type === 'choice') {
    return { ...base, display_width: null, multiple: false, display: 'select', choices: (f.options ?? []).map((o) => [o.value, o.label]), default: f.default ?? defaultFor(f) }
  }
  return { ...base, default: f.default ?? defaultFor(f) }
}
