// Logic lines of a module ({% if %}, {% for %}, {% set %}, comments, macros):
// what each one does in plain French, which elements it governs, and the
// operations of the Structure and Réglages tabs (hidden rows, « Affiché si… »
// badges, removing a condition while keeping its content). Pure.
import { isLogicBlock, isMacroBlock } from './hubl-render'
import { mapLists } from './tree'
import type { Block, ModuleTree, Section } from './types'

export type LogicKind = 'if' | 'elif' | 'else' | 'end' | 'for' | 'set' | 'do' | 'macro' | 'comment' | 'other'

export interface LogicInfo {
  kind: LogicKind
  /** Statement name (if, endfor, set…). */
  name: string
  /** What follows the name: the condition, the list, the assignment. */
  expr: string
  /** Short label for the Structure tab (« Condition », « Boucle »…). */
  title: string
  /** One sentence for the person, in French. */
  summary: string
}

/** Fields of the module, to name them by their label. */
type Labels = Map<string, { label: string; type: string }>
const labelsOf = (tree?: ModuleTree): Labels => new Map((tree?.fields ?? []).map((f) => [f.name, { label: f.label || f.name, type: f.hsType ?? f.type }]))

const CONTACT: Record<string, string> = {
  firstname: 'le prénom du contact',
  lastname: 'le nom du contact',
  email: 'l’e-mail du contact',
  company: 'l’entreprise du contact',
  city: 'la ville du contact',
  phone: 'le téléphone du contact',
  country: 'le pays du contact',
  jobtitle: 'le poste du contact',
}

/** A value of the code, named for a person (« le prénom du contact », « le champ Titre »). */
export function humanValue(expr: string, labels: Labels = new Map()): string {
  const e = expr.trim().replace(/\|[\s\S]*$/, '').trim()
  let m: RegExpExecArray | null
  if ((m = /^contact\.(\w+)$/.exec(e))) return CONTACT[m[1]] ?? `la propriété « ${m[1]} » du contact`
  if ((m = /^(?:module|widget)\.(\w+)((?:\.\w+)*)$/.exec(e))) {
    const label = labels.get(m[1])?.label ?? m[1].replace(/_/g, ' ')
    return m[2] ? `« ${m[2].slice(1).replace(/\./g, ' › ')} » du champ « ${label} »` : `le champ « ${label} »`
  }
  if ((m = /^request\.(\w+)/.exec(e))) return 'l’adresse de la page'
  if ((m = /^loop\.(index0?|first|last)$/.exec(e))) return m[1] === 'first' ? 'le premier élément' : m[1] === 'last' ? 'le dernier élément' : 'le numéro de l’élément'
  if ((m = /^hubdb_table_rows\(/.exec(e))) return 'les lignes d’une table HubDB'
  if ((m = /^(\w+)\.(\w+)$/.exec(e))) return `« ${m[2].replace(/_/g, ' ')} » de ${m[1]}`
  if (/^[A-Za-z_]\w*$/.test(e)) return `« ${e.replace(/_/g, ' ')} »`
  return `« ${e.length > 48 ? `${e.slice(0, 46)}…` : e} »`
}

const literal = (s: string) => s.trim().replace(/^(["'])([\s\S]*)\1$/, '« $2 »')

/** A condition in French (« le prénom du contact est connu »). */
export function humanCondition(expr: string, labels: Labels = new Map()): string {
  const e = expr.trim().replace(/^\(([\s\S]*)\)$/, '$1').trim()
  let m: RegExpExecArray | null
  if (/\s(?:and|or)\s/.test(e)) {
    const parts = e.split(/\s+(and|or)\s+/)
    return parts.map((p, i) => (i % 2 ? (p === 'and' ? 'et' : 'ou') : humanCondition(p, labels))).join(' ')
  }
  if ((m = /^not\s+([\s\S]+)$/.exec(e))) return /^contact\./.test(m[1].trim()) ? `${humanValue(m[1], labels)} est inconnu` : `${humanValue(m[1], labels)} est vide ou désactivé`
  if ((m = /^([\s\S]+?)\s*(==|!=|>=|<=|>|<)\s*([\s\S]+)$/.exec(e))) {
    const op = { '==': 'vaut', '!=': 'ne vaut pas', '>=': 'vaut au moins', '<=': 'vaut au plus', '>': 'dépasse', '<': 'est inférieur à' }[m[2]]
    if (/^(true|True)$/.test(m[3])) return `${humanValue(m[1], labels)} est ${m[2] === '==' ? 'activé' : 'désactivé'}`
    return `${humanValue(m[1], labels)} ${op} ${literal(m[3])}`
  }
  if ((m = /^([\s\S]+?)\s+not\s+in\s+([\s\S]+)$/.exec(e))) return `${humanValue(m[2], labels)} ne contient pas ${literal(m[1])}`
  if ((m = /^([\s\S]+?)\s+in\s+([\s\S]+)$/.exec(e))) return /^\[/.test(m[2].trim()) ? `${humanValue(m[1], labels)} vaut ${m[2].trim().slice(1, -1).split(',').map(literal).join(' ou ')}` : `${humanValue(m[2], labels)} contient ${literal(m[1])}`
  if ((m = /^([\s\S]+?)\s+is\s+(not\s+)?(\w+)/.exec(e))) return `${humanValue(m[1], labels)} ${m[2] ? 'n’est pas' : 'est'} ${m[3] === 'defined' ? 'défini' : m[3]}`
  if (/^(true|True|1)$/.test(e)) return 'toujours'
  const field = /^(?:module|widget)\.(\w+)$/.exec(e)
  if (/^contact\./.test(e)) return `${humanValue(e, labels)} est connu`
  if (field && labels.get(field[1])?.type === 'boolean') return `${humanValue(e, labels)} est activé`
  return `${humanValue(e, labels)} est rempli`
}

/** What a logic block does, or null for content. */
export function logicInfo(b: Block, tree?: ModuleTree): LogicInfo | null {
  if (!isLogicBlock(b) || b.type !== 'raw') return null
  const labels = labelsOf(tree)
  if (isMacroBlock(b)) {
    const names = [...b.html.matchAll(/\{%-?\s*macro\s+(\w+)/g)].map((m) => m[1])
    return { kind: 'macro', name: 'macro', expr: names.join(', '), title: 'Modèle réutilisable', summary: `Définit ${names.length > 1 ? 'les modèles' : 'le modèle'} « ${names.join(' », « ')} », écrit${names.length > 1 ? 's' : ''} ailleurs dans le module. N’affiche rien ici.` }
  }
  if (/^\s*\{#/.test(b.html)) return { kind: 'comment', name: 'comment', expr: b.html.replace(/^\s*\{#|#\}\s*$/g, '').trim(), title: 'Commentaire', summary: 'Note laissée dans le code : rien ne s’affiche dans l’e-mail.' }
  const m = /^\s*\{%-?\s*(\w+)\s*([\s\S]*?)\s*-?%\}\s*$/.exec(b.html)
  const name = m?.[1] ?? ''
  const expr = m?.[2] ?? ''
  switch (name) {
    case 'if':
      return { kind: 'if', name, expr, title: 'Condition', summary: `Les éléments qui suivent s’affichent seulement si ${humanCondition(expr, labels)}.` }
    case 'unless':
      return { kind: 'if', name, expr, title: 'Condition', summary: `Les éléments qui suivent s’affichent sauf si ${humanCondition(expr, labels)}.` }
    case 'elif':
      return { kind: 'elif', name, expr, title: 'Sinon si', summary: `Sinon, les éléments qui suivent s’affichent si ${humanCondition(expr, labels)}.` }
    case 'else':
      return { kind: 'else', name, expr, title: 'Sinon', summary: 'Les éléments qui suivent s’affichent quand la condition (ou la liste) au-dessus ne donne rien.' }
    case 'endif':
    case 'endunless':
      return { kind: 'end', name, expr, title: 'Fin de condition', summary: 'Ferme la condition ouverte plus haut : la suite s’affiche toujours.' }
    case 'endfor':
      return { kind: 'end', name, expr, title: 'Fin de boucle', summary: 'Ferme la boucle ouverte plus haut.' }
    case 'for': {
      const f = /^([\w\s,]+?)\s+in\s+([\s\S]+)$/.exec(expr)
      return { kind: 'for', name, expr, title: 'Boucle', summary: `Les éléments qui suivent sont répétés pour chaque élément de ${humanValue(f?.[2] ?? expr, labels)}.` }
    }
    case 'set': {
      const f = /^(\w+)\s*=\s*([\s\S]+)$/.exec(expr)
      return { kind: 'set', name, expr, title: 'Variable', summary: f ? `Calcule « ${f[1]} » (${humanValue(f[2], labels).replace(/^« ([\s\S]*) »$/, '$1')}), utilisé plus loin. N’affiche rien.` : 'Calcule une valeur utilisée plus loin. N’affiche rien.' }
    }
    case 'do':
      return { kind: 'do', name, expr, title: 'Calcul', summary: 'Prépare une valeur utilisée plus loin. N’affiche rien.' }
    default:
      return { kind: 'other', name, expr, title: 'Logique', summary: 'Instruction du code : rien ne s’affiche à sa place.' }
  }
}

/** The list (cell) holding `id`, and its position there. */
function locate(tree: ModuleTree, id: string): { list: Block[]; index: number } | null {
  const search = (list: Block[]): { list: Block[]; index: number } | null => {
    const index = list.findIndex((b) => b.id === id)
    if (index >= 0) return { list, index }
    for (const b of list) if (b.type === 'section') for (const c of b.cells) {
      const hit = search(c)
      if (hit) return hit
    }
    return null
  }
  return search(tree.sections)
}

export interface LogicFrame {
  /** Id of the {% if %} / {% for %} (or of the {% elif %} / {% else %} of the branch). */
  id: string
  kind: 'if' | 'for'
  /** « si le prénom du contact est connu », « répété pour… » */
  text: string
}

/** For every element: the conditions and loops it sits in (outermost first). */
export function logicFrames(tree: ModuleTree): Map<string, LogicFrame[]> {
  const out = new Map<string, LogicFrame[]>()
  const labels = labelsOf(tree)
  const walk = (list: Block[], outer: LogicFrame[]) => {
    const stack: LogicFrame[] = []
    for (const b of list) {
      const info = logicInfo(b, tree)
      if (info) {
        const neg = /^\s*\{%-?\s*unless\b/.test(b.type === 'raw' ? b.html : '')
        if (info.kind === 'if') stack.push({ id: b.id, kind: 'if', text: `${neg ? 'sauf si' : 'si'} ${humanCondition(info.expr, labels)}` })
        else if (info.kind === 'for') {
          const f = /\s+in\s+([\s\S]+)$/.exec(info.expr)
          stack.push({ id: b.id, kind: 'for', text: `répété pour chaque élément de ${humanValue(f?.[1] ?? info.expr, labels)}` })
        } else if (info.kind === 'elif' && stack.length) stack[stack.length - 1] = { id: b.id, kind: 'if', text: `sinon, si ${humanCondition(info.expr, labels)}` }
        else if (info.kind === 'else' && stack.length) {
          const top = stack[stack.length - 1]
          stack[stack.length - 1] = { id: b.id, kind: 'if', text: top.kind === 'for' ? 'quand la liste est vide' : 'sinon (condition du dessus non remplie)' }
        } else if (info.kind === 'end') stack.pop()
        continue
      }
      const frames = [...outer, ...stack]
      if (frames.length) out.set(b.id, frames)
      if (b.type === 'section') b.cells.forEach((c) => walk(c, frames))
    }
  }
  tree.sections.forEach((s) => s.cells.forEach((c) => walk(c, [])))
  return out
}

/** Number of logic lines in the module. */
export function countLogic(tree: ModuleTree): number {
  let n = 0
  const walk = (list: Block[]) => list.forEach((b) => (isLogicBlock(b) ? n++ : b.type === 'section' && b.cells.forEach(walk)))
  tree.sections.forEach((s) => s.cells.forEach(walk))
  return n
}

/** A section (or card) holding nothing but logic lines. */
export const onlyLogic = (s: Section): boolean => s.cells.some((c) => c.length > 0) && s.cells.every((c) => c.every((b) => isLogicBlock(b) || (b.type === 'section' && onlyLogic(b))))

/** Index of the line closing the {% if %} / {% for %} at `from`, and its branch lines. */
function span(list: Block[], from: number): { end: number; branches: number[] } {
  let depth = 0
  const branches: number[] = []
  for (let j = from + 1; j < list.length; j++) {
    const k = logicInfo(list[j])?.kind
    if (k === 'if' || k === 'for') depth++
    else if (k === 'end') {
      if (depth === 0) return { end: j, branches }
      depth--
    } else if ((k === 'elif' || k === 'else') && depth === 0) branches.push(j)
  }
  return { end: list.length, branches }
}

/** The elements governed by the condition or loop at `id` (first branch). */
export function governed(tree: ModuleTree, id: string): Block[] {
  const at = locate(tree, id)
  if (!at) return []
  const k = logicInfo(at.list[at.index])?.kind
  if (k !== 'if' && k !== 'for' && k !== 'elif' && k !== 'else') return []
  const { end, branches } = span(at.list, at.index)
  const stop = branches[0] ?? end
  return at.list.slice(at.index + 1, stop).filter((b) => !isLogicBlock(b))
}

/**
 * Removes a condition or a loop and keeps what it governs: a condition keeps
 * its first case (the « sinon » cases go), a loop keeps its body shown once.
 * Any other logic line is simply deleted.
 */
export function removeLogic(tree: ModuleTree, id: string): ModuleTree {
  const at = locate(tree, id)
  if (!at) return tree
  const info = logicInfo(at.list[at.index])
  if (!info) return tree
  if (info.kind !== 'if' && info.kind !== 'for') return mapLists(tree, (list) => list.filter((b) => b.id !== id))
  const list = at.list
  const { end, branches } = span(list, at.index)
  const stop = branches[0] ?? end
  const next = [...list.slice(0, at.index), ...list.slice(at.index + 1, stop), ...list.slice(end + 1)]
  return mapLists(tree, (l) => (l === list ? next : l))
}

/** Rewrites the condition / list / value of a logic line, keeping its tag. */
export function setLogicExpr(html: string, expr: string): string {
  return html.replace(/^(\s*\{%-?\s*\w+\s*)([\s\S]*?)(\s*-?%\}\s*)$/, (_m, a: string, _e: string, b: string) => `${a.replace(/\s*$/, ' ')}${expr.trim()}${b.replace(/^\s*/, ' ')}`)
}
