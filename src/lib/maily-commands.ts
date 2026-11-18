// Maily's built-in engine: the everyday adjustments of a module done by the
// tool itself, instantly and without a connection (no AI involved).
// « Change le titre en "Offre spéciale" », « mets le bouton en rouge »,
// « centre le texte », « mets les pictos côte à côte », « ajoute un bouton »,
// « supprime la section 2 », « renomme le champ cta en cta_principal »,
// « ajoute un champ couleur couleur_fond »… Several orders can be chained
// with « puis », « et ensuite » or a new line.
// A request it doesn't fully understand is left to the online Maily (Claude /
// Gemini); offline it is kept until the connection is back.
// No server-only import: this file ships to the browser.

import { collectFields, toFieldName } from '@/lib/fields'
import { mapLists, removeNode, updateNode } from '@/lib/tree'
import { createBlock, uid } from '@/lib/types'
import type { Align, Block, BlockType, ExtraField, ExtraFieldType, ModuleTree, Section } from '@/lib/types'

export interface CommandResult {
  tree: ModuleTree
  /** What was done, one line per order (French, for the chat). */
  done: string[]
  /** Orders not understood (left to the online Maily). */
  left: string[]
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’`]/g, "'")

// ---- colours -----------------------------------------------------------------------

const COLORS: [RegExp, string][] = [
  [/\bbleu (marine|nuit|fonce)\b/, '#1e3a8a'],
  [/\bbleu clair\b/, '#93c5fd'],
  [/\bgris clair\b/, '#f4f4fa'],
  [/\bgris fonce\b/, '#374151'],
  [/\bvert (clair|menthe)\b/, '#86efac'],
  [/\bvert fonce\b/, '#166534'],
  [/\brose (neon|fluo|vif)\b/, '#ff007f'],
  [/\brose pale\b/, '#fce7f3'],
  [/\brouge\b/, '#e11d48'],
  [/\bbleu\b/, '#2563eb'],
  [/\bvert\b/, '#16a34a'],
  [/\bjaune\b/, '#facc15'],
  [/\borange\b/, '#f97316'],
  [/\bviolet\b|\bmauve\b/, '#7c3aed'],
  [/\brose\b/, '#ff007f'],
  [/\bnoir\b/, '#0f0f1a'],
  [/\bblanc\b/, '#ffffff'],
  [/\bgris\b/, '#6b7280'],
  [/\b(turquoise|cyan)\b/, '#00e5ff'],
  [/\bbeige\b|\bcreme\b/, '#f5f0e6'],
  [/\bmarron\b|\bbrun\b/, '#7c4a2d'],
  [/\b(dore|or)\b/, '#d4a017'],
  [/\bmarine\b/, '#1e3a8a'],
]

function colorIn(text: string): string | null {
  const hex = /#([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(text)
  if (hex) return `#${hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]}`.toLowerCase()
  const rgb = /rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)/i.exec(text)
  if (rgb) return `#${rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, '0')).join('')}`
  const f = fold(text)
  for (const [re, hexValue] of COLORS) if (re.test(f)) return hexValue
  return null
}

// ---- targets -----------------------------------------------------------------------

type Kind = 'heading' | 'text' | 'button' | 'image' | 'divider' | 'spacer' | 'section' | 'module'

const KINDS: [RegExp, Kind][] = [
  [/\b(titres?|h1|h2|h3|accroches?)\b/, 'heading'],
  [/\b(boutons?|cta|call to action|appels? a l'action)\b/, 'button'],
  [/\b(images?|photos?|pictos?|pictogrammes?|icones?|logos?|visuels?|illustrations?)\b/, 'image'],
  [/\b(separateurs?|traits?|lignes? de separation)\b/, 'divider'],
  [/\b(espaces?|espaceurs?|marges? vides?)\b/, 'spacer'],
  [/\b(sections?|blocs? de section|cards?|cartes?|encadres?)\b/, 'section'],
  [/\b(textes?|paragraphes?|descriptions?|corps)\b/, 'text'],
  [/\b(module|e-?mail|newsletter|tout le module)\b/, 'module'],
]

const ORDINALS: [RegExp, number][] = [
  [/\b(premier|premiere|1er|1ere|1re)\b/, 1],
  [/\b(deuxieme|second|seconde|2e|2eme|2nd|2nde)\b/, 2],
  [/\b(troisieme|3e|3eme)\b/, 3],
  [/\b(quatrieme|4e|4eme)\b/, 4],
  [/\b(cinquieme|5e|5eme)\b/, 5],
]

interface Spot {
  block: Block
  /** Index of the top-level section it is in. */
  top: number
}

function allBlocks(tree: ModuleTree): Spot[] {
  const out: Spot[] = []
  const walk = (blocks: Block[], top: number) => {
    for (const b of blocks) {
      out.push({ block: b, top })
      if (b.type === 'section') b.cells.forEach((c) => walk(c, top))
    }
  }
  tree.sections.forEach((s, i) => {
    out.push({ block: s, top: i })
    s.cells.forEach((c) => walk(c, i))
  })
  return out
}

interface Target {
  kind: Kind
  /** Every element of that kind (« les boutons », « tous les titres »). */
  all: boolean
  ids: string[]
  label: string
}

const LABEL: Record<Kind, string> = {
  heading: 'le titre',
  text: 'le texte',
  button: 'le bouton',
  image: "l'image",
  divider: 'le séparateur',
  spacer: "l'espace",
  section: 'la section',
  module: 'le module',
}

function findTarget(order: string, tree: ModuleTree, selectedId?: string | null): Target | null {
  const f = fold(order)
  const found = KINDS.find(([re]) => re.test(f))
  const spots = allBlocks(tree)
  // Nothing named: the element selected in the editor, if any.
  if (!found) {
    const sel = selectedId ? spots.find((s) => s.block.id === selectedId) : null
    if (!sel) return null
    const kind = sel.block.type === 'raw' ? null : (sel.block.type as Kind)
    return kind ? { kind, all: false, ids: [sel.block.id], label: LABEL[kind] } : null
  }
  const kind = found[1]
  if (kind === 'module') return { kind, all: false, ids: [], label: LABEL.module }
  // « les boutons », « tous les titres », « mes pictos »: every one of them.
  const word = found[0].exec(f)!
  const plural = /s$/.test(word[0]) && /\b(les|tous les|toutes les|mes|ces|des)\s+(?:\w+\s+)?$/.test(f.slice(0, word.index)) || /\b(tous|toutes)\b/.test(f)
  // Only the top-level sections count as « section N ».
  let list = kind === 'section' ? tree.sections.map((s, i) => ({ block: s as Block, top: i })) : spots.filter((s) => s.block.type === kind)
  // « dans la section 2 » / « de la section 2 » narrows the search.
  const inSection = /\b(?:dans|de|en) la section (\d)\b/.exec(f)
  if (inSection && kind !== 'section') list = list.filter((s) => s.top === Number(inSection[1]) - 1)
  if (!list.length) return { kind, all: false, ids: [], label: LABEL[kind] }
  if (plural) return { kind, all: true, ids: list.map((s) => s.block.id), label: `${list.length > 1 ? 'les' : ''} ${LABEL[kind].replace(/^(le|la|l')\s?/, '')}${list.length > 1 ? 's' : ''}`.trim() }
  // « le 2e titre », « titre 2 », « la section 3 », « le dernier bouton ».
  let n = ORDINALS.find(([re]) => re.test(f))?.[1]
  const numbered = new RegExp(`\\b(?:${['titre', 'texte', 'bouton', 'image', 'section', 'paragraphe', 'picto', 'photo'].join('|')})s? (?:n[°o] ?)?(\\d)\\b`).exec(f)
  if (numbered) n = Number(numbered[1])
  if (/\b(dernier|derniere)\b/.test(f)) n = list.length
  // The selected element when it is of that kind and no number is given.
  if (!n && selectedId) {
    const sel = list.find((s) => s.block.id === selectedId)
    if (sel) return { kind, all: false, ids: [sel.block.id], label: LABEL[kind] }
  }
  const pick = list[(n ?? 1) - 1]
  if (!pick) return { kind, all: false, ids: [], label: `${LABEL[kind]} n° ${n}` }
  return { kind, all: false, ids: [pick.block.id], label: n && n > 1 ? `${LABEL[kind]} n° ${n}` : LABEL[kind] }
}

// The new text of a « change … en "X" » order: in quotes, else after en / par / : .
function newText(order: string): string | null {
  const q = /[«"“]\s*([^»"”]+?)\s*[»"”]/.exec(order) ?? /'([^']{2,})'/.exec(order)
  if (q) return q[1].trim()
  const m = /\b(?:en|par|:|devient|pour|avec le texte|avec)\s+(?!(?:rouge|bleu|vert|noir|blanc|gras|italique|majuscules?|haut|bas|gauche|droite|centre|\d+ ?px)\b)(.+)$/i.exec(order)
  return m ? m[1].trim().replace(/[.!]+$/, '') : null
}

const sizeIn = (f: string) => {
  const m = /\b(\d{1,3}) ?(px|pixels?)\b/.exec(f) ?? /\btaille (?:de )?(\d{1,3})\b/.exec(f)
  return m ? Number(m[1]) : null
}

const alignIn = (f: string): Align | null =>
  /\b(centre|centrer|centree?s?|au centre|au milieu)\b/.test(f)
    ? 'center'
    : /\b(a|sur la) droite\b|\baligne(?:r|s)? (?:a )?droite\b/.test(f)
      ? 'right'
      : /\b(a|sur la) gauche\b|\baligne(?:r|s)? (?:a )?gauche\b/.test(f)
        ? 'left'
        : null

// ---- one order --------------------------------------------------------------------

type Step = { tree: ModuleTree; said: string } | null

function patchAll(tree: ModuleTree, ids: string[], patch: (b: Block) => Partial<Block> | null): ModuleTree {
  let t = tree
  for (const id of ids) {
    t = mapLists(t, (list) =>
      list.map((b) => {
        if (b.id !== id) return b
        const p = patch(b)
        return p ? ({ ...b, ...p } as Block) : b
      }),
    )
  }
  return t
}

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase())
const plainText = (html: string) => html.replace(/<[^>]+>/g, '').trim()
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function fieldOrder(order: string, tree: ModuleTree): Step {
  const f = fold(order)
  // « renomme le champ cta en cta_principal »
  const rename = /\brenomm\w* (?:le )?champ ([\w.-]+) (?:en|par|:) ?([\w.-]+)/.exec(f)
  if (rename) {
    const from = rename[1]
    const to = toFieldName(rename[2])
    const block = collectFields(tree).find((x) => x.name === from)
    if (block) {
      const t = updateNode(tree, block.block.id, { field: { ...(block.block.field ?? { label: block.label }), name: to, label: block.block.field?.label ?? block.label } } as Partial<Block>)
      return { tree: t, said: `Champ « ${from} » renommé « ${to} » (les liens {{ module.${to} }} suivent).` }
    }
    const extra = tree.fields?.find((x) => x.name === from)
    if (extra) return { tree: { ...tree, fields: tree.fields!.map((x) => (x === extra ? { ...x, name: to } : x)) }, said: `Champ « ${from} » renommé « ${to} ». Pense à changer {{ module.${from} }} dans le code s'il y est écrit à la main.` }
    return { tree, said: `Je ne trouve pas de champ « ${from} » dans ce module.` }
  }
  // « change le libellé du champ cta en "Bouton principal" »
  const label = /\b(?:libelle|nom affiche) du champ ([\w.-]+)/.exec(f)
  if (label) {
    const text = newText(order.slice(order.toLowerCase().indexOf(label[1]) + label[1].length))
    const block = collectFields(tree).find((x) => x.name === label[1])
    if (block && text) return { tree: updateNode(tree, block.block.id, { field: { ...(block.block.field ?? { name: block.name }), name: block.block.field?.name ?? block.name, label: text } } as Partial<Block>), said: `Libellé du champ « ${label[1]} » : « ${text} ».` }
    const extra = tree.fields?.find((x) => x.name === label[1])
    if (extra && text) return { tree: { ...tree, fields: tree.fields!.map((x) => (x === extra ? { ...x, label: text } : x)) }, said: `Libellé du champ « ${label[1]} » : « ${text} ».` }
    return null
  }
  // « ajoute un champ couleur couleur_fond » / « ajoute une option (case à cocher) afficher_bandeau »
  const add = /\br?ajout\w* (?:un |une |l'|le |la |les )?(?:nouveau |nouvelle )?(champ|option|reglage|parametre)s? ?(texte|texte riche|nombre|case a cocher|booleen|oui\/non|lien|url|image|couleur|date|liste|choix)? ?(?:nomme |appele |:)? ?([a-z_][\w]*)?/.exec(f)
  // Without a name nor a type (« rajoute l'option »), the online Maily knows which one is meant.
  if (add && !add[2] && !(add[3] && !/^(dans|au|aux|pour|qui|de|du|des)$/.test(add[3]))) return null
  if (add && /\b(champ|option|reglage|parametre)\b/.test(f)) {
    const type: ExtraFieldType =
      ({ 'texte riche': 'richtext', nombre: 'number', 'case a cocher': 'boolean', booleen: 'boolean', 'oui/non': 'boolean', lien: 'link', url: 'url', image: 'image', couleur: 'color', date: 'date', liste: 'choice', choix: 'choice' } as Record<string, ExtraFieldType>)[add[2] ?? ''] ??
      (add[1] === 'option' ? 'boolean' : 'text')
    const name = toFieldName(add[3] && !/^(dans|au|aux|pour|qui)$/.test(add[3]) ? add[3] : `${type === 'boolean' ? 'option' : type}_${(tree.fields?.length ?? 0) + 1}`)
    if (tree.fields?.some((x) => x.name === name) || collectFields(tree).some((x) => x.name === name)) return { tree, said: `Le champ « ${name} » existe déjà.` }
    const text = /[«"“]\s*([^»"”]+?)\s*[»"”]/.exec(order)?.[1]
    const def: ExtraField = {
      name,
      label: text ?? name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()),
      type,
      default: type === 'boolean' ? true : type === 'number' ? 0 : type === 'color' ? { color: '#ff007f', opacity: 100 } : type === 'link' ? { url: { href: 'https://example.com', type: 'EXTERNAL' } } : type === 'image' ? { src: '', alt: '' } : type === 'choice' ? 'option_1' : '',
      ...(type === 'choice' ? { options: [{ value: 'option_1', label: 'Option 1' }, { value: 'option_2', label: 'Option 2' }] } : {}),
      keep: true,
    }
    return {
      tree: { ...tree, fields: [...(tree.fields ?? []), def] },
      said: `Champ « ${name} » (${type}) ajouté aux réglages du module (onglet Champs, exporté dans fields.json). Dans le code : {{ module.${name} }}${type === 'boolean' ? ` ou {% if module.${name} %}…{% endif %}` : ''}.`,
    }
  }
  // « liste les champs »
  if (/\b(liste|montre|affiche|quels sont)\b.*\bchamps\b/.test(f)) {
    const names = [...collectFields(tree).map((x) => `${x.name} (${x.label})`), ...(tree.fields ?? []).map((x) => `${x.name} (${x.label}, ${x.hsType ?? x.type})`)]
    return { tree, said: names.length ? `Champs du module :\n${names.map((n) => `- ${n}`).join('\n')}` : "Ce module n'a pas encore de champ." }
  }
  return null
}

// The images (or any blocks) of one cell placed side by side: a nested card of
// 2 or 3 columns, stacked on phones unless « même sur mobile ».
function sideBySide(tree: ModuleTree, target: Target, f: string): Step {
  const keep = /\b(meme|aussi) sur (mobile|telephone)\b|\bsur mobile aussi\b/.test(f)
  const cols = (Number(/\b(\d) colonnes?\b/.exec(f)?.[1]) || 0) as 0 | 1 | 2 | 3
  // A section named: its column count changes.
  if (target.kind === 'section' && target.ids.length) {
    const n = (cols || 2) as 1 | 2 | 3
    let t = tree
    for (const id of target.ids)
      t = mapLists(t, (list) =>
        list.map((b) => {
          if (b.id !== id || b.type !== 'section') return b
          const blocks = b.cells.flat()
          const cells: Block[][] = Array.from({ length: n }, () => [])
          blocks.forEach((x, i) => cells[Math.min(n - 1, Math.floor((i * n) / Math.max(1, blocks.length)))].push(x))
          return { ...b, columns: n, cells, behavior: keep ? 'side' : b.behavior }
        }),
      )
    return { tree: t, said: `${cap(target.label)} passe en ${n} colonne${n > 1 ? 's' : ''}${keep ? ', côte à côte aussi sur mobile' : ''}.` }
  }
  // Blocks of a kind that follow each other in one cell: grouped in columns.
  const kind = target.kind
  let done = 0
  const t = mapLists(tree, (list) => {
    if (done) return list
    const out: Block[] = []
    for (let i = 0; i < list.length; i++) {
      if (!done && list[i].type === kind) {
        let j = i
        while (j < list.length && list[j].type === kind) j++
        if (j - i >= 2) {
          const group = list.slice(i, j)
          const n = (cols || Math.min(3, group.length)) as 1 | 2 | 3
          const cells: Block[][] = Array.from({ length: n }, () => [])
          group.forEach((x, k) => cells[k % n].push(kind === 'image' ? ({ ...x, width: 100, align: 'center' } as Block) : x))
          const card: Section = { id: uid(), type: 'section', columns: n, behavior: keep ? 'side' : 'stack', bg: 'transparent', padding: 0, padX: 8, radius: 0, cells }
          out.push(card)
          done = group.length
          i = j - 1
          continue
        }
      }
      out.push(list[i])
    }
    return out
  })
  if (!done) return { tree, said: `Je n'ai pas trouvé plusieurs ${LABEL[kind].replace(/^(le|la|l')\s?/, '')}s à la suite à mettre côte à côte.` }
  return { tree: t, said: `${done} ${LABEL[kind].replace(/^(le|la|l')\s?/, '')}s placé${kind === 'image' ? 'e' : ''}s côte à côte${keep ? ', aussi sur mobile' : ' (les uns sous les autres sur mobile)'}.` }
}

function addBlock(tree: ModuleTree, f: string, order: string): Step {
  const m = /\br?ajout\w* (?:un |une |des |deux |trois |2 |3 )?(?:nouveau |nouvelle )?(titre|texte|paragraphe|bouton|image|photo|separateur|trait|espace|section|card|carte|colonne)/.exec(f)
  if (!m) return null
  const type: BlockType | 'section2' =
    ({ titre: 'heading', texte: 'text', paragraphe: 'text', bouton: 'button', image: 'image', photo: 'image', separateur: 'divider', trait: 'divider', espace: 'spacer', section: 'section', card: 'section', carte: 'section', colonne: 'section2' } as Record<string, BlockType | 'section2'>)[m[1]]
  if (type === 'section2') return null
  const text = /[«"“]\s*([^»"”]+?)\s*[»"”]/.exec(order)?.[1]
  const block = createBlock(type)
  if (text && block.type === 'heading') block.text = text
  if (text && block.type === 'text') block.html = escapeHtml(text)
  if (text && block.type === 'button') block.label = text
  if (type === 'section') {
    const n = (Number(/\b(\d) colonnes?\b/.exec(f)?.[1]) || 1) as 1 | 2 | 3
    const s: Section = { id: uid(), type: 'section', columns: n, behavior: 'stack', bg: '#ffffff', padding: 24, radius: 0, cells: Array.from({ length: n }, () => [createBlock('text')]) }
    const at = /\bau debut\b|\ben haut\b/.test(f) ? 0 : tree.sections.length
    return { tree: { ...tree, sections: [...tree.sections.slice(0, at), s, ...tree.sections.slice(at)] }, said: `Section${n > 1 ? ` de ${n} colonnes` : ''} ajoutée ${at === 0 ? 'en haut' : 'à la fin'} du module.` }
  }
  if (!tree.sections.length) return null
  const sec = /\bsection (\d)\b/.exec(f)
  const idx = sec ? Math.min(tree.sections.length, Number(sec[1])) - 1 : /\bau debut\b|\ben haut\b/.test(f) ? 0 : tree.sections.length - 1
  const top = tree.sections[idx]
  const atStart = /\bau debut\b|\ben haut\b/.test(f)
  const sections = tree.sections.map((s, i) =>
    i !== idx ? s : { ...s, cells: s.cells.map((c, k) => (k === (atStart ? 0 : s.cells.length - 1) ? (atStart ? [block, ...c] : [...c, block]) : c)) },
  )
  void top
  const noun = ({ heading: 'Un titre', text: 'Un texte', button: 'Un bouton', image: 'Une image', divider: 'Un séparateur', spacer: 'Un espace' } as Record<string, string>)[type] ?? 'Un élément'
  return { tree: { ...tree, sections }, said: `${noun} ajouté${type === 'image' ? 'e' : ''} ${atStart ? 'au début' : 'à la fin'} de la section ${idx + 1}${text ? ` (« ${text} »)` : ''}${type === 'image' ? ' : dépose ton fichier dessus dans l’aperçu' : ''}.` }
}

function oneOrder(order: string, tree: ModuleTree, selectedId?: string | null): Step {
  const f = fold(order).trim()
  if (!f) return null

  const fields = fieldOrder(order, tree)
  if (fields) return fields
  if (/\br?ajout/.test(f) && !/\b(champ|option|reglage|parametre|texte alternatif|alt|lien|arrondi|bordure|ombre)\b/.test(f)) return addBlock(tree, f, order)

  // Module-wide settings.
  const width = /\blargeur (?:du module |de l'e-?mail )?(?:a |de |en |: )?(\d{3})\b/.exec(f)
  if (width && !/\b(image|bouton)\b/.test(f)) {
    const w = Math.max(320, Math.min(900, Number(width[1])))
    return { tree: { ...tree, width: w }, said: `Largeur du module : ${w} px.` }
  }
  const font = /\bpolice (?:en |: |du module en )?([a-z][\w -]{2,30})$/.exec(f)
  if (font) {
    const name = font[1].trim().replace(/\b\w/g, (c) => c.toUpperCase())
    return { tree: { ...tree, font: `'${name}', Helvetica, Arial, sans-serif` }, said: `Police du module : ${name} (Helvetica, Arial en secours).` }
  }
  if (/\b(active|ajoute|mets?)\b.*\bvml\b/.test(f)) return { tree: { ...tree, vml: true }, said: 'VML activé : Outlook sur Windows dessine les boutons arrondis et cliquables.' }
  if (/\b(desactive|retire|enleve|supprime)\b.*\bvml\b/.test(f)) return { tree: { ...tree, vml: false }, said: 'VML désactivé.' }

  const target = findTarget(order, tree, selectedId)
  if (!target) return null
  if (target.kind !== 'module' && !target.ids.length) return { tree, said: `Je ne trouve pas ${target.label} dans ce module.` }

  // Removal.
  if (/\b(supprime|supprimer|enleve|enlever|retire|retirer|efface|effacer)\b/.test(f) && target.kind !== 'module') {
    let t = tree
    for (const id of target.ids) t = target.kind === 'section' && tree.sections.some((s) => s.id === id) ? { ...t, sections: t.sections.filter((s) => s.id !== id) } : removeNode(t, id)
    return { tree: t, said: `Supprimé : ${target.label}.` }
  }

  // Side by side / columns.
  if (/\bcote a cote\b|\ben (\d) colonnes?\b|\bsur (\d) colonnes?\b|\balignes? horizontalement\b|\ben ligne\b/.test(f)) return sideBySide(tree, target, f)
  if (/\bempil\w*\b.*\bmobile\b/.test(f) && target.kind === 'section') return { tree: patchAll(tree, target.ids, () => ({ behavior: 'stack' }) as Partial<Block>), said: `${cap(target.label)} : colonnes empilées sur mobile.` }

  // Visibility on phones.
  if (/\b(cache|masque|cacher|masquer)\b.*\b(mobile|telephone)\b/.test(f)) return { tree: patchAll(tree, target.ids, () => ({ hide: 'mobile' }) as Partial<Block>), said: `Masqué sur mobile : ${target.label}.` }
  if (/\b(seulement|uniquement) sur (mobile|telephone)\b/.test(f)) return { tree: patchAll(tree, target.ids, () => ({ hide: 'desktop' }) as Partial<Block>), said: `Visible seulement sur mobile : ${target.label}.` }
  if (/\b(affiche|montre|reaffiche)\b.*\bpartout\b/.test(f)) return { tree: patchAll(tree, target.ids, () => ({ hide: undefined }) as Partial<Block>), said: `Visible partout : ${target.label}.` }

  // Link.
  const url = /\b(https?:\/\/[^\s"»]+|mailto:[^\s"»]+|tel:[+\d ]+)/i.exec(order)?.[1]?.replace(/[.,;!]+$/, '')
  if (url && /\b(lien|url|adresse|pointe|renvoie|redirige|href)\b/.test(f)) {
    if (target.kind !== 'button' && target.kind !== 'image') return null
    return { tree: patchAll(tree, target.ids, () => ({ href: url }) as Partial<Block>), said: `Lien ${target.kind === 'image' ? "de l'image" : 'du bouton'} : ${url}` }
  }

  // Alt text.
  if (/\b(texte alternatif|alt)\b/.test(f) && target.kind === 'image') {
    const alt = newText(order)
    if (!alt) return null
    return { tree: patchAll(tree, target.ids, () => ({ alt }) as Partial<Block>), said: `Texte alternatif : « ${alt} ».` }
  }

  // Alignment.
  const align = alignIn(f)
  if (align && /\b(centre|aligne|gauche|droite|milieu)\w*/.test(f)) {
    if (target.kind === 'module') {
      const ids = allBlocks(tree).filter((s) => ['heading', 'text', 'button', 'image'].includes(s.block.type)).map((s) => s.block.id)
      return { tree: patchAll(tree, ids, () => ({ align }) as Partial<Block>), said: `Tout le contenu est ${align === 'center' ? 'centré' : align === 'left' ? 'aligné à gauche' : 'aligné à droite'}.` }
    }
    if (!['heading', 'text', 'button', 'image'].includes(target.kind)) return null
    return { tree: patchAll(tree, target.ids, () => ({ align }) as Partial<Block>), said: `${align === 'center' ? 'Centré' : align === 'left' ? 'Aligné à gauche' : 'Aligné à droite'} : ${target.label}.` }
  }

  // Rounded corners / full width (buttons, images, sections).
  if (/\barrondi\w*\b/.test(f) || /\bcarre\b/.test(f)) {
    const r = /\bcarre\b|\bsans arrondi\b/.test(f) ? 0 : (sizeIn(f) ?? (target.kind === 'button' ? 24 : 12))
    return { tree: patchAll(tree, target.ids, () => ({ radius: r }) as Partial<Block>), said: `${cap(target.label)} : arrondi de ${r} px.` }
  }
  if (/\bpleine largeur\b|\btoute la largeur\b/.test(f) && target.kind === 'button') return { tree: patchAll(tree, target.ids, () => ({ fullWidth: true }) as Partial<Block>), said: 'Bouton sur toute la largeur.' }

  // Colours.
  const color = colorIn(order)
  if (color && /\b(couleur|fond|en |texte|police|colore|teinte)\b/.test(f + ' ')) {
    const background = /\b(fond|arriere-plan|arriere plan)\b/.test(f)
    if (target.kind === 'module') {
      if (background || /\bfond\b/.test(f)) return { tree: { ...tree, bg: color }, said: `Fond du module : ${color}.` }
      return null
    }
    const textColor = /\b(texte|ecriture|police|libelle)\b/.test(f) && target.kind !== 'text' && target.kind !== 'heading'
    const said = `${target.label.replace(/^./, (c) => c.toUpperCase())} : ${background || (target.kind === 'button' && !textColor) || target.kind === 'section' ? 'fond' : 'couleur'} ${color}.`
    return {
      tree: patchAll(tree, target.ids, (b) => {
        if (b.type === 'button') return textColor ? { color } : { bg: color }
        if (b.type === 'section') return { bg: color }
        if (b.type === 'heading' || b.type === 'text' || b.type === 'divider') return { color }
        return null
      }),
      said,
    }
  }

  // Size.
  const px = sizeIn(f)
  const bigger = /\b(agrandi\w*|plus grand\w*|grossi\w*|augmente\w*)\b/.test(f)
  const smaller = /\b(redui\w*|plus petit\w*|diminue\w*|rapetisse\w*)\b/.test(f)
  if ((px || bigger || smaller) && /\b(taille|px|pixels?|grand|petit|agrandi|reduis|reduire|grossi|diminue|augmente|largeur|hauteur)\w*/.test(f)) {
    const t = patchAll(tree, target.ids, (b) => {
      if (b.type === 'heading' || b.type === 'text') return { size: px ?? Math.round(b.size * (bigger ? 1.2 : 0.85)) }
      if (b.type === 'button') return { fontSize: px ?? Math.round((b.fontSize ?? 15) * (bigger ? 1.15 : 0.9)) }
      if (b.type === 'image') return { width: Math.max(10, Math.min(100, px && /%/.test(order) ? px : Math.round(b.width * (bigger ? 1.25 : 0.75)))) }
      if (b.type === 'spacer') return { height: px ?? Math.round(b.height * (bigger ? 1.5 : 0.6)) }
      return null
    })
    return { tree: t, said: `${px ? `Taille ${px} px` : bigger ? 'Agrandi' : 'Réduit'} : ${target.label}.` }
  }

  // Bold / weight.
  if (/\ben gras\b|\bplus gras\b/.test(f) && (target.kind === 'heading' || target.kind === 'button')) return { tree: patchAll(tree, target.ids, (b) => (b.type === 'heading' ? { weight: 800 } : { bold: true }) as Partial<Block>), said: `En gras : ${target.label}.` }

  // Heading level.
  const level = /\ben (h[123])\b/.exec(f)
  if (level && target.kind === 'heading') return { tree: patchAll(tree, target.ids, () => ({ level: Number(level[1][1]) as 1 | 2 | 3 }) as Partial<Block>), said: `${cap(target.label)} passe en ${level[1].toUpperCase()}.` }

  // New text (change / remplace / mets / écris).
  if (/\b(change|changer|remplace|remplacer|modifie|modifier|mets|mettre|ecris|ecrire|renomme|renommer|libelle|intitule|texte)\b/.test(f) && ['heading', 'text', 'button'].includes(target.kind)) {
    const text = newText(order)
    if (!text || colorIn(text) === text) return null
    const t = patchAll(tree, target.ids, (b) =>
      b.type === 'heading' ? { text } : b.type === 'button' ? { label: text } : b.type === 'text' ? { html: escapeHtml(text) } : null,
    )
    const before = allBlocks(tree).find((s) => s.block.id === target.ids[0])?.block
    const old = before?.type === 'heading' ? before.text : before?.type === 'button' ? before.label : before?.type === 'text' ? plainText(before.html) : ''
    return { tree: t, said: `${cap(target.label)} : « ${text} »${old ? ` (avant : « ${old.slice(0, 60)} »)` : ''}.` }
  }

  return null
}

// Splits a message into orders (« puis », « ensuite », « et aussi », new lines, « ; »).
export function splitOrders(text: string): string[] {
  return text
    .split(/\n+|;|\s(?:puis|ensuite|et ensuite|et aussi|apres quoi|et puis)\s/i)
    .map((s) => s.replace(/^[\s,.-]*(et\s+)?/i, '').trim())
    .filter((s) => s.length > 2)
}

/**
 * Runs the orders of a message on the module. `done` empty and `left` full: not
 * a message for the built-in engine (a question, a request for writing…).
 */
export function runCommands(text: string, tree: ModuleTree, selectedId?: string | null): CommandResult {
  let t = tree
  const done: string[] = []
  const left: string[] = []
  for (const order of splitOrders(text)) {
    let step: Step = null
    try {
      step = oneOrder(order, t, selectedId)
    } catch {
      step = null
    }
    if (!step) left.push(order)
    else {
      t = step.tree
      done.push(step.said)
    }
  }
  return { tree: t, done, left }
}

/** A question (« comment centrer le titre ? »), never run as an order. */
export const isQuestion = (text: string) =>
  /\?\s*$/.test(text.trim()) || /^\s*(comment|pourquoi|est-ce|qu'est-ce|que|quel|quelle|quels|quelles|ou|où|quand|combien|peux-tu m'expliquer|explique)\b/i.test(text)

/** The message is clearly an order for the module (not a question). */
export const looksLikeOrder = (text: string) =>
  !/\?\s*$/.test(text.trim()) &&
  /^\s*(?:peux-tu |tu peux |pourrais-tu |merci de |stp |s'il te pla[iî]t )?(?:applique[sz]?(?:-moi| moi)? |fais(?:-moi| moi)? )?(change|remplace|modifie|mets|mettre|met|ecris|écris|renomme|ajoute|rajoute|supprime|enl[eè]ve|retire|efface|centre|aligne|agrandis|r[ée]duis|arrondis|cache|masque|active|d[ée]sactive|passe|place|dispose|liste|colore|les |le |la |l')/i.test(text)
