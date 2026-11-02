import { createBlock, createSection } from './types'
import type { Block, ButtonBlock, ImageBlock, RawBlock, Section, TextBlock } from './types'

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

// Round icons are PNG files served by the app (e-mail clients do not show SVG).
const ICONS = 'https://workspaceneon.netlify.app/social'
const NETWORKS = [
  { name: 'LinkedIn', file: 'linkedin', href: 'https://www.linkedin.com/' },
  { name: 'Facebook', file: 'facebook', href: 'https://www.facebook.com/' },
  { name: 'Instagram', file: 'instagram', href: 'https://www.instagram.com/' },
  { name: 'YouTube', file: 'youtube', href: 'https://www.youtube.com/' },
]

// The usual social bar: a centred row of round icons, each one a link. Table
// layout so it holds in Outlook; the links are edited in the code.
const socialBar = () =>
  `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tbody><tr>${NETWORKS.map(
    (n) =>
      `<td style="padding:0 6px"><a href="${n.href}" target="_blank" rel="noopener noreferrer"><img src="${ICONS}/${n.file}.png" width="36" height="36" alt="${n.name}" style="display:block;border:0;border-radius:50%"></a></td>`,
  ).join('')}</tr></tbody></table>`

export const PRESETS: Preset[] = [
  {
    id: 'social',
    label: 'Social',
    hint: 'Rangée d’icônes rondes vers tes réseaux',
    build: () => card(1, [[{ ...(createBlock('raw') as RawBlock), html: socialBar() }]], { bg: '#ffffff', padding: 12, radius: 0 }),
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

