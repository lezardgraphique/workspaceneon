import { toFieldName } from './fields'
import type { Block, ButtonBlock, FieldDef, ImageBlock, ModuleTree } from './types'

// Exact module fields from existing HuBL code.
//
// A module written for a design manager references its fields as
// `{{ module.title }}`, `{{ module.cta_link.url.href }}`, `{{ module.image.src }}`…
// Once the markup is converted into blocks, those placeholders sit in the block
// content. `bindFields` turns each one into a real field of the block, keeping
// the exact names, and swaps the placeholder for the field's default value
// (from a fields.json when there is one) so the preview shows real content.

export interface FieldSpec {
  name: string
  label: string
  type: string
  default?: unknown
}

export interface BoundField {
  // Name stored on the block (field.name)
  name: string
  kind: 'heading' | 'text' | 'button' | 'image'
  label: string
  // Exact names exposed in the code: {{ module.<name> }}
  exposed: string[]
}

export interface FieldBinding {
  tree: ModuleTree
  bound: BoundField[]
  // Placeholders found in the code that could not become a field
  // (inside HuBL logic, mixed with other text, groups or repeaters).
  unbound: string[]
  // Placeholders used by several blocks: only the first one is a field.
  reused: string[]
  // Names that don't survive the snake_case normalisation of field names.
  inexact: string[]
}

export const humanize = (name: string) => {
  const s = name.replace(/[_-]+/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : name
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// A fields.json (array of fields, or { fields: [...] }). Groups are flattened
// as `group.child`.
export function parseFieldsJson(text: string): FieldSpec[] | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  const list = Array.isArray(data) ? data : isObj(data) && Array.isArray(data.fields) ? data.fields : null
  if (!list) return null
  const out: FieldSpec[] = []
  const walk = (items: unknown[], prefix: string) => {
    for (const it of items) {
      if (!isObj(it) || typeof it.name !== 'string' || !it.name) continue
      const name = prefix ? `${prefix}.${it.name}` : it.name
      if (Array.isArray(it.children)) walk(it.children, name)
      out.push({
        name,
        label: typeof it.label === 'string' && it.label.trim() ? it.label.trim() : humanize(it.name),
        type: typeof it.type === 'string' ? it.type : 'text',
        default: it.default,
      })
    }
  }
  walk(list, '')
  return out.length ? out : null
}

// ---------------------------------------------------------------------------
// Placeholders
// ---------------------------------------------------------------------------

const REF = /module\.([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*)*)/g

// Every field name referenced by the code, in order of appearance, whether in
// an expression ({{ module.x }}) or in logic ({% if module.x %}).
export function extractFieldRefs(code: string): string[] {
  const seen = new Set<string>()
  const clean = code.replace(/\{#[\s\S]*?#\}/g, '')
  for (const stmt of clean.match(/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g) ?? []) {
    for (const m of stmt.matchAll(REF)) seen.add(m[1])
  }
  return [...seen]
}

interface Ref {
  root: string
  path: string[]
}

// The whole content is one placeholder, optionally with filters ({{ module.x|safe }}).
const WHOLE = /^\s*\{\{-?\s*module\.([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*)*)\s*(?:\|[^}]*)?-?\}\}\s*$/

function wholeRef(s: string): Ref | null {
  const m = WHOLE.exec(s)
  return m ? { root: m[1], path: m[2].split('.').filter(Boolean) } : null
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

// `cta_text` + `cta_link` → `cta`
const TEXT_SUFFIX = /_(text|texte|label|libelle|title|titre)$/i
const LINK_SUFFIX = /_(link|url|lien|href)$/i

export function bindFields(source: ModuleTree, specs: FieldSpec[] = []): FieldBinding {
  const tree = JSON.parse(JSON.stringify(source)) as ModuleTree
  const byName = new Map(specs.map((s) => [s.name, s]))
  const used = new Set<string>()
  const bound: BoundField[] = []
  const reused: string[] = []
  const inexact: string[] = []
  const exposedAll = new Set<string>()

  const claim = (root: string): boolean => {
    if (used.has(root)) {
      if (!reused.includes(root)) reused.push(root)
      return false
    }
    used.add(root)
    return true
  }
  const labelOf = (root: string, fallback = humanize(root)) => byName.get(root)?.label ?? fallback
  const defStr = (root: string) => str(byName.get(root)?.default)
  const checkName = (n: string) => {
    if (toFieldName(n) !== n && !inexact.includes(n)) inexact.push(n)
  }
  const def = (name: string, extra: Partial<FieldDef> = {}): FieldDef => ({ name, label: labelOf(name), ...extra })

  const bindBlock = (b: Block) => {
    switch (b.type) {
      case 'heading': {
        const r = wholeRef(b.text)
        if (!r || r.path.length) return
        if (!claim(r.root)) {
          b.text = defStr(r.root) ?? humanize(r.root)
          return
        }
        b.field = def(r.root)
        b.text = defStr(r.root) ?? humanize(r.root)
        checkName(r.root)
        exposedAll.add(r.root)
        bound.push({ name: r.root, kind: 'heading', label: b.field.label, exposed: [r.root] })
        return
      }
      case 'text': {
        const r = wholeRef(b.html)
        if (!r || r.path.length) return
        if (!claim(r.root)) {
          b.html = defStr(r.root) ?? humanize(r.root)
          return
        }
        b.field = def(r.root)
        b.html = defStr(r.root) ?? humanize(r.root)
        checkName(r.root)
        exposedAll.add(r.root)
        bound.push({ name: r.root, kind: 'text', label: b.field.label, exposed: [r.root] })
        return
      }
      case 'button':
        return bindButton(b)
      case 'image':
        return bindImage(b)
    }
  }

  const bindButton = (b: ButtonBlock) => {
    const t = wholeRef(b.label)
    const l = wholeRef(b.href)
    const textRoot = t && !t.path.length ? t.root : undefined
    // {{ module.cta.url.href }} (link field) or {{ module.cta }} (plain string)
    const linkRoot = l && (!l.path.length || (l.path[0] === 'url' && l.path[1] === 'href')) ? l.root : undefined
    if (!textRoot && !linkRoot) return

    const takeText = textRoot !== undefined && claim(textRoot)
    const takeLink = linkRoot !== undefined && claim(linkRoot)
    if (textRoot && !takeText) b.label = defStr(textRoot) ?? humanize(textRoot)
    if (linkRoot && !takeLink) b.href = 'https://example.com'
    if (!takeText && !takeLink) return

    const textBase = textRoot?.replace(TEXT_SUFFIX, '')
    const linkBase = linkRoot?.replace(LINK_SUFFIX, '')
    const base = takeText && takeLink && textBase === linkBase ? textBase! : ((takeLink ? linkRoot : textRoot) as string)
    const exposed: string[] = []
    const field: FieldDef = { name: base, label: takeText ? labelOf(textRoot!, humanize(base)) : humanize(base) }
    if (takeText) {
      field.textName = textRoot
      exposed.push(textRoot!)
      b.label = defStr(textRoot!) ?? humanize(textRoot!)
      checkName(textRoot!)
    }
    if (takeLink) {
      field.linkName = linkRoot
      exposed.push(linkRoot!)
      const d = byName.get(linkRoot!)?.default
      b.href = (isObj(d) && isObj(d.url) ? str(d.url.href) : undefined) ?? str(d) ?? 'https://example.com'
      checkName(linkRoot!)
    }
    exposed.forEach((n) => exposedAll.add(n))
    b.field = field
    bound.push({ name: base, kind: 'button', label: field.label, exposed })
  }

  const bindImage = (b: ImageBlock) => {
    const s = wholeRef(b.src)
    if (!s || s.path.length !== 1 || s.path[0] !== 'src') return
    if (!claim(s.root)) {
      b.src = ''
      return
    }
    const d = byName.get(s.root)?.default
    const a = wholeRef(b.alt)
    b.field = def(s.root)
    b.src = (isObj(d) ? str(d.src) : undefined) ?? ''
    b.alt = a && a.root === s.root ? ((isObj(d) ? str(d.alt) : undefined) ?? humanize(s.root)) : b.alt
    checkName(s.root)
    exposedAll.add(s.root)
    bound.push({ name: s.root, kind: 'image', label: b.field.label, exposed: [s.root] })
  }

  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.type === 'section') b.cells.forEach(walk)
      else bindBlock(b)
    }
  }
  tree.sections.forEach((s) => s.cells.forEach(walk))

  return { tree, bound, unbound: [], reused, inexact }
}

// Binding plus the report of what stayed out, computed against the source code.
export function bindFieldsFromCode(tree: ModuleTree, code: string, specs: FieldSpec[] = []): FieldBinding {
  const res = bindFields(tree, specs)
  const exposed = new Set(res.bound.flatMap((f) => f.exposed))
  const reused = new Set(res.reused)
  res.unbound = extractFieldRefs(code).filter((n) => !exposed.has(n) && !reused.has(n))
  return res
}
