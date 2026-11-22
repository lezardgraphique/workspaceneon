// Maily's targeted edits: instead of writing the whole module again (long, so
// slow), she sends ```neon patch with pairs of « lines before / lines after »
// copied from the module's code. They are applied here to the code she was
// given; a passage that can't be found sends the request back to her.

export interface PatchResult {
  code?: string
  error?: string
  /** Number of passages replaced. */
  count: number
}

const PAIR = /<{5,}[^\n]*\n([\s\S]*?)\n?={5,}[^\n]*\n([\s\S]*?)\n?>{5,}[^\n]*/g

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// The passage at its exact place, or the same words with other spaces / line breaks.
function locate(code: string, find: string): { start: number; end: number } | null | 'many' {
  const at = code.indexOf(find)
  if (at >= 0) return code.indexOf(find, at + 1) >= 0 ? 'many' : { start: at, end: at + find.length }
  const words = find.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return null
  const re = new RegExp(words.map(esc).join('\\s+'), 'g')
  const all = [...code.matchAll(re)]
  if (all.length > 1) return 'many'
  return all[0] ? { start: all[0].index!, end: all[0].index! + all[0][0].length } : null
}

export function applyPatch(code: string, patch: string): PatchResult {
  const pairs = [...patch.matchAll(PAIR)]
  if (!pairs.length) return { error: 'bloc patch vide ou mal formé (paires <<<<<<< AVANT / ======= / >>>>>>> APRÈS attendues)', count: 0 }
  let out = code
  for (const [, before, after] of pairs) {
    if (!before.trim()) return { error: 'une partie AVANT est vide : copie la ligne voisine du code actuel', count: 0 }
    const spot = locate(out, before)
    if (spot === 'many') return { error: `le passage « ${before.trim().slice(0, 60)}… » apparaît plusieurs fois : ajoute des lignes voisines pour le rendre unique`, count: 0 }
    if (!spot) return { error: `le passage « ${before.trim().slice(0, 60)}… » est introuvable dans le code actuel`, count: 0 }
    out = out.slice(0, spot.start) + after + out.slice(spot.end)
  }
  return { code: out, count: pairs.length }
}
