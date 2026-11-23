import { codeToTree, syncExtraFields } from '@/lib/hubl'
import { isLogicBlock } from '@/lib/hubl-render'
import { withLegacySpecs } from '@/lib/hubl-legacy'
import { validateSyntax } from '@/lib/validator'
import { cleanSource, keepTemplateWhole } from '@/lib/import-repair'
import { parseLenient } from '@/lib/json-repair'
import type { FieldBinding, FieldSpec } from '@/lib/module-fields'
import type { Block, ModuleTree } from '@/lib/types'

// Lets Maily recognise code sent in the chat (pasted, typed or attached) and
// turn it into a rendered module locally, before asking the model anything.
// Only when the local import is too lossy is the model asked to recreate it.

const TAG =
  /<\/?(table|thead|tbody|tfoot|tr|td|th|caption|colgroup|col|div|p|h[1-6]|img|a|span|section|body|html|head|style|title|meta|link|center|font|b|i|u|s|strike|small|big|sup|sub|ul|ol|li|dl|dt|dd|br|hr|strong|em|button|header|footer|main|article|aside|nav|figure|figcaption|picture|source|video|blockquote|pre|code|label|form|input|iframe|mjml|mj-[\w-]+|v:[\w]+|o:[\w]+)\b[^>]*>/gi
// Template syntaxes: HuBL/Jinja/Liquid/Django, Handlebars, Mailchimp merge tags, AMPscript, Mailjet.
const TOKEN = /\{%[\s\S]*?%\}|\{\{[#/^]?\s*[\w.'"[\]-]+[\s\S]*?\}\}|\*\|[A-Z0-9_:]+\|\*|%%\[|%%=|\[\[(?:var|data):/

export function looksLikeCode(text: string): boolean {
  const tags = text.match(TAG)?.length ?? 0
  if (tags >= 3) return true
  const closes = /<\/[a-z][\w:-]*\s*>/i.test(text)
  // Unfinished tokens count too ({{ contact.firstname } is code to repair).
  if (tags >= 1 && closes && (TOKEN.test(text) || /\{[{%]\s*[\w.]+/.test(text))) return true
  // A full document or an MJML template, even short.
  return tags >= 2 && /<(mjml|html|!doctype|mj-body)\b/i.test(text)
}

// A style sheet alone (rules, no markup).
const looksLikeCss = (text: string) => !/<[a-z]/i.test(text) && /[^{}]+\{[^{}]*:[^{}]*\}/.test(text) && !/^\s*[[{]/.test(text)

// JSON (fields.json, another tool's JSON), comments and trailing commas allowed.
function looksLikeJson(text: string): boolean {
  const t = text.trim()
  if (!/^(\/[/*][^\n]*\n\s*)*[[{]/.test(t) || !/[\]}]$/.test(t) || !/["']\s*:/.test(t)) return false
  const v = parseLenient(t)?.value
  return !!v && typeof v === 'object'
}

/** File name for code pasted or typed in the chat, so it is read as what it is. */
export function codeFileName(text: string, lang = ''): string | null {
  if (/^json/i.test(lang) || looksLikeJson(text)) return /^\s*(\/[/*][^\n]*\n\s*)*\[/.test(text) ? 'fields.json' : 'donnees.json'
  if (/^(s?css|less)$/i.test(lang) || (!lang && looksLikeCss(text) && /[;}]\s*$/.test(text.trim()))) return 'styles.css'
  if (looksLikeCode(text) || (/^(html?|hubl|jinja2?|j2|liquid|mjml|xml|neon|handlebars|hbs|mustache|twig|njk|django|ampscript)$/i.test(lang) && (new RegExp(TAG.source, 'i').test(text) || TOKEN.test(text)))) {
    return 'code-colle.html'
  }
  return null
}

export interface TypedCode {
  /** All markup found, joined (HTML/HuBL/other templates). */
  code: string
  instruction: string
  /** Every piece of code found, named by kind (code-colle.html, styles.css, fields.json…). */
  files: { name: string; text: string }[]
}

// Separates code typed in a message from the instruction around it. Several
// fenced blocks are read one by one (HTML + CSS + fields.json in one message).
export function extractCode(text: string): TypedCode | null {
  const files: TypedCode['files'] = []
  let instruction = text
  for (const f of [...text.matchAll(/```([\w+-]*)[^\n]*\n([\s\S]*?)```/g)]) {
    const name = codeFileName(f[2], f[1])
    if (!name) continue
    files.push({ name, text: f[2].trim() })
    instruction = instruction.replace(f[0], ' ')
  }
  if (!files.length) {
    if (looksLikeCode(text)) {
      // Merge tags of other platforms (*|FNAME|*, %%[ ]%%, [[var:x]]) are part of the code.
      const start = text.search(/<[a-z!]|\{[%{#]|\*\|[A-Z]|%%[[=]|\[\[(?:var|data):/i)
      const end =
        Math.max(text.lastIndexOf('>'), text.lastIndexOf('%}') + 1, text.lastIndexOf('}}') + 1, text.lastIndexOf('|*') + 1, text.lastIndexOf(']]') + 1, text.lastIndexOf(']%%') + 2, text.lastIndexOf('=%%') + 2) + 1
      if (start < 0 || end <= start) return null
      files.push({ name: 'code-colle.html', text: text.slice(start, end).trim() })
      instruction = `${text.slice(0, start)} ${text.slice(end)}`
    } else {
      // A JSON pasted after the instruction (« voici mon fields.json : [ … ] »).
      const j = /(^|[:\n])\s*((?:\[\s*\{|\{\s*["'])[\s\S]*[\]}])\s*$/.exec(text)
      if (!j || !looksLikeJson(j[2])) return null
      files.push({ name: codeFileName(j[2]) ?? 'donnees.json', text: j[2].trim() })
      instruction = text.slice(0, j.index + j[1].length)
    }
  }
  // Two HTML parts are one module (e.g. head styles + body), given once.
  const markup = files.filter((f) => f.name.endsWith('.html'))
  const merged = markup.length > 1 ? [{ name: 'code-colle.html', text: markup.map((f) => f.text).join('\n') }, ...files.filter((f) => !f.name.endsWith('.html'))] : files
  return { code: markup.map((f) => f.text).join('\n'), instruction: instruction.replace(/\s+/g, ' ').trim(), files: merged }
}

const CONVERT =
  /(cr[ée]+|recr[ée]|transform|convert|import|rendu|affich|reprodu|int[ée]gr|utilis|appliqu|charg|refai|reconstrui|visualis|mets?[- ]le|colle|corrig|r[ée]pare|am[ée]lior|modifi|adapt|optimis|nettoi|mets? [àa] jour|actualis|voici|voil[àa]|reprend|[ée]dit|ajout|remplac|traduis|r[ée]cup[èe]r|rends?[- ]le|fais[- ]en|ouvre)/i
// A plain question about the code (« pourquoi… », « que fait… ») only gets an answer.
const QUESTION = /^\s*(pourquoi|comment|qu['’]est|est-ce|que (fait|veut|signifie)|c['’]est quoi|explique|à quoi|a quoi|quel(le)?s?\b)/i
const STRONG = /(transform|convert|import|recr[ée]|refai|corrig|r[ée]pare|applique)/i

// In Conseil mode a question about a piece of code shouldn't replace the module.
export const wantsConversion = (instruction: string, mode: 'chat' | 'build') =>
  mode === 'build' || !instruction || (CONVERT.test(instruction) && (!QUESTION.test(instruction) || STRONG.test(instruction)))

// The platform the code was written for, read on the code as received.
function platformOf(input: string): string | undefined {
  if (/<mjml\b|<mj-(body|section|column)\b/i.test(input)) return 'du MJML'
  if (/<meta\s[^>]*class=["']mkto|\{\{\s*(lead|my)\./i.test(input)) return 'un modèle Marketo'
  if (/%%\[|%%=\s*v\(/i.test(input)) return 'un modèle Salesforce Marketing Cloud (AMPscript)'
  if (/\*\|[A-Z0-9_:]+\|\*|\smc:(edit|repeatable)/.test(input)) return 'un modèle Mailchimp'
  if (/\[\[(var|data):/.test(input)) return 'un modèle Mailjet'
  if (/\{\{[#/](if|each|unless|with)\b/.test(input)) return 'un modèle Handlebars'
  if (/\{%-?\s*(assign|capture|case|when|elsif|endcase|tablerow|unsubscribe)\b|\{\{[^}]*\|\s*\w+\s*:/.test(input)) return 'un modèle Liquid'
  return undefined
}

function kindOf(code: string, input = code): string {
  if (/data-neon=["']section/.test(code)) return 'un module Neon Sandbox'
  const platform = platformOf(input)
  if (platform) return `${platform} (converti en HuBL)`
  if (/\{\{\s*module\.|\{%\s*(module|widget)/.test(code)) return 'un module HuBL avec des champs {{ module.… }}'
  const hubl = /\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/.test(code)
  const email = /<table\b/i.test(code) && /role=["']presentation|cellpadding|bgcolor|<!--\[if mso/i.test(code)
  const base = email ? 'du HTML email (mise en page en tableaux)' : /<style\b/i.test(code) ? 'du HTML/CSS classique' : 'du HTML'
  return hubl ? `${base} avec du HuBL` : base
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

export type Recognition =
  | { ok: true; tree: ModuleTree; kind: string; complete: boolean; summary: string; issue?: string; binding?: FieldBinding; source: string }
  | { ok: false; kind: string; error: string }

export function recognizeCode(input: string, current: ModuleTree, given?: FieldSpec[]): Recognition {
  // Pasted code is cleaned and repaired first (escaped HTML, JSON string,
  // unfinished HuBL, unclosed blocks…): see import-repair.ts.
  const clean = /data-neon=["']section/.test(input) ? { code: input, repairs: [] as string[], specs: [] as FieldSpec[] } : cleanSource(input)
  const code = clean.code
  const withTags = clean.specs.length ? [...(given ?? []), ...clean.specs.filter((s) => !(given ?? []).some((g) => g.name === s.name))] : given
  // Fields declared by old template tags ({% text "titre" … %}) count like a fields.json.
  const specs = withLegacySpecs(code, withTags)
  const kind = kindOf(code, input)
  const res = codeToTree(code, current, specs)
  if (!res.ok) return { ok: false, kind, error: res.error }

  // Every variable no block owns becomes a module field (the variable stays in the content).
  const synced = syncExtraFields({ ...res.tree, fields: undefined }, specs, code)
  // A template whose layout blocks would lose (macros, computed widths…) is kept whole.
  const kept = keepTemplateWhole(code, synced, specs)?.tree
  const tree = kept ?? synced
  const created = tree.fields ?? []

  const st = { blocks: 0, raw: 0, cards: 0 }
  const walk = (list: Block[]) => {
    for (const b of list) {
      if (b.type === 'section') {
        st.cards++
        b.cells.forEach(walk)
      } else if (!isLogicBlock(b)) {
        // {% if %} / {% endif %} lines are interpreted by the preview, not "free code".
        st.blocks++
        if (b.type === 'raw') st.raw++
      }
    }
  }
  tree.sections.forEach((s) => s.cells.forEach(walk))

  // Placeholders that stayed literal text (inside HuBL logic, mixed with other
  // content) are the only ones the model still has to deal with.
  const binding = res.binding
  const unbound = (binding?.unbound ?? []).filter((n) => !created.some((f) => f.name === n))
  const left = unbound.length
  const syntax = validateSyntax(code)
  const issue =
    syntax.errors > 0
      ? `${plural(syntax.errors, 'erreur de syntaxe', 'erreurs de syntaxe')} dans le code (${syntax.issues
          .filter((i) => i.severity === 'error')
          .slice(0, 3)
          .map((i) => `ligne ${i.line} : ${i.message}${i.fix ? ` — correction proposée : ${i.fix.label}` : ''}`)
          .join(' ; ')})`
      : left > 0
      ? `${plural(left, 'variable', 'variables')} {{ module.… }} (${unbound.join(', ')}) non liée${left > 1 ? 's' : ''} à un champ`
      : !kept && st.blocks && st.raw / st.blocks > 0.5
        ? `${st.raw} blocs sur ${st.blocks} restent en Bloc HTML`
        : undefined

  const parts = [plural(tree.sections.length, 'section', 'sections'), plural(st.blocks - st.raw, 'bloc éditable', 'blocs éditables')]
  if (st.cards) parts.push(plural(st.cards, 'card', 'cards'))
  const raw = kept
    ? ' (modèle gardé tel quel : macros et largeurs calculées conservées, contenu réglable dans l’onglet Champs)'
    : st.raw
    ? ` et ${plural(st.raw, 'Bloc HTML', 'Blocs HTML')} (logique HuBL ou éléments non reconnus, conservés tels quels)`
    : ''
  const fields = binding?.bound.length
    ? ` ${plural(binding.bound.length, 'champ reconnu', 'champs reconnus')} avec leurs noms exacts (${binding.bound.flatMap((f) => f.exposed).join(', ')}).`
    : ''
  const extra = created.length
    ? ` ${plural(created.length, 'champ créé', 'champs créés')} pour les variables du code (${created.map((f) => f.name).join(', ')}) : elles restent en place dans le contenu.`
    : ''
  return {
    ok: true,
    tree,
    kind,
    binding,
    complete: !issue,
    issue,
    summary: `J'ai reconnu **${kind}** et je l'ai transformé en rendu : ${parts.join(', ')}${raw}.${fields}${extra}${clean.repairs.length ? ` Corrigé avant l'import : ${clean.repairs.join(' ; ')}.` : ''}`,
    source: code,
  }
}
