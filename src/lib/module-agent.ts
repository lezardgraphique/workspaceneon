import { codeToTree, reconcileIds, treeToCode } from '@/lib/hubl'
import type { Block, ModuleTree, Section } from '@/lib/types'

export type ModuleAgentStatus = {
  ok: boolean
  score: number
  issues: string[]
  warnings: string[]
  imported: boolean
  kind: string
  tree?: ModuleTree
  summary: string
}

const countBlocks = (list: Block[]) => {
  let blocks = 0
  let raw = 0
  let cards = 0

  const walk = (items: Block[]) => {
    for (const block of items) {
      if (block.type === 'section') {
        cards++
        block.cells.forEach(walk)
      } else {
        blocks++
        if (block.type === 'raw') raw++
      }
    }
  }

  walk(list)
  return { blocks, raw, cards }
}

export function optimizeModuleTree(tree: ModuleTree): ModuleTree {
  const sections = tree.sections
    .map((section) => {
      const cells = section.cells
        .map((cell) =>
          cell.filter((block) => {
            if (block.type === 'raw') return !!block.html.trim()
            if (block.type === 'text') return !!block.html.trim()
            if (block.type === 'heading') return !!block.text.trim()
            return true
          }),
        )
        .filter((cell) => cell.length > 0)

      const normalized = cells.length ? cells : [[]]
      return {
        ...section,
        columns: Math.min(3, Math.max(1, normalized.length)) as Section['columns'],
        cells: normalized,
      }
    })
    .filter((section) => section.cells.some((cell) => cell.length > 0))

  return {
    ...tree,
    sections,
    width: Math.min(900, Math.max(320, Math.round(tree.width || 600))),
    bg: tree.bg || '#ffffff',
    font: tree.font || 'Helvetica Neue, Helvetica, Arial, sans-serif',
  }
}

export function validateModuleCode(code: string, current: ModuleTree): ModuleAgentStatus {
  const parsed = codeToTree(code, current)
  if (!parsed.ok) {
    return {
      ok: false,
      score: 0,
      issues: [parsed.error],
      warnings: [],
      imported: false,
      kind: 'invalide',
      summary: 'Le code fourni n’est pas valide pour le moteur du module.',
    }
  }

  const tree = optimizeModuleTree(reconcileIds(parsed.tree, current))
  const counts = countBlocks(tree.sections.flatMap((section) => section.cells.flat()))
  const rawRatio = counts.blocks ? counts.raw / counts.blocks : 0
  const issues: string[] = []
  const warnings: string[] = []

  if (!tree.sections.length) issues.push('Le module n’a aucune section valide.')
  if (tree.width < 320 || tree.width > 900) warnings.push('La largeur du module sort des limites recommandées.')
  if (rawRatio > 0.45) issues.push(`Le code contient trop de blocs libres (${counts.raw}/${counts.blocks}).`)
  if (counts.cards === 0) warnings.push('Aucune card/section structurée n’a été détectée.')
  if (counts.blocks === 0) issues.push('Aucun bloc exploitable n’a été reconnu.')

  if (rawRatio > 0.2) warnings.push('Des éléments HuBL ou HTML non reconnus restent conservés en mode libre.')

  const score = Math.max(0, Math.min(100, 100 - issues.length * 28 - warnings.length * 8 - Math.round(rawRatio * 30)))
  const ok = score >= 70 && issues.length === 0

  return {
    ok,
    score,
    issues,
    warnings,
    imported: !!parsed.imported,
    kind: parsed.imported ? 'HTML/HuBL importé' : 'module Neon valide',
    tree,
    summary: ok
      ? `Validation OK : ${tree.sections.length} section${tree.sections.length > 1 ? 's' : ''}, ${counts.blocks} bloc${counts.blocks > 1 ? 's' : ''} reconnus et ${counts.raw} bloc${counts.raw > 1 ? 's' : ''} libre${counts.raw > 1 ? 's' : ''} conservés.`
      : `Le code nécessite une correction avant application : ${issues.join(' ') || 'structure trop instable pour être appliquée.'}`,
  }
}

export function repairModuleCode(code: string, current: ModuleTree): ModuleAgentStatus {
  const result = validateModuleCode(code, current)
  return {
    ...result,
    summary: result.ok
      ? `${result.summary} Le moteur a conservé la structure et appliqué les corrections nécessaires.`
      : `${result.summary} Les blocs non valides ont été rejetés et la version actuelle reste inchangée.`,
  }
}

export function renderModuleForPreview(tree: ModuleTree, name: string): string {
  return treeToCode(tree, name)
}
