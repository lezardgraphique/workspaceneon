import { createBlock, createSection } from './types'
import type { Block, ButtonBlock, ImageBlock, RawBlock, Section } from './types'

// Ready-made blocks offered in Structure > Ajouter. They are plain cards made of
// the usual blocks, so they stay editable, exportable to HuBL and parsed back.

export interface Preset {
  id: string
  label: string
  hint: string
  build: () => Section
}

const button = (patch: Partial<ButtonBlock>): ButtonBlock => ({ ...(createBlock('button') as ButtonBlock), ...patch })

function card(columns: 1 | 2 | 3, cells: Block[][], patch: Partial<Section> = {}): Section {
  return { ...createSection(columns, true), ...patch, cells }
}

// Round icons are PNG files served by the app (e-mail clients do not show SVG).
const SITE = 'https://workspaceneon.netlify.app'
const ICONS = `${SITE}/social`
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
    hint: 'Jours restants calculés à l’envoi + date de fin (fiable partout)',
    build: () => {
      // Pure HTML + HuBL: HubSpot computes the days left when the e-mail is sent,
      // so nothing depends on an image server, on image blocking or on Apple's
      // image pre-loading. The end date written under it is always exact.
      const c = (f: string) => `{{ module.${f}.color }}`
      const num = `font-size:44px;line-height:48px;font-weight:700;color:${c('couleur_chiffres')}`
      const lab = `font-size:13px;line-height:18px;color:${c('couleur_texte')}`
      const cell = `padding:14px 22px;background:${c('couleur_cases')};border-radius:{{ module.rayon|int }}px`
      const tile = (n: string, l: string) => `<td align="center" style="${cell}"><div style="${num}">${n}</div><div style="${lab}">${l}</div></td>`
      const table = (cells: string) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto"><tbody><tr>${cells}</tr></tbody></table>`
      const html = [
        '{% set reste = module.date_fin - local_dt|unixtimestamp %}',
        '{% if reste > 0 %}',
        '{% set jours = (reste / 86400000)|int %}',
        '{% set heures = ((reste % 86400000) / 3600000)|int %}',
        '<div style="text-align:center;font-family:Arial,Helvetica,sans-serif">',
        `{% if module.texte_avant %}<p style="margin:0 0 10px;font-size:16px;line-height:22px;color:${c('couleur_texte')}">{{ module.texte_avant }}</p>{% endif %}`,
        // Whole tables inside the {% if %}: a condition between two cells would be
        // moved out of the table by the HTML parser.
        `{% if module.afficher_heures %}${table(tile('{{ jours }}', '{% if jours > 1 %}jours{% else %}jour{% endif %}') + '<td width="12" style="width:12px"></td>' + tile('{{ heures }}', '{% if heures > 1 %}heures{% else %}heure{% endif %}'))}{% else %}${table(tile('{{ jours }}', '{% if jours > 1 %}jours{% else %}jour{% endif %}'))}{% endif %}`,
        `{% if module.afficher_date_fin %}<p style="margin:10px 0 0;font-size:13px;line-height:18px;color:${c('couleur_texte')}">Jusqu'au {{ module.date_fin|format_datetime("d MMMM yyyy 'à' HH:mm", "Europe/Paris", "fr") }}</p>{% endif %}`,
        '</div>',
        '{% else %}',
        `<p style="margin:0;text-align:center;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:22px;font-weight:700;color:${c('couleur_chiffres')}">{{ module.message_fin }}</p>`,
        '{% endif %}',
      ].join('\n')
      return card(1, [[{ ...(createBlock('raw') as RawBlock), html }]], { bg: '#ffffff', padding: 16, radius: 0 })
    },
  },
  {
    id: 'countdown-gif',
    label: 'Compte à rebours animé (image)',
    hint: 'Image qui défile 60 s à l’ouverture (dépend de la messagerie)',
    build: () => {
      // The image is drawn by the app (/countdown.gif) at the moment the e-mail
      // is opened and ticks every second. Every setting is a {{ module.x }}
      // variable: they become fields automatically (date, units, colours,
      // size, language, urgency colour, end message…).
      const col = (f: string) => `{{ module.${f}.color|replace('#', '') }}`
      const flag = (f: string) => `{% if module.${f} %}1{% else %}0{% endif %}`
      const params = [
        'to={{ module.date_fin }}',
        'u={{ module.unites }}',
        `lab=${flag('afficher_libelles')}`,
        'lang={{ module.langue }}',
        `sep=${flag('afficher_separateur')}`,
        'st={{ module.style_cases }}',
        `bg=${col('couleur_cases')}`,
        `fg=${col('couleur_chiffres')}`,
        `lb=${col('couleur_texte')}`,
        'r={{ module.rayon|int }}',
        's={{ module.taille|int }}',
        'g={{ module.espacement|int }}',
        'urg={{ module.seuil_urgence_heures|int }}',
        `al=${col('couleur_alerte')}`,
        'end={{ module.message_fin|urlencode }}',
      ].join('&amp;')
      const html = `<div style="text-align:center"><img src="${SITE}/countdown.gif?${params}" alt="Compte à rebours" style="display:inline-block;max-width:100%;height:auto;border:0"></div>`
      return card(1, [[{ ...(createBlock('raw') as RawBlock), html }]], { bg: '#ffffff', padding: 12, radius: 0 })
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

