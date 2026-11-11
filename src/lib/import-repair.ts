// Import of code and JSON that never ends on an empty block: the pasted text
// is cleaned and repaired first (escaped HTML, JSON strings, Markdown fences,
// curly quotes in HuBL, unfinished {{ }} / {% %}, unclosed blocks and
// headings, template wrappers, {% module %} tags), a module is rebuilt from
// its fields when only a fields.json / module JSON is given, and every repair
// is listed for the person. Browser only (codeToTree uses DOMParser).
import { Parser } from 'htmlparser2'
import { codeToTree, previewEmail, syncExtraFields, treeToHubSpot, verbatimBlock } from './hubl'
import { previewScope, renderHubl } from './hubl-render'
import { applyValues, importSpecs, parseForeignJson } from './json-import'
import type { ForeignJson } from './json-import'
import { parseFieldsJson } from './module-fields'
import type { FieldSpec } from './module-fields'
import { parseLenient } from './json-repair'
import { fixCode, validateSyntax } from './validator'
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
  if ((/^".*"$/s.test(t) && /\\[n"t\/]/.test(t)) || (!/\n/.test(t) && /\\n|\\"/.test(t) && /<[a-z]/i.test(t))) {
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
      repairs.push(`${plural(fixed.fixed, 'erreur corrigée', 'erreurs corrigées')} par le validateur (fermetures manquantes ou en trop)`)
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

// ---------------------------------------------------------------------------

export interface ImportInput {
  html: string
  css?: string
  /** A fields.json (list of fields). */
  fieldsJson?: string
  /** Any other JSON (module JSON, values, another tool's model…). */
  other?: string
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
  const css = input.css?.trim() ? input.css : (foreign?.css ?? '')
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
  const source = css.trim() ? `<style>\n${css}\n</style>\n${clean.code}` : clean.code
  const given = [...(fj ?? []), ...clean.specs.filter((s) => !(fj ?? []).some((f) => f.name === s.name))]
  const specs = importSpecs(source, given.length ? given : null, foreign)
  const res = codeToTree(source, current, specs)
  if (!res.ok) return { ok: false, error: res.error, repairs }
  let { tree, applied } = applyValues(syncExtraFields({ ...res.tree, fields: undefined }, specs, source), foreign?.values ?? null)
  const whole = fromFields ? null : keepTemplateWhole(source, tree, specs)
  if (whole) {
    ;({ tree, applied } = applyValues(whole, foreign?.values ?? null))
    repairs.push(KEPT_WHOLE)
  }
  return { ok: true, tree, source, specs, values: foreign?.values ?? null, repairs, fromFields, foreign, fieldsJson: fj, applied }
}

export const KEPT_WHOLE = 'modèle gardé tel quel (macros, largeurs calculées, cellules écrites par des boucles) : son contenu se règle dans l’onglet Champs'

/**
 * Templates built on macros, computed widths or cells printed by loops lose
 * their structure once cut into blocks. `tree` is the imported module (blocks
 * and fields); when its blocks show less than the template itself, the module
 * with the template kept whole, exactly as written, is returned (else null).
 */
export function keepTemplateWhole(source: string, tree: ModuleTree, specs?: FieldSpec[]): ModuleTree | null {
  if (/data-neon=["'](module|section)/.test(source) || !looksLikeTemplate(source)) return null
  const whole = renderedSize(renderHubl(source.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''), previewScope(tree)))
  const cut = renderedSize(previewEmail(tree, 'x'))
  if (!showsMore(whole, cut)) return null
  return syncExtraFields({ ...tree, fields: undefined, sections: [wholeSection(source)] }, specs, source)
}

const wholeSection = (html: string): ModuleTree['sections'][number] => ({ id: uid(), type: 'section', columns: 1, behavior: 'stack', bg: 'transparent', padding: 0, radius: 0, cells: [[verbatimBlock(html)]] })
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
