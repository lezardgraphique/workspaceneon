// Import of code and JSON that never ends on an empty block: the pasted text
// is cleaned and repaired first (escaped HTML, JSON strings, Markdown fences,
// curly quotes in HuBL, unfinished {{ }} / {% %}, unclosed blocks and
// headings, template wrappers, {% module %} tags), a module is rebuilt from
// its fields when only a fields.json / module JSON is given, and every repair
// is listed for the person. Browser only (codeToTree uses DOMParser).
import { Parser } from 'htmlparser2'
import { codeToTree, previewEmail, syncExtraFields, treeToHubSpot, verbatimBlock } from './hubl'
import { isLogicBlock, previewScope, renderHubl } from './hubl-render'
import { applyValues, importSpecs, parseForeignJson } from './json-import'
import type { ForeignJson } from './json-import'
import { parseFieldsJson } from './module-fields'
import type { FieldSpec } from './module-fields'
import { parseLenient } from './json-repair'
import { convertForeign } from './foreign-syntax'
import { fixCode, validateSyntax } from './validator'
import { collectFields } from './fields'
import { doctorTemplate, isNeonExport } from './template-doctor'
import { formatCss, formatTemplate } from './code-format'
import { legacySpecs } from './hubl-legacy'
import { uid } from './types'
import type { ModuleTree } from './types'

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

const decodeEntities = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, n: string) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')

// {% module "name" path="@hubspot/…" … %} of a template: becomes the module's
// own content with a field of the same name, so it shows and stays editable.
function moduleTags(code: string, specs: FieldSpec[]): { code: string; n: number } {
  let n = 0
  const attr = (body: string, k: string) => {
    const m = new RegExp(`\\b${k}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'((?:[^'\\\\]|\\\\.)*)')`).exec(body)
    return m ? (m[1] ?? m[2]).replace(/\\(["'])/g, '$1') : undefined
  }
  const out = code.replace(/\{%-?\s*(?:module|dnd_module)\s+["']([\w-]+)["']([\s\S]*?)-?%\}/g, (_m, rawName: string, body: string) => {
    const name = rawName.replace(/-/g, '_')
    const path = attr(body, 'path') ?? ''
    const label = attr(body, 'label') ?? name.replace(/_/g, ' ')
    const kind = /rich_text|richtext/.test(path) ? 'richtext' : /header|section_header/.test(path) ? 'header' : /linked_image|image/.test(path) ? 'image' : /cta|button/.test(path) ? 'cta' : /text/.test(path) ? 'text' : ''
    if (!kind) return `{# module ${name} (${path || 'sans chemin'}) non repris #}`
    n++
    if (kind === 'richtext') {
      specs.push({ name, label, type: 'richtext', default: attr(body, 'html') ?? attr(body, 'value') ?? '<p>Texte</p>' })
      return `<div>{{ module.${name} }}</div>`
    }
    if (kind === 'header') {
      specs.push({ name, label, type: 'text', default: attr(body, 'header') ?? attr(body, 'value') ?? label })
      return `<h2>{{ module.${name} }}</h2>`
    }
    if (kind === 'image') {
      specs.push({ name, label, type: 'image', default: { src: attr(body, 'src') ?? '', alt: attr(body, 'alt') ?? label } })
      return `<img src="{{ module.${name}.src }}" alt="{{ module.${name}.alt }}" width="600" style="max-width:100%">`
    }
    if (kind === 'cta') {
      specs.push({ name: `${name}_texte`, label, type: 'text', default: attr(body, 'text') ?? attr(body, 'value') ?? 'En savoir plus' })
      specs.push({ name: `${name}_lien`, label: `${label} (lien)`, type: 'link', default: { url: { href: attr(body, 'href') ?? attr(body, 'url') ?? '#', type: 'EXTERNAL' } } })
      return `<a href="{{ module.${name}_lien.url.href }}" style="display:inline-block;background:#e0006f;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none">{{ module.${name}_texte }}</a>`
    }
    specs.push({ name, label, type: 'text', default: attr(body, 'value') ?? label })
    return `<p>{{ module.${name} }}</p>`
  })
  return { code: out, n }
}

// A {{ or {% whose closer never comes before the next opener or the end of
// the line is finished: only when it plainly ends with the wrong closer
// (« } », « % », « }} » for a statement). `%` inside (modulo) is left alone.
function finishDelimiters(code: string): { code: string; n: number } {
  let n = 0
  let out = ''
  let i = 0
  while (i < code.length) {
    const at = code.slice(i).search(/\{\{|\{%/)
    if (at < 0) {
      out += code.slice(i)
      break
    }
    const start = i + at
    out += code.slice(i, start)
    const stmt = code[start + 1] === '%'
    const close = stmt ? '%}' : '}}'
    const rest = code.slice(start + 2)
    const end = rest.indexOf(close)
    const next = rest.search(/\{\{|\{%|\n/)
    if (end >= 0 && (next < 0 || end < next)) {
      out += code.slice(start, start + 2 + end + 2)
      i = start + 2 + end + 2
      continue
    }
    // No closer in its stretch: the wrong closer, right after the expression
    // and before any markup (« {{ x }</a> », « {% endif %<br> », « {% if x }} »).
    const stretch = next < 0 ? rest : rest.slice(0, next)
    const m = stmt
      ? /^([^<>{}%]*?)\s*(?:%(?![\w(])|\}\})(?=\s*(?:<|$))/.exec(stretch)
      : /^([^<>{}]*?[^\s}])\s*\}(?!\})/.exec(stretch)
    if (m) {
      out += `${code.slice(start, start + 2)}${m[1].replace(/\s+$/, '')} ${close}`
      n++
      i = start + 2 + m[0].length
      continue
    }
    out += code.slice(start, start + 2)
    i = start + 2
  }
  return { code: out, n }
}

/** Cleans and repairs pasted code; `repairs` says what was done, in French. */
export function cleanSource(input: string): { code: string; repairs: string[]; specs: FieldSpec[] } {
  const repairs: string[] = []
  const specs: FieldSpec[] = []
  let code = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n')

  // Markdown code fence around the code (copied from a chat or a README).
  const fence = /^\s*```[\w-]*[^\n]*\n([\s\S]*?)\n?```\s*$/.exec(code)
  if (fence) {
    code = fence[1]
    repairs.push('balises Markdown ``` retirées')
  }

  // The code as a JSON string ("<table…\n…"), e.g. copied from an API answer.
  const t = code.trim()
  // Escapes inside HuBL ({% … replace('\\n', ' ') %}) are the template's own
  // strings, not a JSON encoding: a module minified on one line keeps them.
  const outside = t.replace(/\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}|\{#[\s\S]*?#\}/g, '')
  if ((/^".*"$/s.test(t) && /\\[n"t\/]/.test(outside)) || (!/\n/.test(t) && /\\n|\\"/.test(outside) && /<[a-z]/i.test(t))) {
    try {
      // Quotes not already escaped get escaped (no lookbehind: Safari 15).
      const s = JSON.parse(/^".*"$/s.test(t) ? t : `"${t.replace(/\\?"/g, (q) => (q === '"' ? '\\"' : q))}"`)
      if (typeof s === 'string') {
        code = s
        repairs.push('code extrait d’une chaîne JSON (\\n, \\" décodés)')
      }
    } catch {
      /* not a JSON string after all */
    }
  }

  // Escaped HTML (&lt;table&gt;…): copied from a page showing the code as text.
  const escaped = (code.match(/&lt;\/?[a-z]/gi) ?? []).length
  const real = (code.match(/<\/?[a-z]/gi) ?? []).length
  if (escaped >= 2 && escaped > real) {
    code = decodeEntities(code)
    repairs.push('HTML échappé (&lt; &gt;) décodé')
  }

  // Another platform's template language (Liquid, Handlebars, Mailchimp,
  // AMPscript, Mailjet, Marketo, MJML): HuBL, so it works instead of showing as code.
  const foreign = convertForeign(code)
  code = foreign.code
  repairs.push(...foreign.repairs)
  specs.push(...foreign.specs)

  // Template wrappers: the module's content is what's inside.
  const before = code
  code = code
    .replace(/\{%-?\s*extends\s+[^%]*-?%\}/g, '')
    .replace(/\{%-?\s*block\s+[\w-]+\s*-?%\}/g, '')
    .replace(/\{%-?\s*endblock(?:\s+[\w-]+)?\s*-?%\}/g, '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
  if (code !== before) repairs.push('enveloppe de gabarit (extends / block) ou scripts retirés')

  // {% require_css %}<style>…</style>{% end_require_css %}: the styles count.
  const req = code.replace(/\{%-?\s*require_css\s*-?%\}([\s\S]*?)\{%-?\s*end_require_css\s*-?%\}/g, '$1')
  if (req !== code) {
    code = req
    repairs.push('styles de {% require_css %} appliqués')
  }

  // Curly quotes inside HuBL: never valid there.
  let quotes = 0
  code = code.replace(/\{[%{][\s\S]*?[%}]\}/g, (m) =>
    m.replace(/[“”«»„]|[‘’]/g, (q) => {
      quotes++
      return /[‘’]/.test(q) ? "'" : '"'
    }),
  )
  if (quotes) repairs.push(`${plural(quotes, 'guillemet typographique', 'guillemets typographiques')} corrigé${quotes > 1 ? 's' : ''} dans le HuBL`)

  // Unfinished delimiters: {{ x } → {{ x }}, {% if x % → {% if x %}, {% x }} → {% x %}.
  const fixed = finishDelimiters(code)
  if (fixed.n) {
    code = fixed.code
    repairs.push(`${plural(fixed.n, 'délimiteur HuBL incomplet complété', 'délimiteurs HuBL incomplets complétés')} ({{ }} / {% %})`)
  }

  // {% module %} tags of a template.
  const mods = moduleTags(code, specs)
  if (mods.n) {
    code = mods.code
    repairs.push(`${plural(mods.n, 'balise {% module %} transformée', 'balises {% module %} transformées')} en contenu modifiable`)
  }

  // A heading left open before the next block would swallow it.
  let heads = 0
  code = code.replace(/<(h[1-6])(\s[^>]*)?>((?:(?!<\/\1>|<h[1-6][\s>])[\s\S])*?)(?=<(?:p|div|table|ul|ol|h[1-6])[\s>])/gi, (m, tag: string, attrs = '', inner: string) => {
    if (/<\/h[1-6]>/i.test(inner)) return m
    heads++
    return `<${tag}${attrs}>${inner}</${tag}>`
  })
  if (heads) repairs.push(`${plural(heads, 'titre non fermé refermé', 'titres non fermés refermés')}`)

  // Validator: stray closers removed, blocks and tags left open closed.
  const lint = validateSyntax(code)
  if (lint.issues.some((i) => i.fixable)) {
    const fixed = fixCode(code)
    if (fixed.fixed) {
      code = fixed.code
      repairs.push(`${plural(fixed.fixed, 'erreur corrigée', 'erreurs corrigées')} par le validateur (fermetures manquantes ou en trop, balises HuBL inachevées, guillemets…)`)
    }
  }
  return { code: code.trim(), repairs, specs }
}

// ---------------------------------------------------------------------------
// A module from its fields alone (fields.json or a module JSON without code).

const isTitle = (n: string) => /titre|title|heading|header|headline|accroche|nom|name/i.test(n)
const isLink = (s: FieldSpec) => /^(link|url)$/.test(s.type) || /lien|link|url|href/i.test(s.name)
const isButtonText = (n: string) => /cta|bouton|button|btn|label|texte_bouton/i.test(n)

function fieldMarkup(specs: FieldSpec[], prefix: string, used: Set<string>): string[] {
  const out: string[] = []
  const ref = (n: string) => `${prefix}${n}`
  const links = specs.filter((s) => isLink(s) && !s.name.includes('.'))
  for (const s of specs) {
    if (s.name.includes('.') || used.has(s.name)) continue
    const r = ref(s.name)
    switch (s.type) {
      case 'group': {
        const kids = parseFieldsJson(JSON.stringify((s.raw?.children as unknown[]) ?? [])) ?? []
        const top = kids.filter((k) => !k.name.includes('.'))
        const repeated = !!s.raw?.occurrence
        used.add(s.name)
        if (repeated) {
          out.push(
            `{% for item in ${r} %}`,
            `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:16px;background:#f7f7fb;border-radius:8px">`,
            ...fieldMarkup(top, 'item.', new Set()),
            `</td></tr></table>`,
            `{% endfor %}`,
          )
        } else out.push(...fieldMarkup(top, `${r}.`, new Set()))
        break
      }
      case 'image':
      case 'backgroundimage':
        used.add(s.name)
        out.push(`<img src="{{ ${r}.src }}" alt="{{ ${r}.alt }}" width="600" style="display:block;max-width:100%;height:auto">`)
        break
      case 'richtext':
        used.add(s.name)
        out.push(`<div style="font-size:16px;line-height:1.6;color:#444444">{{ ${r} }}</div>`)
        break
      case 'text':
      case 'textarea': {
        used.add(s.name)
        if (isButtonText(s.name) && links.length) {
          const link = links.find((l) => !used.has(l.name)) ?? links[0]
          used.add(link.name)
          const href = link.type === 'url' ? `${ref(link.name)}.href` : `${ref(link.name)}.url.href`
          out.push(`<a href="{{ ${href} }}" style="display:inline-block;background:#e0006f;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">{{ ${r} }}</a>`)
        } else if (isTitle(s.name) && !out.some((l) => l.startsWith('<h2'))) out.push(`<h2 style="font-size:26px;color:#111111">{{ ${r} }}</h2>`)
        else out.push(`<p style="font-size:16px;color:#444444">{{ ${r} }}</p>`)
        break
      }
      case 'cta':
        used.add(s.name)
        out.push(`{% cta guid="{{ ${r} }}" %}`)
        break
      case 'number':
        used.add(s.name)
        out.push(`<p style="font-size:16px;color:#444444">{{ ${r} }}</p>`)
        break
      default:
        // Booleans, colours, choices, fonts…: settings of the module, kept as fields.
        break
    }
  }
  // A link without a button text: a button of its own.
  for (const l of links) {
    if (used.has(l.name)) continue
    used.add(l.name)
    const href = l.type === 'url' ? `${ref(l.name)}.href` : `${ref(l.name)}.url.href`
    out.push(`<a href="{{ ${href} }}" style="display:inline-block;background:#e0006f;color:#ffffff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">${l.label || 'En savoir plus'}</a>`)
  }
  return out
}

export function codeFromFields(specs: FieldSpec[]): string {
  const lines = fieldMarkup(specs, 'module.', new Set())
  if (!lines.length) return ''
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="background:#ffffff;padding:24px">\n${lines.join('\n')}\n</td></tr></table>`
}

// ---- fields the code doesn't use ------------------------------------------
// A field of the fields.json that the code never reads does nothing in the
// e-mail. At import, such fields are made to work: displayable ones get their
// element at the end of the module (text, title, image, button and its link,
// repeated list…), settings are wired when their name is clear (a background
// colour, a show / hide switch, an alignment, a padding); the others stay
// settings and are named in the report.

export interface Wiring {
  /** « name : what was done », shown in the import report. */
  wired: string[]
  /** Settings left as they are (nothing in the code uses them). */
  settings: string[]
}

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'col', 'source', 'area', 'wbr'])
const WRAPPABLE = new Set(['img', 'a', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'table', 'span', 'ul', 'ol', 'blockquote', 'section'])

// Ranges of the HTML elements of a template (HuBL left as text), for wrapping
// the element that shows a field.
function elementRanges(code: string): { tag: string; start: number; end: number }[] {
  const out: { tag: string; start: number; end: number }[] = []
  const stack: { tag: string; start: number }[] = []
  const re = /<!--[\s\S]*?-->|<\/?([a-zA-Z][\w-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g
  for (let m = re.exec(code); m; m = re.exec(code)) {
    if (!m[1]) continue
    const tag = m[1].toLowerCase()
    if (m[0][1] === '/') {
      const i = stack.map((x) => x.tag).lastIndexOf(tag)
      if (i >= 0) {
        out.push({ tag, start: stack[i].start, end: m.index + m[0].length })
        stack.length = i
      }
    } else if (VOID.has(tag) || m[0].endsWith('/>')) out.push({ tag, start: m.index, end: m.index + m[0].length })
    else stack.push({ tag, start: m.index })
  }
  return out
}

// Whether the code reads a field (module.x, item.x in a loop, or an old tag {% text "x" %}).
const reads = (code: string, name: string) =>
  new RegExp(`\\bmodule\\.${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b|\\{%-?\\s*\\w+\\s+["']${name}["']|\\bmodule\\[["']${name}["']\\]`).test(code)

const DISPLAY = new Set(['text', 'textarea', 'richtext', 'image', 'backgroundimage', 'link', 'url', 'cta', 'group', 'number', 'email', 'video', 'blog', 'form', 'page', 'menu', 'simplemenu', 'logo'])

export function wireUnusedFields(source: string, specs: FieldSpec[]): { source: string } & Wiring {
  const top = specs.filter((s) => !s.name.includes('.') && !reads(source, s.name))
  if (!top.length) return { source, wired: [], settings: [] }
  const wired: string[] = []
  const settings: string[] = []
  let code = source

  // 1. Displayable fields: their element at the end of the module (inside what
  // the settings below wrap: background, padding, alignment, show / hide).
  const shown = top.filter((s) => DISPLAY.has(s.type) && s.type !== 'number')
  const added = shown.length ? fieldMarkup(shown, 'module.', new Set()) : []
  if (added.length) {
    code = `${code}\n<!-- Champs du fields.json ajoutés à l'import -->\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:16px 24px">\n${added.join('\n')}\n</td></tr></table>`
    const what = (s: FieldSpec) =>
      s.type === 'image' || s.type === 'backgroundimage'
        ? 'image ajoutée'
        : /^(link|url)$/.test(s.type)
          ? 'lien du bouton ajouté'
          : s.type === 'group'
            ? `liste${s.raw?.occurrence ? ' répétée' : ''} ajoutée`
            : s.type === 'richtext'
              ? 'texte riche ajouté'
              : isButtonText(s.name) && shown.some(isLink)
                ? 'texte du bouton ajouté'
                : isTitle(s.name)
                  ? 'titre ajouté'
                  : 'texte ajouté'
    for (const s of shown) if (reads(code, s.name)) wired.push(`${s.name} : ${what(s)} à la fin du module`)
  }
  // 2. Settings with a clear name.
  for (const s of top) {
    if (DISPLAY.has(s.type) && s.type !== 'number') continue
    const n = s.name.toLowerCase()
    const ref = `module.${s.name}`
    if (s.type === 'color' && /(fond|bg|background|arriere|backdrop)/.test(n)) {
      code = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="background-color:{{ ${ref}.color }}">\n${code}\n</td></tr></table>`
      wired.push(`${s.name} : couleur de fond du module`)
      continue
    }
    if (s.type === 'color' && /(texte|text|police|font|ecriture|écriture)/.test(n)) {
      code = `<div style="color:{{ ${ref}.color }}">\n${code}\n</div>`
      wired.push(`${s.name} : couleur du texte (là où le code n'impose pas la sienne)`)
      continue
    }
    if (s.type === 'choice' && /(align|alignement|position)/.test(n)) {
      code = `<div style="text-align:{{ ${ref} }}">\n${code}\n</div>`
      wired.push(`${s.name} : alignement du contenu`)
      continue
    }
    if (s.type === 'number' && /(padding|marge|espacement|spacing|interieur|intérieur)/.test(n)) {
      code = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:{{ ${ref} }}px">\n${code}\n</td></tr></table>`
      wired.push(`${s.name} : marge intérieure du module (px)`)
      continue
    }
    if (s.type === 'boolean') {
      const show = /^(afficher|affiche|show|display|montrer|voir|avec|with|has|activer|active|enable)[_-]?(.*)$/.exec(n)
      const hide = /^(masquer|masque|cacher|cache|hide|sans|without|disable|desactiver)[_-]?(.*)$/.exec(n)
      const rest = (show ?? hide)?.[2]?.replace(/^(le|la|les|l)_/, '') ?? ''
      // The field it switches: same name, or the one its name contains.
      const target = rest
        ? specs.find((x) => x.name !== s.name && !x.name.includes('.') && reads(code, x.name) && (x.name.toLowerCase() === rest || x.name.toLowerCase().includes(rest) || rest.includes(x.name.toLowerCase())))
        : undefined
      const cond = hide ? `not ${ref}` : ref
      if (target) {
        const at = code.search(new RegExp(`\\bmodule\\.${target.name}\\b`))
        const el = elementRanges(code)
          .filter((r) => r.start <= at && r.end > at && WRAPPABLE.has(r.tag))
          .sort((a, b) => a.end - a.start - (b.end - b.start))[0]
        if (el) {
          code = `${code.slice(0, el.start)}{% if ${cond} %}${code.slice(el.start, el.end)}{% endif %}${code.slice(el.end)}`
          wired.push(`${s.name} : ${hide ? 'masque' : 'affiche ou masque'} « ${target.label || target.name} »`)
          continue
        }
      }
      if (show && (!rest || /^(module|bloc|contenu|section|tout)$/.test(rest))) {
        code = `{% if ${cond} %}\n${code}\n{% endif %}`
        wired.push(`${s.name} : ${hide ? 'masque' : 'affiche'} tout le module`)
        continue
      }
    }
    settings.push(s.name)
  }

  for (const s of shown) if (!reads(code, s.name)) settings.push(s.name)
  return { source: code, wired, settings }
}

// ---------------------------------------------------------------------------

export interface ImportInput {
  html: string
  css?: string
  /** A fields.json (list of fields). */
  fieldsJson?: string
  /** Any other JSON (module JSON, values, another tool's model…). */
  other?: string
  /** module.js, read to check the elements its script looks for. */
  js?: string
}

export type Prepared =
  | {
      ok: true
      tree: ModuleTree
      /** The code actually imported (after repairs). */
      source: string
      specs?: FieldSpec[]
      values: Record<string, unknown> | null
      repairs: string[]
      /** Module built from the fields alone (no code given). */
      fromFields: boolean
      foreign: ForeignJson | null
      fieldsJson: FieldSpec[] | null
      /** Names whose value came from the JSON. */
      applied: string[]
      /** Fields of the JSON the code didn't use, made to work at import. */
      wiring: Wiring
    }
  | { ok: false; error: string; repairs: string[] }

export function prepareImport(input: ImportInput, current: ModuleTree): Prepared {
  const repairs: string[] = []
  const fjText = input.fieldsJson?.trim() ?? ''
  const fj = fjText ? parseFieldsJson(fjText) : null
  if (fjText && fj) {
    const r = parseLenient(fjText)
    if (r?.repairs.length) repairs.push(`fields.json : ${r.repairs.join(', ')}`)
  }
  if (fjText && !fj) repairs.push('fields.json illisible : ignoré')
  const foreign = input.other?.trim() ? parseForeignJson(input.other) : null
  if (input.other?.trim()) {
    const r = parseLenient(input.other)
    if (r?.repairs.length) repairs.push(`JSON : ${r.repairs.join(', ')}`)
  }

  let html = input.html.trim() ? input.html : (foreign?.html ?? '')
  let css = input.css?.trim() ? input.css : (foreign?.css ?? '')
  // Files exported by an older version of this tool: back to the module's own code.
  if (isNeonExport(html) && /\b(module|widget)\./.test(html)) {
    const d = doctorTemplate({ source: html, css, js: input.js })
    // Repaired code is no longer the original: written cleanly laid out.
    html = formatTemplate(d.source)
    css = d.css.trim() ? formatCss(d.css) : ''
    repairs.push(...d.fixes, ...d.warnings.map((w) => `à savoir : ${w}`))
  }
  let fromFields = false
  if (!html.trim()) {
    // Only fields: a module is built from them so nothing shows empty.
    const defs = fj ?? (foreign?.specs.length ? foreign.specs : null)
    const built = defs ? codeFromFields(defs) : ''
    if (!built) return { ok: false, error: 'Aucun code à importer, et aucun champ affichable dans le JSON.', repairs }
    html = built
    fromFields = true
    repairs.push('aucun code fourni : module construit à partir des champs')
  }

  const clean = cleanSource(html)
  repairs.push(...clean.repairs)
  let source = css.trim() ? `<style>\n${css}\n</style>\n${clean.code}` : clean.code
  const given = [...(fj ?? []), ...clean.specs.filter((s) => !(fj ?? []).some((f) => f.name === s.name))]
  const specs = importSpecs(source, given.length ? given : null, foreign)
  // Fields of a fields.json (or of the other JSON) the code never reads: made to work.
  let wiring: Wiring = { wired: [], settings: [] }
  const declared = [...(fj ?? []), ...(foreign?.specs ?? []).filter((s) => !(fj ?? []).some((f) => f.name === s.name))]
  if (!fromFields && declared.length) {
    const w = wireUnusedFields(source, declared)
    source = w.source
    wiring = { wired: w.wired, settings: w.settings }
  }
  const res = codeToTree(source, current, specs)
  if (!res.ok) return { ok: false, error: res.error, repairs }
  let { tree, applied } = applyValues(syncExtraFields({ ...res.tree, fields: undefined }, specs, source), foreign?.values ?? null)
  // module.css given apart: the template kept whole gives it back apart.
  const head = css.trim() ? `<style>\n${css}\n</style>\n` : ''
  const moduleCss = head && source.startsWith(head) ? css : undefined
  // A HubSpot module as downloaded (its fields.json, or code reading module.x
  // before any conversion; {% module %} tags of a template are converted, not kept).
  const hubspot = !clean.specs.length && (!!fj?.length || /\b(module|widget)\./.test(html))
  const whole = fromFields ? null : keepTemplateWhole(source, tree, specs, moduleCss, hubspot)
  if (whole) {
    ;({ tree, applied } = applyValues(whole.tree, foreign?.values ?? null))
    repairs.push(whole.reason)
  }
  return { ok: true, tree, source, specs, values: foreign?.values ?? null, repairs, fromFields, foreign, fieldsJson: fj, applied, wiring }
}

export const KEPT_WHOLE = 'modèle gardé tel quel (macros, largeurs calculées, cellules écrites par des boucles) : son contenu se règle dans l’onglet Champs'

/**
 * Templates built on macros, computed widths or cells printed by loops lose
 * their structure once cut into blocks. `tree` is the imported module (blocks
 * and fields); when its blocks show less than the template itself, the module
 * with the template kept whole, exactly as written, is returned (else null).
 */
export function keepTemplateWhole(source: string, tree: ModuleTree, specs?: FieldSpec[], moduleCss?: string, hubspot?: boolean): { tree: ModuleTree; reason: string } | null {
  if (/data-neon=["'](module|section)/.test(source)) return null
  // Cutting into blocks would change what the module does: kept as written.
  const loss = lossyCut(source, tree, hubspot)
  if (!loss) {
    if (!looksLikeTemplate(source)) return null
    const whole = renderedSize(renderHubl(source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''), previewScope(tree)))
    const cut = renderedSize(previewEmail(tree, 'x'))
    // Macros hold the content in code: blocks could only show their calls, so the
    // template stays whole (and its export identical to what was imported).
    if (!showsMore(whole, cut) && !mostlyCode(tree) && !/\{%-?\s*macro\b/.test(source)) return null
  }
  const body = moduleCss != null ? source.slice(`<style>\n${moduleCss}\n</style>\n`.length) : source
  // Without a fields.json, what the blocks recognised (a text block = rich
  // text, a button = text + link…) still types the fields of the whole module.
  const fromBlocks = blockSpecs(tree).filter((b) => !(specs ?? []).some((s) => s.name === b.name))
  const learnt = [...(specs ?? []), ...fromBlocks]
  const kept = syncExtraFields({ ...tree, fields: undefined, sections: [wholeSection(body, moduleCss)] }, learnt.length ? learnt : undefined, source)
  // Those learnt types are guesses: the export writes them like any guessed field.
  if (fromBlocks.length && kept.fields) kept.fields = kept.fields.map((f) => (fromBlocks.some((l) => l.name === f.name) ? (({ noDefault: _n, order: _o, ...r }) => r)(f) : f))
  return { tree: kept, reason: loss ? `${loss === 'module HubSpot' ? 'Module HubSpot' : `Module (${loss})`} ${KEPT_EXACT}` : KEPT_WHOLE }
}

export const KEPT_EXACT = 'gardé tel quel pour ressortir identique à l’export : ses contenus se règlent dans l’onglet Champs'

/**
 * Why cutting this code into blocks would lose something the original module
 * does (null when nothing is lost): tag names built by HuBL, code that would
 * print as text, and any HubSpot module (`hubspot`; by default: code reading
 * module.x), which must come out of the export exactly as it came in.
 */
export function lossyCut(source: string, tree: ModuleTree, hubspot?: boolean): string | null {
  const code = source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
  if (/<\/?\{\{|<\/?\{%/.test(code)) return 'balise dont le nom est calculé en HuBL'
  let cutShown = ''
  try {
    cutShown = previewEmail(tree, 'x')
  } catch {
    return 'découpage impossible'
  }
  const scope = previewScope(tree)
  let wholeJunk = 0
  try {
    wholeJunk = renderedSize(renderHubl(code, scope)).junk
  } catch {
    wholeJunk = 0
  }
  if (renderedSize(cutShown).junk > wholeJunk) return 'du code se serait affiché comme du texte'
  // A HubSpot module (given with its fields.json, or reading module.x) comes
  // back out of the export as it came in: blocks would rewrite its markup.
  // (Old template tags, {% text "x" %}…, are converted instead: the preview can't show them.)
  if ((hubspot ?? /\b(module|widget)\./.test(code)) && !legacySpecs(code).length && !/\{%-?\s*widget_block\b/.test(code)) return 'module HubSpot'
  return null
}

// Cutting a template into blocks is worth it only when most of what it shows
// becomes editable blocks; mostly « Bloc HTML » pieces gain nothing and lose
// the template's exact code (a HubSpot module re-imported must stay identical).
function mostlyCode(tree: ModuleTree): boolean {
  let raw = 0
  let editable = 0
  const walk = (list: ModuleTree['sections'][number]['cells'][number]) =>
    list.forEach((b) => (b.type === 'section' ? b.cells.forEach(walk) : b.type === 'raw' ? !isLogicBlock(b) && raw++ : b.type !== 'spacer' && b.type !== 'divider' && editable++))
  tree.sections.forEach((s) => s.cells.forEach(walk))
  return raw > 0 && editable < raw
}

const wholeSection = (html: string, moduleCss?: string): ModuleTree['sections'][number] => ({ id: uid(), type: 'section', columns: 1, behavior: 'stack', bg: 'transparent', padding: 0, radius: 0, cells: [[verbatimBlock(html, undefined, moduleCss)]] })
const showsMore = (a: { imgs: number; text: number }, b: { imgs: number; text: number }) => (a.imgs || a.text) > 0 && (a.imgs > b.imgs || a.text > b.text * 1.25 + 20)

/**
 * A module imported before templates were kept whole: when its blocks, put
 * back together, show more as one template than cut into blocks, it becomes
 * that template (fields, values and settings unchanged). Else null.
 */
export function upgradeImported(tree: ModuleTree): ModuleTree | null {
  const raws: string[] = []
  const walk = (list: ModuleTree['sections'][number]['cells'][number]) => list.forEach((b) => (b.type === 'raw' ? (b.verbatim ? raws.push('\u0000') : raws.push(b.html)) : b.type === 'section' && b.cells.forEach(walk)))
  tree.sections.forEach((s) => s.cells.forEach(walk))
  if (raws.includes('\u0000') || !raws.some((h) => /\{%-?\s*(macro|do|for)\b/.test(h))) return null
  try {
    const src = treeToHubSpot(tree, '')['module.html'].replace(/^\{#[\s\S]*?#\}\n?/, '')
    if (!looksLikeTemplate(src)) return null
    const kept: ModuleTree = { ...tree, sections: [wholeSection(src)] }
    const after = renderedSize(previewEmail(kept, 'x'))
    const before = renderedSize(previewEmail(tree, 'x'))
    // Only when the whole template renders cleanly (no code shown as text).
    return after.junk <= before.junk && showsMore(after, before) ? kept : null
  } catch {
    return null
  }
}

/** Macros the module defines but never calls: their calls were lost (an import cut the template). */
export function lostMacroCalls(tree: ModuleTree): string[] {
  const text: string[] = []
  const walk = (list: ModuleTree['sections'][number]['cells'][number]) =>
    list.forEach((b) => {
      if (b.type === 'section') return b.cells.forEach(walk)
      if (b.type === 'raw' && b.verbatim) return
      text.push(b.type === 'raw' || b.type === 'text' ? b.html : b.type === 'heading' ? b.text : '')
    })
  tree.sections.forEach((s) => s.cells.forEach(walk))
  const all = text.join('\n')
  const names = [...all.matchAll(/\{%-?\s*macro\s+([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1])
  // Defined but called nowhere (not even by another macro): its calls were lost.
  return names.filter((n) => (all.match(new RegExp(`\\b${n}\\s*\\(`, 'g'))?.length ?? 0) <= 1)
}

// Logic beyond simple conditions: macros, computed variables, loops writing cells.
const looksLikeTemplate = (src: string) => /\{%-?\s*(macro|do|for)\b/.test(src) || (src.match(/\{%-?\s*set\b/g)?.length ?? 0) >= 5

// What a rendering shows: its images and the length of its visible text.
function renderedSize(html: string): { imgs: number; text: number; junk: number } {
  let imgs = 0
  let text = 0
  let junk = 0
  let hidden = 0
  const p = new Parser(
    {
      onopentag: (n) => {
        if (n === 'img') imgs++
        if (n === 'style' || n === 'script' || n === 'title') hidden++
      },
      onclosetag: (n) => {
        if (n === 'style' || n === 'script' || n === 'title') hidden = Math.max(0, hidden - 1)
      },
      ontext: (t) => {
        if (hidden) return
        text += t.replace(/\s+/g, '').length
        // Code printed as text: HuBL or attributes of a broken tag.
        junk += (t.match(/\{\{|\{%|%\}|\}\}|\w="|<\/?[a-z]/gi) ?? []).length
      },
    },
    { decodeEntities: true },
  )
  p.end(html)
  return { imgs, text, junk }
}

// Fields of the blocks bound to `{{ module.x }}` (types the analyzer alone can't tell).
function blockSpecs(tree: ModuleTree): FieldSpec[] {
  const out: FieldSpec[] = []
  for (const f of collectFields(tree)) {
    const b = f.block
    const d = b.field
    if (!d) continue
    if (b.type === 'button') {
      if (d.textName) out.push({ name: d.textName, label: d.label ?? f.label, type: 'text', default: b.label })
      if (d.linkName) out.push({ name: d.linkName, label: `${d.label ?? f.label} (lien)`, type: 'link', default: { url: { content_id: null, type: 'EXTERNAL', href: b.href }, open_in_new_tab: false, no_follow: false } })
      continue
    }
    const exact = d.specs?.[f.name]
    if (exact) continue
    if (b.type === 'heading') out.push({ name: f.name, label: d.label ?? f.label, type: 'text', default: b.text })
    else if (b.type === 'image') out.push({ name: f.name, label: d.label ?? f.label, type: 'image', default: { src: b.src, alt: b.alt } })
  }
  return out.filter((s) => !s.name.includes('.')).map((s) => ({ ...s, raw: { name: s.name, label: s.label, type: s.type, required: false, locked: false, default: s.default } }))
}
