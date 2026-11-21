// Editing the definitions of a module's fields at any depth (a field inside a
// group inside a repeated group…), so that a field the import missed or read
// wrongly can be added or corrected. Each change also updates the values the
// module holds (the default of the top field: an object for a group, a list
// for a repeated field) and, for a rename, the references in the code.
// Pure functions: the Champs tab commits the tree they return.

import { defaultFor } from '@/lib/extra-fields'
import { toFieldName } from '@/lib/fields'
import type { ExtraField, ExtraFieldType, Json, ModuleTree } from '@/lib/types'

/** Names from the top field down to the one edited. */
export type FieldPath = string[]

type Obj = { [key: string]: Json }
const isObj = (v: Json | undefined): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

/** The definition at `path`, or undefined. */
export function fieldAt(fields: ExtraField[] | undefined, path: FieldPath): ExtraField | undefined {
  let list = fields ?? []
  let f: ExtraField | undefined
  for (const name of path) {
    f = list.find((x) => x.name === name)
    if (!f) return undefined
    list = f.children ?? []
  }
  return f
}

// Replaces the definition at `path` (fn returns null to remove it).
function mapDef(fields: ExtraField[], path: FieldPath, fn: (f: ExtraField) => ExtraField | null): ExtraField[] {
  const [head, ...rest] = path
  const out: ExtraField[] = []
  for (const f of fields) {
    if (f.name !== head) out.push(f)
    else if (!rest.length) {
      const next = fn(f)
      if (next) out.push(next)
    } else out.push({ ...f, children: mapDef(f.children ?? [], rest, fn) })
  }
  return out
}

// Applies `fn` to every value of the field at `path` inside the top value `v`
// of field `f` (repeated levels are lists: each item is reached).
// fn receives the parent object and the key; it changes the object in place.
function eachParent(v: Json | undefined, f: ExtraField, path: FieldPath, fn: (parent: Obj, key: string) => void): Json | undefined {
  if (v === undefined) return v
  if (f.repeater) return Array.isArray(v) ? v.map((it) => eachParent(it, { ...f, repeater: false }, path, fn) as Json) : v
  if (!path.length || !isObj(v)) return v
  const [head, ...rest] = path
  const copy: Obj = { ...v }
  if (!rest.length) fn(copy, head)
  else {
    const child = (f.children ?? []).find((c) => c.name === head)
    if (child && head in copy) copy[head] = eachParent(copy[head], child, rest, fn) as Json
  }
  return copy
}

// The top field after a change of its definition, its value carried along.
function withValues(tree: ModuleTree, path: FieldPath, defs: ExtraField[], fn: (parent: Obj, key: string, before: ExtraField[]) => void): ModuleTree {
  const before = tree.fields ?? []
  const top = path[0]
  const oldTop = before.find((f) => f.name === top)
  return {
    ...tree,
    fields: defs.map((f) => {
      if (f.name !== top || !oldTop || path.length < 2) return f
      const value = f.default === undefined ? defaultFor(oldTop) : f.default
      // The default changes, so the value is no longer just a preview stand-in.
      return { ...f, default: eachParent(value, oldTop, path.slice(1), (p, k) => fn(p, k, before)) as Json, sample: undefined }
    }),
  }
}

/** A name not used yet among `siblings` (champ, champ_2, champ_3…). */
export function freeName(siblings: ExtraField[], wanted: string): string {
  const base = toFieldName(wanted) || 'champ'
  let name = base
  for (let i = 2; siblings.some((s) => s.name === name); i++) name = `${base}_${i}`
  return name
}

/** Adds a field at the top (parent = []) or inside the group at `parent`. */
export function addField(tree: ModuleTree, parent: FieldPath, type: ExtraFieldType = 'text', label = 'Nouveau champ'): { tree: ModuleTree; path: FieldPath } {
  const siblings = parent.length ? (fieldAt(tree.fields, parent)?.children ?? []) : (tree.fields ?? [])
  const name = freeName(siblings, label)
  const def: ExtraField = { name, label, type, keep: true, ...(type === 'group' ? { children: [] } : {}), ...(type === 'choice' ? { options: [{ value: 'option_1', label: 'Option 1' }, { value: 'option_2', label: 'Option 2' }] } : {}) }
  const value = defaultFor(def)
  if (!parent.length) return { tree: { ...tree, fields: [...(tree.fields ?? []), { ...def, default: value }] }, path: [name] }
  const defs = mapDef(tree.fields ?? [], parent, (g) => ({ ...g, type: 'group', children: [...(g.children ?? []), def] }))
  const path = [...parent, name]
  // Every existing value of the group gets the new key.
  return {
    tree: withValues(tree, path, defs, (p, k) => {
      if (!(k in p)) p[k] = value
    }),
    path,
  }
}

/** Removes the field at `path` (and its value everywhere). */
export function removeField(tree: ModuleTree, path: FieldPath): ModuleTree {
  const defs = mapDef(tree.fields ?? [], path, () => null)
  if (path.length === 1) return { ...tree, fields: defs }
  return withValues(tree, path, defs, (p, k) => {
    delete p[k]
  })
}

/** Label, choice options: no effect on the values. */
export function editField(tree: ModuleTree, path: FieldPath, patch: Pick<Partial<ExtraField>, 'label' | 'options'>): ModuleTree {
  return { ...tree, fields: mapDef(tree.fields ?? [], path, (f) => ({ ...f, ...patch })) }
}

/** Another type: the value becomes the new type's default (the exact HubSpot definition is dropped). */
export function retypeField(tree: ModuleTree, path: FieldPath, type: ExtraFieldType): ModuleTree {
  const old = fieldAt(tree.fields, path)
  if (!old || old.type === type) return tree
  const next: ExtraField = {
    ...old,
    type,
    hsType: undefined,
    spec: old.spec && old.repeater ? { occurrence: old.spec.occurrence ?? null } : undefined,
    children: type === 'group' ? (old.children ?? []) : undefined,
    options: type === 'choice' ? (old.options?.length ? old.options : [{ value: 'option_1', label: 'Option 1' }, { value: 'option_2', label: 'Option 2' }]) : undefined,
    noDefault: undefined,
  }
  const fresh = defaultFor({ ...next, default: undefined, repeater: false })
  // A text read as rich text (or the reverse) keeps its words; other types start from their default.
  const convert = (v: Json | undefined): Json => {
    if (old.type === 'text' && type === 'richtext' && typeof v === 'string') return `<p>${v}</p>`
    if (old.type === 'richtext' && type === 'text' && typeof v === 'string') return v.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    return fresh
  }
  const each = (v: Json | undefined): Json => (old.repeater ? (Array.isArray(v) ? v.map((x) => convert(x)) : [fresh]) : convert(v))
  const defs = mapDef(tree.fields ?? [], path, () =>
    path.length === 1 ? { ...next, default: each(old.default), sample: undefined } : { ...next, default: old.default === undefined ? undefined : each(old.default) },
  )
  if (path.length === 1) return { ...tree, fields: defs }
  return withValues(tree, path, defs, (p, k) => {
    p[k] = each(p[k])
  })
}

/** Repeated (a list of items, {% for %}) or single. */
export function setRepeated(tree: ModuleTree, path: FieldPath, repeated: boolean): ModuleTree {
  const old = fieldAt(tree.fields, path)
  if (!old || !!old.repeater === repeated) return tree
  const convert = (v: Json | undefined): Json => (repeated ? [v ?? defaultFor({ ...old, repeater: false })] : Array.isArray(v) ? (v[0] ?? defaultFor({ ...old, repeater: false })) : (v ?? defaultFor({ ...old, repeater: false })))
  const spec = { ...(old.spec ?? {}) }
  if (repeated) spec.occurrence = { min: null, max: null, sorting_label_field: null, default: null }
  else delete spec.occurrence
  const next: ExtraField = { ...old, repeater: repeated, spec: Object.keys(spec).length ? spec : undefined }
  const defs = mapDef(tree.fields ?? [], path, () => (path.length === 1 ? { ...next, default: convert(old.default), sample: undefined } : next))
  if (path.length === 1) return { ...tree, fields: defs }
  return withValues(tree, path, defs, (p, k) => {
    p[k] = convert(p[k])
  })
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Every string of the module's content (not the field definitions) through `fn`.
function mapContent(tree: ModuleTree, fn: (s: string) => string): ModuleTree {
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return fn(v)
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return { ...tree, sections: walk(tree.sections) as ModuleTree['sections'] }
}

/**
 * Renames the field at `path`: its definition, its values and the code that
 * reads it (`module.a.b`, and `item.b` inside `{% for item in module.a %}`).
 * Returns the tree unchanged when the name is taken.
 */
export function renameField(tree: ModuleTree, path: FieldPath, wanted: string): ModuleTree {
  const name = toFieldName(wanted)
  const old = path[path.length - 1]
  if (!name || name === old) return tree
  const parent = path.slice(0, -1)
  const siblings = parent.length ? (fieldAt(tree.fields, parent)?.children ?? []) : (tree.fields ?? [])
  if (siblings.some((s) => s.name === name)) return tree
  const defs = mapDef(tree.fields ?? [], path, (f) => ({ ...f, name }))
  let t: ModuleTree =
    path.length === 1
      ? { ...tree, fields: defs }
      : withValues(tree, path, defs, (p, k) => {
          if (k in p) {
            // Same place in the object: the order of the keys is kept.
            const entries = Object.entries(p).map(([kk, vv]) => [kk === k ? name : kk, vv] as const)
            for (const kk of Object.keys(p)) delete p[kk]
            for (const [kk, vv] of entries) p[kk] = vv
          }
        })
  // The code: every expression that stands for the parent (module.a.b, or the
  // variable of a {% for %} over it, loops inside loops included) followed by the old name.
  // Loops and the blocks they show are often in different strings (a logic block,
  // then a text block): the loop variables are read from the whole module.
  let all = ''
  mapContent(t, (x) => {
    all += `${x}\n`
    return x
  })
  const exprs = parentExprs(all, parent)
  t = mapContent(t, (s) => {
    let out = path.length === 1 ? s.replace(new RegExp(`\\bmodule\\[(["'])${esc(old)}\\1\\]`, 'g'), `module.${old}`) : s
    for (const expr of exprs) out = out.replace(new RegExp(`(^|[^\\w.])${esc(expr)}\\.${esc(old)}\\b(?!\\s*\\()`, 'g'), `$1${expr}.${name}`)
    return out
  })
  return t
}

// What stands for the object at `prefix` in a template: `module.a.b`, and each
// loop variable over it ({% for x in module.a %} → x stands for an item of a,
// {% for y in x.b %} → y for an item of a.b).
function parentExprs(code: string, prefix: FieldPath): string[] {
  if (!prefix.length) return ['module']
  const out = new Set<string>([`module.${prefix.join('.')}`])
  // Items of a repeated level: the variables of the loops over it.
  const loops = (exprs: string[]) => {
    const vars: string[] = []
    for (const e of exprs) for (const m of code.matchAll(new RegExp(`\\{%-?\\s*for\\s+(\\w+)\\s+in\\s+${esc(e)}(?![\\w.])`, 'g'))) vars.push(m[1])
    return vars
  }
  let level = ['module']
  for (let i = 0; i < prefix.length; i++) {
    const here = level.map((e) => `${e}.${prefix[i]}`)
    here.forEach((e) => out.add(e))
    // The next level is reached through the expression itself or the loop variables over it.
    level = [...here, ...loops(here)]
  }
  for (const v of loops([...out])) out.add(v)
  return [...out]
}

/** « valeur | libellé » lines ↔ choice options. */
export const optionsToText = (o: ExtraField['options']) => (o ?? []).map((x) => (x.label && x.label !== x.value ? `${x.value} | ${x.label}` : x.value)).join('\n')
export const textToOptions = (t: string): NonNullable<ExtraField['options']> =>
  t
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [v, ...rest] = l.split('|')
      const value = v.trim()
      return { value, label: rest.join('|').trim() || value }
    })
