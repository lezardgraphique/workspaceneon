import { isSample } from './extra-fields'
import { hasVisibleContent } from './hubl-render'
import type { Block, ModuleTree } from './types'

// What the code validator can't see: how the module actually shows. Each note
// says what is wrong and how to fix it, in plain words (shown under the
// validator, and sent to Maily when the user asks her to fix it).

export interface PreviewNote {
  severity: 'error' | 'warning' | 'info'
  message: string
  help: string
}

const blocksOf = (tree: ModuleTree): Block[] => {
  const out: Block[] = []
  const walk = (list: Block[]) => list.forEach((b) => (out.push(b), b.type === 'section' && b.cells.forEach(walk)))
  tree.sections.forEach((s) => walk([s]))
  return out
}

/** `tree`: the module; `shown`: the tree as the preview renders it (interpretForPreview). */
export function checkPreview(tree: ModuleTree, shown: ModuleTree): PreviewNote[] {
  const notes: PreviewNote[] = []
  const lists = (tree.fields ?? []).filter((f) => f.repeater)
  const empty = lists.filter((f) => !Array.isArray(f.default) || f.default.length === 0)
  const samples = lists.filter(isSample)
  const verbatim = blocksOf(tree).some((b) => b.type === 'raw' && b.verbatim)

  if (tree.sections.length && !hasVisibleContent(shown)) {
    const causes = [
      empty.length ? `la liste ${empty.map((f) => `« ${f.label} »`).join(', ')} n'a aucun élément (ajoute-en dans l'onglet Champs)` : '',
      'une condition {% if %} du code est fausse avec les valeurs actuelles des champs',
      verbatim ? '' : "si le module a été importé avant la mise à jour de l'import, sa mise en page a pu être découpée : réimporte le code d'origine (onglet Code › Importer), il est maintenant gardé tel quel",
    ].filter(Boolean)
    notes.push({
      severity: 'error',
      message: "L'aperçu est vide : aucun texte ni image ne s'affiche",
      help: `Causes possibles : ${causes.join(' ; ')}.`,
    })
  }
  for (const f of samples) {
    const n = Array.isArray(f.default) ? f.default.length : 0
    notes.push({
      severity: 'info',
      message: `« ${f.label} » : l'aperçu montre ${n} élément${n > 1 ? 's' : ''} d'exemple`,
      help: "Son fields.json la définit vide ([]). Les exemples servent seulement à voir le rendu : l'export la garde vide tant que tu ne les modifies pas, et HubSpot n'affichera rien avant que tu y ajoutes des éléments. Remplace-les dans l'onglet Champs.",
    })
  }
  if (verbatim) {
    notes.push({
      severity: 'info',
      message: 'Modèle importé tel quel',
      help: "Ses macros, largeurs calculées et cellules écrites par des boucles sont gardées à l'identique et exportées ainsi. Modifie son contenu dans l'onglet Champs et sa structure dans le code. « Convertir en blocs » le découperait et lui ferait perdre sa mise en page.",
    })
  }
  return notes
}
