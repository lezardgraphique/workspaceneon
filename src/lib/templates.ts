import { uid } from './types'
import type { Block, ModuleTree, Section } from './types'

// Starter modules offered on the library page. Ids are generated per call so
// each new module gets its own.

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
// Absolute URL so the image keeps working once the module is pasted into HubSpot.
export const HERO_IMAGE =
  'https://illustrious-panda-0e55d7.netlify.app/.netlify/images?url=/img/neon-hero.png&w=1200&fm=jpg&q=80'

const h = (text: string, extra: Partial<Block> = {}): Block =>
  ({ id: uid(), type: 'heading', text, level: 2, color: '#0f0f1a', align: 'left', size: 26, ...extra }) as Block
const t = (html: string, extra: Partial<Block> = {}): Block =>
  ({ id: uid(), type: 'text', html, color: '#3a3a52', align: 'left', size: 16, ...extra }) as Block
const btn = (label: string, extra: Partial<Block> = {}): Block =>
  ({
    id: uid(),
    type: 'button',
    label,
    href: 'https://example.com',
    bg: '#ff007f',
    color: '#ffffff',
    align: 'left',
    radius: 8,
    ...extra,
  }) as Block
const sec = (cells: Block[][], extra: Partial<Section> = {}): Section => ({
  id: uid(),
  type: 'section',
  columns: cells.length as 1 | 2 | 3,
  behavior: 'stack',
  bg: '#ffffff',
  padding: 24,
  radius: 0,
  cells,
  ...extra,
})
const card = (title: string, body: string): Section =>
  sec([[h(title, { size: 18, level: 3 }), t(body, { size: 14 }), btn('Voir', { radius: 6 })]], {
    bg: '#f4f4fa',
    padding: 16,
    radius: 10,
  })

export interface Starter {
  key: string
  name: string
  description: string
  build: () => ModuleTree
}

export const STARTERS: Starter[] = [
  {
    key: 'blank',
    name: 'Module vierge',
    description: 'Une section, un titre, un texte. Le point de départ minimal.',
    build: () => ({
      width: 600,
      bg: '#f2f2f7',
      font: FONT,
      sections: [sec([[h('Ton titre ici'), t('Commence à écrire ton message.')]])],
    }),
  },
  {
    key: 'newsletter',
    name: 'Newsletter',
    description: 'Visuel héro, édito personnalisé en HuBL et appel à l\'action.',
    build: () => ({
      width: 600,
      bg: '#f2f2f7',
      font: FONT,
      sections: [
        sec([[{ id: uid(), type: 'image', src: HERO_IMAGE, alt: 'Visuel de la newsletter', width: 100, align: 'center' }]], {
          padding: 0,
        }),
        sec([
          [
            { id: uid(), type: 'raw', html: '{% if contact.firstname %}Bonjour {{ contact.firstname }},{% else %}Bonjour,{% endif %}' },
            h('Les nouveautés du mois'),
            t('Trois améliorations qui vont accélérer ta façon de travailler. On t\'explique tout en deux minutes.'),
            btn('Lire la suite'),
          ],
        ]),
      ],
    }),
  },
  {
    key: 'promo',
    name: 'Offre 2 colonnes',
    description: 'Accroche à gauche, bénéfices à droite, empilés sur mobile.',
    build: () => ({
      width: 600,
      bg: '#0f0f1a',
      font: FONT,
      sections: [
        sec(
          [
            [
              h('-30 % jusqu\'à dimanche', { color: '#ffffff', size: 30 }),
              t('Une offre réservée à nos abonnés. Profites-en avant minuit.', { color: '#c9c9de' }),
              btn('J\'en profite', { bg: '#00e5ff', color: '#0f0f1a' }),
            ],
            [
              t('<strong>✓ Livraison offerte</strong><br>✓ Retour gratuit 30 jours<br>✓ Support prioritaire', {
                color: '#ffffff',
              }),
            ],
          ],
          { bg: '#1a1a2e', radius: 14 },
        ),
      ],
    }),
  },
  {
    key: 'cards',
    name: 'Cartes produits',
    description: 'Trois cards imbriquées côte à côte, pour un catalogue.',
    build: () => ({
      width: 600,
      bg: '#f2f2f7',
      font: FONT,
      sections: [
        sec([[h('Notre sélection', { align: 'center' }), t('Choisis la formule qui te ressemble.', { align: 'center' })]], {
          padding: 24,
        }),
        sec(
          [
            [card('Essentiel', 'Tout pour bien démarrer.')],
            [card('Pro', 'Pour les équipes qui accélèrent.')],
            [card('Studio', 'La puissance sans limite.')],
          ],
          { padding: 16 },
        ),
      ],
    }),
  },
]
