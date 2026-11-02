// Indicative performance estimate for a block ("clic estimé", "ouverture
// estimée") with advice. It is a rule of thumb, not a measure: a sector average
// multiplied by a few well-known good practices (clear action, contrast, one
// main call to action, urgency, personalisation…). Never present it as a promise.

import { findNode, findPath } from './tree'
import type { Block, ButtonBlock, HeadingBlock, ModuleTree } from './types'

// Averages of the Brevo 2026 benchmark (2025 data, opens excluding Apple Mail
// Privacy Protection inflation), in % of delivered e-mails.
export const SECTORS = {
  education: { label: 'Formation / Éducation', open: 22.3, click: 2.4 },
  services: { label: 'Services & conseil', open: 22.7, click: 2.2 },
  it: { label: 'IT & logiciels', open: 20.7, click: 1.9 },
  finance: { label: 'Banque & finance', open: 21.3, click: 1.9 },
  health: { label: 'Santé & bien-être', open: 19.5, click: 2.1 },
  retail: { label: 'Commerce de détail', open: 16.7, click: 2.3 },
  ecommerce: { label: 'E-commerce', open: 15.5, click: 2.2 },
  media: { label: 'Médias', open: 21.3, click: 3.0 },
  nonprofit: { label: 'Associations', open: 27.0, click: 3.1 },
  other: { label: 'Autre (moyenne)', open: 20.7, click: 2.3 },
} as const
export type Sector = keyof typeof SECTORS
export const DEFAULT_SECTOR: Sector = 'education'

export interface Factor {
  label: string
  effect: 1 | 0 | -1
}

export interface Estimate {
  kind: 'click' | 'open'
  title: string
  value: number // %
  low: number
  high: number
  baseline: number // sector average, %
  factors: Factor[]
  tips: string[]
  note?: string
}

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))
const round1 = (n: number) => Math.round(n * 10) / 10

function build(kind: Estimate['kind'], title: string, baseline: number, parts: { f: Factor; w: number }[], tips: string[], note?: string, zero = false): Estimate {
  const mult = zero ? 0 : clamp(parts.reduce((m, p) => m * p.w, 1), 0.4, 2.2)
  const value = baseline * mult
  return {
    kind,
    title,
    value: round1(value),
    low: round1(value * 0.75),
    high: round1(value * 1.25),
    baseline,
    factors: parts.map((p) => p.f),
    tips: [...new Set(tips)],
    note,
  }
}

// ── helpers ────────────────────────────────────────────────────────────────
const lum = (hex: string): number | null => {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  const ch = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}
export function contrast(a: string, b: string): number | null {
  const x = lum(a)
  const y = lum(b)
  if (x === null || y === null) return null
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

const blocks = (cells: Block[][]): Block[] => cells.flat()
function walk(sections: Block[], fn: (b: Block, top: number) => void, top = -1): void {
  sections.forEach((b, i) => {
    const t = top < 0 ? i : top
    fn(b, t)
    if (b.type === 'section') walk(blocks(b.cells), fn, t)
  })
}
const all = (tree: ModuleTree): { b: Block; top: number }[] => {
  const out: { b: Block; top: number }[] = []
  walk(tree.sections, (b, top) => out.push({ b, top }))
  return out
}
const plain = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
const hasToken = (s: string) => /\{\{|\{%/.test(s)
const personal = (s: string) => /\{\{\s*(contact|personalization)[\w.]*\s*[|}]/i.test(s) || /\{\{\s*contact\./i.test(s)

const VERB = /^(d[ée]couvr|r[ée]serv|inscri|t[ée]l[ée]charg|essay|test|voir|vois|regard|profit|rejoin|command|obten|demand|lire|lis|acc[ée]d|particip|choisi|cr[ée]|commenc|d[ée]marr|ach[eè]t|b[ée]n[ée]fici|go|get|buy|try|join|start|learn|download|register|book|discover|watch|read|see|claim|shop|view|sign)/i
const GENERIC = /^(cliqu\w* ici|ici|en savoir plus|valider|ok|suite|lire la suite|click here|learn more|submit)$/i

const cleanLabel = (s: string) => plain(s).replace(/^[^\p{L}\p{N}{]+/u, '').replace(/[^\p{L}\p{N}!?.]+$/u, '')

// ── blocks ─────────────────────────────────────────────────────────────────
const sectionBgOf = (tree: ModuleTree, id: string): string => {
  const path = findPath(tree, id)
  for (let i = path.length - 2; i >= 0; i--) {
    const n = findNode(tree, path[i])
    if (n?.type === 'section') return n.bg
  }
  return tree.bg
}

function buttonEstimate(tree: ModuleTree, b: ButtonBlock, base: number): Estimate {
  const items = all(tree)
  const buttons = items.filter((x) => x.b.type === 'button')
  const top = items.find((x) => x.b.id === b.id)?.top ?? 0
  const hasCountdown = items.some((x) => x.b.type === 'raw' && /countdown\.gif/.test(x.b.html))
  const parts: { f: Factor; w: number }[] = []
  const tips: string[] = []
  const add = (label: string, effect: 1 | 0 | -1, w: number, tip?: string) => {
    parts.push({ f: { label, effect }, w })
    if (tip) tips.push(tip)
  }

  const label = cleanLabel(b.label)
  const words = label.split(/\s+/).filter(Boolean).length
  if (!label) add('Libellé vide', -1, 0.5, 'Écris un libellé : sans texte, le bouton ne donne pas envie de cliquer.')
  else if (words >= 2 && words <= 4) add(`Libellé court (${words} mots)`, 1, 1.1)
  else if (words > 5) add(`Libellé long (${words} mots)`, -1, 0.85, 'Raccourcis le libellé à 2–4 mots : il se lit d’un coup d’œil, surtout sur mobile.')
  else if (words === 1) add('Libellé d’un seul mot', 0, 0.97, 'Un verbe + un bénéfice (« Réserver ma place ») fonctionne mieux qu’un mot seul.')
  if (label && GENERIC.test(label)) add('Libellé générique', -1, 0.88, 'Remplace « En savoir plus » / « Cliquez ici » par ce que la personne obtient : « Voir le programme », « Réserver ma place ».')
  else if (label && VERB.test(label)) add('Commence par un verbe d’action', 1, 1.1)
  else if (label) add('Pas de verbe d’action', 0, 0.96, 'Commence le libellé par un verbe (Découvrir, Réserver, Télécharger…).')
  if (personal(b.label)) add('Libellé personnalisé', 1, 1.05)

  const cText = contrast(b.color, b.bg)
  if (cText !== null) {
    if (cText >= 4.5) add(`Texte lisible (contraste ${cText.toFixed(1)}:1)`, 1, 1.03)
    else if (cText >= 3) add(`Contraste texte moyen (${cText.toFixed(1)}:1)`, -1, 0.92, 'Fonce le texte ou le fond du bouton : un contraste de 4,5:1 minimum reste lisible partout.')
    else add(`Contraste texte faible (${cText.toFixed(1)}:1)`, -1, 0.8, 'Le texte du bouton est difficile à lire : augmente le contraste avec son fond.')
  }
  const cBg = contrast(b.bg, sectionBgOf(tree, b.id))
  if (cBg !== null && cBg < 1.5) add('Bouton qui se fond dans le décor', -1, 0.85, 'Choisis une couleur de bouton qui ressort du fond de la section (la couleur d’accent du module, par exemple).')

  const href = b.href.trim()
  if (!href || href === '#' || /example\.(com|org)/i.test(href)) add('Lien à renseigner', -1, 0.5, 'Ajoute le vrai lien de destination : un bouton sans lien ne rapporte aucun clic.')
  else if (!/utm_/i.test(href) && /^https?:/i.test(href)) tips.push('Ajoute des paramètres UTM au lien (utm_source, utm_campaign) pour mesurer ce bloc dans tes statistiques.')

  if (top === 0) add('Visible dès l’ouverture', 1, 1.15)
  else if (top >= 3) add('Placé loin dans le module', -1, 0.85, 'Remonte le bouton : au-delà du 3ᵉ écran, une part des lecteurs ne le voit jamais.')
  if (buttons.length === 1) add('Un seul appel à l’action', 1, 1.1)
  else if (buttons.length >= 4) add(`${buttons.length} boutons en concurrence`, -1, 0.85, 'Garde un bouton principal : trop de choix dilue les clics.')
  if (hasCountdown) add('Urgence : compte à rebours', 1, 1.08)
  return build('click', 'Clic estimé sur ce bouton', base, parts, tips)
}

const URGENT = /(dernier|derni[eè]re|derniers jours|aujourd'hui|aujourd’hui|plus que|jusqu'à|jusqu’à|limit[ée]|vite|\bj-\d|se termine|ce soir|avant le|ends|last chance|today|only)/i
const SPAMMY = /(gratuit|100 ?%|!!+|€€|\$\$|urgent|cadeau|gagn[ée]|free)/i

function headingEstimate(tree: ModuleTree, b: HeadingBlock, base: number): Estimate {
  const parts: { f: Factor; w: number }[] = []
  const tips: string[] = []
  const add = (label: string, effect: 1 | 0 | -1, w: number, tip?: string) => {
    parts.push({ f: { label, effect }, w })
    if (tip) tips.push(tip)
  }
  const t = plain(b.text)
  const len = t.length
  if (!len) add('Titre vide', -1, 0.6, 'Écris un titre : c’est ce qui donne envie d’ouvrir.')
  else if (len >= 25 && len <= 55) add(`Longueur idéale (${len} caractères)`, 1, 1.1)
  else if (len < 15) add(`Très court (${len} caractères)`, -1, 0.92, 'Vise 30 à 50 caractères : assez précis pour intriguer, assez court pour ne pas être coupé sur mobile.')
  else if (len > 70) add(`Trop long (${len} caractères)`, -1, 0.88, 'Au-delà de 60 caractères, l’objet est coupé dans la boîte de réception : mets le plus important au début.')
  else add(`Longueur correcte (${len} caractères)`, 0, 1)
  if (personal(b.text)) add('Personnalisé (prénom…)', 1, 1.12)
  else tips.push('Teste une personnalisation avec le prénom : {{ contact.firstname }} (avec une valeur par défaut).')
  if (/\d/.test(t) || /\?/.test(t)) add('Chiffre ou question', 1, 1.05)
  if (URGENT.test(t)) add('Mot d’urgence', 1, 1.06)
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, '')
  if (letters.length > 6 && letters.replace(/[^A-ZÀ-Þ]/g, '').length / letters.length > 0.6) add('Tout en majuscules', -1, 0.85, 'Évite les majuscules partout : cela ressemble à du spam.')
  if (SPAMMY.test(t)) add('Mot ou signe « spam »', -1, 0.9, 'Évite « gratuit », « 100 % », « !! » dans l’objet : ils font monter le risque de spam.')
  const first = all(tree).find((x) => x.b.type === 'heading')?.b.id === b.id
  return build('open', 'Ouverture estimée si repris comme objet', base, parts, tips, first ? 'Le taux d’ouverture dépend de l’objet et du pré-en-tête : reprends ce titre comme objet.' : 'Ce titre n’est pas le premier du module : l’estimation vaut s’il sert d’objet.')
}

function countdownEstimate(tree: ModuleTree, html: string, id: string, base: number): Estimate {
  const items = all(tree)
  const parts: { f: Factor; w: number }[] = [{ f: { label: 'Urgence visible (compte à rebours)', effect: 1 }, w: 1.12 }]
  const tips: string[] = []
  const add = (label: string, effect: 1 | 0 | -1, w: number, tip?: string) => {
    parts.push({ f: { label, effect }, w })
    if (tip) tips.push(tip)
  }
  const field = tree.fields?.find((f) => f.type === 'datetime' || f.type === 'date')
  const date = typeof field?.default === 'number' ? field.default : null
  if (date !== null) {
    const days = (date - Date.now()) / 86_400_000
    if (days < 0) add('Date dépassée', -1, 0.6, 'La date de fin est passée : le compte à rebours affichera le message de fin. Choisis une date future.')
    else if (days <= 7) add(`Échéance proche (${Math.max(1, Math.ceil(days))} j)`, 1, 1.05)
    else if (days > 30) add('Échéance lointaine', -1, 0.92, 'Un compte à rebours à plus de 30 jours crée peu d’urgence : réserve-le aux dernières semaines.')
  }
  const fg = /[?&;]fg=([0-9a-f]{6})/i.exec(html)?.[1]
  const bg = /[?&;]bg=([0-9a-f]{6})/i.exec(html)?.[1]
  if (fg && bg) {
    const c = contrast('#' + fg, '#' + bg)
    if (c !== null && c < 3) add('Chiffres peu contrastés', -1, 0.9, 'Les chiffres se lisent mal sur ce fond : change leur couleur ou celle des cases.')
  }
  const idx = items.findIndex((x) => x.b.id === id)
  const nextButton = items.slice(idx + 1).some((x) => x.b.type === 'button')
  if (nextButton) add('Bouton juste après', 1, 1.05)
  else if (!items.some((x) => x.b.type === 'button')) add('Aucun bouton à côté', -1, 0.75, 'Ajoute un bouton juste sous le compte à rebours : c’est lui qui transforme l’urgence en clic.')
  tips.push('Passe les chiffres en rouge sur les dernières heures (réglage « Seuil d’urgence ») pour renforcer l’effet.')
  tips.push('Le compte à rebours défile 60 secondes à l’ouverture puis se fige : garde-le comme repère visuel, pas comme seule raison d’agir.')
  return build('click', 'Clic estimé du module avec ce compte à rebours', base, parts, tips, 'Effet indicatif : les tests publiés sur les comptes à rebours restent peu concluants et varient selon la cible.')
}

function socialEstimate(base: number): Estimate {
  return build(
    'click',
    'Clic estimé sur les réseaux',
    base,
    [{ f: { label: 'Liens secondaires (réseaux sociaux)', effect: -1 }, w: 0.25 }],
    ['Garde les réseaux sociaux en bas du module : ils captent peu de clics et ne doivent pas concurrencer le bouton principal.', 'Vérifie que chaque icône pointe vers ta vraie page.'],
  )
}

function imageEstimate(tree: ModuleTree, b: Extract<Block, { type: 'image' }>, base: number): Estimate {
  const tips: string[] = ['Ajoute un bouton juste sous l’image : ici l’image n’est pas cliquable, tous les clics passent par les boutons.']
  const parts: { f: Factor; w: number }[] = [{ f: { label: 'Image sans lien : aucun clic direct', effect: -1 }, w: 1 }]
  if (b.alt.trim().length < 4 && !hasToken(b.alt)) {
    parts.push({ f: { label: 'Texte alternatif manquant', effect: -1 }, w: 1 })
    tips.push('Renseigne le texte alternatif : beaucoup de messageries bloquent les images par défaut, il s’affiche alors à leur place.')
  } else parts.push({ f: { label: 'Texte alternatif renseigné', effect: 1 }, w: 1 })
  if (b.width > tree.width) tips.push(`L’image (${b.width}px) dépasse la largeur du module (${tree.width}px) : réduis-la.`)
  return build('click', 'Clic direct estimé sur l’image', base, parts, tips, 'Pour mesurer un clic sur un visuel, mets-le dans un bouton ou ajoute un lien dans le code.', true)
}

export function estimateBlock(tree: ModuleTree, node: Block, sector: Sector = DEFAULT_SECTOR): Estimate | null {
  const s = SECTORS[sector]
  switch (node.type) {
    case 'button':
      return buttonEstimate(tree, node, s.click)
    case 'heading':
      return headingEstimate(tree, node, s.open)
    case 'image':
      return imageEstimate(tree, node, s.click)
    case 'raw':
      if (/countdown\.gif/.test(node.html)) return countdownEstimate(tree, node.html, node.id, s.click)
      if (/\/social\//.test(node.html)) return socialEstimate(s.click)
      return null
    default:
      return null
  }
}

// The whole module: the best button drives the clicks, the first heading the opens.
export function estimateModule(tree: ModuleTree, sector: Sector = DEFAULT_SECTOR): { click: Estimate; open: Estimate } {
  const s = SECTORS[sector]
  const items = all(tree).map((x) => x.b)
  const buttons = items.filter((b): b is ButtonBlock => b.type === 'button')
  const heading = items.find((b): b is HeadingBlock => b.type === 'heading')

  let click: Estimate
  if (!buttons.length) {
    click = build('click', 'Clic estimé du module', s.click, [{ f: { label: 'Aucun bouton', effect: -1 }, w: 1 }], ['Ajoute un bouton d’appel à l’action : sans lui, le module ne peut pas générer de clic.'], undefined, true)
  } else {
    const per = buttons.map((b) => buttonEstimate(tree, b, s.click))
    const best = per.reduce((a, b) => (b.value > a.value ? b : a))
    const hasCountdown = items.some((b) => b.type === 'raw' && /countdown\.gif/.test(b.html))
    click = { ...best, title: 'Clic estimé du module', factors: best.factors, tips: [...new Set([...per.flatMap((e) => e.tips)])].slice(0, 6), note: hasCountdown ? 'Compte à rebours inclus dans l’estimation (effet indicatif).' : undefined }
  }

  const open = heading
    ? headingEstimate(tree, heading, s.open)
    : build('open', 'Ouverture estimée', s.open, [{ f: { label: 'Pas de titre', effect: 0 }, w: 0.95 }], ['Ajoute un titre en tête du module : il peut servir d’objet et de pré-en-tête.'])
  return { click, open: { ...open, title: 'Ouverture estimée', note: 'Basée sur le premier titre, à reprendre comme objet. L’ouverture dépend surtout de l’objet, de l’expéditeur et de l’heure d’envoi.' } }
}
