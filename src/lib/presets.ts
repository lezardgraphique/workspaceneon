import { createBlock, createSection } from './types'
import type { Block, ButtonBlock, ImageBlock, Section, TextBlock } from './types'

// Ready-made blocks offered in Structure > Ajouter. They are plain cards made of
// the usual blocks, so they stay editable, exportable to HuBL and parsed back.

export interface Preset {
  id: string
  label: string
  hint: string
  build: () => Section
}

const button = (patch: Partial<ButtonBlock>): ButtonBlock => ({ ...(createBlock('button') as ButtonBlock), ...patch })
const text = (patch: Partial<TextBlock>): TextBlock => ({ ...(createBlock('text') as TextBlock), ...patch })

function card(columns: 1 | 2 | 3, cells: Block[][], patch: Partial<Section> = {}): Section {
  return { ...createSection(columns, true), ...patch, cells }
}

const NETWORKS = [
  { label: 'LinkedIn', bg: '#0a66c2', href: 'https://www.linkedin.com/' },
  { label: 'Facebook', bg: '#1877f2', href: 'https://www.facebook.com/' },
  { label: 'Instagram', bg: '#c13584', href: 'https://www.instagram.com/' },
]

export const PRESETS: Preset[] = [
  {
    id: 'social',
    label: 'Social',
    hint: 'Trois boutons vers tes réseaux',
    build: () =>
      card(
        3,
        NETWORKS.map((n) => [button({ label: n.label, href: n.href, bg: n.bg, align: 'center', radius: 6 })]),
        { behavior: 'side', bg: '#ffffff', padding: 8, radius: 0 },
      ),
  },
  {
    id: 'video',
    label: 'Vidéo',
    hint: 'Image d’aperçu + bouton de lecture',
    build: () => {
      // Email clients do not play video: the thumbnail and the button open the video page.
      const image: ImageBlock = { ...(createBlock('image') as ImageBlock), alt: 'Aperçu de la vidéo', field: { name: 'video_apercu', label: 'Aperçu de la vidéo' } }
      return card(1, [
        [
          image,
          button({ label: '▶ Regarder la vidéo', href: 'https://www.youtube.com/', bg: '#ff007f', align: 'center', radius: 24 }),
        ],
      ])
    },
  },
  {
    id: 'countdown',
    label: 'Compte à rebours',
    hint: 'Jours, heures, minutes (à mettre à jour)',
    build: () => {
      const tile = (n: string, unit: string): Block[] => [
        text({ html: `<strong>${n}</strong>`, size: 34, align: 'center', color: '#ff007f' }),
        text({ html: unit, size: 13, align: 'center', color: '#3a3a52' }),
      ]
      return card(3, [tile('07', 'jours'), tile('12', 'heures'), tile('30', 'minutes')], { behavior: 'side', bg: '#f4f4fa', padding: 12 })
    },
  },
  {
    id: 'dynamic-image',
    label: 'Image dynamique',
    hint: 'Image choisie à chaque envoi (champ du module)',
    build: () => {
      const image: ImageBlock = { ...(createBlock('image') as ImageBlock), alt: 'Image personnalisée', field: { name: 'image_dynamique', label: 'Image dynamique' } }
      return card(1, [[image]], { bg: '#ffffff', padding: 0, radius: 0 })
    },
  },
]

