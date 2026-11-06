import { codeToTree, syncExtraFields } from '@/lib/hubl'
import { isLogicBlock } from '@/lib/hubl-render'
import { withLegacySpecs } from '@/lib/hubl-legacy'
import { validateSyntax } from '@/lib/validator'
import type { FieldBinding, FieldSpec } from '@/lib/module-fields'
import type { Block, ModuleTree } from '@/lib/types'

// Lets Maily recognise code sent in the chat (pasted, typed or attached) and
// turn it into a rendered module locally, before asking the model anything.
// Only when the local import is too lossy is the model asked to recreate it.

const FENCE = /```([^\n`]*)\n([\s\S]*?)```/g
const TAG = /<\/?[a-z][\w:-]*\b[^>]*>/gi
const CODE_LANGUAGES = /^(html?|hubl|jinja2?|twig|liquid|nunjucks|xml|xhtml|mjml|neon)$/i
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

export const looksLikeCode = (text: string) => {
  const tags = text.match(TAG) ?? []
  if (tags.length >= 2 || /\{%[\s\S]*?%\}[\s\S]*<[a-z]/i.test(text) || /data-neon=["'](?:module|section)/i.test(text)) return true
  // Accept a single complete element (including void elements), but don't
  // mistake an incidental tag mentioned in prose for a pasted template.
  const first = text.trimStart().match(/^<([a-z][\w:-]*)\b[^>]*>/i)
  if (!first) return /^\s*<!doctype\s+html\b/i.test(text)
  const name = first[1].toLowerCase()
  return VOID_TAGS.has(name) || new RegExp(`<\\/${name}\\s*>`, 'i').test(text)
}

// Separates code typed in a message from the instruction around it. Multiple
// fenced HTML/HuBL fragments are kept together (e.g. markup and a second block).
export function extractCode(text: string): { code: string; instruction: string } | null {
  const fences = [...text.matchAll(FENCE)]
  const codeFences = fences.filter((f) => {
    const language = (f[1] ?? '').trim().split(/\s+/)[0]
    return CODE_LANGUAGES.test(language) || looksLikeCode(f[2] ?? '')
  })
  if (codeFences.length) {
    const code = codeFences.map((f) => (f[2] ?? '').trim()).filter(Boolean).join('\n')
    let instruction = ''
    let cursor = 0
    for (const fence of codeFences) {
      const start = fence.index ?? cursor
      instruction += `${text.slice(cursor, start)} `
      cursor = start + fence[0].length
    }
    instruction += text.slice(cursor)
    return { code, instruction.trim() }
  }
  if (!looksLikeCode(text)) return null
  const start = text.search(/<[a-z][\w:-]*\b|\{[%{#]/i)
  const end = Math.max(text.lastIndexOf('>'), text.lastIndexOf('%}') + 1, text.lastIndexOf('}}') + 1) + 1
  if (start < 0 || end <= start) return null
  return { code: text.slice(start, end).trim(), instruction: `${text.slice(0, start)} ${text.slice(end)}`.trim() }
}

const CONVERT =
  /(cr[ée]+|recr[ée]|transform|convert|import|rendu|affich|reprodu|int[ée]gr|utilis|appliqu|charg|refai|reconstrui|visualis|mets?[- ]le|colle)/i

// In Conseil mode a question about a piece of code shouldn't replace the module.
export const wantsConversion = (instruction: string, mode: 'chat' | 'build') =>
  mode === 'build' || !instruction || CONVERT.test(instruction)

function kindOf(code: string): string {
  if (/data-neon=["']section/.test(code)) return 'un module Neon Sandbox'
  if (/\{\{\s*module\.|\{%\s*(module|widget)/.test(code)) return 'un module HuBL avec des champs {{ module.… }}'
  const hubl = /\{%[\s\S]*?%\}|\{\{[\s\S]*?\}\}/.test(code)
  const email = /<table\b/i.test(code) && /role=["']presentation|cellpadding|bgcolor|<!--\[if mso/i.test(code)
  const base = email ? 'du HTML email (mise en page en tableaux)' : /<style\b/i.test(code) ? 'du HTML/CSS classique' : 'du HTML'
  return hubl ? `${base} avec du HuBL` : base
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

export type Recognition =
  | { ok: true; tree: ModuleTree; kind: string; complete: boolean; summary: string; issue?: string; binding?: FieldBinding }
  | { ok: false; kind: string; error: string }

export function recognizeCode(code: string, current: ModuleTree, given?: FieldSpec[]): Recognition {
  // Fields declared by old template tags ({% text "titre" … %}) count like a fields.json.
  const specs = withLegacySpecs(code, given)
  const kind = kindOf(code)
  const res = codeToTree(code, current, specs)
  if (!res.ok) return { ok: false, kind, error: res.error }

  // Every variable no block owns becomes a module field (the variable stays in the content).
  const tree = syncExtraFields({ ...res.tree, fields: undefined }, specs, code)
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
  const syntax = validateSyntax(code)
  const issues: string[] = []
  if (syntax.errors > 0) {
    const first = syntax.issues.find((i) => i.severity === 'error')!
    issues.push(`${plural(syntax.errors, 'erreur de syntaxe', 'erreurs de syntaxe')} dans le code (ligne ${first.line} : ${first.message})`)
  }
  if (unbound.length) {
    issues.push(`${plural(unbound.length, 'variable', 'variables')} {{ module.… }} (${unbound.join(', ')}) non liée${unbound.length > 1 ? 's' : ''} à un champ`)
  }
  if (st.blocks && st.raw / st.blocks > 0.5) issues.push(`${st.raw} blocs sur ${st.blocks} restent en Bloc HTML`)
  const issue = issues.length ? issues.join(' ; ') : undefined

  const parts = [plural(tree.sections.length, 'section', 'sections'), plural(st.blocks - st.raw, 'bloc éditable', 'blocs éditables')]
  if (st.cards) parts.push(plural(st.cards, 'card', 'cards'))
  const raw = st.raw
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
    summary: `J'ai reconnu **${kind}** et je l'ai transformé en rendu : ${parts.join(', ')}${raw}.${fields}${extra}`,
  }
}
