import { standaloneEmail } from './hubl'
import type { Block, ModuleTree, Section } from './types'

// ---------------------------------------------------------------------------
// Email client tests (Litmus-style), simulated in the browser.
//
// Each client renders the exported page.html after the transformations its
// engine is known to apply: Outlook on Windows (Word engine) reads conditional
// comments and drops border-radius, max-width, media queries and link padding;
// Gmail with a non-Google account drops <style> blocks; dark modes invert all
// colours (Gmail iOS) or only light backgrounds / dark texts (Outlook.com).
// `auditModule` lists the issues each client will show, with the block concerned.
// ---------------------------------------------------------------------------

export type ClientId =
  | 'apple-mail'
  | 'iphone'
  | 'gmail-web'
  | 'gmail-android'
  | 'gmail-ios-dark'
  | 'gmail-imap'
  | 'outlook-win'
  | 'outlook-com'
  | 'outlook-com-dark'
  | 'yahoo'
  | 'samsung'

export interface EmailClient {
  id: ClientId
  name: string
  platform: string
  width: number
  mobile: boolean
  engine: 'webkit' | 'word' | 'no-style'
  dark?: 'full' | 'partial'
}

export const CLIENTS: EmailClient[] = [
  { id: 'apple-mail', name: 'Apple Mail', platform: 'macOS', width: 800, mobile: false, engine: 'webkit' },
  { id: 'outlook-win', name: 'Outlook 2016–2021', platform: 'Windows', width: 800, mobile: false, engine: 'word' },
  { id: 'outlook-com', name: 'Outlook.com', platform: 'Web', width: 800, mobile: false, engine: 'webkit' },
  { id: 'outlook-com-dark', name: 'Outlook.com', platform: 'Web · sombre', width: 800, mobile: false, engine: 'webkit', dark: 'partial' },
  { id: 'gmail-web', name: 'Gmail', platform: 'Web', width: 800, mobile: false, engine: 'webkit' },
  { id: 'yahoo', name: 'Yahoo Mail', platform: 'Web', width: 800, mobile: false, engine: 'webkit' },
  { id: 'iphone', name: 'Mail', platform: 'iPhone', width: 375, mobile: true, engine: 'webkit' },
  { id: 'gmail-ios-dark', name: 'Gmail', platform: 'iPhone · sombre', width: 375, mobile: true, engine: 'webkit', dark: 'full' },
  { id: 'gmail-android', name: 'Gmail', platform: 'Android', width: 360, mobile: true, engine: 'webkit' },
  { id: 'gmail-imap', name: 'Gmail (compte IMAP)', platform: 'Android', width: 360, mobile: true, engine: 'no-style' },
  { id: 'samsung', name: 'Samsung Email', platform: 'Android', width: 360, mobile: true, engine: 'webkit' },
]

const ALL = CLIENTS.map((c) => c.id)
const MOBILE = CLIENTS.filter((c) => c.mobile).map((c) => c.id)
const GMAIL: ClientId[] = ['gmail-web', 'gmail-android', 'gmail-ios-dark', 'gmail-imap']

// --- Colours ---------------------------------------------------------------

function parseHex(c: string): [number, number, number] | null {
  const m = c.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, '$&$&') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}

const luminance = ([r, g, b]: [number, number, number]) => {
  const lin = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

export function contrast(a: string, b: string): number | null {
  const x = parseHex(a)
  const y = parseHex(b)
  if (!x || !y) return null
  const [l1, l2] = [luminance(x), luminance(y)].sort((m, n) => n - m)
  return (l1 + 0.05) / (l2 + 0.05)
}

// Mirror the lightness of a colour (HSL), keeping its hue: #ffffff → #000000,
// #ff007f stays a pink. This is what partial dark modes do.
function flipLightness(hex: string): string {
  const rgb = parseHex(hex)
  if (!rgb) return hex
  const [r, g, b] = rgb.map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  let h = 0
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  // Not a pure mirror: Outlook keeps dark backgrounds slightly lifted.
  const nl = Math.min(0.95, Math.max(0.1, 1 - l))
  const c = (1 - Math.abs(2 * nl - 1)) * s
  const x = c * (1 - Math.abs(((h + 6) % 6) % 2 - 1))
  const [r1, g1, b1] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor((h + 6) % 6)]
  const m = nl - c / 2
  return '#' + [r1, g1, b1].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')
}

const isLight = (hex: string) => {
  const rgb = parseHex(hex)
  return !!rgb && luminance(rgb) > 0.4
}

// --- Rendering -------------------------------------------------------------

export interface RenderOptions {
  imagesOff: boolean
}

const editStyle = (el: Element, fn: (style: string) => string) => {
  const s = el.getAttribute('style')
  if (s != null) el.setAttribute('style', fn(s))
}
const dropProps = (style: string, props: string[]) =>
  style.replace(new RegExp(`(^|;)\\s*(${props.join('|')})\\s*:[^;]*`, 'gi'), '$1')

export function renderForClient(html: string, client: EmailClient, opts: RenderOptions): string {
  // Only the Word engine reads Outlook conditional comments.
  if (client.engine === 'word') html = html.replace(/<!--\[if mso\]>([\s\S]*?)<!\[endif\]-->/g, '$1')
  const doc = new DOMParser().parseFromString(html, 'text/html')

  if (client.engine === 'no-style') doc.querySelectorAll('style').forEach((s) => s.remove())
  if (client.engine === 'word') {
    doc.querySelectorAll('style').forEach((s) => {
      if (/@media/.test(s.textContent ?? '')) s.remove()
    })
    doc.querySelectorAll('[style]').forEach((el) => editStyle(el, (s) => dropProps(s, ['border-radius', 'max-width'])))
    // Links are inline in Word: no padding, the background only covers the text.
    doc.querySelectorAll('a[style]').forEach((el) => editStyle(el, (s) => dropProps(s, ['padding', 'display'])))
    // Images take their width attribute (pixels), never the CSS percentage.
    doc.querySelectorAll('img').forEach((img) => {
      editStyle(img, (s) => dropProps(s, ['width', 'height']))
      const w = img.getAttribute('width')
      if (w && !w.endsWith('%')) img.setAttribute('style', `${img.getAttribute('style') ?? ''};width:${w}px;`)
    })
  }

  if (opts.imagesOff) {
    doc.querySelectorAll('img').forEach((img) => {
      const box = doc.createElement('span')
      const w = img.getAttribute('width')
      box.textContent = img.getAttribute('alt') || ''
      box.setAttribute(
        'style',
        `display:inline-block;box-sizing:border-box;width:${w && !w.endsWith('%') ? `${w}px` : '100%'};max-width:100%;min-height:60px;padding:12px;border:1px dashed #b4b4c8;background:#f1f1f6;color:#5c5c78;font:13px/1.4 Arial,sans-serif;text-align:center;`,
      )
      img.replaceWith(box)
    })
  }

  if (client.dark === 'partial') {
    const hex = /#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi
    doc.querySelectorAll('[style]').forEach((el) =>
      editStyle(el, (s) =>
        s.replace(/(^|;)\s*([\w-]+)\s*:([^;]*)/g, (_, sep: string, prop: string, val: string) => {
          const text = prop.toLowerCase() === 'color'
          return `${sep}${prop}:${val.replace(hex, (c) => (text ? (isLight(c) ? c : flipLightness(c)) : isLight(c) ? flipLightness(c) : c))}`
        }),
      ),
    )
    doc.body.setAttribute('style', `${doc.body.getAttribute('style') ?? ''};background:#1f1f1f;`)
  }

  const style = doc.createElement('style')
  style.textContent = [
    'html,body{margin:0;}',
    client.dark === 'full' ? 'html{filter:invert(1) hue-rotate(180deg);background:#fff;} img{filter:invert(1) hue-rotate(180deg);}' : '',
  ].join('\n')
  doc.head.append(style)
  return `<!doctype html>\n${doc.documentElement.outerHTML}`
}

// --- Audit -----------------------------------------------------------------

export interface Issue {
  key: string
  level: 'error' | 'warn' | 'info'
  title: string
  detail: string
  clients: ClientId[]
  blockId?: string
}

const GMAIL_CLIP = 102 * 1024

export function auditModule(tree: ModuleTree, name: string): { issues: Issue[]; bytes: number } {
  const issues: Issue[] = []
  const once = new Set<string>()
  const add = (i: Issue) => {
    if (once.has(i.key)) return
    once.add(i.key)
    issues.push(i)
  }

  const walk = (blocks: Block[], bg: string, mobileColumns: number) => {
    for (const b of blocks) {
      switch (b.type) {
        case 'image':
          if (!b.src)
            add({ key: `nosrc-${b.id}`, level: 'error', title: 'Image sans source', detail: 'Ajoute ou téléverse une image : un cadre vide s\'affichera partout.', clients: ALL, blockId: b.id })
          else if (/\.gif(\?|$)/i.test(b.src))
            add({ key: `gif-${b.id}`, level: 'info', title: 'GIF animé figé', detail: 'Outlook sur Windows n\'affiche que la première image du GIF : place le message clé dessus.', clients: ['outlook-win'], blockId: b.id })
          if (!b.alt.trim())
            add({ key: `alt-${b.id}`, level: 'warn', title: 'Texte alternatif manquant', detail: 'Outlook bloque les images par défaut : sans texte alternatif, le lecteur ne voit rien à cet endroit.', clients: ALL, blockId: b.id })
          break
        case 'button': {
          if (!/^(https?:|mailto:|tel:|\{\{)/i.test(b.href.trim()) || /example\.(com|org)/i.test(b.href))
            add({ key: `href-${b.id}`, level: 'warn', title: 'Lien du bouton à compléter', detail: `« ${b.href || 'vide'} » n'est pas un lien définitif.`, clients: ALL, blockId: b.id })
          const c = contrast(b.color, b.bg)
          if (c != null && c < 3)
            add({ key: `cbtn-${b.id}`, level: 'warn', title: 'Bouton peu lisible', detail: `Contraste texte / fond de ${c.toFixed(1)}:1 (3:1 minimum).`, clients: ALL, blockId: b.id })
          if (b.radius > 0)
            add({ key: 'radius-btn', level: 'info', title: 'Boutons aux coins carrés', detail: 'Outlook sur Windows ignore border-radius : les boutons y apparaissent rectangulaires.', clients: ['outlook-win'], blockId: b.id })
          add({ key: 'btn-padding', level: 'info', title: 'Zone cliquable réduite', detail: 'Outlook sur Windows ignore la marge intérieure des liens : la couleur et le clic se limitent au texte du bouton.', clients: ['outlook-win'], blockId: b.id })
          break
        }
        case 'heading':
        case 'text': {
          const c = contrast(b.color, bg)
          const min = b.type === 'heading' || b.size >= 24 ? 3 : 4.5
          if (c != null && c < min)
            add({ key: `ctxt-${b.id}`, level: 'warn', title: 'Texte peu contrasté', detail: `Contraste de ${c.toFixed(1)}:1 sur ce fond (${min}:1 minimum recommandé).`, clients: ALL, blockId: b.id })
          break
        }
        case 'raw':
          if (/\{\{|\{%/.test(b.html))
            add({ key: 'hubl', level: 'info', title: 'HuBL simulé', detail: 'Les variables {{ … }} et les conditions {% … %} sont interprétées ici avec un contact d\'exemple ; à l\'envoi, ce sera le vrai contact.', clients: ALL, blockId: b.id })
          break
        case 'section':
          section(b, bg, mobileColumns)
          break
      }
    }
  }

  // mobileColumns: columns side by side on a phone around this section.
  const section = (s: Section, parentBg: string, mobileColumns: number) => {
    const bg = parseHex(s.bg) ? s.bg : parentBg
    if (s.radius > 0)
      add({ key: 'radius-section', level: 'info', title: 'Cartes aux coins carrés', detail: 'Outlook sur Windows ignore border-radius sur les sections et les cards.', clients: ['outlook-win'], blockId: s.id })
    const mobileTotal = mobileColumns * (s.behavior === 'side' ? s.columns : 1)
    if (s.columns > 1 && s.behavior === 'stack')
      add({ key: 'nostack', level: 'info', title: 'Colonnes non empilées', detail: 'Sans media queries, Outlook sur Windows et Gmail avec un compte IMAP gardent les colonnes côte à côte, même sur mobile.', clients: ['outlook-win', 'gmail-imap'], blockId: s.id })
    if (mobileTotal >= 3)
      add({ key: `narrow-${s.id}`, level: 'warn', title: 'Colonnes très étroites sur mobile', detail: `${mobileTotal} colonnes côte à côte sur un écran de 360 px : passe la section en « empilées ».`, clients: MOBILE, blockId: s.id })
    s.cells.forEach((cell) => walk(cell, bg, mobileTotal))
  }

  if (tree.width > 640)
    add({ key: 'width', level: 'warn', title: 'Module large', detail: `${tree.width} px : au-delà de 640 px, les volets de lecture d'Outlook et de Gmail font défiler horizontalement.`, clients: ['outlook-win', 'outlook-com', 'gmail-web'] })
  tree.sections.forEach((s) => section(s, parseHex(tree.bg) ? tree.bg : '#ffffff', 1))

  const bytes = new TextEncoder().encode(standaloneEmail(tree, name)).length
  if (bytes > GMAIL_CLIP)
    add({ key: 'clip', level: 'error', title: 'Message tronqué par Gmail', detail: `${Math.round(bytes / 1024)} Ko : au-delà de 102 Ko, Gmail coupe le message et affiche « Afficher l'intégralité du message ».`, clients: GMAIL })

  const order = { error: 0, warn: 1, info: 2 }
  issues.sort((a, b) => order[a.level] - order[b.level])
  return { issues, bytes }
}
