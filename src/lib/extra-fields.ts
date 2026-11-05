import { collectFields } from './fields'
import { humanize } from './module-fields'
import { normalizeHubl, withLegacySpecs } from './hubl-legacy'
import type { FieldSpec } from './module-fields'
import type { ExtraField, ExtraFieldType, Json, ModuleTree } from './types'

// Module fields from HuBL code, as exact as the code allows.
//
// Every `module.<name>` (and legacy `widget.<name>`) the code uses becomes a
// field. Its type comes from how it is used, following the HubSpot field
// reference (developers.hubspot.com/docs/cms/reference/fields/module-theme-fields):
//   .src/.alt → image   .url.href → link   .href → url   .color/.opacity → color
//   .css with .font/.size/.styles → font   .horizontal_align → alignment
//   .text_align → textalignment   .padding/.margin → spacing   .top/.left… → border
//   .background_position/.background_size → backgroundimage   .colors → gradient
//   .name/.unicode in {% icon %} → icon   {% cta %} / cta() → cta   {% form %} → form
//   .oembed_response → embed   .player_id → videoplayer   {% inline_rich_text %} → richtext
//   == 'a' / in ['a','b'] → choice   alone in {% if %} → boolean   |int → number   |format_date → date
// Aliases ({% set s = module.style %}), loops at any depth ({% for c in module.group.cards %})
// and nested groups are followed. When a fields.json is given, its definitions
// win and are kept whole (spec), so the export gives them back unchanged.

// ---------------------------------------------------------------------------
// Usage tree
// ---------------------------------------------------------------------------

interface UseNode {
  out: number
  cond: number
  filters: Set<string>
  ctx: string[] // text just before each {{ }} (attribute, URL…)
  tags: Set<string> // HuBL tags the value is used in: cta, icon, form, inline_text…
  funcs: Set<string> // functions it is passed to: cta(), menu(), content_by_id()…
  compared: Set<string> // literals it is compared with
  repeater: boolean
  item?: UseNode // a repeater's item
  kids: Map<string, UseNode>
  direct: number // used as a whole (not only through its properties)
}

const node = (): UseNode => ({ out: 0, cond: 0, filters: new Set(), ctx: [], tags: new Set(), funcs: new Set(), compared: new Set(), repeater: false, kids: new Map(), direct: 0 })

const child = (n: UseNode, key: string): UseNode => {
  if (key === '*') return (n.item ??= node())
  let k = n.kids.get(key)
  if (!k) n.kids.set(key, (k = node()))
  return k
}

// Properties that belong to the field itself, never to a sub-field.
const LOOP_PROPS = new Set(['length', 'items', 'keys', 'values'])

// A reference: name, then .props or ['props'], then filters.
const REF = /(?<![\w.'"])([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*|\[\s*(?:'[^']*'|"[^"]*")\s*\])*)((?:\s*\|\s*[A-Za-z_]\w*(?:\([^)]*\))?)*)/g
const STRING = /'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g

const DATE_FILTERS = new Set(['datetimeformat', 'format_date', 'format_datetime', 'format_time', 'between_times', 'unixtimestamp', 'pretty_relative_time', 'todate'])
const NUMBER_FILTERS = new Set(['int', 'float', 'round', 'abs', 'format_number', 'format_currency_value', 'ceil', 'floor', 'sum', 'filesizeformat'])
const RICH_FILTERS = new Set(['safe', 'striptags', 'truncatehtml', 'wordwrap'])
const TAG_TYPES: Record<string, string> = {
  cta: 'cta',
  icon: 'icon',
  form: 'form',
  inline_text: 'text',
  inline_rich_text: 'richtext',
  video_player: 'videoplayer',
  menu: 'menu',
  simple_menu: 'simplemenu',
  logo: 'logo',
}
const FUNC_TYPES: Record<string, string> = {
  cta: 'cta',
  menu: 'menu',
  content_by_id: 'page',
  content_by_ids: 'page',
  blog_recent_posts: 'blog',
  blog_popular_posts: 'blog',
  blog_all_posts_url: 'blog',
  blog_authors: 'blog',
  blog_tags: 'blog',
  hubdb_table_rows: 'hubdbtable',
  hubdb_table: 'hubdbtable',
  hubdb_table_row: 'hubdbtable',
  hubdb_table_column: 'hubdbtable',
  crm_object: 'crmobject',
  crm_objects: 'crmobject',
}

type Path = string[]

class Analyzer {
  roots = new Map<string, UseNode>()
  // Names that stand for a module path: aliases ({% set %}) and loop items.
  scopes: Map<string, Path>[] = [new Map([['module', []], ['widget', []]])]

  resolve(name: string): Path | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const p = this.scopes[i].get(name)
      if (p) return p
    }
    return null
  }

  at(path: Path): UseNode | null {
    if (!path.length) return null
    let n = this.roots.get(path[0])
    if (!n) this.roots.set(path[0], (n = node()))
    for (const k of path.slice(1)) n = child(n, k)
    return n
  }

  // Every reference of an expression; returns the paths found.
  refs(text: string, kind: 'out' | 'cond', ctx?: string, tag?: string): { path: Path; filters: string[] }[] {
    const found: { path: Path; filters: string[] }[] = []
    const plain = text.replace(STRING, (s) => ' '.repeat(s.length))
    for (const m of plain.matchAll(REF)) {
      const base = this.resolve(m[1])
      if (!base) continue
      const props = [...text.slice((m.index ?? 0) + m[1].length, (m.index ?? 0) + m[1].length + m[2].length).matchAll(/\.([A-Za-z_]\w*)|\[\s*['"]([^'"]+)['"]\s*\]/g)].map((x) => x[1] ?? x[2])
      const path = [...base, ...props.filter((p) => !LOOP_PROPS.has(p))]
      if (!path.length) continue
      const filters = [...m[3].matchAll(/\|\s*([A-Za-z_]\w*)/g)].map((f) => f[1])
      const n = this.at(path)!
      filters.forEach((f) => n.filters.add(f))
      if (kind === 'cond') n.cond++
      else {
        n.out++
        if (ctx !== undefined) n.ctx.push(ctx)
      }
      if (tag) n.tags.add(tag)
      // Used as a whole: printed or tested as is (not only one of its properties).
      if (props.length === path.length - base.length) n.direct++
      found.push({ path, filters })
    }
    // fn(module.x…): the function tells the type.
    for (const m of plain.matchAll(/\b([a-z_]+)\(\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/g)) {
      const segs = m[2].split('.')
      const base = this.resolve(segs[0])
      if (base && FUNC_TYPES[m[1]]) this.at([...base, ...segs.slice(1)])?.funcs.add(m[1])
    }
    // Comparisons with literals: x == 'a', 'a' == x, x is equalto 'a', x in ['a', 'b'].
    const cmp = /([A-Za-z_][\w.]*)\s*(?:==|!=|is\s+(?:not\s+)?(?:equalto|sameas))\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*==\s*([A-Za-z_][\w.]*)|([A-Za-z_][\w.]*)\s+(?:not\s+)?in\s*\[([^\]]*)\]/g
    for (const m of text.matchAll(cmp)) {
      const ref = m[1] ?? m[4] ?? m[5]
      const segs = ref.split('.')
      const base = this.resolve(segs[0])
      if (!base) continue
      const n = this.at([...base, ...segs.slice(1)])
      if (!n) continue
      const lits = m[6] !== undefined ? [...m[6].matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|(-?\d+(?:\.\d+)?)/g)].map((x) => x[1] ?? x[2] ?? x[3]) : [unquote(m[2] ?? m[3])]
      lits.forEach((l) => n.compared.add(l))
    }
    return found
  }

  run(code: string) {
    const clean = normalizeHubl(code.replace(/\{#[\s\S]*?#\}/g, ''))
    // Loops and their end, to pop the loop variable.
    const ends: number[] = []
    for (const m of clean.matchAll(/\{\{-?([\s\S]*?)-?\}\}|\{%-?([\s\S]*?)-?%\}/g)) {
      const at = m.index ?? 0
      if (m[1] !== undefined) {
        this.refs(m[1], 'out', clean.slice(Math.max(0, at - 60), at))
        continue
      }
      const stmt = m[2].trim()
      const head = /^(\w+)/.exec(stmt)?.[1] ?? ''
      const body = stmt.slice(head.length)
      if (head === 'for') {
        const f = /^\s*([\w\s,]+?)\s+in\s+([\s\S]+)$/.exec(body)
        if (f) {
          const target = f[2].trim()
          const hit = this.refs(target, 'out')[0]
          const scope = new Map<string, Path>()
          // `for x in module.list` (not `range(...)`): x is an item of the list.
          if (hit && /^[A-Za-z_][\w.[\]'"]*(\s*\|[\s\S]*)?$/.test(target)) {
            const n = this.at(hit.path)!
            n.repeater = true
            const names = f[1].split(',').map((s) => s.trim())
            // `for k, v in dict.items()` stays a group; one name iterates the items.
            if (names.length === 1) scope.set(names[0], [...hit.path, '*'])
          }
          this.scopes.push(scope)
          ends.push(this.scopes.length - 1)
        }
        continue
      }
      if (head === 'endfor') {
        const i = ends.pop()
        if (i !== undefined) this.scopes.length = i
        continue
      }
      if (head === 'set') {
        const f = /^\s*([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(body)
        if (f) {
          const target = f[2].trim()
          const segs = /^([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*)*)$/.exec(target)
          const base = segs ? this.resolve(segs[1]) : null
          if (base && segs) {
            // An alias: its uses are the field's uses.
            this.scopes[this.scopes.length - 1].set(f[1], [...base, ...segs[2].split('.').filter(Boolean)])
            continue
          }
          this.refs(target, 'out')
        }
        continue
      }
      const cond = head === 'if' || head === 'elif' || head === 'unless'
      const tag = TAG_TYPES[head] ? head : undefined
      if (tag && /field\s*=\s*["']([A-Za-z_]\w*)["']/.test(body)) {
        // {% inline_text field="title" value="{{ module.title }}" %}: names the field.
        const name = /field\s*=\s*["']([A-Za-z_]\w*)["']/.exec(body)![1]
        this.at([name])!.tags.add(head)
      }
      // Expressions written as "{{ … }}" inside a tag's parameters (quotes included).
      const inner = body.replace(/(["'])\s*\{\{([\s\S]*?)\}\}\s*\1/g, ' $2 ').replace(/\{\{([\s\S]*?)\}\}/g, ' $1 ')
      this.refs(inner, cond ? 'cond' : 'out', undefined, tag)
    }
  }
}

const unquote = (s: string) => (/^['"]/.test(s) ? s.slice(1, -1) : s)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const keysOf = (n: UseNode) => new Set(n.kids.keys())
const only = (keys: Set<string>, allowed: string[]) => [...keys].every((k) => allowed.includes(k))
const any = (keys: Set<string>, wanted: string[]) => wanted.some((k) => keys.has(k))

const IMAGE_KEYS = ['src', 'alt', 'width', 'height', 'loading', 'size_type', 'max_width', 'max_height']
const LINK_KEYS = ['url', 'open_in_new_tab', 'no_follow', 'sponsored', 'user_generated_content', 'rel']
const URL_KEYS = ['href', 'type', 'content_id']
const COLOR_KEYS = ['color', 'opacity', 'rgba', 'hex', 'css']
const FONT_KEYS = ['css', 'font', 'font_set', 'size', 'size_unit', 'styles', 'color', 'variant', 'fallback', 'style']
const BORDER_SIDES = ['top', 'bottom', 'left', 'right', 'radius', 'css']

// HubSpot type → how the app edits it.
export const KIND_OF: Record<string, ExtraFieldType> = {
  text: 'text',
  richtext: 'richtext',
  number: 'number',
  boolean: 'boolean',
  link: 'link',
  url: 'url',
  image: 'image',
  file: 'file',
  color: 'color',
  font: 'font',
  alignment: 'alignment',
  textalignment: 'textalignment',
  backgroundimage: 'backgroundimage',
  date: 'date',
  datetime: 'datetime',
  choice: 'choice',
  group: 'group',
  cta: 'text',
  hubdbtable: 'text',
  blog: 'text',
}

const named = (name: string, re: RegExp) => re.test(name)

// Exact HubSpot type of a used value (without fields.json).
function hubspotType(name: string, n: UseNode): string {
  // Properties of a typed value are final values; a key with sub-keys of its own
  // (styles.background.color.color) is a sub-field, so the node is a group.
  const deep = new Set([...n.kids].filter(([, v]) => v.kids.size || v.item).map(([key]) => key))
  const k = new Set([...keysOf(n)].filter((key) => !deep.has(key) || ['url', 'styles', 'padding', 'margin', 'top', 'bottom', 'left', 'right', 'colors', 'side_or_corner', 'oembed_response', 'conversion_asset', 'properties'].includes(key)))
  if (k.size < n.kids.size) {
    // Some keys are sub-fields: a group, unless the rest still describes a typed value.
    return 'group'
  }
  for (const t of n.tags) if (TAG_TYPES[t] && t !== 'inline_text' && t !== 'inline_rich_text') return TAG_TYPES[t]
  for (const f of n.funcs) if (FUNC_TYPES[f]) return FUNC_TYPES[f]
  if (k.size) {
    if (any(k, ['background_position', 'background_size']) || (k.has('src') && k.has('css'))) return 'backgroundimage'
    if (any(k, ['override_inherited_src', 'suppress_company_name'])) return 'logo'
    if (any(k, ['oembed_response', 'oembed_url', 'embed_html', 'source_type'])) return 'embed'
    if (any(k, ['player_id', 'conversion_asset', 'loop_video', 'autoplay', 'hide_control'])) return 'videoplayer'
    if (any(k, ['form_id', 'response_type', 'redirect_url', 'redirect_id'])) return 'form'
    if (only(k, IMAGE_KEYS) && any(k, ['src', 'alt'])) return 'image'
    if (only(k, LINK_KEYS) && k.has('url')) return 'link'
    if (only(k, URL_KEYS) && k.has('href')) return 'url'
    if (any(k, ['horizontal_align', 'vertical_align'])) return 'alignment'
    if (k.has('text_align')) return 'textalignment'
    if (any(k, ['padding', 'margin'])) return 'spacing'
    if (any(k, ['colors', 'side_or_corner'])) return 'gradient'
    if (only(k, FONT_KEYS) && any(k, ['font', 'font_set', 'size', 'size_unit', 'styles', 'variant', 'fallback'])) return 'font'
    if (only(k, ['name', 'unicode', 'type']) && any(k, ['name', 'unicode']) && (k.has('unicode') || named(name, /icon|icone|picto|glyph/i))) return 'icon'
    // A border has sides described by width/style/color (or its .css); a lone `radius` is a number.
    if (only(k, BORDER_SIDES) && [...deep].some((x) => ['top', 'bottom', 'left', 'right'].includes(x))) return 'border'
    if (only(k, ['properties', 'id']) && k.has('properties')) return 'crmobject'
    // A font field also prints its CSS through .style.
    if (only(k, ['style', 'css']) && named(name, /font|police|typo/i)) return 'font'
    if (only(k, ['css'])) {
      // `.css` alone: the name says which style field it is.
      if (named(name, /font|police|typo/i)) return 'font'
      if (named(name, /border|bordure/i)) return 'border'
      if (named(name, /gradient|degrade/i)) return 'gradient'
      if (named(name, /bg|background|fond|image/i)) return 'backgroundimage'
      if (named(name, /align/i)) return 'alignment'
      return 'spacing'
    }
    if (only(k, COLOR_KEYS) && any(k, ['color', 'opacity', 'rgba', 'hex'])) return 'color'
    return 'group'
  }
  if (n.tags.has('inline_rich_text')) return 'richtext'
  if (n.tags.has('inline_text')) return 'text'
  const lits = [...n.compared]
  if (lits.length && lits.every((l) => /^(true|false)$/i.test(l))) return 'boolean'
  if (lits.length && lits.every((l) => /^-?\d+(\.\d+)?$/.test(l)) && !n.out) return 'number'
  if (lits.length) return 'choice'
  const f = [...n.filters]
  if (n.ctx.some((c) => /countdown\.gif\?to=$/i.test(c))) return 'datetime'
  if (n.filters.has('unixtimestamp') || n.filters.has('format_datetime') || n.filters.has('format_time')) return 'datetime'
  if (f.some((x) => DATE_FILTERS.has(x))) return 'date'
  if (!n.out && n.cond) return 'boolean'
  if (f.some((x) => NUMBER_FILTERS.has(x)) || /^(nombre|count|qty|quantite|prix|price|montant|amount|number|note|rating)\b|_(count|price|prix|nombre|montant|note)$/.test(name)) return 'number'
  // A plain value in src="…" / background="…" is a file (an image URL).
  if (n.ctx.some((c) => /(src|background)\s*=\s*["']?$|url\(\s*['"]?$/i.test(c))) return 'file'
  // A document to download: a plain value in href="…" named like a file.
  if (n.ctx.some((c) => /href\s*=\s*["']?$/i.test(c)) && /(fichier|file|pdf|brochure|document|doc\b|telecharg|download|piece|plaquette|catalogue_pdf)/i.test(name)) return 'file'
  if (f.some((x) => RICH_FILTERS.has(x)) || /(rich|body|corps|contenu|content|description|paragraph|paragraphe|html|intro)/i.test(name)) return 'richtext'
  return 'text'
}

// ---------------------------------------------------------------------------
// Defaults (HubSpot shapes) and preview values
// ---------------------------------------------------------------------------

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
  /(prix|price|montant|amount)/i.test(name) ? 49 : /(seuil|urgence)/i.test(name) ? 24 : /rayon|radius|arrondi/i.test(name) ? 10 : /taille|size/i.test(name) ? 6 : /ecart|espace|gap/i.test(name) ? 12 : /epaisseur|width/i.test(name) ? 2 : /note|rating|etoile/i.test(name) ? 4 : 1

const side = (v: number) => ({ value: v, units: 'px' })

// Default value of a HubSpot type (as fields.json writes it).
function hubspotDefault(type: string, name: string): Json {
  switch (type) {
    case 'cta':
    case 'menu':
    case 'page':
    case 'followupemail':
    case 'tag':
      return null
    case 'blog':
      return 'default'
    case 'hubdbtable':
      return ''
    case 'email':
      return []
    case 'simplemenu':
      return [{ linkLabel: 'Lien', linkUrl: 'https://example.com', isPublished: false, pageId: null, pageTitle: null, type: 'URL_LINK', isDeleted: false, children: [] }]
    case 'spacing':
      return { padding: { top: side(16), bottom: side(16), left: side(16), right: side(16) }, margin: {} }
    case 'border': {
      const s = { width: side(1), opacity: 100, style: 'solid', color: '#e3e3ee' }
      return { top: s, bottom: s, left: s, right: s }
    }
    case 'gradient':
      return { colors: [{ color: { r: 255, g: 0, b: 127, a: 1 } }, { color: { r: 0, g: 229, b: 255, a: 1 } }], side_or_corner: { verticalSide: 'BOTTOM', horizontalSide: null } }
    case 'icon':
      return { name: 'star', unicode: 'f005', type: 'SOLID' }
    case 'form':
      return { form_id: '', response_type: 'inline', message: 'Merci !', redirect_id: null, redirect_url: '' }
    case 'embed':
      return { source_type: 'oembed', oembed_url: '', oembed_response: { html: '' } }
    case 'videoplayer':
      return { player_id: null, height: 360, width: 640, size_type: 'auto_full_width', conversion_asset: { type: 'CTA', id: null, position: 'POST' }, loop_video: false, mute_video: false, autoplay: false, hide_control: false }
    case 'logo':
      return { src: '', alt: humanize(name), width: 160, height: 60, loading: 'lazy', override_inherited_src: false, suppress_company_name: true }
    case 'crmobject':
      return { id: null }
    default:
      return null
  }
}

export function defaultFor(f: Pick<ExtraField, 'name' | 'type' | 'children' | 'repeater' | 'default' | 'options' | 'hsType'>): Json {
  const label = humanize(f.name)
  const one = (): Json => {
    switch (f.type) {
      case 'text':
        if (f.hsType) return hubspotDefault(f.hsType, f.name)
        return /(url|lien|link|href)/i.test(f.name)
          ? 'https://example.com'
          : /mail/i.test(f.name)
            ? 'contact@exemple.fr'
            : /(color|couleur)/i.test(f.name)
              ? colorFor(f.name)
              : /^(langue|lang)$/i.test(f.name)
                ? 'fr'
                : /^message_fin/i.test(f.name)
                  ? "L'offre est terminée"
                  : /^texte_avant/i.test(f.name)
                    ? 'Plus que'
                    : label
      case 'richtext':
        return `<p>${label}</p>`
      case 'number':
        return numberFor(f.name)
      case 'boolean':
        return !/(separateur|bordure|border|heures|minutes)/i.test(f.name)
      case 'link':
        return LINK_DEFAULT
      case 'url':
        return { content_id: null, href: 'https://example.com', type: 'EXTERNAL' }
      case 'image':
        return { src: '', alt: label, width: 600, height: 300 }
      case 'file':
        return ''
      case 'color':
        return { color: colorFor(f.name), opacity: 100 }
      case 'font':
        return { font: 'Arial', font_set: 'DEFAULT', size: 16, size_unit: 'px', color: '#3a3a52', styles: {} }
      case 'alignment':
        return { horizontal_align: 'LEFT', vertical_align: 'TOP' }
      case 'textalignment':
        return { text_align: 'LEFT' }
      case 'backgroundimage':
        return { src: '', background_position: 'MIDDLE_CENTER', background_size: 'cover' }
      case 'choice':
        return f.default ?? f.options?.[0]?.value ?? ''
      case 'date':
      case 'datetime':
        // One week from now, to the minute.
        return Math.floor((Date.now() + 7 * 86_400_000) / 60_000) * 60_000
      case 'json':
        return hubspotDefault(f.hsType ?? '', f.name)
      case 'group':
        return Object.fromEntries((f.children ?? []).map((c) => [c.name, c.default ?? defaultFor(c)]))
    }
  }
  const v = one()
  return f.repeater ? [v, v] : v
}

// Readable labels for the settings the countdown preset exposes.
const KNOWN_LABELS: Record<string, string> = {
  date_fin: 'Date et heure de fin',
  unites: 'Unités affichées',
  afficher_libelles: 'Libellés (jours, heures…)',
  langue: 'Langue des libellés',
  afficher_separateur: 'Séparateur « : »',
  style_cases: 'Style des cases',
  couleur_cases: 'Couleur des cases',
  couleur_chiffres: 'Couleur des chiffres',
  couleur_texte: 'Couleur des libellés',
  rayon: 'Arrondi des cases',
  taille: 'Taille des chiffres',
  espacement: 'Espacement des cases',
  seuil_urgence_heures: 'Urgence sous (heures)',
  couleur_alerte: 'Couleur d’urgence',
  message_fin: 'Message de fin',
  texte_avant: 'Texte au-dessus',
  afficher_heures: 'Afficher les heures',
  afficher_date_fin: 'Afficher la date de fin',
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
const choiceOf = (n: UseNode) => CHOICES.find((c) => n.ctx.some((x) => c.re.test(x)))

// A field from how it is used (no fields.json).
function fromUse(name: string, n: UseNode): ExtraField {
  const repeater = n.repeater
  // A repeater's item: its own properties describe it.
  const shape = repeater && n.item ? n.item : n
  let hs = hubspotType(name, shape)
  if (hs === 'text' && choiceOf(shape)) hs = 'choice'
  const kind: ExtraFieldType = hs === 'group' ? 'group' : (KIND_OF[hs] ?? 'json')
  const field: ExtraField = {
    name,
    label: KNOWN_LABELS[name] && !repeater ? KNOWN_LABELS[name] : humanize(name),
    type: kind,
    ...(kind !== hs && hs !== 'group' ? { hsType: hs } : {}),
  }
  if (repeater) field.repeater = true
  if (kind === 'group') field.children = [...shape.kids].map(([k, v]) => fromUse(k, v))
  if (kind === 'choice') {
    const preset = choiceOf(shape)
    if (preset) {
      field.options = preset.options
      field.default = preset.default
    } else {
      field.options = [...shape.compared].map((v) => ({ value: v, label: humanize(v) }))
      field.default = field.options[0]?.value ?? ''
      if (repeater) field.default = [field.default, field.default]
    }
    return field
  }
  field.default = defaultFor(field)
  return field
}

// ---------------------------------------------------------------------------
// fields.json
// ---------------------------------------------------------------------------

const asJson = (v: unknown): Json | undefined => {
  try {
    return v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Json)
  } catch {
    return undefined
  }
}

// A field from its fields.json definition: exact type, label, default, and
// every other property kept for the export.
export function fromSpec(raw: Record<string, unknown>): ExtraField | null {
  const name = typeof raw.name === 'string' ? raw.name : ''
  const hs = typeof raw.type === 'string' ? raw.type : 'text'
  if (!/^[A-Za-z_]\w{0,59}$/.test(name)) return null
  const kind: ExtraFieldType = KIND_OF[hs] ?? 'json'
  const { name: _n, label, type: _t, default: def, children, choices, ...rest } = raw
  void _n
  void _t
  const field: ExtraField = { name, label: typeof label === 'string' && label.trim() ? label.trim() : humanize(name), type: kind }
  if (kind !== hs) field.hsType = hs
  if (raw.occurrence && typeof raw.occurrence === 'object') field.repeater = true
  if (kind === 'group') field.children = (Array.isArray(children) ? children : []).filter((c): c is Record<string, unknown> => !!c && typeof c === 'object').map(fromSpec).filter((c): c is ExtraField => !!c)
  if (kind === 'choice' && Array.isArray(choices)) {
    field.options = choices.filter((c): c is unknown[] => Array.isArray(c)).map((c) => ({ value: String(c[0]), label: String(c[1] ?? c[0]) }))
  }
  const spec = asJson(rest)
  if (spec && typeof spec === 'object' && !Array.isArray(spec) && Object.keys(spec).length) field.spec = spec as { [k: string]: Json }
  const d = asJson(def)
  field.default = d !== undefined && d !== null ? d : def === null ? null : standIn(field)
  if (!('default' in raw)) field.noDefault = true
  field.keep = true
  return field
}

// Value shown for a field whose definition gives none.
const standIn = (f: ExtraField): Json => (f.type === 'choice' && f.options?.length ? f.options[0].value : defaultFor({ ...f, default: undefined }))
// Still the stand-in (never edited): the export writes no default, like the original.
const isStandIn = (f: ExtraField) => !!f.noDefault && JSON.stringify(f.default) === JSON.stringify(standIn(f))

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

// Fields used by the code, typed from their uses; with a fields.json, its
// definitions win (all of them, even those the code doesn't reference).
export function analyzeFieldRefs(code: string, given: FieldSpec[] = []): ExtraField[] {
  const specs = withLegacySpecs(code, given) ?? []
  const a = new Analyzer()
  a.run(code)
  const out: ExtraField[] = []
  const top = specs.filter((s) => !s.name.includes('.') && s.raw)
  const bySpec = new Map(top.map((s) => [s.name, s]))
  for (const [name, n] of a.roots) {
    const s = bySpec.get(name)
    const f = s?.raw ? fromSpec(s.raw) : null
    out.push(f ?? fromUse(name, n))
  }
  for (const s of top) if (!a.roots.has(s.name)) {
    const f = fromSpec(s.raw!)
    if (f) out.push(f)
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

// ---------------------------------------------------------------------------
// Preview and export
// ---------------------------------------------------------------------------

const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const unit = (v: unknown) => {
  const o = obj(v)
  return o.value === undefined ? '' : `${num(o.value)}${typeof o.units === 'string' ? o.units : 'px'}`
}
const POS: Record<string, string> = { TOP: 'top', MIDDLE: 'center', BOTTOM: 'bottom', LEFT: 'left', CENTER: 'center', RIGHT: 'right' }

// The `.css` property HubSpot computes for style fields, so the preview reads it.
function withCss(type: string, value: Json): Json {
  const v = obj(value)
  if (!Object.keys(v).length) return value
  let css = ''
  if (type === 'font') {
    const styles = obj(v.styles)
    css = `${v.font ? `font-family:${v.font};` : ''}${v.size !== undefined ? `font-size:${num(v.size)}${typeof v.size_unit === 'string' ? v.size_unit : 'px'};` : ''}${v.color ? `color:${v.color};` : ''}${Object.entries(styles).map(([k, x]) => `${k}:${x};`).join('')}`
  } else if (type === 'spacing') {
    for (const box of ['padding', 'margin'])
      for (const sd of ['top', 'right', 'bottom', 'left']) {
        const u = unit(obj(obj(v[box])[sd]))
        if (u) css += `${box}-${sd}:${u};`
      }
  } else if (type === 'border') {
    for (const sd of ['top', 'right', 'bottom', 'left']) {
      const b = obj(v[sd])
      if (Object.keys(b).length) css += `border-${sd}:${unit(b.width) || '1px'} ${b.style ?? 'solid'} ${b.color ?? '#000'};`
    }
  } else if (type === 'backgroundimage') {
    const [y, x] = String(v.background_position ?? 'MIDDLE_CENTER').split('_')
    css = v.src ? `background-image:url('${v.src}');background-position:${POS[x] ?? 'center'} ${POS[y] ?? 'center'};background-size:${v.background_size ?? 'cover'};` : ''
  } else if (type === 'gradient') {
    const stops = (Array.isArray(v.colors) ? v.colors : []).map((c) => {
      const k = obj(obj(c).color)
      return `rgba(${num(k.r)}, ${num(k.g)}, ${num(k.b)}, ${num(k.a, 1)})`
    })
    const s = obj(v.side_or_corner)
    css = stops.length ? `background-image:linear-gradient(to ${[s.verticalSide, s.horizontalSide].filter(Boolean).join(' ').toLowerCase() || 'bottom'}, ${stops.join(', ')});` : ''
  } else if (type === 'alignment') {
    css = `text-align:${POS[String(v.horizontal_align)] ?? 'left'};`
  } else return value
  return { ...v, css } as Json
}

// Value the preview gives to `module.<name>` (same shape as fields.json defaults).
export function scopeValue(f: ExtraField): Json {
  const hs = f.hsType ?? f.type
  if (f.type === 'group') {
    const item = (src: Json | undefined): Json => {
      const o = obj(src)
      // A repeated sub-field (a list inside each item) stays a list.
      return Object.fromEntries((f.children ?? []).map((c) => [c.name, scopeValue({ ...c, default: (o[c.name] as Json | undefined) ?? (c.repeater ? undefined : c.default) })]))
    }
    if (f.repeater) {
      const list = Array.isArray(f.default) && f.default.length ? f.default : [{}, {}]
      return list.map((x) => item(x as Json))
    }
    return item(f.default)
  }
  const v = f.default ?? defaultFor(f)
  if (f.repeater) return (Array.isArray(v) ? v : [v, v]).map((x) => withCss(hs, x as Json))
  return withCss(hs, v)
}

// One entry of fields.json: the imported definition when there is one (exact),
// otherwise a complete HubSpot definition of the type.
export function hubspotField(f: ExtraField): Record<string, unknown> {
  const type = f.hsType ?? f.type
  const base: Record<string, unknown> = { name: f.name, label: f.label, type, required: false, locked: false, ...(f.spec ?? {}) }
  base.type = type
  if (f.repeater && !base.occurrence) base.occurrence = { min: 0, max: 10, default: 2 }
  if (f.type === 'group') {
    const kids = (f.children ?? []).map((c) => hubspotField({ ...c }))
    const one: Json = Object.fromEntries((f.children ?? []).map((c) => [c.name, c.default ?? defaultFor(c)]))
    if (isStandIn(f)) return { ...base, children: kids }
    return { ...base, children: kids, default: f.default ?? (f.repeater ? [one, one] : one) }
  }
  if (isStandIn(f)) return f.type === 'choice' ? { ...(f.spec ? {} : { display_width: null, multiple: false, display: 'select' }), ...base, choices: (f.options ?? []).map((o) => [o.value, o.label]) } : base
  if (f.type === 'choice') {
    return {
      ...(f.spec ? {} : { display_width: null, multiple: false, display: 'select' }),
      ...base,
      choices: (f.options ?? []).map((o) => [o.value, o.label]),
      default: f.default ?? defaultFor(f),
    }
  }
  return { ...base, default: f.default === undefined ? defaultFor(f) : f.default }
}
