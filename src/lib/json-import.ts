import { humanize } from './module-fields'
import { extractFieldRefs } from './module-fields'
import { withLegacySpecs } from './hubl-legacy'
import type { FieldSpec } from './module-fields'
import type { Block, ExtraField, Json, ModuleTree } from './types'
import { stripTags } from './sanitize'

// JSON copied from other tools, turned into what the import understands:
// field definitions (as fields.json entries), field values, and the module's
// code when the JSON carries it. Formats recognised:
// - HubSpot fields.json, or any object holding it ({ fields: [...] }, the
//   design manager / CMS API module JSON with `source`, `css`, `fields`);
// - HubSpot values (`widget_data`, `body`, `params` of a module in a page or
//   e-mail: { titre: "…", image: { src }, cartes: [ … ] });
// - JSON Schema ({ type: "object", properties: { … } });
// - Contentful content types ({ fields: [{ id, name, type, linkType, items }] });
// - Storyblok-like schemas ({ schema: { titre: { type: "text" } } });
// - any list of field definitions using other key names (id/key/slug,
//   title/displayName, fieldType/kind/control, defaultValue/value, options…).

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)

export interface ForeignJson {
  /** Readable name of what was recognised. */
  format: string
  /** Definitions the JSON states (exact). */
  specs: FieldSpec[]
  /** Definitions guessed from values: used only for names the code doesn't type itself. */
  guessed: FieldSpec[]
  /** Values by field name (applied to the recognised fields and blocks). */
  values: Obj | null
  html?: string
  css?: string
}

const NAME_KEYS = ['name', 'id', 'key', 'slug', 'field', 'fieldName', 'field_name', 'apiKey', 'api_key', 'handle']
const LABEL_KEYS = ['label', 'title', 'displayName', 'display_name', 'name', 'caption']
const TYPE_KEYS = ['type', 'fieldType', 'field_type', 'kind', 'widget', 'control', 'inputType', 'input_type', 'component']
const DEFAULT_KEYS = ['default', 'defaultValue', 'default_value', 'value', 'initialValue', 'initial_value', 'example']
const CHILD_KEYS = ['children', 'fields', 'subfields', 'sub_fields', 'items', 'properties', 'schema']
const OPTION_KEYS = ['choices', 'options', 'enum', 'values', 'allowedValues', 'validations']

const pick = (o: Obj, keys: string[]) => {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== '') return o[k]
  return undefined
}

const snake = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 59)
const fieldName = (s: string) => {
  const n = /^[A-Za-z_]\w{0,59}$/.test(s) ? s : snake(s)
  return /^[A-Za-z_]/.test(n) ? n : n ? `f_${n}` : ''
}

// Type names of other tools → HubSpot types.
const TYPE_MAP: [RegExp, string][] = [
  [/^(text|string|symbol|short_?text|single_?line(_?text)?|input|textfield|plain(_?text)?|textinput|title|slug|uid|keyword|email|phone(_?number)?|tel|key_?text)$/i, 'text'],
  [/^(richtext|rich_?text|html|wysiwyg|markdown|textarea|long_?text|multiline(_?text)?|editor|bloks?_?richtext|body|paragraph|structured_?text|input_?rich_?text(_?(html|md))?|input_?multiline|block_?content|portable_?text)$/i, 'richtext'],
  [/^(number|integer|int|float|decimal|numeric|range|slider|double|currency|percent|rating|duration|big_?integer|auto_?number|count)$/i, 'number'],
  [/^(boolean|bool|checkbox|toggle|switch|true_false|yes_?no)$/i, 'boolean'],
  [/^(select|dropdown|radio|choice|enum|enumeration|option|options|single_?select|multi_?select|buttons|segmented|multioption|select_?dropdown|select_?radio|select_?multiple_?dropdown|select_?icons)$/i, 'choice'],
  [/^(image|img|picture|photo|media|asset|file_?image|upload|image_?upload|images?)$/i, 'image'],
  [/^(file|document|attachment|attachments|multiple_?attachments|pdf|files)$/i, 'file'],
  [/^(link|cta_?link|button|multilink|reference|link_?to_?media|content_?link)$/i, 'link'],
  [/^(url|href|uri|web|website)$/i, 'url'],
  [/^(color|colour|colorpicker|color_?picker|hex|select_?color)$/i, 'color'],
  [/^(date|day)$/i, 'date'],
  [/^(datetime|date_?time|timestamp|time|created_?time|last_?modified_?time)$/i, 'datetime'],
  [/^(group|object|fieldset|section|block|component|repeater|list|array|blocks|collection|flexible_?content)$/i, 'group'],
  [/^(font|typography)$/i, 'font'],
  [/^(alignment|align)$/i, 'alignment'],
  [/^(textalignment|text_?align)$/i, 'textalignment'],
  [/^(spacing|padding|margin)$/i, 'spacing'],
  [/^(border)$/i, 'border'],
  [/^(backgroundimage|background_?image|bg_?image)$/i, 'backgroundimage'],
  [/^(gradient)$/i, 'gradient'],
  [/^(icon)$/i, 'icon'],
  [/^(cta)$/i, 'cta'],
  [/^(form)$/i, 'form'],
  [/^(email)$/i, 'text'],
  [/^(video|embed|oembed)$/i, 'embed'],
]
const HUBSPOT_TYPES = new Set(['text', 'richtext', 'number', 'boolean', 'choice', 'image', 'file', 'link', 'url', 'color', 'date', 'datetime', 'group', 'font', 'alignment', 'textalignment', 'spacing', 'border', 'backgroundimage', 'gradient', 'icon', 'cta', 'form', 'embed', 'videoplayer', 'logo', 'menu', 'simplemenu', 'page', 'blog', 'hubdbtable', 'hubdbrow', 'tag', 'email', 'crmobject', 'crmobjectproperty', 'followupemail'])

function mapType(raw: unknown, def: Obj): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().replace(/-/g, '_')
  if (HUBSPOT_TYPES.has(t)) return t
  // Contentful
  if (t === 'Link') return def.linkType === 'Asset' ? 'image' : 'link'
  if (t === 'Array') return 'group'
  if (t === 'Location') return 'text'
  // Prismic StructuredText: a single heading is a text, paragraphs a rich text.
  if (t === 'StructuredText') return isObj(def.config) && typeof def.config.single === 'string' && /^heading\d$/.test(def.config.single.split(',')[0].trim()) && !/paragraph/.test(def.config.single) ? 'text' : 'richtext'
  if (t === 'Group' && isObj(def.config)) return 'group'
  // Strapi plugin custom fields: plugin::color-picker.color
  const last = t.split(/[:.]/).filter(Boolean).pop() ?? t
  for (const [re, ht] of TYPE_MAP) if (re.test(t) || re.test(last)) return ht
  return null
}

// The most precise type the definition gives: an interface / widget (Directus
// meta.interface, Strapi customField) says more than the storage type.
function typeOfDef(def: Obj): string | null {
  const meta = isObj(def.meta) ? def.meta : null
  for (const raw of [meta?.interface, def.customField, def.interface, ...TYPE_KEYS.map((k) => def[k])]) {
    const t = mapType(raw, def)
    if (t) return t
  }
  return null
}

const IMAGE_EXT = /^(\.?(jpe?g|png|gif|webp|svg|avif|heic)|image\/.*|images?)$/i
const IMAGE_NAME = /(image|img|visuel|photo|logo|picto|banni|banner|illustration|thumbnail|vignette|avatar|cover|hero)/i

// A value's HubSpot type (for values without definitions).
export function typeOfValue(name: string, v: unknown): string {
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number') return /(date|_at$|deadline|fin|debut|echeance|expir)/i.test(name) && v > 1e11 ? 'datetime' : 'number'
  if (typeof v === 'string') {
    if (/<\/?[a-z][\s\S]*>/i.test(v)) return 'richtext'
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return 'color'
    if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i.test(v)) return 'file'
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return 'datetime'
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'date'
    return 'text'
  }
  if (Array.isArray(v)) return 'group'
  if (isObj(v)) {
    if ('src' in v && ('background_position' in v || 'background_size' in v)) return 'backgroundimage'
    if ('src' in v || 'alt' in v) return 'image'
    if (isObj(v.url) && 'href' in (v.url as Obj)) return 'link'
    if ('href' in v) return 'url'
    if ('color' in v && Object.keys(v).every((k) => ['color', 'opacity'].includes(k))) return 'color'
    if ('font' in v || 'font_set' in v) return 'font'
    if ('horizontal_align' in v || 'vertical_align' in v) return 'alignment'
    if ('text_align' in v) return 'textalignment'
    if ('padding' in v || 'margin' in v) return 'spacing'
    if ('name' in v && 'unicode' in v) return 'icon'
    return 'group'
  }
  return 'text'
}

// A value in the HubSpot shape of its type (a Contentful date string → timestamp…).
function hubspotValue(type: string, v: unknown): unknown {
  if (v === undefined) return undefined
  if ((type === 'date' || type === 'datetime') && typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : undefined
  }
  if (type === 'image' && typeof v === 'string') return { src: v, alt: '' }
  if (type === 'link' && typeof v === 'string') return { url: { type: 'EXTERNAL', href: v, content_id: null }, open_in_new_tab: false, no_follow: false }
  if (type === 'url' && typeof v === 'string') return { href: v, type: 'EXTERNAL', content_id: null }
  if (type === 'color' && typeof v === 'string') return { color: v, opacity: 100 }
  return v
}

// Options of a choice: [[v, l]], ['a', 'b'], [{ value, label }], Contentful validations [{ in: [...] }].
function choicesOf(def: Obj, depth = 0): [string, string][] | undefined {
  for (const k of OPTION_KEYS) {
    const raw = def[k]
    // Nested: Sanity options.list, Directus meta.options.choices, Webflow validations.options, Prismic config.options…
    if (isObj(raw) && depth < 3) {
      const inner = choicesOf({ ...raw, ...(Array.isArray(raw.list) ? { options: raw.list } : {}) }, depth + 1)
      if (inner) return inner
    }
    if (!Array.isArray(raw) || !raw.length) continue
    const list: [string, string][] = []
    for (const o of raw) {
      if (Array.isArray(o)) list.push([String(o[0]), String(o[1] ?? o[0])])
      else if (isObj(o) && Array.isArray(o.in)) o.in.forEach((x) => list.push([String(x), String(x)]))
      else if (isObj(o)) {
        const v = pick(o, ['value', 'id', 'key', 'name'])
        if (v !== undefined) list.push([String(v), String(pick(o, ['label', 'title', 'name', 'text']) ?? v)])
      } else if (typeof o === 'string' || typeof o === 'number') list.push([String(o), String(o)])
    }
    if (list.length) return list
  }
  if (depth === 0) for (const k of ['meta', 'config']) if (isObj(def[k])) {
    const inner = choicesOf(def[k] as Obj, depth + 1)
    if (inner) return inner
  }
  return undefined
}

// One definition of another tool → a fields.json entry (recursively).
function toHubSpot(def: Obj, nameHint?: string, depth = 0): Obj | null {
  if (depth > 5) return null
  // Contentful: `id` is the name, `name` the label.
  const contentful = typeof def.id === 'string' && typeof def.name === 'string' && typeof def.type === 'string' && /^[A-Z]/.test(def.type)
  const rawName = contentful ? def.id : (nameHint ?? pick(def, NAME_KEYS))
  if (typeof rawName !== 'string' && typeof rawName !== 'number') return null
  const name = fieldName(String(rawName))
  if (!name) return null
  let type = typeOfDef(def)
  const cfg = isObj(def.config) ? (def.config as Obj) : null
  // Sanity: arrays say what they hold in `of` (block = rich text, objects = repeated groups).
  const of = Array.isArray(def.of) ? def.of.filter(isObj) : null
  if (of?.length) {
    if (of.some((o) => o.type === 'block')) type = 'richtext'
    else if (of.length === 1 && !Array.isArray(of[0].fields)) {
      const inner = toHubSpot({ ...of[0], name: String(rawName) }, undefined, depth + 1)
      if (inner) return { ...inner, label: inner.label === humanize(name) ? (pick(def, ['title', 'label']) ?? inner.label) : inner.label, occurrence: { min: 0, max: 20, default: 2 } }
    }
  }
  // A file restricted to images is an image.
  if (type === 'file') {
    const exts = pick(def, ['allowedFileTypes', 'allowed_types', 'allowedTypes', 'accept', 'mimeTypes', 'extensions'])
    const list = Array.isArray(exts) ? exts.map(String) : typeof exts === 'string' ? exts.split(/[\s,]+/) : []
    if ((list.length && list.every((e) => IMAGE_EXT.test(e))) || (!list.length && IMAGE_NAME.test(name))) type = 'image'
  }
  // Strapi: a single media is an image, a component / dynamic zone a group.
  if (def.type === 'media' && Array.isArray(def.allowedTypes) && !def.allowedTypes.includes('images')) type = 'file'
  // JSON Schema
  const schemaType = def.type
  if (schemaType === 'string' && (!type || type === 'text')) type = def.format === 'uri' ? 'url' : def.format === 'date' ? 'date' : def.format === 'date-time' ? 'datetime' : def.format === 'color' ? 'color' : Array.isArray(def.enum) ? 'choice' : /html|rich/i.test(String(def.contentMediaType ?? def.format ?? '')) ? 'richtext' : 'text'
  if ((schemaType === 'array' && !of?.some((o) => o.type === 'block')) || schemaType === 'object') type = 'group'
  const labelRaw = contentful ? def.name : cfg && typeof cfg.label === 'string' && cfg.label ? cfg.label : pick(def, LABEL_KEYS.filter((k) => k !== 'name' || nameHint !== undefined || pick(def, NAME_KEYS.filter((n) => n !== 'name')) !== undefined))
  const label = typeof labelRaw === 'string' && labelRaw.trim() ? labelRaw.trim() : humanize(name)
  const out: Obj = { name, label }

  // Children: a list, or a map name → definition (JSON Schema properties, Storyblok schema).
  let kids: Obj[] = []
  let repeater = false
  const itemsSchema = isObj(def.items) ? (def.items as Obj) : undefined
  if ((schemaType === 'array' && type !== 'richtext') || def.type === 'Array' || def.repeatable === true || def.type === 'dynamiczone' || def.type === 'Group' || /^(repeater|list|array|collection|flexible_?content)$/i.test(String(pick(def, TYPE_KEYS) ?? ''))) repeater = true
  if (type === 'richtext' && of?.length) repeater = false
  const childSource = itemsSchema && (isObj(itemsSchema.properties) || Array.isArray(itemsSchema.fields)) ? itemsSchema : cfg && isObj(cfg.fields) ? cfg : of?.length === 1 && Array.isArray(of[0].fields) ? of[0] : def
  for (const k of CHILD_KEYS) {
    const c = childSource[k]
    if (Array.isArray(c) && c.some(isObj)) {
      kids = c.filter(isObj).map((x) => toHubSpot(x, undefined, depth + 1)).filter((x): x is Obj => !!x)
      if (kids.length) break
    }
    if (isObj(c) && k !== 'items' && Object.values(c).some((x) => isObj(x) && (pick(x, TYPE_KEYS) !== undefined || 'properties' in x))) {
      kids = Object.entries(c)
        .filter(([, x]) => isObj(x))
        .map(([n, x]) => toHubSpot(x as Obj, n, depth + 1))
        .filter((x): x is Obj => !!x)
      if (kids.length) break
    }
  }
  // A repeated simple value (Contentful Array of Symbol, JSON Schema array of strings).
  if (repeater && !kids.length && itemsSchema) {
    const inner = toHubSpot({ ...itemsSchema, name }, undefined, depth + 1)
    type = (inner?.type as string) ?? 'text'
  } else if (kids.length) type = 'group'
  // Strapi v5 `blocks` (rich text) and other groups without anything inside.
  else if (type === 'group' && /^blocks$/i.test(String(def.type ?? ''))) {
    type = 'richtext'
    repeater = false
  }
  if (!type) type = kids.length ? 'group' : 'text'
  out.type = type
  if (type === 'group') out.children = kids
  if (repeater) out.occurrence = { min: 0, max: 20, default: 2 }
  if (type === 'choice') {
    const ch = choicesOf(def)
    if (ch) out.choices = ch
    else out.type = 'text'
  } else if (type === 'text' || !type) {
    // A text whose pattern / placeholder is a web address is a URL.
    const hint = [def.regex, def.pattern, def.placeholder, def.format, isObj(def.meta) && isObj(def.meta.options) ? def.meta.options.placeholder : undefined].filter((x) => typeof x === 'string').join(' ')
    if (/https?\??:|^uri$|\burl\b/i.test(hint)) out.type = 'url'
    // A text limited to a list of values is a choice (Sanity options.list, enum…).
    const ch = choicesOf(def)
    if (ch && ch.length > 1) {
      out.type = 'choice'
      out.choices = ch
    }
  }
  const d = pick(def, DEFAULT_KEYS.filter((k) => k !== 'value' || !Array.isArray(def.value)))
  const v = hubspotValue(String(out.type), d)
  if (v !== undefined && !(out.type === 'choice' && isObj(v))) out.default = v
  return out
}

// Values (name → value) → definitions typed from the values.
function specsFromValues(values: Obj, depth = 0): Obj[] {
  const out: Obj[] = []
  for (const [k, v] of Object.entries(values)) {
    const name = fieldName(k)
    if (!name || depth > 4) continue
    const type = typeOfValue(name, v)
    const f: Obj = { name, label: humanize(name), type, default: v }
    if (type === 'group') {
      const sample = Array.isArray(v) ? v.find(isObj) : v
      if (Array.isArray(v)) {
        f.occurrence = { min: 0, max: 20, default: Math.max(1, v.length) }
        if (!sample) {
          // A list of plain values: a repeated simple field.
          f.type = v.length ? typeOfValue(name, v[0]) : 'text'
          out.push(f)
          continue
        }
      }
      f.children = isObj(sample) ? specsFromValues(sample, depth + 1).map(({ default: _d, ...c }) => (void _d, c)) : []
    }
    out.push(f)
  }
  return out
}

// A list of field definitions? (objects with a name-like and a type-like key)
const looksLikeDefs = (list: unknown[]) => list.some((x) => isObj(x) && pick(x, NAME_KEYS) !== undefined && pick(x, TYPE_KEYS) !== undefined)
const looksLikeDefMap = (o: Obj) => {
  const vals = Object.values(o)
  return vals.length > 0 && vals.every((x) => isObj(x)) && vals.some((x) => pick(x as Obj, TYPE_KEYS) !== undefined)
}

const flatten = (list: Obj[], prefix = ''): FieldSpec[] =>
  list.flatMap((f) => {
    const name = prefix ? `${prefix}.${f.name}` : String(f.name)
    const own: FieldSpec = { name, label: String(f.label ?? f.name), type: String(f.type ?? 'text'), default: f.default, raw: f }
    return [own, ...(Array.isArray(f.children) ? flatten(f.children as Obj[], name) : [])]
  })

// Same name in another spelling: logoPartenaire = logo_partenaire = logo-partenaire.
const loose = (n: string) => n.toLowerCase().replace(/[^a-z0-9]/g, '')

const isCode = (v: unknown) => typeof v === 'string' && /<[a-z!][\s\S]*>|\{\{|\{%/i.test(v)

// Bookkeeping keys of CMS entries (ids, revisions, dates): never module values.
const META_KEYS = /^(_.*|id|documentId|document_id|sys|metadata|createdAt|updatedAt|publishedAt|created_at|updated_at|published_at|createdOn|lastUpdated|lastPublished|locale|localizations|cmsLocaleId|isDraft|isArchived|first_publication_date|last_publication_date|uid|href|slugs|lang|alternate_languages|linked_documents|type)$/
const LOCALE = /^[a-z]{2}(-[A-Za-z]{2,4})?$/

// Prismic / Sanity rich text (lists of blocks) → HTML; a single heading → its text.
function richToHtml(v: unknown[]): string | undefined {
  const blocks = v.filter(isObj)
  if (!blocks.length || blocks.length !== v.length) return undefined
  const textOf = (b: Obj) => (typeof b.text === 'string' ? b.text : Array.isArray(b.children) ? b.children.filter(isObj).map((c) => (typeof c.text === 'string' ? c.text : '')).join('') : null)
  if (!blocks.every((b) => textOf(b) !== null && (typeof b.type === 'string' || b._type === 'block'))) return undefined
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  if (blocks.length === 1 && /^heading\d$/.test(String(blocks[0].type))) return textOf(blocks[0])!
  return blocks
    .map((b) => {
      const tag = /^heading([1-6])$/.exec(String(b.type ?? ''))?.[1] ?? /^h([1-6])$/.exec(String(b.style ?? ''))?.[1]
      const t = esc(textOf(b)!)
      return tag ? `<h${tag}>${t}</h${tag}>` : /list-item|bullet/.test(String(b.type ?? b.listItem ?? '')) ? `<li>${t}</li>` : `<p>${t}</p>`
    })
    .join('')
}

// Values as the editor expects them: CMS wrappers unwrapped (Strapi attributes,
// Webflow fieldData, Contentful locales), bookkeeping keys dropped, rich text
// block lists turned into HTML.
function cleanValues(values: Obj, depth = 0): Obj {
  let v = values
  for (const k of ['attributes', 'fieldData', 'field_data']) if (isObj(v[k])) v = { ...(v[k] as Obj) }
  // Only a CMS entry (it has an id of its own) loses its bookkeeping keys.
  const entry = ['id', '_id', 'documentId', 'sys', '_type', 'cmsLocaleId'].some((k) => k in values)
  const out: Obj = {}
  for (const [k, x] of Object.entries(v)) {
    if ((entry && META_KEYS.test(k)) || k.startsWith('_')) continue
    const c = cleanValue(x, depth)
    if (c !== undefined) out[k] = c
  }
  return out
}
function cleanValue(x: unknown, depth: number): unknown {
  if (depth > 4) return x
  if (Array.isArray(x)) return richToHtml(x) ?? x.map((y) => (isObj(y) ? cleanValues(y, depth + 1) : y))
  if (!isObj(x)) return x
  const keys = Object.keys(x)
  // Sanity image (asset reference without an address): nothing usable.
  if (x._type === 'image' || (isObj(x.asset) && typeof (x.asset as Obj)._ref === 'string')) return typeof x.url === 'string' ? { src: x.url, alt: typeof x.alt === 'string' ? x.alt : '' } : undefined
  // Contentful: { "fr-FR": value }
  if (keys.length && keys.every((k) => LOCALE.test(k))) return cleanValue(x[keys[0]], depth)
  // Strapi media: { data: { attributes: { url, alternativeText } } } / { url, alternativeText }
  const media = isObj(x.data) && isObj((x.data as Obj).attributes) ? ((x.data as Obj).attributes as Obj) : x
  if (typeof media.url === 'string' && ('mime' in media || 'alternativeText' in media || 'formats' in media)) return { src: media.url, alt: typeof media.alternativeText === 'string' ? media.alternativeText : '' }
  // Prismic image: { url, alt, dimensions }; Prismic link: { link_type, url }
  if (typeof x.url === 'string' && 'dimensions' in x) return { src: x.url, alt: typeof x.alt === 'string' ? x.alt : '' }
  if (typeof x.link_type === 'string' && typeof x.url === 'string') return { url: { type: 'EXTERNAL', href: x.url, content_id: null }, open_in_new_tab: x.target === '_blank', no_follow: false }
  // Contentful asset: { fields: { file: { url } , title } }
  if (isObj(x.fields) && isObj((x.fields as Obj).file)) {
    const f = x.fields as Obj
    const file = cleanValue(f.file, depth) as Obj
    const title = cleanValue(f.title, depth)
    if (typeof file?.url === 'string') return { src: file.url.startsWith('//') ? 'https:' + file.url : file.url, alt: typeof title === 'string' ? title : '' }
  }
  return cleanValues(x, depth + 1)
}

// Finds what the JSON carries, wherever it sits (a few levels deep).
export function parseForeignJson(text: string): ForeignJson | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  let html: string | undefined
  let css: string | undefined
  let defs: Obj[] | null = null
  let values: Obj | null = null
  let format = ''

  const visit = (v: unknown, path: string[], depth: number) => {
    if (depth > 5) return
    if (Array.isArray(v)) {
      if (!defs && looksLikeDefs(v)) {
        defs = v.filter(isObj).map((x) => toHubSpot(x)).filter((x): x is Obj => !!x)
        format ||= v.some((x) => isObj(x) && typeof x.type === 'string' && /^[A-Z]/.test(x.type) && typeof x.id === 'string') ? 'modèle Contentful' : 'liste de champs'
      }
      return
    }
    if (!isObj(v)) return
    // Code carried by the JSON (HubSpot module API: source / css).
    for (const [k, x] of Object.entries(v)) {
      if (!html && /^(source|html|module_?html|template|markup|body_?html|content_?html)$/i.test(k) && isCode(x)) html = x as string
      if (!css && /^(css|styles?|module_?css)$/i.test(k) && typeof x === 'string' && /[{:;]/.test(x)) css = x
    }
    if (!defs && v.type === 'object' && isObj(v.properties)) {
      defs = Object.entries(v.properties as Obj).map(([n, x]) => (isObj(x) ? toHubSpot(x, n) : null)).filter((x): x is Obj => !!x)
      format ||= 'JSON Schema'
    }
    // Prismic custom types: { json: { Main: { titre: { type, config } }, SEO: {…} } } (tabs of definitions).
    if (!defs && isObj(v.json) && Object.values(v.json as Obj).some((t) => isObj(t) && looksLikeDefMap(t as Obj))) {
      defs = Object.values(v.json as Obj)
        .filter((t): t is Obj => isObj(t) && looksLikeDefMap(t as Obj))
        .flatMap((t) => Object.entries(t).map(([n, d]) => toHubSpot(d as Obj, n)))
        .filter((d): d is Obj => !!d && d.type !== 'uid')
      format ||= 'type de contenu Prismic'
    }
    for (const key of ['fields', 'schema', 'children', 'properties', 'attributes', 'inputs', 'module_fields', 'fieldDefinitions', 'field_definitions']) {
      const x = v[key]
      if (defs) break
      if (Array.isArray(x) && looksLikeDefs(x)) visit(x, [...path, key], depth + 1)
      else if (isObj(x) && looksLikeDefMap(x)) {
        defs = Object.entries(x).map(([n, d]) => toHubSpot(d as Obj, n)).filter((d): d is Obj => !!d)
        format ||= key === 'attributes' ? 'type de contenu Strapi' : 'schéma de composant'
      }
    }
    // Values of a module in a page or e-mail.
    for (const key of ['widget_data', 'body', 'params', 'values', 'data', 'content', 'module', 'fields_values']) {
      const x = v[key]
      if (!values && isObj(x) && !looksLikeDefMap(x) && !('properties' in x) && !Object.values(x).every((y) => isObj(y) && 'body' in (y as Obj))) {
        values = x
        format ||= 'valeurs de module'
      }
    }
    // HubSpot widgets: { widgets: { module_1: { body: {...} } } } → the first module's values.
    if (!values && isObj(v.widgets)) {
      const first = Object.values(v.widgets as Obj).find((w) => isObj(w) && isObj((w as Obj).body))
      if (first) {
        values = (first as Obj).body as Obj
        format ||= 'valeurs de module (widgets)'
      }
    }
    for (const [k, x] of Object.entries(v)) if (isObj(x) || Array.isArray(x)) visit(x, [...path, k], depth + 1)
  }

  // Entries of other tools: a Contentful entry (fields by locale), Airtable records.
  if (isObj(data) && isObj(data.sys) && (data.sys as Obj).type === 'Entry' && isObj(data.fields)) {
    values = data.fields as Obj
    format = 'entrée Contentful'
  } else if (isObj(data) && Array.isArray(data.records) && isObj(data.records[0]) && isObj((data.records[0] as Obj).fields)) {
    values = (data.records[0] as Obj).fields as Obj
    format = 'enregistrement Airtable'
  } else if (Array.isArray(data) && looksLikeDefs(data)) {
    const hubspot = (x: Obj) => typeof x.type === 'string' && HUBSPOT_TYPES.has(x.type) && typeof x.name === 'string'
    defs = data.filter(isObj).map((x) => (hubspot(x) ? x : toHubSpot(x))).filter((x): x is Obj => !!x)
    format = data.every((x) => isObj(x) && hubspot(x)) ? 'fields.json HubSpot' : 'liste de champs'
  } else visit(data, [], 0)

  // Plain object of values (nothing else recognised): { titre: "…", image: {…} }.
  if (!defs && !values && isObj(data) && !html && Object.keys(data).length && !looksLikeDefMap(data)) {
    values = data
    format = 'valeurs de module'
  }
  if (isObj(data) && Array.isArray(data.fields) && (data.fields as unknown[]).every((x) => isObj(x) && typeof x.type === 'string' && HUBSPOT_TYPES.has(x.type))) format = html ? 'module HubSpot (API)' : 'fields.json HubSpot'

  if (values) values = cleanValues(values)
  const list: Obj[] = defs ?? []
  // Values without definitions say something of the types too (weaker than the code).
  const valueSpecs = values ? specsFromValues(values).filter((s) => !list.some((d) => d.name === s.name)) : []
  if (!list.length && !valueSpecs.length && !html) return null
  return { format: format || 'JSON', specs: flatten(list), guessed: flatten(valueSpecs), values, html, css }
}

// ---------------------------------------------------------------------------
// Values → recognised module
// ---------------------------------------------------------------------------


const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : undefined)

// Shapes a value for a field (only when it fits the field's type).
function valueFor(f: ExtraField, v: unknown): Json | undefined {
  if (v === undefined) return undefined
  if (f.repeater) return Array.isArray(v) ? (v.map((x) => valueFor({ ...f, repeater: false }, x)).filter((x) => x !== undefined) as Json[]) : undefined
  const hs = f.hsType ?? f.type
  const shaped = hubspotValue(hs, v)
  switch (f.type) {
    case 'text':
    case 'richtext':
    case 'file':
    case 'choice':
      return typeof shaped === 'string' || (shaped === null && f.hsType) ? (shaped as Json) : typeof shaped === 'number' ? String(shaped) : undefined
    case 'number':
      return typeof shaped === 'number' ? shaped : typeof shaped === 'string' && Number.isFinite(Number(shaped)) ? Number(shaped) : undefined
    case 'boolean':
      return typeof shaped === 'boolean' ? shaped : undefined
    case 'date':
    case 'datetime':
      return typeof shaped === 'number' ? shaped : undefined
    case 'group': {
      if (!isObj(shaped)) return undefined
      const out: Record<string, Json> = isObj(f.default) ? { ...(f.default as Record<string, Json>) } : {}
      for (const c of f.children ?? []) {
        const x = valueFor(c, (shaped as Obj)[c.name])
        if (x !== undefined) out[c.name] = x
      }
      return out
    }
    default:
      return isObj(shaped) || Array.isArray(shaped) ? (JSON.parse(JSON.stringify(shaped)) as Json) : undefined
  }
}

// Puts the values of the JSON into the module: field defaults, and the content
// of the blocks bound to fields. Returns the names that received a value.
export function applyValues(tree: ModuleTree, values: Obj | null): { tree: ModuleTree; applied: string[] } {
  if (!values) return { tree, applied: [] }
  const applied: string[] = []
  const loosely = new Map(Object.keys(values).map((k) => [loose(k), k]))
  const get = (name: string) => (name in values ? values[name] : values[loosely.get(loose(name)) ?? ''])
  const fields = (tree.fields ?? []).map((f) => {
    const v = valueFor(f, get(f.name))
    if (v === undefined) return f
    applied.push(f.name)
    return { ...f, default: v }
  })
  const walk = (b: Block): Block => {
    if (b.type === 'section') return { ...b, cells: b.cells.map((c) => c.map(walk)) }
    if (!('field' in b) || !b.field) return b
    const name = b.field.name
    switch (b.type) {
      case 'heading': {
        const v = str(get(name))
        if (v === undefined) return b
        applied.push(name)
        return { ...b, text: stripTags(v) }
      }
      case 'text': {
        const v = str(get(name))
        if (v === undefined) return b
        applied.push(name)
        return { ...b, html: v }
      }
      case 'image': {
        const v = get(name)
        const src = isObj(v) ? str(v.src) : str(v)
        if (src === undefined) return b
        applied.push(name)
        return { ...b, src, ...(isObj(v) && str(v.alt) !== undefined ? { alt: str(v.alt)! } : {}) }
      }
      case 'button': {
        const tn = b.field.textName ?? `${name}_label`
        const ln = b.field.linkName ?? `${name}_link`
        const label = str(get(tn))
        const lv = get(ln)
        const href = isObj(lv) ? (isObj(lv.url) ? str((lv.url as Obj).href) : str(lv.href)) : str(lv)
        if (label !== undefined) applied.push(tn)
        if (href !== undefined) applied.push(ln)
        return { ...b, ...(label !== undefined ? { label } : {}), ...(href !== undefined ? { href } : {}) }
      }
      default:
        return b
    }
  }
  return { tree: { ...tree, sections: tree.sections.map((s) => walk(s) as typeof s), ...(fields.length ? { fields } : {}) }, applied }
}

// Definitions for an import: the fields.json first, then what the JSON states,
// then the types guessed from its values for names the code doesn't use.
export function importSpecs(code: string, fieldsJson: FieldSpec[] | null | undefined, foreign: ForeignJson | null | undefined): FieldSpec[] | undefined {
  const top = (n: string) => n.split('.')[0]
  const fj = fieldsJson ?? []
  const used = new Set(extractFieldRefs(code))
  // Another tool may write logoPartenaire where the code says logo_partenaire.
  const byKey = new Map([...used].map((n) => [loose(n), n]))
  const rename = (sp: FieldSpec): FieldSpec => {
    const t = top(sp.name)
    const to = used.has(t) ? t : byKey.get(loose(t))
    if (!to || to === t) return sp
    const name = to + sp.name.slice(t.length)
    return { ...sp, name, raw: sp.raw && !sp.name.includes('.') ? { ...sp.raw, name: to } : sp.raw }
  }
  const foreignSpecs = (foreign?.specs ?? []).map(rename)
  const exact = [...fj, ...foreignSpecs.filter((s) => !fj.some((f) => top(f.name) === top(s.name)))]
  const weak = (foreign?.guessed ?? []).map(rename).filter((s) => !exact.some((e) => top(e.name) === top(s.name)) && !used.has(top(s.name)))
  return withLegacySpecs(code, [...exact, ...weak])
}
