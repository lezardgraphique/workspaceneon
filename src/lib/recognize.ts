import { codeToTree } from '@/lib/hubl'
import { isLogicBlock } from '@/lib/hubl-render'
import { validateSyntax } from '@/lib/validator'
import type { FieldBinding, FieldSpec } from '@/lib/module-fields'
import type { Block, ModuleTree } from '@/lib/types'

// Lets Maily recognise code sent in the chat (pasted, typed or attached) and
// turn it into a rendered module locally, before asking the model anything.
// Only when the local import is too lossy is the model asked to recreate it.

const FENCE = /```(?:html?|hubl|jinja2?|xml|neon)?[^\n]*\n([\s\S]*?)```/i
const TAG =
  /<\/?(table|tr|td|div|p|h[1-6]|img|a|span|section|body|html|head|style|center|ul|ol|li|br|hr|strong|em|button|header|footer|main|article)\b[^>]*>/gi

export const looksLikeCode = (text: string) =>
  (text.match(TAG)?.length ?? 0) >= 3 || /\{%[\s\S]*?%\}[\s\S]*<[a-z]/i.test(text)

// Separates code typed in a message from the instruction around it.
export function extractCode(text: string): { code: string; instruction: string } | null {
  const f = FENCE.exec(text)
  if (f && looksLikeCode(f[1])) {
    return { code: f[1].trim(), instruction: `${text.slice(0, f.index)} ${text.slice(f.index + f[0].length)}`.trim() }
  }
  if (!looksLikeCode(text)) return null
  const start = text.search(/<[a-z!]|\{[%{#]/i)
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

export function recognizeCode(code: string, current: ModuleTree, specs?: FieldSpec[]): Recognition {
  const kind = kindOf(code)
  const res = codeToTree(code, current, specs)
  if (!res.ok) return { ok: false, kind, error: res.error }

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
  res.tree.sections.forEach((s) => s.cells.forEach(walk))

  // Placeholders that stayed literal text (inside HuBL logic, mixed with other
  // content) are the only ones the model still has to deal with.
  const binding = res.binding
  const left = binding?.unbound.length ?? 0
  const syntax = validateSyntax(code)
  const issue =
    syntax.errors > 0
      ? `${plural(syntax.errors, 'erreur de syntaxe', 'erreurs de syntaxe')} dans le code (ligne ${syntax.issues.find((i) => i.severity === 'error')!.line} : ${syntax.issues.find((i) => i.severity === 'error')!.message})`
      : left > 0
      ? `${plural(left, 'variable', 'variables')} {{ module.… }} (${binding!.unbound.join(', ')}) non liée${left > 1 ? 's' : ''} à un champ`
      : st.blocks && st.raw / st.blocks > 0.5
        ? `${st.raw} blocs sur ${st.blocks} restent en Code libre`
        : undefined

  const parts = [plural(res.tree.sections.length, 'section', 'sections'), plural(st.blocks - st.raw, 'bloc éditable', 'blocs éditables')]
  if (st.cards) parts.push(plural(st.cards, 'card', 'cards'))
  const raw = st.raw
    ? ` et ${plural(st.raw, 'bloc Code libre', 'blocs Code libre')} (logique HuBL ou éléments non reconnus, conservés tels quels)`
    : ''
  const fields = binding?.bound.length
    ? ` ${plural(binding.bound.length, 'champ reconnu', 'champs reconnus')} avec leurs noms exacts (${binding.bound.flatMap((f) => f.exposed).join(', ')}).`
    : ''
  return {
    ok: true,
    tree: res.tree,
    kind,
    binding,
    complete: !issue,
    issue,
    summary: `J'ai reconnu **${kind}** et je l'ai transformé en rendu : ${parts.join(', ')}${raw}.${fields}`,
  }
}
