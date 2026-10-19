// Module tree: the single source of truth edited by the visual editor and the
// code editor. HuBL is generated from it (src/lib/hubl.ts) and parsed back.

export type Align = 'left' | 'center' | 'right'

// Module field definition (like a fields.json entry). Optional: content blocks
// without one get an automatic name (heading_1, text_2…), see src/lib/fields.ts.
export interface FieldDef {
  name: string
  label: string
}

export interface HeadingBlock {
  id: string
  type: 'heading'
  field?: FieldDef
  text: string
  level: 1 | 2 | 3
  color: string
  align: Align
  size: number
}

export interface TextBlock {
  id: string
  type: 'text'
  field?: FieldDef
  html: string
  color: string
  align: Align
  size: number
}

export interface ButtonBlock {
  id: string
  type: 'button'
  field?: FieldDef
  label: string
  href: string
  bg: string
  color: string
  align: Align
  radius: number
}

export interface ImageBlock {
  id: string
  type: 'image'
  field?: FieldDef
  src: string
  alt: string
  width: number
  align: Align
}

export interface DividerBlock {
  id: string
  type: 'divider'
  color: string
}

export interface SpacerBlock {
  id: string
  type: 'spacer'
  height: number
}

// Free HTML/HuBL kept verbatim (e.g. `{% if contact.firstname %}`). Can be
// converted into editable blocks (htmlToBlocks in src/lib/hubl.ts).
export interface RawBlock {
  id: string
  type: 'raw'
  html: string
}

export type Columns = 1 | 2 | 3
// side = columns stay side by side on mobile, stack = they stack vertically
export type Behavior = 'side' | 'stack'

export interface Section {
  id: string
  type: 'section'
  columns: Columns
  behavior: Behavior
  bg: string
  padding: number
  radius: number
  cells: Block[][]
}

export type Block =
  | HeadingBlock
  | TextBlock
  | ButtonBlock
  | ImageBlock
  | DividerBlock
  | SpacerBlock
  | RawBlock
  | Section

export type BlockType = Block['type']

export interface ModuleTree {
  width: number
  bg: string
  font: string
  sections: Section[]
}

export interface ModuleRecord {
  id: string
  name: string
  tree: ModuleTree
  createdAt: string
  updatedAt: string
}

export const uid = () => Math.random().toString(36).slice(2, 9)

export function createBlock(type: BlockType): Block {
  const id = uid()
  switch (type) {
    case 'heading':
      return { id, type, text: 'Titre accrocheur', level: 2, color: '#0f0f1a', align: 'left', size: 26 }
    case 'text':
      return {
        id,
        type,
        html: 'Rédige ici ton message. Sois clair, concret et orienté bénéfice.',
        color: '#3a3a52',
        align: 'left',
        size: 16,
      }
    case 'button':
      return {
        id,
        type,
        label: 'Découvrir',
        href: 'https://example.com',
        bg: '#ff007f',
        color: '#ffffff',
        align: 'left',
        radius: 8,
      }
    case 'image':
      return { id, type, src: '', alt: 'Image', width: 100, align: 'center' }
    case 'divider':
      return { id, type, color: '#e3e3ee' }
    case 'spacer':
      return { id, type, height: 24 }
    case 'raw':
      return { id, type, html: '{% if contact.firstname %}Bonjour {{ contact.firstname }},{% endif %}' }
    case 'section':
      return createSection(1, true)
  }
}

export function createSection(columns: Columns, nested = false): Section {
  return {
    id: uid(),
    type: 'section',
    columns,
    behavior: 'stack',
    bg: nested ? '#f4f4fa' : '#ffffff',
    padding: nested ? 16 : 24,
    radius: nested ? 10 : 0,
    cells: Array.from({ length: columns }, () => [createBlock('text')]),
  }
}

export const BLOCK_LABELS: Record<BlockType, string> = {
  heading: 'Titre',
  text: 'Texte',
  button: 'Bouton',
  image: 'Image',
  divider: 'Séparateur',
  spacer: 'Espace',
  raw: 'Code libre',
  section: 'Card imbriquée',
}
