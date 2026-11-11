import { collectFields } from './fields'
import type { FieldBlock, ModuleField } from './fields'
import { Parser } from 'htmlparser2'
import { interpretForPreview } from './hubl-render'
import type { SampleContact } from './hubl-render'
import { analyzeFieldRefs, exposedNames, hubspotField } from './extra-fields'
import { bindFieldsFromCode } from './module-fields'
import { isSafeUrl, sanitizeCssText, sanitizeHtml as strictHtml, sanitizeStyle } from './sanitize'
import type { FieldBinding, FieldSpec } from './module-fields'
import { olAttr, olParse, olStyle } from './outlook'
import { protectHubl, restoreDom, restoreTree } from './hubl-protect'
import { normalizeHubl, withLegacySpecs } from './hubl-legacy'
import { classAttr, columnWidths, dividerLine, headingLine, headingWeight, hasSpacing, hideClass, hideStyle, marginCss, responsiveCss, safeBgImage, sectionPad, spacingAttrs, spacingOf, spacingParse, textLine } from './look'
import { buttonBold, buttonBorder, buttonBorderColor, buttonFontSize, buttonWidth, msoCell, msoOnly, notMso, outlookHeight, vmlShape } from './vml'
import { uid } from './types'
import type { Align, Behavior, Block, Columns, ExtraField, FieldDef, ModuleTree, RawBlock, Section } from './types'

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

// Escapes text but leaves HuBL tokens ({{ … }}, {% … %}) untouched, so the
// variables of pasted code keep working.
const HUBL_TOKEN = /(\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\})/
const hasHubl = (s: string) => /\{[{%]/.test(s)
export const escKeep = (s: string) => s.split(HUBL_TOKEN).map((part, i) => (i % 2 ? part : esc(part))).join('')

const STACK_CSS = `@media only screen and (max-width: 480px) {
  .neon-stack > tbody > tr > .neon-col, .neon-stack > tr > .neon-col { display: block !important; width: 100% !important; box-sizing: border-box; }
}`

type Mode = 'sync' | 'hubspot'

interface Field {
  name: string
  label: string
  type: 'text' | 'richtext' | 'link' | 'image'
  default: unknown
  // Exact definition from an imported fields.json (type, label, display…).
  spec?: Record<string, unknown>
}

class Ctx {
  fields: Field[] = []
  defs: Map<string, ModuleField>
  vml: boolean
  /** Rendered for display (standalone preview): templates kept as written are shown, not wrapped for the code. */
  shown = false
  constructor(public mode: Mode, tree: ModuleTree) {
    this.vml = !!tree.vml
    this.defs = new Map(mode === 'hubspot' ? collectFields(tree).map((f) => [f.block.id, f]) : [])
  }
  // Registers a fields.json entry for the block and returns its HuBL name.
  field(b: FieldBlock, suffix: string, labelSuffix: string, type: Field['type'], def: unknown, exact?: string) {
    const f = this.defs.get(b.id)!
    const name = exact || (suffix ? `${f.name}_${suffix}` : f.name)
    const spec = (b as { field?: FieldDef }).field?.specs?.[name]
    this.fields.push({ name, label: labelSuffix ? `${f.label} · ${labelSuffix}` : f.label, type, default: def, ...(spec ? { spec } : {}) })
    return name
  }
  // The block is one of the module's fields (not fixed content, not holding variables).
  isField(b: { id: string }) {
    return this.mode === 'hubspot' && this.defs.has(b.id)
  }
  // Custom field definition, kept in the sync format so it survives code edits.
  fieldAttrs(b: FieldBlock): Record<string, string> {
    if (!b.field) return {}
    return {
      field: b.field.name,
      label: b.field.label,
      ...(b.field.textName ? { 'field-text': b.field.textName } : {}),
      // The exact imported definition (fields.json) survives code edits.
      ...(b.field.specs && Object.keys(b.field.specs).length ? { 'field-specs': JSON.stringify(b.field.specs) } : {}),
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
const indent = (text: string, by: string) => text.split('\n').map((l) => by + l).join('\n')

// `avail` is the content width (px) available to the node, used for the pixel
// width attribute of images (Outlook on Windows ignores percentage widths).
function renderBlock(b: Block, ctx: Ctx, d: number, font: string, avail: number): string {
  const p = pad(d)
  const sp = spacingOf(b)
  switch (b.type) {
    case 'heading': {
      // Content that holds a variable stays in place: it is not a field of its own.
      const content = ctx.isField(b) ? `{{ module.${ctx.field(b, '', '', 'text', b.text)} }}` : escKeep(b.text)
      return `${p}<h${b.level}${ctx.attrs({ neon: 'heading', ...ctx.fieldAttrs(b), align: b.align, color: b.color, size: b.size, ...(b.lineHeight != null ? { lh: b.lineHeight } : {}), ...(b.weight != null ? { weight: b.weight } : {}), ...(b.letterSpacing ? { ls: b.letterSpacing } : {}), ...(b.fixed ? { fixed: 1 } : {}), ...spacingAttrs(b), ...olAttr(b.outlook) })}${classAttr(hideClass(b.hide))} style="${hideStyle(b.hide)}${marginCss(sp.t, sp.b, sp.l, sp.r)}font-family:${esc(font)};font-size:${b.size}px;line-height:${headingLine(b)};font-weight:${headingWeight(b)};${b.letterSpacing ? `letter-spacing:${b.letterSpacing}px;` : ''}color:${escKeep(b.color)};text-align:${b.align};${olStyle(b.outlook, { line: true })}">${content}</h${b.level}>`
    }
    case 'text': {
      const content = ctx.isField(b) ? `{{ module.${ctx.field(b, '', '', 'richtext', b.html)} }}` : b.html
      return `${p}<div${ctx.attrs({ neon: 'text', ...ctx.fieldAttrs(b), align: b.align, color: b.color, size: b.size, ...(b.lineHeight != null ? { lh: b.lineHeight } : {}), ...(b.letterSpacing ? { ls: b.letterSpacing } : {}), ...(b.fixed ? { fixed: 1 } : {}), ...spacingAttrs(b), ...olAttr(b.outlook) })}${classAttr(hideClass(b.hide))} style="${hideStyle(b.hide)}${marginCss(sp.t, sp.b, sp.l, sp.r)}font-family:${esc(font)};font-size:${b.size}px;line-height:${textLine(b)};${b.letterSpacing ? `letter-spacing:${b.letterSpacing}px;` : ''}color:${escKeep(b.color)};text-align:${b.align};${olStyle(b.outlook, { line: true })}">${content}</div>`
    }
    case 'button': {
      // javascript:, data: and other schemes never reach the generated code.
      let href = isSafeUrl(b.href) ? escKeep(b.href) : '#'
      let label = escKeep(b.label)
      if (ctx.isField(b)) {
        if (!hasHubl(b.label)) label = `{{ module.${ctx.field(b, 'label', 'texte', 'text', b.label, b.field?.textName)} }}`
        if (!hasHubl(b.href)) {
          const u = ctx.field(
            b,
            'link',
            'lien',
            'link',
            { url: { content_id: null, type: 'EXTERNAL', href: b.href }, open_in_new_tab: true, no_follow: false },
            b.field?.linkName,
          )
          href = `{{ module.${u}.url.href }}`
        }
      }
      const bw = buttonBorder(b)
      const px = b.padX ?? 26
      const pad = b.height ? `padding:0 ${px}px;line-height:${b.height - 2 * bw}px;` : `padding:${b.padY ?? 12}px ${px}px;`
      const border = bw ? `border:${bw}px solid ${escKeep(buttonBorderColor(b))};` : ''
      const link = `<a href="${href}" target="_blank" rel="noopener noreferrer" style="display:${b.fullWidth ? 'block;text-align:center' : 'inline-block'};${pad}background:${escKeep(b.bg)};color:${escKeep(b.color)};${border}border-radius:${b.radius}px;font-family:${esc(font)};font-size:${buttonFontSize(b)}px;font-weight:${buttonBold(b) ? 700 : 400};text-decoration:none;">${label}</a>`
      // With VML on, Outlook for Windows gets a drawn shape (rounded, padded,
      // clickable); every other client keeps the plain link.
      const inner = ctx.vml
        ? `${indent(msoOnly(vmlShape({ href, label, bg: escKeep(b.bg), color: escKeep(b.color), radius: b.radius, font: esc(font), width: b.fullWidth ? Math.round(avail) : (b.vmlWidth ?? buttonWidth(b.label, b)), height: outlookHeight(b), fontSize: buttonFontSize(b), bold: buttonBold(b), borderWidth: bw, borderColor: escKeep(buttonBorderColor(b)) })), p + '  ')}
${indent(notMso(`  ${link}`), p + '  ')}`
        : b.msoCell
          ? (() => {
              // Outlook without VML: a coloured cell around the link (see msoCell).
              const [open, close] = msoCell({ bg: escKeep(b.bg), align: b.align, look: b.vmlHeight ? { ...b, height: b.vmlHeight } : b, width: b.fullWidth ? Math.round(avail) : b.vmlWidth, border })
              return `${p}  ${open}\n${p}  ${link}\n${p}  ${close}`
            })()
          : `${p}  ${link}`
      return `${p}<div${ctx.attrs({ neon: 'button', ...ctx.fieldAttrs(b), align: b.align, bg: b.bg, color: b.color, radius: b.radius, ...(b.vmlWidth ? { 'vml-width': b.vmlWidth } : {}), ...(b.vmlHeight ? { 'vml-height': b.vmlHeight } : {}), ...(b.height ? { height: b.height } : {}), ...(b.fontSize ? { 'font-size': b.fontSize } : {}), ...(b.bold === false ? { bold: 0 } : {}), ...(bw ? { 'border-width': bw, 'border-color': b.borderColor || b.color } : {}), ...(b.msoCell ? { 'mso-cell': 1 } : {}), ...(b.fullWidth ? { full: 1 } : {}), ...(b.padX != null ? { 'pad-x': b.padX } : {}), ...(b.padY != null ? { 'pad-y': b.padY } : {}), ...(b.fixed ? { fixed: 1 } : {}), ...spacingAttrs(b), ...olAttr(b.outlook) })}${classAttr(hideClass(b.hide))} style="${hideStyle(b.hide)}${marginCss(sp.t, sp.b, sp.l, sp.r)}text-align:${b.align};${olStyle(b.outlook)}">
${inner}
${p}</div>`
    }
    case 'image': {
      let src = isSafeUrl(b.src, true) ? escKeep(b.src) : ''
      let alt = escKeep(b.alt)
      if (ctx.isField(b)) {
        const f = ctx.field(b, '', '', 'image', { src: b.src, alt: b.alt, loading: 'lazy' })
        src = `{{ module.${f}.src }}`
        alt = `{{ module.${f}.alt }}`
      }
      // Optional link (CTA image) and rounded corners.
      let link = b.href && isSafeUrl(b.href) ? escKeep(b.href) : ''
      if (link && ctx.mode === 'hubspot' && !hasHubl(b.href!) && ctx.defs.has(b.id)) {
        const u = ctx.field(b, 'link', 'lien', 'link', { url: { content_id: null, type: 'EXTERNAL', href: b.href }, open_in_new_tab: true, no_follow: false })
        link = `{{ module.${u}.url.href }}`
      }
      const img = `<img src="${src}" alt="${alt}" width="${b.outlook?.w ?? Math.round((avail * b.width) / 100)}" style="display:inline-block;width:${b.width}%;max-width:100%;height:auto;border:0;${b.radius ? `border-radius:${b.radius}px;` : ''}">`
      return `${p}<div${ctx.attrs({ neon: 'image', ...ctx.fieldAttrs(b), align: b.align, width: b.width, ...(b.href ? { href: b.href } : {}), ...(b.radius ? { radius: b.radius } : {}), ...(b.fixed ? { fixed: 1 } : {}), ...spacingAttrs(b), ...olAttr(b.outlook) })}${classAttr(hideClass(b.hide))} style="${hideStyle(b.hide)}${marginCss(sp.t, sp.b, sp.l, sp.r)}text-align:${b.align};${olStyle(b.outlook)}">
${p}  ${link ? `<a href="${link}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;">${img}</a>` : img}
${p}</div>`
    }
    case 'divider':
      return `${p}<hr${ctx.attrs({ neon: 'divider', color: b.color, ...(b.thickness ? { thickness: b.thickness } : {}), ...(b.lineStyle && b.lineStyle !== 'solid' ? { style: b.lineStyle } : {}), ...(b.width && b.width < 100 ? { width: b.width } : {}), ...spacingAttrs(b), ...olAttr(b.outlook) })}${classAttr(hideClass(b.hide))} style="${hideStyle(b.hide)}border:0;border-top:${esc(dividerLine(b))};${b.width && b.width < 100 ? `margin:${sp.t}px ${b.mr != null ? `${sp.r}px` : 'auto'} ${sp.b}px ${b.ml != null ? `${sp.l}px` : 'auto'};width:${b.width}%;` : marginCss(sp.t, sp.b, sp.l, sp.r)}${olStyle(b.outlook)}">`
    case 'spacer':
      return `${p}<div${ctx.attrs({ neon: 'spacer', height: b.height, ...(b.mobileHeight != null ? { 'mobile-height': b.mobileHeight } : {}), ...spacingAttrs(b), ...olAttr(b.outlook) })}${classAttr(hideClass(b.hide), b.mobileHeight != null ? `neon-mh-${b.mobileHeight}` : '')} style="${hideStyle(b.hide)}${hasSpacing(b) ? marginCss(sp.t, sp.b, sp.l, sp.r) : ''}height:${b.height}px;line-height:${b.height}px;font-size:0;${b.outlook?.h != null ? `mso-line-height-alt:${b.outlook.h}px;mso-line-height-rule:exactly;` : ''}${olStyle(b.outlook)}">&nbsp;</div>`
    case 'raw':
      if (b.verbatim) return verbatimCode(b, ctx.shown ? 'hubspot' : ctx.mode, p)
      return ctx.mode === 'hubspot' ? `${p}${b.html}` : `${p}<div data-neon="raw"${b.cols ? ` data-cols="${b.cols}"` : ''}>${b.html}</div>`
    case 'section':
      return renderSection(b, ctx, d, font, true, avail)
  }
}

// A column's blocks. In the exported module, a `{% for %}` set to N columns opens a
// table row whose cells the loop writes (side by side, stacked on phones).
function renderCell(cell: Block[], ctx: Ctx, d: number, font: string, avail: number): string {
  const p = pad(d)
  const open: (number | null)[] = []
  let width = avail
  return cell
    .map((b) => {
      const st = b.type === 'raw' ? /^\s*\{%-?\s*(for|endfor)\b/.exec(b.html)?.[1] : undefined
      if (st === 'for') open.push(b.type === 'raw' && b.cols && ctx.mode === 'hubspot' ? b.cols : null)
      if (b.type === 'raw' && st === 'for' && b.cols && ctx.mode === 'hubspot') {
        width = Math.max(40, avail / b.cols - 12)
        return `${p}<table role="presentation" class="neon-stack" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${b.html}<td class="neon-col" width="${Math.floor(100 / b.cols)}%" valign="top" style="padding:0 6px;">`
      }
      if (st === 'endfor') {
        const cols = open.pop()
        if (cols) {
          width = avail
          return `${p}</td>${(b as { html: string }).html}</tr></table>`
        }
      }
      return renderBlock(b, ctx, d, font, width)
    })
    .join('\n')
}

function renderSection(s: Section, ctx: Ctx, d: number, font: string, nested: boolean, avail: number): string {
  const p = pad(d)
  const widths = columnWidths(s)
  const { x: padX, t: padT, b: padB, l: padL, r: padR } = sectionPad(s)
  const cls = `neon-section${s.behavior === 'stack' ? ' neon-stack' : ''}${s.hide ? ` ${hideClass(s.hide)}` : ''}`
  const cells = s.cells
    .map((cell, i) => {
      const left = i === 0 ? padL : padX / 2
      const right = i === s.cells.length - 1 ? padR : padX / 2
      // Equal columns keep the historical computation (same pixel widths as before).
      const inner = s.columns === 2 && s.ratio && s.ratio !== 50 ? Math.max(40, (avail * widths[i]) / 100 - left - right) : Math.max(40, (avail - padL - padR - padX * (s.columns - 1)) / s.columns)
      const blocks = renderCell(cell, ctx, d + 3, font, inner)
      const op = s.outlook?.pad
      const msoPad = op != null ? `mso-padding-alt:${op}px ${i === s.cells.length - 1 ? op : op / 2}px ${op}px ${i === 0 ? op : op / 2}px;` : ''
      return `${p}    <td${ctx.attrs({ neon: 'column' })} class="neon-col" width="${widths[i]}%" valign="${s.valign ?? 'top'}" style="padding:${padT}px ${right}px ${padB}px ${left}px;${msoPad}">
${blocks}
${p}    </td>`
    })
    .join('\n')
  const sp = spacingOf(s, nested)
  const margin = nested || s.mt != null || s.mb != null ? marginCss(sp.t, sp.b, sp.l, sp.r) : ''
  const border = s.borderWidth ? `border:${s.borderWidth}px solid ${escKeep(s.borderColor ?? '#e3e3ee')};` : ''
  const img = safeBgImage(s.bgImage)
  // The colour stays first: Outlook (and anyone blocking images) shows it.
  const bgImg = img ? `background-image:url('${img}');background-size:cover;background-position:center;` : ''
  return `${p}<table${ctx.attrs({
    neon: 'section',
    columns: s.columns,
    behavior: s.behavior,
    bg: s.bg,
    padding: s.padding,
    radius: s.radius,
    ...(s.padY != null ? { 'pad-y': s.padY } : {}),
    ...(s.padX != null ? { 'pad-x': s.padX } : {}),
    ...(s.pt != null ? { 'pad-t': s.pt } : {}),
    ...(s.pr != null ? { 'pad-r': s.pr } : {}),
    ...(s.pb != null ? { 'pad-b': s.pb } : {}),
    ...(s.pl != null ? { 'pad-l': s.pl } : {}),
    ...(s.borderWidth ? { 'border-width': s.borderWidth, 'border-color': s.borderColor ?? '#e3e3ee' } : {}),
    ...(img ? { 'bg-image': img } : {}),
    ...(s.columns === 2 && s.ratio && s.ratio !== 50 ? { ratio: s.ratio } : {}),
    ...(s.valign && s.valign !== 'top' ? { valign: s.valign } : {}),
    ...(s.css ? { css: s.css } : {}),
    ...(s.name ? { name: s.name } : {}),
    ...spacingAttrs(s),
    ...olAttr(s.outlook),
  })} class="${cls}" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"${img ? ` background="${img}"` : ''} style="${hideStyle(s.hide)}width:100%;background:${escKeep(s.bg)};${bgImg}${border}border-radius:${s.radius}px;border-collapse:separate;${margin}${s.css ? `${s.css};` : ''}${olStyle(s.outlook)}">
${p}  <tr>
${cells}
${p}  </tr>
${p}</table>`
}

function renderModule(tree: ModuleTree, ctx: Ctx): string {
  const body = tree.sections.map((s) => renderSection(s, ctx, 3, tree.font, false, tree.width)).join('\n')
  // The conditional "ghost" table gives Outlook on Windows (which ignores
  // max-width) a fixed width; other clients skip it as a comment.
  return `<div${ctx.attrs({ neon: 'module', width: tree.width, bg: tree.bg, font: tree.font, ...(tree.vml ? { vml: 1 } : {}), ...(tree.pad != null ? { pad: tree.pad } : {}) })} style="background:${esc(tree.bg)};padding:${tree.pad ?? 24}px 0;">
  <!--[if mso]><table role="presentation" width="${tree.width}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${tree.width}px;margin:0 auto;">
    <tr><td>
${body}
    </td></tr>
  </table>
  <!--[if mso]></td></tr></table><![endif]-->
</div>`
}

// A template kept as written: in the code, inside a <script type="text/hubl">
// (never parsed as HTML, so cells printed by macros or loops stay where they are).
const VERBATIM_RE = /<script type="text\/hubl" data-neon="raw"( data-cols="[23]")?>([\s\S]*?)<\/script>/g
const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/gi
function verbatimCode(b: RawBlock, mode: Mode, p: string): string {
  const css = b.css ? `<style type="text/css">\n${b.css}\n</style>\n` : ''
  if (mode === 'hubspot') return `${p}${css}${b.html}`
  const body = `${css}${b.html}`.replace(/<\/(script)/gi, '<\\/$1')
  return `${p}<script type="text/hubl" data-neon="raw"${b.cols ? ` data-cols="${b.cols}"` : ''}>\n${body}\n${p}</script>`
}
/** A verbatim template from its code: <style> sheets apart, the rest sanitized as is. */
export function verbatimBlock(src: string, cols?: number): RawBlock {
  const sheets: string[] = []
  const html = src.replace(/<\\\/script/gi, '</script').replace(STYLE_RE, (_m, css: string) => (sheets.push(css.trim()), '')).trim()
  const css = sanitizeCssText(sheets.filter(Boolean).join('\n\n'))
  return { id: uid(), type: 'raw', html: strictHtml(html).trim(), verbatim: true, ...(css ? { css } : {}), ...(cols === 2 || cols === 3 ? { cols } : {}) }
}

export function treeToCode(tree: ModuleTree, name: string): string {
  return `{# Neon Sandbox Pro · ${name.replace(/#}/g, '')}
   Édite le contenu et les attributs data-* : l'aperçu se met à jour en direct.
   Tout HTML/HuBL sans data-neon dans une colonne est conservé comme bloc brut. #}
<style>
${STACK_CSS}${responsiveCss(tree)}
</style>
${renderModule(tree, new Ctx('sync', tree))}
`
}

// Fields for every `module.<name>` the module's code uses that no block
// exposes: created when HuBL is pasted, kept while the variable is still in
// the code, with the user's edits (label, type, value) preserved. The variable
// itself is never touched: it stays where it is in the content.
// `source`: the imported code itself. Its fields are read from it (some of its
// references, in styles the converter doesn't keep, are not in the regenerated
// code) and kept afterwards even when the code stops using them.
export function syncExtraFields(tree: ModuleTree, specs?: FieldSpec[], source?: string): ModuleTree {
  const code = treeToCode(tree, '') + (source ? `\n${source}` : '')
  const prev = new Map((tree.fields ?? []).map((f) => [f.name, f]))
  const exposed = exposedNames(tree)
  let fields: ExtraField[] = []
  if (/\b(module|widget)\./.test(code) || specs?.length) {
    fields = analyzeFieldRefs(code, specs)
      .filter((f) => !exposed.has(f.name))
      .map((f) => (specs?.length || source ? f : (prev.get(f.name) ?? f)))
  }
  if (source) fields = fields.map((f) => (f.keep ? f : { ...f, keep: true }))
  const names = new Set(fields.map((f) => f.name))
  for (const f of prev.values()) if (f.keep && !names.has(f.name) && !exposed.has(f.name)) fields.push(f)
  if (JSON.stringify(fields) === JSON.stringify(tree.fields ?? [])) return tree
  const { fields: _old, ...rest } = tree
  void _old
  return fields.length ? { ...rest, fields } : rest
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
  // A field imported with its fields.json definition keeps it (exact type, label, options).
  const fields = ctx.fields.map((f) => ({
    name: f.name,
    label: f.label,
    type: f.type,
    required: false,
    locked: false,
    ...(f.spec ?? {}),
    default: f.default,
  }))
  // Variables the code uses that no block owns (dates, conditions, repeaters…).
  const own = new Set(fields.map((f) => f.name))
  const extra = (tree.fields ?? []).filter((f) => !own.has(f.name)).map(hubspotField)
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
    'module.css': `${STACK_CSS}${responsiveCss(tree)}\n`,
    'fields.json': JSON.stringify([...fields, ...extra], null, 2) + '\n',
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
// Optional number attribute: absent stays absent (the default look is kept).
const optNum = (v: string | null, key: string, min: number, max: number, round = true): Record<string, number> => {
  if (v === null || v.trim() === '' || !Number.isFinite(Number(v))) return {}
  const n = Math.min(max, Math.max(min, Number(v)))
  return { [key]: round ? Math.round(n) : Math.round(n * 100) / 100 }
}
// A colour may be a module variable ({{ module.style.fond.color }}): kept, interpreted by the preview.
const asColor = (v: string | null, def: string) => (v && (/^#[0-9a-f]{3,8}$|^[a-z]+$|^rgba?\(/i.test(v.trim()) || /^\{\{[^"'<>;{}]*\}\}$/.test(v.trim())) ? v.trim() : def)

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
  const b = parseBlockInner(el)
  if (!b || b.type === 'raw' || b.type === 'section') return b
  const fixed = el.getAttribute('data-fixed') === '1' && (b.type === 'heading' || b.type === 'text' || b.type === 'button' || b.type === 'image') ? { fixed: true } : {}
  return { ...b, ...fixed, ...spacingParse((k) => el.getAttribute(`data-${k}`)), ...olParse(el.getAttribute('data-ol')) }
}

// data-field-specs: { name: { type, label, … } } (validated again by sanitizeTree on save).
function fieldSpecs(raw: string | null): Pick<FieldDef, 'specs'> {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    const specs = Object.fromEntries(Object.entries(v).filter(([k, x]) => /^[A-Za-z_]\w{0,59}$/.test(k) && x && typeof x === 'object' && !Array.isArray(x)).slice(0, 4))
    return Object.keys(specs).length ? { specs: specs as FieldDef['specs'] } : {}
  } catch {
    return {}
  }
}

function parseBlockInner(el: Element): Block | null {
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
          ...fieldSpecs(g('field-specs')),
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
        ...optNum(g('lh'), 'lineHeight', 0.8, 3, false),
        ...optNum(g('weight'), 'weight', 100, 900),
        ...optNum(g('ls'), 'letterSpacing', -5, 20),
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
        ...optNum(g('lh'), 'lineHeight', 0.8, 3, false),
        ...optNum(g('ls'), 'letterSpacing', -5, 20),
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
        ...(g('vml-width') ? { vmlWidth: asNum(g('vml-width'), 160, 80, 600) } : {}),
        ...(g('vml-height') ? { vmlHeight: asNum(g('vml-height'), 44, 20, 120) } : {}),
        ...(g('height') ? { height: asNum(g('height'), 42, 24, 100) } : {}),
        ...(g('font-size') ? { fontSize: asNum(g('font-size'), 15, 10, 36) } : {}),
        ...(g('bold') === '0' ? { bold: false } : {}),
        ...(g('mso-cell') === '1' ? { msoCell: true } : {}),
        ...(g('full') === '1' ? { fullWidth: true } : {}),
        ...optNum(g('pad-x'), 'padX', 0, 80),
        ...optNum(g('pad-y'), 'padY', 0, 60),
        ...(g('border-width') ? { borderWidth: asNum(g('border-width'), 1, 1, 8), borderColor: asColor(g('border-color'), '#ffffff') } : {}),
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
        ...(g('href') && isSafeUrl(g('href')!) ? { href: g('href')! } : {}),
        ...optNum(g('radius'), 'radius', 0, 200),
      }
    }
    case 'divider':
      return {
        id,
        type: 'divider',
        color: asColor(g('color'), '#e3e3ee'),
        ...optNum(g('thickness'), 'thickness', 1, 20),
        ...(g('style') === 'dashed' || g('style') === 'dotted' ? { lineStyle: g('style') as 'dashed' | 'dotted' } : {}),
        ...optNum(g('width'), 'width', 5, 100),
      }
    case 'spacer':
      return { id, type: 'spacer', height: asNum(g('height'), 24, 0, 400), ...optNum(g('mobile-height'), 'mobileHeight', 0, 400) }
    case 'raw': {
      const cols = Number(el.getAttribute('data-cols'))
      const kept = el.getAttribute('data-verbatim')
      if (kept !== null && verbatimStore[Number(kept)] !== undefined) return { ...verbatimBlock(verbatimStore[Number(kept)], cols), id }
      return { id, type: 'raw', html: strictHtml(el.innerHTML.trim()), ...(cols === 2 || cols === 3 ? { cols: cols as 2 | 3 } : {}) }
    }
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

// A section's name in the Structure: plain text, one line, 40 characters at most.
export const sectionName = (v: unknown) => (typeof v === 'string' ? v.replace(/[<>{}]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) : '')

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
    ...optNum(g('pad-y'), 'padY', 0, 200),
    ...optNum(g('pad-x'), 'padX', 0, 200),
    ...optNum(g('pad-t'), 'pt', 0, 200),
    ...optNum(g('pad-r'), 'pr', 0, 200),
    ...optNum(g('pad-b'), 'pb', 0, 200),
    ...optNum(g('pad-l'), 'pl', 0, 200),
    ...(g('border-width') ? { ...optNum(g('border-width'), 'borderWidth', 1, 20), borderColor: asColor(g('border-color'), '#e3e3ee') } : {}),
    ...(safeBgImage(g('bg-image') ?? '') ? { bgImage: safeBgImage(g('bg-image')!) } : {}),
    ...(cells.length === 2 ? optNum(g('ratio'), 'ratio', 20, 80) : {}),
    ...(g('valign') === 'middle' || g('valign') === 'bottom' ? { valign: g('valign') as 'middle' | 'bottom' } : {}),
    ...(g('css') && sanitizeStyle(g('css')!) ? { css: sanitizeStyle(g('css')!) } : {}),
    ...(sectionName(g('name')) ? { name: sectionName(g('name')) } : {}),
    ...spacingParse(g),
    ...olParse(g('ol')),
    cells,
  }
}

export type ParseResult =
  | { ok: true; tree: ModuleTree; imported?: boolean; binding?: FieldBinding }
  | { ok: false; error: string }

// `specs` (a fields.json) gives labels and default values to the {{ module.… }} fields
// found in free code, which become real, exactly named fields of the blocks.
// Verbatim templates of the code being parsed, out of the HTML parser's reach.
let verbatimStore: string[] = []

export function codeToTree(code: string, fallback: ModuleTree, specs?: FieldSpec[]): ParseResult {
  verbatimStore = []
  // Templates kept as written leave the HTML before parsing (placeholders).
  const lifted = code.replace(VERBATIM_RE, (_m, cols: string | undefined, body: string) => `<div data-neon="raw"${cols ?? ''} data-verbatim="${verbatimStore.push(body) - 1}"></div>`)
  // HuBL comments would otherwise leak into the DOM as text.
  const cleaned = lifted.replace(/\{#[\s\S]*?#\}/g, '')
  const prot = protectHubl(cleaned)
  const doc = new DOMParser().parseFromString(`<body>${prot.html}</body>`, 'text/html')
  restoreDom(doc.body, prot.tokens)
  sanitize(doc.body)
  const mod = doc.querySelector('[data-neon="module"]')
  const sectionEls = Array.from(doc.querySelectorAll('[data-neon="section"]')).filter((s) => !ownerSection(s))
  if (!sectionEls.length) {
    // Free HTML/HuBL without markers: convert it into editable blocks.
    // module['x'], widget_data.x.value and the old template tags read as module.x.
    const src = normalizeHubl(cleaned)
    const imp = importHtml(src)
    if (!imp.sections.length) {
      return { ok: false, error: 'Aucun contenu reconnu — l\'aperçu garde la dernière version valide.' }
    }
    const imported: ModuleTree = {
      width: fallback.width,
      bg: imp.bg ?? fallback.bg,
      font: imp.font ?? fallback.font,
      sections: imp.sections,
    }
    const binding = bindFieldsFromCode(imported, src, withLegacySpecs(cleaned, specs))
    // A HubSpot module: its fields are the ones it declares. Its other texts,
    // buttons and images stay fixed content instead of becoming new fields.
    if (/\b(module|widget)\.[A-Za-z_]/.test(src)) markFixed(binding.tree.sections)
    return { ok: true, imported: true, tree: binding.tree, binding }
  }
  const g = (k: string) => mod?.getAttribute(`data-${k}`) ?? null
  return {
    ok: true,
    tree: {
      width: asNum(g('width'), fallback.width, 320, 900),
      bg: asColor(g('bg'), fallback.bg),
      font: g('font')?.replace(/[;{}<>"]/g, '') || fallback.font,
      sections: restoreTree(sectionEls.map(parseSection), prot.tokens),
      ...(g('vml') === '1' ? { vml: true } : {}),
      ...optNum(g('pad'), 'pad', 0, 120),
    },
  }
}

function markFixed(blocks: Block[]) {
  for (const b of blocks) {
    if (b.type === 'section') b.cells.forEach(markFixed)
    else if ((b.type === 'heading' || b.type === 'text' || b.type === 'button' || b.type === 'image') && !b.field) b.fixed = true
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
// The browser drops a style value it cannot parse, such as
// `background-color: {{ module.bg.color }}`: read those from the attribute.
const COLOR_TOKEN = /^\{\{[^"'<>;{}]*\}\}$/
function tokenStyle(el: Element, props: string[]): string | undefined {
  const st = el.getAttribute('style') ?? ''
  for (const prop of props) {
    const v = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'i').exec(st)?.[1].trim()
    if (v && COLOR_TOKEN.test(v)) return v
  }
}
const bgOf = (el: Element) =>
  toHex(css(el)?.backgroundColor) ?? toHex(el.getAttribute('bgcolor')) ?? tokenStyle(el, ['background-color', 'background']) ?? (COLOR_TOKEN.test(el.getAttribute('bgcolor')?.trim() ?? '') ? el.getAttribute('bgcolor')!.trim() : undefined)
const isBlank = (html: string) => {
  let text = ''
  const parser = new Parser({ ontext: (value) => (text += value) }, { decodeEntities: true })
  parser.end(html)
  return !text.replace(/\s/g, '')
}

function styleOf(el: Element, inh: Inherit): Inherit {
  const st = css(el)
  const align = st?.textAlign || el.getAttribute('align') || (el.tagName === 'CENTER' ? 'center' : '')
  return {
    color: toHex(st?.color) ?? toHex(el.getAttribute('color')) ?? tokenStyle(el, ['color']) ?? inh.color,
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

// Only inline content (small pictos count as inline, like the CPF logo before a price).
const smallImg = (el: Element) => el.tagName === 'IMG' && (px(el.getAttribute('width')) ?? px(css(el)?.width) ?? 999) <= 80
const inlineOnly = (el: Element): boolean => Array.from(el.children).every((c) => (INLINE.has(c.tagName) && !isButtonLink(c) && inlineOnly(c)) || smallImg(c))
// HuBL logic written inside a paragraph ({% for i in range(5) %}★{% endfor %},
// {% if x %}<img>{% endif %}), opened and closed there: the paragraph stays one
// text block with its logic instead of being cut into pieces.
function inlineLogic(el: Element): boolean {
  const st = (el.innerHTML.match(/\{%-?\s*(\w+)/g) ?? []).map((m) => m.replace(/^\{%-?\s*/, ''))
  if (!st.length) return false
  let depth = 0
  for (const s of st) {
    if (/^(if|for|unless)$/.test(s)) depth++
    else if (/^(endif|endfor|endunless)$/.test(s)) depth--
    if (depth < 0) return false
  }
  return depth === 0 && st.some((s) => /^(if|for|unless)$/.test(s))
}

// Background of the cell a link sits in (bulletproof buttons colour the cell, not the link).
function cellBg(a: Element): string | undefined {
  let p = a.parentElement
  for (let i = 0; p && i < 3; i++, p = p.parentElement) {
    const attr = p.getAttribute('bgcolor')
    if (attr) return toHex(attr) ?? (/^\s*\{\{[^}]+\}\}\s*$/.test(attr) ? attr.trim() : undefined)
    const bg = bgOf(p)
    if (bg) return bg
    if (p.tagName === 'TABLE') break
  }
  return undefined
}

const rawBlock = (html: string): Block => ({ id: uid(), type: 'raw', html: strictHtml(html.trim()) })

const textBlock = (html: string, s: Inherit): Block => ({
  id: uid(),
  type: 'text',
  html: strictHtml(html.trim()),
  color: s.color ?? '#3a3a52',
  align: s.align ?? 'left',
  size: Math.min(64, Math.max(8, s.size ?? 16)),
})

function makeSection(cells: Block[][], bg: string, padding: number, radius = 0, from?: Element): Section {
  const kept = cells.slice(0, 3)
  if (cells.length > 3) kept[2] = [...kept[2], ...cells.slice(3).flat()]
  const extra = from ? hublStyle(from) : ''
  // A plain border of the box (border:1px solid #e0e0e0) is the card's.
  const st = from ? css(from) : undefined
  const bw = px(st?.borderTopWidth) ?? px(st?.borderWidth)
  const bc = toHex(st?.borderTopColor) ?? toHex(st?.borderColor)
  const border = bw && bw > 0 && bw <= 10 && (st?.borderTopStyle || st?.borderStyle || 'solid') !== 'none' ? { borderWidth: bw, ...(bc ? { borderColor: bc } : {}) } : {}
  return { id: uid(), type: 'section', columns: kept.length as Columns, behavior: 'stack', bg, padding, radius, ...border, ...(extra ? { css: extra } : {}), cells: kept }
}

// Style declarations driven by the module's fields ({{ module.spacing.css }},
// border-radius:{{ module.r }}px…): kept on the section so the module still
// uses them. The background colour is already the section's.
function hublStyle(el: Element): string {
  const style = el.getAttribute('style') ?? ''
  const decls = style
    .split(/;(?![^{]*\}\})(?![^(]*\))/)
    .map((d) => d.trim())
  // A card's shadow has no setting of its own: kept as is.
  const shadow = decls.filter((d) => /^box-shadow\s*:/i.test(d) && !/[<>{}]/.test(d))
  if (!/\{[{%]/.test(style)) return shadow.join(';')
  return [...decls.filter((d) => /\{[{%]/.test(d) && !/^background(-color)?\s*:/i.test(d)), ...shadow].join(';')
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
  const bg = toHex(css(a)?.backgroundColor) ?? tokenStyle(a, ['background-color', 'background']) ?? cellBg(a)
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
    } else addInline(escKeep(part.replace(/\s+/g, ' ')))
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
  const tableBg = bgOf(table)
  // A card without padding of its own (image flush to the edges, text in a padded cell).
  const flushCard = !!tableBg && !px(css(table)?.paddingTop) && !px(css(table)?.padding)
  // A shrink-wrapped table (a bulletproof button): its cell's align centres the
  // label inside the box, not the box in the column.
  const tableW = table.getAttribute('width') ?? css(table)?.width ?? ''
  const shrink = !/^\s*100%|^\s*[3-9]\d\dpx?$|^\s*[3-9]\d\d$/.test(tableW)
  // A small shrink-wrapped row (stars image + "5/5") reads as one line of text.
  if (shrink && rows.length === 1 && !table.querySelector('table')) {
    const tds = Array.from(rows[0].children).filter((c) => c.tagName === 'TD')
    if (tds.length > 1 && tds.every((td) => inlineOnly(td) && !td.querySelector('a[style*="background"]'))) {
      const parts = tds.map((td) => {
        const st = (td.getAttribute('style') ?? '').replace(/padding[^;]*;?/gi, '').trim()
        const html = td.innerHTML.replace(/(<img\b[^>]*style=")([^"]*)"/gi, (_m, a: string, s: string) => `${a}${s.replace(/display\s*:\s*block;?/i, '')};vertical-align:middle"`)
        return st ? `<span style="${st}">${html}</span>` : html
      })
      return [textBlock(parts.join(' '), styleOf(tds[0], ts))]
    }
  }
  const shrinkStyle = (td: Element): Inherit => ({ ...styleOf(td, ts), align: (ALIGNS.includes(table.getAttribute('align') as Align) ? (table.getAttribute('align') as Align) : inh.align) })
  // Rows in order, with the HuBL written between them ({% for %} around a row,
  // {% if %} around a few rows…), which becomes logic blocks at the same place.
  const items: (Element | Text)[] = []
  for (const n of Array.from(table.childNodes)) {
    if (n.nodeType === Node.ELEMENT_NODE && /^(TBODY|THEAD|TFOOT)$/.test((n as Element).tagName)) items.push(...(Array.from(n.childNodes) as (Element | Text)[]))
    else items.push(n as Element | Text)
  }
  for (const item of items) {
    if (item.nodeType === Node.TEXT_NODE) {
      for (const st of (item.textContent ?? '').match(/\{%[\s\S]*?%\}/g) ?? []) out.push(rawBlock(st))
      continue
    }
    if (item.nodeType !== Node.ELEMENT_NODE || (item as Element).tagName !== 'TR') continue
    const tr = item as Element
    const rs = styleOf(tr, ts)
    // Cells written by a loop ({% for c in row %}<td>…</td>{% endfor %}) or wrapped
    // in a condition: the logic stays around the cell's content, in order.
    if (Array.from(tr.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && /\{%/.test(n.textContent ?? ''))) {
      // {% for %}<td>…</td>{% endfor %}: the items sit side by side, as many as the cell width allows.
      const tds = Array.from(tr.children).filter((c) => c.tagName === 'TD')
      const width = tds.length === 1 ? Number.parseFloat(tds[0].getAttribute('width') ?? css(tds[0])?.width ?? '') : NaN
      const loopCols: 2 | 3 | undefined = tds.length === 1 && /%/.test(tds[0].getAttribute('width') ?? css(tds[0])?.width ?? '') && width <= 50 ? (width <= 34 ? 3 : 2) : undefined
      for (const n of Array.from(tr.childNodes)) {
        if (n.nodeType === Node.TEXT_NODE) {
          for (const st of (n.textContent ?? '').match(/\{%[\s\S]*?%\}/g) ?? []) {
            const b = rawBlock(st) as RawBlock
            out.push(loopCols && /^\{%-?\s*for\b/.test(st) ? { ...b, cols: loopCols } : b)
          }
          continue
        }
        const td = n as Element
        if (n.nodeType !== Node.ELEMENT_NODE || td.tagName !== 'TD') continue
        const blocks = convertNodes(td.childNodes, td.querySelector(':scope > table') ? rs : styleOf(td, rs))
        if (!blocks.length) continue
        const bg = bgOf(td)
        out.push(...(bg || hublStyle(td) ? [makeSection([blocks], bg ?? 'transparent', px(css(td)?.paddingTop) ?? 16, 0, td)] : blocks))
      }
      continue
    }
    const cells = Array.from(tr.children)
      .filter((td) => td.tagName === 'TD')
      // A cell's align="center" around a nested table centres the table, not its text.
      .map((td) => ({ td, blocks: convertNodes(td.childNodes, td.querySelector(':scope > table') ? rs : shrink && tr.children.length === 1 ? shrinkStyle(td) : styleOf(td, rs)) }))
      .filter((c) => c.blocks.length) // drop empty gutter cells
    if (cells.length === 1) {
      const { td, blocks } = cells[0]
      const bg = bgOf(td)
      const tdPad = px(css(td)?.paddingTop) ?? px(css(td)?.padding)
      out.push(...(bg || hublStyle(td) ? [makeSection([blocks], bg ?? 'transparent', tdPad ?? 16, 0, td)] : flushCard && tdPad ? [makeSection([blocks], 'transparent', tdPad, 0)] : blocks))
    } else if (cells.length > 1) {
      const bg = bgOf(tr) ?? bgOf(cells[0].td) ?? 'transparent'
      out.push(makeSection(cells.map((c) => c.blocks), bg, px(css(cells[0].td)?.paddingTop) ?? 8))
    }
  }
  const bg = tableBg
  if ((bg || hublStyle(table)) && out.length) return [makeSection([out], bg ?? 'transparent', flushCard ? 0 : 16, px(css(table)?.borderRadius) ?? 0, table)]
  return out
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
      // An empty box drawing a line (border-bottom:1px dotted …) is a separator.
      const line = /border(?:-(?:bottom|top))?\s*:\s*(\d+)px\s+(solid|dotted|dashed)\s+([^;]+)/i.exec(el.getAttribute('style') ?? '')
      if (line) {
        const col = line[3].trim()
        const m = /margin\s*:\s*(\d+)px(?:\s+\S+)?(?:\s+(\d+)px)?/i.exec(el.getAttribute('style') ?? '')
        const mt = m ? Number(m[1]) : undefined
        const mb = m ? Number(m[2] ?? m[1]) : undefined
        return [
          {
            id: uid(),
            type: 'divider',
            color: toHex(col) ?? (COLOR_TOKEN.test(col) ? col : '#e3e3ee'),
            ...(Number(line[1]) !== 1 ? { thickness: Math.min(10, Number(line[1])) } : {}),
            ...(line[2].toLowerCase() !== 'solid' ? { lineStyle: line[2].toLowerCase() as 'dotted' | 'dashed' } : {}),
            ...(mt != null ? { mt } : {}),
            ...(mb != null ? { mb } : {}),
          } as Block,
        ]
      }
      const h = px(css(el)?.height) ?? px(el.getAttribute('height'))
      return h ? [{ id: uid(), type: 'spacer', height: Math.min(400, h) }] : []
    }
    // A paragraph in capitals or in bold (text-transform, font-weight, font:700 …) keeps them.
    const tt = css(el)?.textTransform
    const fw = css(el)?.fontWeight
    const looks = [
      tt && /^(uppercase|lowercase|capitalize)$/.test(tt) ? `text-transform:${tt}` : '',
      fw && (fw === 'bold' || Number(fw) >= 600) ? 'font-weight:700' : '',
    ].filter(Boolean)
    const inner = (h: string) => (looks.length ? `<span style="${looks.join(';')}">${h}</span>` : h)
    let blocks = (inlineLogic(el) || looks.length) && inlineOnly(el) ? [textBlock(inner(el.innerHTML), s)] : convertNodes(el.childNodes, s)
    // Its own margins (margin:6px 0) replace the default spacing of the block it becomes.
    if (blocks.length === 1 && blocks[0].type !== 'section' && blocks[0].type !== 'raw' && /margin/i.test(el.getAttribute('style') ?? '')) {
      const mt = px(css(el)?.marginTop) ?? 0
      const mb = px(css(el)?.marginBottom) ?? 0
      blocks = [{ ...blocks[0], mt, mb } as Block]
    }
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

// Tokens of the last parsed fragment: in-tag statements are put back into the
// blocks' strings once converted (see hubl-protect.ts).
let fragmentTokens: string[] = []
// {% macro %} definitions of the last parsed fragment, kept whole (one logic block each).
let fragmentMacros: string[] = []
const MACRO_DEF = /\{%-?\s*macro\b[\s\S]*?\{%-?\s*endmacro\s*-?%\}/g
const MACRO_MARK = /^\{% nsp_macro (\d+) %\}$/

// Puts the macro definitions back in place of their marks.
function restoreMacros(blocks: Block[]): Block[] {
  if (!fragmentMacros.length) return blocks
  return blocks.map((b) => {
    if (b.type === 'section') return { ...b, cells: b.cells.map(restoreMacros) }
    if (b.type === 'raw') {
      const m = MACRO_MARK.exec(b.html.trim())
      if (m) return { ...b, html: fragmentMacros[Number(m[1])] ?? '' }
    }
    return b
  })
}

function parseFragment(html: string) {
  fragmentMacros = []
  // A macro's body is a template, not content: it stays one block.
  const src = html.replace(MACRO_DEF, (m) => `{% nsp_macro ${fragmentMacros.push(strictHtml(m)) - 1} %}`)
  const prot = protectHubl(src.replace(/\{#[\s\S]*?#\}/g, ''))
  fragmentTokens = prot.tokens
  // <body> first: a comment opening the document would land outside of it.
  const doc = new DOMParser().parseFromString(/<body[\s>]/i.test(prot.html) ? prot.html : `<body>${prot.html}`, 'text/html')
  restoreDom(doc.body, prot.tokens)
  sanitize(doc.body)
  inlineStylesheets(doc)
  return doc.body
}

// Blocks for a column (used to convert a raw block in place).
export function htmlToBlocks(html: string): Block[] {
  const body = parseFragment(html)
  return restoreMacros(restoreTree(convertNodes(body.childNodes, {}), fragmentTokens))
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
  // Logic opened in one place and closed further down ({% for f in … %} … card … {% endfor %})
  // must stay in one column: split into sections, the loop would lose its body.
  let depth = 0
  let crosses = false
  for (const b of blocks) {
    if (b.type === 'section') {
      if (depth > 0) crosses = true
      continue
    }
    if (b.type !== 'raw') continue
    const st = /^\s*\{%-?\s*(\w+)/.exec(b.html)?.[1]
    if (st && /^(if|for|unless)$/.test(st) && !/\{%-?\s*end(if|for|unless)/.test(b.html)) depth++
    else if (st && /^end(if|for|unless)$/.test(st)) depth = Math.max(0, depth - 1)
  }
  if (crosses) {
    const font = (css(body).fontFamily ? body : body.querySelector('[style*="font-family"]')) as HTMLElement | null
    return {
      sections: restoreMacros(restoreTree([makeSection([blocks], contentBg, 0)], fragmentTokens)) as Section[],
      bg: wrappers.length > 1 ? wrappers[0] : bgOf(body),
      font: font ? css(font).fontFamily.replace(/"/g, "'").replace(/[;{}<>]/g, '') || undefined : undefined,
    }
  }
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
  return { sections: restoreMacros(restoreTree(sections, fragmentTokens)) as Section[], bg: wrappers.length > 1 ? wrappers[0] : bgOf(body), font: font || undefined }
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
${STACK_CSS}${responsiveCss(tree)}
</style>
</head>
<body>
${renderModule(tree, Object.assign(new Ctx('sync', tree), { shown: true }))}
</body>
</html>
`
}

// What the platform would render for a sample contact: HuBL interpreted
// ({% if %} branches resolved, variables replaced). For previews only; the
// exported files keep the HuBL.
export function previewEmail(tree: ModuleTree, name: string, contact: SampleContact = 'known'): string {
  return standaloneEmail(interpretForPreview(tree, contact).tree, name)
}
