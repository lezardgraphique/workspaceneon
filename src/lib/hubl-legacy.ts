// HuBL written in older or less common ways, brought back to the `module.x` form
// the importer reads:
// - dictionary access: module['titre'], item["lien"]['url'] → module.titre, item.lien.url;
// - template tags of older e-mails and templates ({% text "titre" value="…" %},
//   {% rich_text %}, {% image %}, {% boolean %}, {% choice %}, {% color %}…, also
//   wrapped in {% widget_block %}): each becomes a `module.<name>` placeholder and a
//   field definition (label, default, options) like a fields.json would give;
// - widget_data.<name>.value (tags exported to the template context) → module.<name>.
import type { FieldSpec } from './module-fields'

const DICT = /\[\s*(['"])([A-Za-z_]\w*)\1\s*\]/g
const PARAM = /([A-Za-z_]\w*)\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\[[^\]]*\]|[A-Za-z_]\w*|-?\d+(?:\.\d+)?)/g

type Params = Record<string, string | boolean | number | string[]>

function value(raw: string): string | boolean | number | string[] {
  if (/^['"]/.test(raw)) return raw.slice(1, -1).replace(/\\(["'\\])/g, '$1')
  if (/^(true|false)$/i.test(raw)) return /^true$/i.test(raw)
  if (/^-?\d/.test(raw)) return Number(raw)
  if (raw.startsWith('[')) return [...raw.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1] ?? m[2])
  return raw
}

function params(s: string): Params {
  const out: Params = {}
  // Strings are read whole, so a "=" inside a value never starts a parameter.
  for (const m of s.matchAll(PARAM)) out[m[1].toLowerCase()] = value(m[2])
  return out
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
const humanize = (n: string) => n.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase())

// type of the field, what the tag prints, its default value.
interface Legacy {
  type: string
  out: (n: string, p: Params) => string
  def: (p: Params) => unknown
  extra?: (p: Params) => Record<string, unknown>
}

const choices = (p: Params): string[] => (Array.isArray(p.choices) ? p.choices : typeof p.choices === 'string' ? p.choices.split(',').map((c) => c.trim()).filter(Boolean) : [])
const silent = (p: Params) => p.export_to_template_context === true

const TAGS: Record<string, Legacy> = {
  text: { type: 'text', out: (n, p) => (silent(p) ? '' : `{{ module.${n} }}`), def: (p) => str(p.value) ?? '' },
  header: {
    type: 'text',
    out: (n, p) => {
      if (silent(p)) return ''
      const h = /^h[1-6]$/i.test(String(p.header_tag ?? '')) ? String(p.header_tag).toLowerCase() : 'h1'
      return `<${h}>{{ module.${n} }}</${h}>`
    },
    def: (p) => str(p.value) ?? '',
  },
  rich_text: { type: 'richtext', out: (n, p) => (silent(p) ? '' : `<div>{{ module.${n} }}</div>`), def: (p) => str(p.html) ?? str(p.value) ?? '' },
  raw_html: { type: 'richtext', out: (n, p) => (silent(p) ? '' : `<div>{{ module.${n} }}</div>`), def: (p) => str(p.value) ?? '' },
  image: {
    type: 'image',
    out: (n, p) => (silent(p) ? '' : `<img src="{{ module.${n}.src }}" alt="{{ module.${n}.alt }}">`),
    def: (p) => ({ src: str(p.src) ?? '', alt: str(p.alt) ?? '', ...(typeof p.width === 'number' ? { width: p.width } : {}), ...(typeof p.height === 'number' ? { height: p.height } : {}) }),
  },
  linked_image: {
    type: 'image',
    out: (n, p) => (silent(p) ? '' : `<img src="{{ module.${n}.src }}" alt="{{ module.${n}.alt }}">`),
    def: (p) => ({ src: str(p.src) ?? '', alt: str(p.alt) ?? '' }),
  },
  image_src: { type: 'image', out: (n, p) => (silent(p) ? '' : `{{ module.${n}.src }}`), def: (p) => ({ src: str(p.src) ?? str(p.value) ?? '', alt: '' }) },
  boolean: { type: 'boolean', out: () => '', def: (p) => p.value === true },
  choice: {
    type: 'choice',
    out: (n, p) => (silent(p) ? '' : `{{ module.${n} }}`),
    def: (p) => str(p.value) ?? choices(p)[0] ?? '',
    extra: (p) => ({ choices: choices(p).map((c) => [c, c]), display: 'select' }),
  },
  color: { type: 'color', out: () => '', def: (p) => ({ color: str(p.color) ?? str(p.value) ?? '#000000', opacity: 100 }) },
}

const TAG = /\{%-?\s*(text|header|rich_text|raw_html|image|linked_image|image_src|boolean|choice|color)\s+(['"])([A-Za-z_]\w*)\2([\s\S]*?)-?%\}/g
// {% widget_block rich_text "name" label="…" %}{% widget_attribute "html" %}…{% end_widget_attribute %}{% end_widget_block %}
const BLOCK = /\{%-?\s*widget_block\s+(\w+)\s+(['"])([A-Za-z_]\w*)\2([\s\S]*?)-?%\}([\s\S]*?)\{%-?\s*end_widget_block\s*-?%\}/g
const ATTR = /\{%-?\s*widget_attribute\s+(['"])(\w+)\1\s*-?%\}([\s\S]*?)\{%-?\s*end_widget_attribute\s*-?%\}/g

function scan(code: string): { code: string; specs: FieldSpec[] } {
  const specs: FieldSpec[] = []
  const add = (tag: string, name: string, p: Params) => {
    const t = TAGS[tag]
    if (!specs.some((s) => s.name === name)) {
      const label = str(p.label)?.trim() || humanize(name)
      const def = t.def(p)
      specs.push({ name, label, type: t.type, default: def, raw: { name, label, type: t.type, default: def, ...(t.extra?.(p) ?? {}) } })
    }
    return t.out(name, p)
  }
  let out = code.replace(BLOCK, (all, tag: string, _q, name: string, head: string, body: string) => {
    if (!TAGS[tag]) return all
    const p = params(head)
    for (const m of body.matchAll(ATTR)) p[m[2].toLowerCase()] = m[3].trim()
    return add(tag, name, p)
  })
  out = out.replace(TAG, (_all, tag: string, _q, name: string, rest: string) => add(tag, name, params(rest)))
  return { code: out, specs }
}

// Only inside HuBL delimiters: the HTML around is left as it is.
function inHubl(code: string, fix: (s: string) => string): string {
  return code.replace(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g, fix)
}

const DATA_PROPS: Record<string, string> = { value: '', html: '', color: '.color', src: '.src', alt: '.alt' }

export function normalizeHubl(code: string): string {
  if (!/[[\]]|widget_data|\{%-?\s*(widget_block|text|header|rich_text|raw_html|image|linked_image|image_src|boolean|choice|color)\s/.test(code)) return code
  const out = scan(code).code
  return inHubl(out, (s) =>
    s
      .replace(/(\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)((?:\s*\[\s*(['"])[A-Za-z_]\w*\3\s*\])+)/g, (_m, head: string, tail: string) => head + tail.replace(DICT, '.$2').replace(/\s+/g, ''))
      .replace(/\bwidget_data\.([A-Za-z_]\w*)(?:\.(value|html|color|src|alt)\b)?/g, (_m, n: string, p?: string) => `module.${n}${p ? DATA_PROPS[p] : ''}`),
  )
}

// Field definitions written by the old template tags.
export function legacySpecs(code: string): FieldSpec[] {
  return scan(code).specs
}

// Definitions given (fields.json, other JSON) win over the ones read from the tags.
export function withLegacySpecs(code: string, specs?: FieldSpec[] | null): FieldSpec[] | undefined {
  const legacy = legacySpecs(code).filter((l) => !(specs ?? []).some((s) => s.name.split('.')[0] === l.name))
  const all = [...(specs ?? []), ...legacy]
  return all.length ? all : undefined
}
