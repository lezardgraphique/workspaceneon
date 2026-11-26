// Check of the modules imported before the import got its latest fixes
// (HubSpot modules kept whole, tag names built by HuBL, better field types):
// what can be fixed in place, and what only a new import of the original
// files can give back (classes, CSS, markup the old cut lost for good).

import { analyzeFieldRefs } from './extra-fields'
import { retypeField } from './field-edit'
import type { FieldPath } from './field-edit'
import { treeToHubSpot } from './hubl'
import { prepareImport, upgradeImported } from './import-repair'
import { isNeonExport } from './template-doctor'
import type { Block, ExtraField, ExtraFieldType, ModuleTree } from './types'

export interface ImportScan {
  /** Not an imported module (made in the tool): nothing to check. */
  skipped: boolean
  /** Fixes made in `fixed` (French, one per line). */
  fixes: string[]
  /** What only a new import can fix (French). */
  reimport: string[]
  /** The module with the fixes, when there are any. */
  fixed?: ModuleTree
}

const TYPE_NAMES: Partial<Record<ExtraFieldType, string>> = {
  text: 'texte',
  richtext: 'texte enrichi',
  number: 'nombre',
  boolean: 'oui / non',
  choice: 'liste de choix',
  link: 'lien',
  url: 'URL',
  image: 'image',
  file: 'fichier',
  color: 'couleur',
  group: 'groupe',
}

function blocksOf(tree: ModuleTree): Block[] {
  const out: Block[] = []
  const walk = (list: Block[]) => list.forEach((b) => (out.push(b), b.type === 'section' && b.cells.forEach(walk)))
  tree.sections.forEach((s) => s.cells.forEach(walk))
  return out
}

/** Made by an import (fields of a file, fixed content, HuBL kept as code…). */
export function isImported(tree: ModuleTree): boolean {
  if ((tree.fields ?? []).some((f) => f.keep)) return true
  return blocksOf(tree).some(
    (b) => (b.type === 'raw' && (b.verbatim || /\{%|\{\{\s*module\./.test(b.html))) || ('fixed' in b && b.fixed) || ('field' in b && !!b.field?.specs),
  )
}

const fromFieldsJson = (f: ExtraField): boolean => !!f.spec && ('id' in f.spec || 'required' in f.spec || 'locked' in f.spec || !!f.order)

export function scanImport(tree: ModuleTree): ImportScan {
  if (!isImported(tree)) return { skipped: true, fixes: [], reimport: [] }
  const fixes: string[] = []
  const reimport: string[] = []
  const blocks = blocksOf(tree)
  const whole = blocks.some((b) => b.type === 'raw' && b.verbatim)

  // Markup that the old import turned into text: lost, only a new import gives it back.
  const shown = (b: Block) => (b.type === 'text' || b.type === 'raw' ? (b.type === 'raw' && b.verbatim ? '' : b.html) : b.type === 'heading' ? b.text : '')
  if (blocks.some((b) => /&lt;\/?(\{\{|[a-z][\w-]*\s+[\w-]+=)|^\s*"?&gt;|"&gt;/i.test(shown(b))))
    reimport.push('du code s’affiche comme du texte (une balise a été coupée à l’import)')
  // A HubSpot module cut into blocks: its export can't be the module it was.
  const hubspot = (tree.fields ?? []).some(fromFieldsJson) || blocks.some((b) => 'field' in b && !!b.field?.specs)
  if (hubspot && !whole && !tree.cut) reimport.push('module HubSpot découpé en blocs : réimporte ses fichiers pour que l’export redonne le module d’origine (classes, CSS, structure)')

  // A module the old import cut into blocks (or files exported by an older
  // version imported again): rebuilt from its own export, which the doctor puts
  // back to the module's code; its field values, script and meta.json are kept.
  // (Only when code shows as text: a clean cut module is better left as blocks.)
  const rebuilt = rebuild(tree, hubspot && !whole && reimport.some((r) => r.startsWith('du code')))
  if (rebuilt) {
    const lost = reimport.length
    reimport.length = 0
    if (lost) reimport.push('réparé depuis ce qui restait : si un détail manque encore, réimporte les fichiers d’origine')
    return { skipped: false, fixes: rebuilt.fixes, reimport, fixed: rebuilt.tree }
  }

  // Templates cut by the old import, put back together when that shows them better.
  let fixed = upgradeImported(tree)
  if (fixed) fixes.push('modèle importé remis d’un seul tenant')
  let next = fixed ?? tree

  // Fields guessed from the code (no fields.json definition): typed again.
  let code = ''
  try {
    code = treeToHubSpot(next, '')['module.html']
  } catch {
    code = ''
  }
  if (code) {
    const fresh = analyzeFieldRefs(code)
    const visit = (list: ExtraField[] | undefined, again: ExtraField[] | undefined, path: FieldPath) => {
      for (const f of list ?? []) {
        const g = again?.find((x) => x.name === f.name)
        if (!g) continue
        const here = [...path, f.name]
        if (f.type === 'group' && g.type === 'group') {
          visit(f.children, g.children, here)
          continue
        }
        // Defined by a fields.json, or a list kind changed: never touched.
        if (f.spec || f.hsType || f.type === 'group' || g.type === 'group' || g.type === 'json' || f.type === g.type || !!f.repeater !== !!g.repeater) continue
        next = retypeField(next, here, g.type)
        fixes.push(`champ « ${here.join(' › ')} » : ${TYPE_NAMES[f.type] ?? f.type} → ${TYPE_NAMES[g.type] ?? g.type}`)
      }
    }
    visit(next.fields, fresh, [])
  }
  if (next !== tree) fixed = next
  return { skipped: false, fixes, reimport, ...(fixed && fixes.length ? { fixed } : {}) }
}

function rebuild(tree: ModuleTree, cut: boolean): { tree: ModuleTree; fixes: string[] } | null {
  const kept = blocksOf(tree).find((b): b is Extract<Block, { type: 'raw' }> => b.type === 'raw' && !!b.verbatim && b.source != null)
  let html = ''
  let css = ''
  if (kept && isNeonExport(kept.source!)) {
    html = kept.source!
    css = kept.sourceCss ?? ''
  } else if (cut && !kept) {
    try {
      const out = treeToHubSpot(tree, '')
      html = out['module.html']
      css = out['module.css']
    } catch {
      return null
    }
  } else return null
  let fieldsJson = ''
  try {
    fieldsJson = treeToHubSpot(tree, '')['fields.json']
  } catch {
    fieldsJson = ''
  }
  const p = prepareImport({ html, css, fieldsJson, js: tree.js }, tree)
  if (!p.ok) return null
  const next: ModuleTree = { ...p.tree, ...(tree.js ? { js: tree.js } : {}), ...(tree.meta ? { meta: tree.meta } : {}) }
  const fixes = p.repairs.filter((r) => !/^à savoir/.test(r))
  return fixes.length ? { tree: next, fixes } : null
}
