// The editor's engine (code ↔ blocks, import, export, audit) run on the server
// for the MCP server. The engine parses HTML with the browser's DOMParser: here
// happy-dom provides it, only for the duration of a synchronous call, so the
// rest of the server (page rendering checks `typeof DOMParser`) never sees it.
import { auditModule } from '@/lib/clients'
import { collectFields } from '@/lib/fields'
import { syncExtraFields, treeToCode, treeToHubSpot } from '@/lib/hubl'
import { validateModuleCode } from '@/lib/module-agent'
import { parseFieldsJson } from '@/lib/module-fields'
import { prepareImport } from '@/lib/import-repair'
import { sanitizeTree } from '@/lib/sanitize-tree'
import { STARTERS } from '@/lib/templates'
import type { ModuleTree } from '@/lib/types'

let win: object | null = null
const GLOBALS = ['DOMParser', 'Node', 'NodeFilter'] as const

/** Loads happy-dom on first use only (not at every server start). Call before withDom. */
export async function prepareDom(): Promise<void> {
  if (win) return
  const { Window } = await import('happy-dom')
  win ??= new Window()
}

export function withDom<T>(fn: () => T): T {
  if (!win) throw new Error('prepareDom() must run first')
  const g = globalThis as Record<string, unknown>
  const saved = GLOBALS.map((k) => [k, g[k]] as const)
  const w = win as unknown as Record<string, unknown>
  for (const k of GLOBALS) g[k] = w[k]
  try {
    return fn()
  } finally {
    for (const [k, v] of saved) {
      if (v === undefined) delete g[k]
      else g[k] = v
    }
  }
}

export const blankTree = (): ModuleTree => STARTERS.find((s) => s.key === 'blank')!.build()

export interface Parsed {
  ok: boolean
  tree?: ModuleTree
  /** What was recognised, or why it was refused (French, for the AI and the user). */
  summary: string
  issues: string[]
  warnings: string[]
}

const MAX_CODE = 400_000

/**
 * Code from the AI → module tree, checked like Maily's modules. Neon code
 * (data-neon markers) must pass the validator; any other HTML/HuBL is imported
 * like the « Importer » dialog, with its fields.json and/or other JSON.
 */
export function parseCode(code: string, opts: { current?: ModuleTree; fieldsJson?: string; otherJson?: string } = {}): Parsed {
  if (!code.trim() && !opts.fieldsJson?.trim() && !opts.otherJson?.trim()) return { ok: false, summary: 'Code vide.', issues: ['Code vide.'], warnings: [] }
  if (code.length > MAX_CODE) return { ok: false, summary: 'Code trop long (400 000 caractères au plus).', issues: ['Code trop long.'], warnings: [] }
  return withDom(() => {
    const current = opts.current ?? blankTree()
    const fj = opts.fieldsJson?.trim() ? parseFieldsJson(opts.fieldsJson) : null
    if (opts.fieldsJson?.trim() && !fj) return { ok: false, summary: 'fields_json illisible : il faut le tableau JSON des champs.', issues: ['fields.json illisible.'], warnings: [] }
    const neon = /data-neon=["'](module|section)/.test(code)
    if (neon) {
      const check = validateModuleCode(code, current, fj ?? undefined)
      if (!check.ok || !check.tree) return { ok: false, summary: check.summary, issues: check.issues, warnings: check.warnings }
      const tree = sanitizeTree(syncExtraFields(check.tree, fj ?? undefined, code))
      return { ok: true, tree, summary: check.summary, issues: [], warnings: check.warnings }
    }
    // Any other HTML/HuBL (or only a fields.json / module JSON): the repairing
    // import of the « Importer » dialog (cleaned code, module from the fields).
    const prep = prepareImport({ html: code, fieldsJson: opts.fieldsJson, other: opts.otherJson }, current)
    if (!prep.ok) return { ok: false, summary: prep.error, issues: [prep.error], warnings: [] }
    const n = collectFields(prep.tree).length + (prep.tree.fields?.length ?? 0)
    const summary = `${prep.fromFields ? 'Module construit à partir des champs' : 'Code importé'} : ${prep.tree.sections.length} section${prep.tree.sections.length > 1 ? 's' : ''}, ${n} champ${n > 1 ? 's' : ''}.${prep.repairs.length ? ` Corrigé avant l'import : ${prep.repairs.join(' ; ')}.` : ''}`
    return { ok: true, tree: sanitizeTree(prep.tree), summary, issues: [], warnings: [] }
  })
}

export const codeOf = (tree: ModuleTree, name: string) => withDom(() => treeToCode(tree, name))
export const exportOf = (tree: ModuleTree, name: string) => withDom(() => treeToHubSpot(tree, name))
export const auditOf = (tree: ModuleTree, name: string) => withDom(() => auditModule(tree, name))

/** Editable fields of a module: block fields (name, kind, label) and the module's other fields. */
export function fieldsOf(tree: ModuleTree) {
  return withDom(() => ({
    blocs: collectFields(tree).map((f) => ({ nom: f.name, type: f.block.type, libelle: f.label })),
    autres: (tree.fields ?? []).map((f) => ({ nom: f.name, type: f.hsType ?? f.type, libelle: f.label })),
  }))
}
