import { collectFields } from './fields'
import type { FieldBlock, ModuleField } from './fields'
import { interpretTree, previewScope } from './hubl-render'
import type { SampleContact } from './hubl-render'
import { bindFieldsFromCode } from './module-fields'
import { isSafeUrl, sanitizeHtml as strictHtml } from './sanitize'
import type { FieldBinding, FieldSpec } from './module-fields'
import { uid } from './types'
import type { Align, Behavior, Block, Columns, ModuleTree, Section } from './types'

// ---------------------------------------------------------------------------
// Bidirectional sync format
//
// The code editor shows email-safe HTML/HuBL where every editable element
// carries `data-neon="<type>"` plus `data-*` attributes holding its settings.
// `treeToCode` writes that format, `codeToTree` reads it back (browser only —
// relies on DOMParser). Anything without a data-neon marker inside a column
// is preserved as a raw HuBL block, so hand-written `{% if %}` survives.
// ---------------------------------------------------------------------------

export const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const STACK_CSS = `@media only screen and (max-width: 480px) {
  .neon-stack > tbody > tr > .neon-col, .neon-stack > tr > .neon-col { display: block !important; width: 100% !important; box-sizing: border-box; }
}`

type Mode = 'sync' | 'hubspot'

interface Field {
  name: string
  label: string
  type: 'text' | 'richtext' | 'link' | 'image'
  default: unknown
}

class Ctx {
  fields: Field[] = []
  defs: Map<string, ModuleField>
  constructor(public mode: Mode, tree: ModuleTree) {
    this.defs = new Map(mode === 'hubspot' ? collectFields(tree).map((f) => [f.block.id, f]) : [])
  }
  // Registers a fields.json entry for the block and returns its HuBL name.
  field(b: FieldBlock, suffix: string, labelSuffix: string, type: Field['type'], def: unknown, exact?: string) {
    const f = this.defs.get(b.id)!
    const name = exact || (suffix ? `${f.name}_${suffix}` : f.name)
    this.fields.push({ name, label: labelSuffix ? `${f.label} · ${labelSuffix}` : f.label, type, default: def })
    return name
  }
  // Custom field definition, kept in the sync format so it survives code edits.
  fieldAttrs(b: FieldBlock): Record<string, string> {
    if (!b.field) return {}
    return {
      field: b.field.name,
      label: b.field.label,
      ...(b.field.textName ? { 'field-text': b.field.textName } : {}),
      ...(b.field.linkName ? { 'field-link': b.field.linkName } : {}),
    }
  }
  attrs(a: Record<string, string | number>) {
    if (this.mode === 'hubspot') return ''
    return Object.entries(a)
      .map(([k, v]) => ` ${k === 'neon' ? 'data-neon' : `data-${k}`}="${esc(String(v))}"`)
      .join('')
  }
}

const pad = (depth: number) => '  '.repeat(depth)

// `avail` is the content width (px) available to the node, used for the pixel
// width attribute of images (Outlook on Windows ignores percentage widths).
function renderBlock(b: Block, ctx: Ctx, d: number, font: string, avail: number): string {
  const p = pad(d)
  switch (b.type) {
    case 'heading': {
      const content =
        ctx.mode === 'hubspot'
          ? `{{ module.${ctx.field(b, '', '', 'text', b.text)} }}`
          : esc(b.text)
      return `${p}<h${b.level}${ctx.attrs({ neon: 'heading', ...ctx.fieldAttrs(b), align: b.align, color: b.color, size: b.size })} style="margin:0 0 12px;font-family:${esc(font)};font-size:${b.size}px;line-height:1.25;font-weight:700;color:${esc(b.color)};text-align:${b.align};">${content}</h${b.level}>`
    }
    case 'text': {
      const content =
        ctx.mode === 'hubspot' ? `{{ module.${ctx.field(b, '', '', 'richtext', b.html)} }}` : b.html
      return `${p}<div${ctx.attrs({ neon: 'text', ...ctx.fieldAttrs(b), align: b.align, color: b.color, size: b.size })} style="margin:0 0 12px;font-family:${esc(font)};font-size:${b.size}px;line-height:1.6;color:${esc(b.color)};text-align:${b.align};">${content}</div>`
    }
    case 'button': {
      // javascript:, data: and other schemes never reach the generated code.
      let href = isSafeUrl(b.href) ? esc(b.href) : '#'
      let label = esc(b.label)
      if (ctx.mode === 'hubspot') {
        const l = ctx.field(b, 'label', 'texte', 'text', b.label, b.field?.textName)
        const u = ctx.field(
          b,
          'link',
          'lien',
          'link',
          { url: { content_id: null, type: 'EXTERNAL', href: b.href }, open_in_new_tab: true, no_follow: false },
          b.field?.linkName,
        )
        href = `{{ module.${u}.url.href }}`
        label = `{{ module.${l} }}`
      }
      return `${p}<div${ctx.attrs({ neon: 'button', ...ctx.fieldAttrs(b), align: b.align, bg: b.bg, color: b.color, radius: b.radius })} style="margin:0 0 12px;text-align:${b.align};">
${p}  <a href="${href}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:12px 26px;background:${esc(b.bg)};color:${esc(b.color)};border-radius:${b.radius}px;font-family:${esc(font)};font-size:15px;font-weight:700;text-decoration:none;">${label}</a>
${p}</div>`
    }
    case 'image': {
      let src = isSafeUrl(b.src, true) ? esc(b.src) : ''
      let alt = esc(b.alt)
      if (ctx.mode === 'hubspot') {
        const f = ctx.field(b, '', '', 'image', { src: b.src, alt: b.alt, loading: 'lazy' })
        src = `{{ module.${f}.src }}`
        alt = `{{ module.${f}.alt }}`
      }
      return `${p}<div${ctx.attrs({ neon: 'image', ...ctx.fieldAttrs(b), align: b.align, width: b.width })} style="margin:0 0 12px;text-align:${b.align};">
${p}  <img src="${src}" alt="${alt}" width="${Math.round((avail * b.width) / 100)}" style="display:inline-block;width:${b.width}%;max-width:100%;height:auto;border:0;">
${p}</div>`
    }
    case 'divider':
      return `${p}<hr${ctx.attrs({ neon: 'divider', color: b.color })} style="border:0;border-top:1px solid ${esc(b.color)};margin:16px 0;">`
    case 'spacer':
      return `${p}<div${ctx.attrs({ neon: 'spacer', height: b.height })} style="height:${b.height}px;line-height:${b.height}px;font-size:0;">&nbsp;</div>`
    case 'raw':
      return ctx.mode === 'hubspot' ? `${p}${b.html}` : `${p}<div data-neon="raw">${b.html}</div>`
    case 'section':
      return renderSection(b, ctx, d, font, true, avail)
  }
}

function renderSection(s: Section, ctx: Ctx, d: number, font: string, nested: boolean, avail: number): string {
  const p = pad(d)
  const width = Math.floor(100 / s.columns)
  const inner = Math.max(40, (avail - s.padding * (s.columns + 1)) / s.columns)
  const cls = `neon-section${s.behavior === 'stack' ? ' neon-stack' : ''}`
  const cells = s.cells
    .map((cell, i) => {
      const left = i === 0 ? s.padding : s.padding / 2
      const right = i === s.cells.length - 1 ? s.padding : s.padding / 2
      const blocks = cell.map((b) => renderBlock(b, ctx, d + 3, font, inner)).join('\n')
      return `${p}    <td${ctx.attrs({ neon: 'column' })} class="neon-col" width="${width}%" valign="top" style="padding:${s.padding}px ${right}px ${s.padding}px ${left}px;">
${blocks}
${p}    </td>`
    })
    .join('\n')
  return `${p}<table${ctx.attrs({ neon: 'section', columns: s.columns, behavior: s.behavior, bg: s.bg, padding: s.padding, radius: s.radius })} class="${cls}" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${esc(s.bg)};border-radius:${s.radius}px;border-collapse:separate;${nested ? 'margin:0 0 12px;' : ''}">
${p}  <tr>
${cells}
${p}  </tr>
${p}</table>`
}

function renderModule(tree: ModuleTree, ctx: Ctx): string {
  const body = tree.sections.map((s) => renderSection(s, ctx, 3, tree.font, false, tree.width)).join('\n')
  // The conditional "ghost" table gives Outlook on Windows (which ignores
  // max-width) a fixed width; other clients skip it as a comment.
  return `<div${ctx.attrs({ neon: 'module', width: tree.width, bg: tree.bg, font: tree.font })} style="background:${esc(tree.bg)};padding:24px 0;">
  <!--[if mso]><table role="presentation" width="${tree.width}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${tree.width}px;margin:0 auto;">
    <tr><td>
${body}
    </td></tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</div>`
}

export function treeToCode(tree: ModuleTree, name: string): string {
  return `{# Neon Sandbox Pro · ${name.replace(/#}/g, '')}
   Édite le contenu et les attributs data-* : l'aperçu se met à jour en direct.
   Tout HTML/HuBL sans data-neon dans une colonne est conservé comme bloc brut. #}
<style>
${STACK_CSS}
</style>
${renderModule(tree, new Ctx('sync', tree))}
`
}

export interface HubSpotExport {
  'module.html': string
  'module.css': string
  'fields.json': string
  'meta.json': string
}

export function treeToHubSpot(tree: ModuleTree, name: string): HubSpotExport {
  const ctx = new Ctx('hubspot', tree)
  const html = renderModule(tree, ctx)
  const fields = ctx.fields.map((f) => ({
    name: f.name,
    label: f.label,
    type: f.type,
    required: false,
    locked: false,
    default: f.default,
  }))
  const meta = {
    label: name,
    css_assets: [],
    external_js: [],
    global: false,
    help_text: 'Module généré avec Neon Sandbox Pro',
    host_template_types: ['EMAIL'],
    js_assets: [],
    other_assets: [],
    smart_type: 'NOT_SMART',
    tags: [],
    is_available_for_new_content: true,
  }
  return {
    // The name sits in a HuBL comment: it must not be able to close it.
    'module.html': `{# ${name.replace(/[{}#%]/g, ' ').trim()} — généré par Neon Sandbox Pro #}\n${html}\n`,
    'module.css': `${STACK_CSS}\n`,
    'fields.json': JSON.stringify(fields, null, 2) + '\n',
    'meta.json': JSON.stringify(meta, null, 2) + '\n',
  }
}

// ---------------------------------------------------------------------------
// Parsing (browser only)
// ---------------------------------------------------------------------------

const ALIGNS: Align[] = ['left', 'center', 'right']
const asAlign = (v: string | null, def: Align): Align => (ALIGNS.includes(v as Align) ? (v as Align) : def)
const asNum = (v: string | null, def: number, min = 0, max = 2000) => {
  const n = Number(v)
  return Number.isFinite(n) && v !== null && v !== '' ? Math.min(max, Math.max(min, n)) : def
}
const asColor = (v: string | null, def: string) => (v && /^#[0-9a-f]{3,8}$|^[a-z]+$|^rgba?\(/i.test(v.trim()) ? v.trim() : def)

// Strip anything executable before content reaches the live preview.
function sanitize(root: ParentNode) {
  root.querySelectorAll('script, iframe, object, embed, link, meta').forEach((n) => n.remove())
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      if (/^on/i.test(attr.name) || /^\s*javascript:/i.test(attr.value)) el.removeAttribute(attr.name)
    }
  })
}

const ownerSection = (el: Element) => el.parentElement?.closest('[data-neon="section"]') ?? null

function parseBlock(el: Element): Block | null {
  const kind = el.getAttribute('data-neon')
  const g = (k: string) => el.getAttribute(`data-${k}`)
  const id = uid()
  const fname = g('field')?.trim()
  const textName = g('field-text')?.trim()
  const linkName = g('field-link')?.trim()
  const field = fname
    ? {
        field: {
          name: fname,
          label: g('label')?.trim() ?? '',
          ...(textName ? { textName } : {}),
          ...(linkName ? { linkName } : {}),
        },
      }
    : {}
  switch (kind) {
    case 'heading': {
      const lvl = Number(el.tagName.slice(1))
      return {
        id,
        type: 'heading',
        ...field,
        text: el.textContent?.trim() ?? '',
        level: lvl === 1 || lvl === 3 ? lvl : 2,
        align: asAlign(g('align'), 'left'),
        color: asColor(g('color'), '#0f0f1a'),
        size: asNum(g('size'), 26, 8, 96),
      }
    }
    case 'text':
      return {
        id,
        type: 'text',
        ...field,
        html: strictHtml(el.innerHTML.trim()),
        align: asAlign(g('align'), 'left'),
        color: asColor(g('color'), '#3a3a52'),
        size: asNum(g('size'), 16, 8, 64),
      }
    case 'button': {
      const a = el.querySelector('a')
      return {
        id,
        type: 'button',
        ...field,
        label: a?.textContent?.trim() ?? el.textContent?.trim() ?? 'Bouton',
        href: a?.getAttribute('href') ?? '#',
        align: asAlign(g('align'), 'left'),
        bg: asColor(g('bg'), '#ff007f'),
        color: asColor(g('color'), '#ffffff'),
        radius: asNum(g('radius'), 8, 0, 60),
      }
    }
    case 'image': {
      const img = el.tagName === 'IMG' ? el : el.querySelector('img')
      return {
        id,
        type: 'image',
        ...field,
        src: img?.getAttribute('src') ?? '',
        alt: img?.getAttribute('alt') ?? '',
        align: asAlign(g('align'), 'center'),
        width: asNum(g('width'), 100, 5, 100),
      }
    }
    case 'divider':
      return { id, type: 'divider', color: asColor(g('color'), '#e3e3ee') }
    case 'spacer':
      return { id, type: 'spacer', height: asNum(g('height'), 24, 0, 400) }
    case 'raw':
      return { id, type: 'raw', html: strictHtml(el.innerHTML.trim()) }
    case 'section':
      return parseSection(el)
    default:
      return null
  }
}

function parseCell(td: Element): Block[] {
  const out: Block[] = []
  let raw = ''
  const flush = () => {
    if (raw.trim()) out.push({ id: uid(), type: 'raw', html: raw.trim() })
    raw = ''
  }
  td.childNodes.forEach((node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const block = parseBlock(node as Element)
      if (block) {
        flush()
        out.push(block)
        return
      }
      raw += (node as Element).outerHTML
    } else if (node.nodeType === Node.TEXT_NODE) {
      raw += node.textContent ?? ''
    }
  })
  flush()
  return out
}

function parseSection(el: Element): Section {
  const g = (k: string) => el.getAttribute(`data-${k}`)
  const cols = Array.from(el.querySelectorAll('[data-neon="column"]')).filter(
    (td) => td.closest('[data-neon="section"]') === el,
  )
  const cells = cols.slice(0, 3).map(parseCell)
  if (!cells.length) cells.push([])
  return {
    id: uid(),
    type: 'section',
    columns: cells.length as Columns,
    behavior: (g('behavior') === 'side' ? 'side' : 'stack') as Behavior,
    bg: asColor(g('bg'), '#ffffff'),
    padding: asNum(g('padding'), 24, 0, 120),
    radius: asNum(g('radius'), 0, 0, 60),
    cells,
  }
}

export type ParseResult =
  | { ok: true; tree: ModuleTree; imported?: boolean; binding?: FieldBinding }
  | { ok: false; error: string }

// `specs` (a fields.json) gives labels and default values to the {{ module.… }} fields
// found in free code, which become real, exactly named fields of the blocks.
export function codeToTree(code: string, fallback: ModuleTree, specs?: FieldSpec[]): ParseResult {
  // HuBL comments would otherwise leak into the DOM as text.
  const cleaned = code.replace(/\{#[\s\S]*?#\}/g, '')
  const doc = new DOMParser().parseFromString(`<body>${cleaned}</body>`, 'text/html')
  sanitize(doc.body)
  const mod = doc.querySelector('[data-neon="module"]')
  const sectionEls = Array.from(doc.querySelectorAll('[data-neon="section"]')).filter((s) => !ownerSection(s))
  if (!sectionEls.length) {
    // Free HTML/HuBL without markers: convert it into editable blocks.
    const imp = importHtml(cleaned)
    if (!imp.sections.length) {
      return { ok: false, error: 'Aucun contenu reconnu — l\'aperçu garde la dernière version valide.' }
    }
    const imported: ModuleTree = {
      width: fallback.width,
      bg: imp.bg ?? fallback.bg,
      font: imp.font ?? fallback.font,
      sections: imp.sections,
    }
    const binding = bindFieldsFromCode(imported, cleaned, specs)
    return { ok: true, imported: true, tree: binding.tree, binding }
  }
  const g = (k: string) => mod?.getAttribute(`data-${k}`) ?? null
  return {
    ok: true,
    tree: {
      width: asNum(g('width'), fallback.width, 320, 900),
      bg: asColor(g('bg'), fallback.bg),
      font: g('font')?.replace(/[;{}<>"]/g, '') || fallback.font,
      sections: sectionEls.map(parseSection),
    },
  }
}

// ---------------------------------------------------------------------------
// Import: free HTML/HuBL → editable blocks (browser only)
//
// Best-effort conversion of markup without data-neon markers (pasted HTML,
// raw blocks). Headings, paragraphs, links styled as buttons, images, rules
// and layout tables become real blocks with their inline styles carried over.
// HuBL statements ({% … %}) and anything unrecognised stay raw blocks, so
// nothing is lost and the logic keeps working once exported.
// ---------------------------------------------------------------------------

interface Inherit {
  color?: string
  align?: Align
  size?: number
}

const INLINE = new Set(
  'A ABBR B BR CITE CODE DEL EM FONT I INS KBD LABEL MARK Q S SMALL SPAN STRONG SUB SUP TIME U WBR'.split(' '),
)
const CONTAINERS = new Set(
  'ADDRESS ARTICLE ASIDE BLOCKQUOTE BODY CENTER DIV FIGCAPTION FIGURE FOOTER HEADER MAIN NAV P PICTURE SECTION'.split(' '),
)

function toHex(v: string | null | undefined): string | undefined {
  const s = v?.trim().toLowerCase()
  if (!s || ['transparent', 'inherit', 'initial', 'none', 'currentcolor'].includes(s)) return
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?/.exec(s)
  if (m) {
    if (m[4] !== undefined && Number(m[4]) === 0) return
    return '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')
  }
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map((c) => c + c).join('')
  return /^#[0-9a-f]{6}$|^[a-z]+$/.test(s) ? s : undefined
}

function px(v: string | null | undefined): number | undefined {
  const m = /^([\d.]+)(px|pt|r?em)?$/.exec(v?.trim() ?? '')
  if (!m) return
  const n = Number(m[1]) * (m[2] === 'pt' ? 4 / 3 : m[2]?.endsWith('em') ? 16 : 1)
  return Number.isFinite(n) ? Math.round(n) : undefined
}

const css = (el: Element) => (el as HTMLElement).style
const bgOf = (el: Element) => toHex(css(el)?.backgroundColor) ?? toHex(el.getAttribute('bgcolor'))
const isBlank = (html: string) => !html.replace(/<[^>]*>/g, '').replace(/&nbsp;| |\s/g, '')

function styleOf(el: Element, inh: Inherit): Inherit {
  const st = css(el)
  const align = st?.textAlign || el.getAttribute('align') || (el.tagName === 'CENTER' ? 'center' : '')
  return {
    color: toHex(st?.color) ?? toHex(el.getAttribute('color')) ?? inh.color,
    align: ALIGNS.includes(align as Align) ? (align as Align) : inh.align,
    size: px(st?.fontSize) ?? inh.size,
  }
}

const isButtonLink = (el: Element) =>
  el.tagName === 'A' &&
  (!!toHex(css(el)?.backgroundColor) ||
    /inline-block|block/.test(css(el)?.display ?? '') ||
    /\b(btn|button|cta)\b/i.test(el.getAttribute('class') ?? '') ||
    el.getAttribute('role') === 'button')

const hasBlockChild = (el: Element): boolean =>
  Array.from(el.children).some((c) => !INLINE.has(c.tagName) || isButtonLink(c) || hasBlockChild(c))

const rawBlock = (html: string): Block => ({ id: uid(), type: 'raw', html: strictHtml(html.trim()) })

const textBlock = (html: string, s: Inherit): Block => ({
  id: uid(),
  type: 'text',
  html: strictHtml(html.trim()),
  color: s.color ?? '#3a3a52',
  align: s.align ?? 'left',
  size: Math.min(64, Math.max(8, s.size ?? 16)),
})

function makeSection(cells: Block[][], bg: string, padding: number, radius = 0): Section {
  const kept = cells.slice(0, 3)
  if (cells.length > 3) kept[2] = [...kept[2], ...cells.slice(3).flat()]
  return { id: uid(), type: 'section', columns: kept.length as Columns, behavior: 'stack', bg, padding, radius, cells: kept }
}

function imageBlock(img: Element, s: Inherit): Block {
  const w = css(img)?.width || img.getAttribute('width') || ''
  const pct = /%$/.test(w) ? Number.parseFloat(w) : px(w) ? (px(w)! / 600) * 100 : 100
  return {
    id: uid(),
    type: 'image',
    src: img.getAttribute('src') ?? '',
    alt: img.getAttribute('alt') ?? '',
    width: Math.round(Math.min(100, Math.max(5, pct || 100))),
    align: s.align ?? 'center',
  }
}

function buttonBlock(a: Element, s: Inherit): Block {
  const bg = toHex(css(a)?.backgroundColor)
  return {
    id: uid(),
    type: 'button',
    label: a.textContent?.trim() || 'Bouton',
    href: a.getAttribute('href') ?? '#',
    bg: bg ?? '#ff007f',
    color: toHex(css(a)?.color) ?? (bg ? s.color : undefined) ?? '#ffffff',
    align: s.align ?? 'left',
    radius: Math.min(60, px(css(a)?.borderRadius) ?? 8),
  }
}

// HuBL statements become raw blocks; the text between them stays editable.
function splitHubl(text: string, push: (b: Block) => void, addInline: (html: string) => void, flush: () => void) {
  for (const part of text.split(/(\{%[\s\S]*?%\})/)) {
    if (/^\{%/.test(part)) {
      flush()
      push(rawBlock(part))
    } else addInline(esc(part.replace(/\s+/g, ' ')))
  }
}

function convertNodes(nodes: NodeListOf<ChildNode> | ChildNode[], inh: Inherit): Block[] {
  const out: Block[] = []
  let inline = ''
  const flush = () => {
    if (!isBlank(inline)) out.push(textBlock(inline, inh))
    inline = ''
  }
  for (const node of Array.from(nodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      splitHubl(node.textContent ?? '', (b) => out.push(b), (h) => (inline += h), flush)
      continue
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue
    const el = node as Element
    if (el.hasAttribute('data-neon')) {
      const b = parseBlock(el)
      if (b) {
        flush()
        out.push(b)
        continue
      }
    }
    if (isButtonLink(el) && !el.querySelector('img')) {
      flush()
      out.push(buttonBlock(el, styleOf(el, inh)))
    } else if (INLINE.has(el.tagName) && !hasBlockChild(el)) {
      inline += el.outerHTML
    } else {
      flush()
      out.push(...convertElement(el, inh))
    }
  }
  flush()
  return out
}

function convertTable(table: Element, inh: Inherit): Block[] {
  const rows = Array.from(table.querySelectorAll('tr')).filter((tr) => tr.closest('table') === table)
  // Data tables (with headers) are content, not layout: keep them verbatim.
  if (rows.some((tr) => tr.querySelector(':scope > th'))) return [rawBlock(table.outerHTML)]
  const ts = styleOf(table, inh)
  const out: Block[] = []
  for (const tr of rows) {
    const rs = styleOf(tr, ts)
    const cells = Array.from(tr.children)
      .filter((td) => td.tagName === 'TD')
      // A cell's align="center" around a nested table centres the table, not its text.
      .map((td) => ({ td, blocks: convertNodes(td.childNodes, td.querySelector(':scope > table') ? rs : styleOf(td, rs)) }))
      .filter((c) => c.blocks.length) // drop empty gutter cells
    if (cells.length === 1) {
      const { td, blocks } = cells[0]
      const bg = bgOf(td)
      out.push(...(bg ? [makeSection([blocks], bg, px(css(td)?.paddingTop) ?? 16)] : blocks))
    } else if (cells.length > 1) {
      const bg = bgOf(tr) ?? bgOf(cells[0].td) ?? 'transparent'
      out.push(makeSection(cells.map((c) => c.blocks), bg, px(css(cells[0].td)?.paddingTop) ?? 8))
    }
  }
  const bg = bgOf(table)
  return bg && out.length ? [makeSection([out], bg, 16, px(css(table)?.borderRadius) ?? 0)] : out
}

function convertElement(el: Element, inh: Inherit): Block[] {
  const tag = el.tagName
  const s = styleOf(el, inh)
  if (/^H[1-6]$/.test(tag)) {
    const level = Math.min(3, Number(tag[1])) as 1 | 2 | 3
    const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (!text) return []
    return [
      {
        id: uid(),
        type: 'heading',
        text,
        level,
        color: s.color ?? '#0f0f1a',
        align: s.align ?? 'left',
        size: Math.min(96, Math.max(8, s.size ?? [32, 26, 20][level - 1])),
      },
    ]
  }
  switch (tag) {
    case 'IMG':
      return [imageBlock(el, s)]
    case 'HR':
      return [{ id: uid(), type: 'divider', color: toHex(css(el)?.borderTopColor) ?? toHex(el.getAttribute('color')) ?? '#e3e3ee' }]
    case 'BR':
    case 'STYLE':
    case 'TITLE':
    case 'HEAD':
      return []
    case 'UL':
    case 'OL':
    case 'DL':
      return [textBlock(el.outerHTML, s)]
    case 'TABLE':
      return convertTable(el, s)
  }
  if (CONTAINERS.has(tag) || INLINE.has(tag)) {
    if (isBlank(el.innerHTML) && !el.querySelector('img')) {
      const h = px(css(el)?.height) ?? px(el.getAttribute('height'))
      return h ? [{ id: uid(), type: 'spacer', height: Math.min(400, h) }] : []
    }
    const blocks = convertNodes(el.childNodes, s)
    // A box with its own background becomes a card.
    const bg = tag !== 'BODY' ? bgOf(el) : undefined
    return bg && blocks.length
      ? [makeSection([blocks], bg, px(css(el)?.paddingTop) ?? 16, px(css(el)?.borderRadius) ?? 0)]
      : blocks
  }
  // Video, form, svg…: kept verbatim.
  return [rawBlock(el.outerHTML)]
}

// Classic web code styles its markup from <style> sheets: copy those rules
// into inline styles so the importer sees the colours, sizes and boxes. Rules
// apply in source order and the element's own inline style always wins.
// Media queries and pseudo-elements are skipped.
function inlineStylesheets(doc: Document) {
  const text = Array.from(doc.querySelectorAll('style'))
    .map((s) => s.textContent ?? '')
    .join('\n')
  if (!text.trim() || typeof CSSStyleSheet === 'undefined') return
  const sheet = new CSSStyleSheet()
  try {
    sheet.replaceSync(text)
  } catch {
    return
  }
  const acc = new Map<Element, string>()
  for (const rule of Array.from(sheet.cssRules)) {
    if (!(rule instanceof CSSStyleRule) || !rule.style.cssText) continue
    let els: Element[]
    try {
      els = Array.from(doc.querySelectorAll(rule.selectorText))
    } catch {
      continue
    }
    for (const el of els) acc.set(el, `${acc.get(el) ?? ''}${rule.style.cssText}`)
  }
  for (const [el, rules] of acc) el.setAttribute('style', `${rules}${el.getAttribute('style') ?? ''}`)
}

function parseFragment(html: string) {
  const doc = new DOMParser().parseFromString(html.replace(/\{#[\s\S]*?#\}/g, ''), 'text/html')
  sanitize(doc.body)
  inlineStylesheets(doc)
  return doc.body
}

// Blocks for a column (used to convert a raw block in place).
export function htmlToBlocks(html: string): Block[] {
  return convertNodes(parseFragment(html).childNodes, {})
}

// Whole-module import: loose blocks are grouped into sections, and the outer
// wrappers typical of email layouts give the module and content backgrounds.
export function importHtml(html: string): { sections: Section[]; bg?: string; font?: string } {
  const body = parseFragment(html)
  let blocks = convertNodes(body.childNodes, {})
  const wrappers: string[] = []
  while (blocks.length === 1 && blocks[0].type === 'section' && blocks[0].columns === 1) {
    wrappers.push(blocks[0].bg)
    blocks = blocks[0].cells[0]
  }
  const contentBg = wrappers.at(-1) ?? '#ffffff'
  const sections: Section[] = []
  let loose: Block[] = []
  const flush = () => {
    if (loose.length) sections.push(makeSection([loose], contentBg, 24))
    loose = []
  }
  for (const b of blocks) {
    if (b.type === 'section') {
      flush()
      sections.push(b)
    } else loose.push(b)
  }
  flush()
  const fontEl = css(body).fontFamily ? body : body.querySelector('[style*="font-family"]')
  const font = fontEl ? css(fontEl).fontFamily.replace(/"/g, "'").replace(/[;{}<>]/g, '') : ''
  return { sections, bg: wrappers.length > 1 ? wrappers[0] : bgOf(body), font: font || undefined }
}

// Parsing assigns fresh ids; carry over ids from the previous tree wherever the
// same kind of node sits at the same position, so selection survives typing.
export function reconcileIds(next: ModuleTree, prev: ModuleTree): ModuleTree {
  const list = (a: Block[], b: Block[] | undefined): Block[] =>
    a.map((node, i) => {
      const old = b?.[i]
      if (!old || old.type !== node.type) return node
      if (node.type === 'section' && old.type === 'section') {
        return { ...node, id: old.id, cells: node.cells.map((c, j) => list(c, old.cells[j])) }
      }
      return { ...node, id: old.id }
    })
  return { ...next, sections: list(next.sections, prev.sections) as Section[] }
}

// Sanitize a fragment produced outside the parser (e.g. Maily rewrites).
export const sanitizeHtml = strictHtml

// Self-contained HTML file with real content, for testing in a browser or an
// email tester before uploading the module to HubSpot.
export function standaloneEmail(tree: ModuleTree, name: string): string {
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>
body { margin: 0; }
${STACK_CSS}
</style>
</head>
<body>
${renderModule(tree, new Ctx('sync', tree))}
</body>
</html>
`
}

// What the platform would render for a sample contact: HuBL interpreted
// ({% if %} branches resolved, variables replaced). For previews only; the
// exported files keep the HuBL.
export function previewEmail(tree: ModuleTree, name: string, contact: SampleContact = 'known'): string {
  return standaloneEmail(interpretTree(tree, previewScope(tree, contact)), name)
}
