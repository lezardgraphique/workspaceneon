// Module tree: the single source of truth edited by the visual editor and the
// code editor. HuBL is generated from it (src/lib/hubl.ts) and parsed back.

export type Align = 'left' | 'center' | 'right'

// Module field definition (like a fields.json entry). Optional: content blocks
// without one get an automatic name (heading_1, text_2…), see src/lib/fields.ts.
export interface FieldDef {
  name: string
  label: string
  // Buttons expose two fields, the text and the link. Their names default to
  // `<name>_label` and `<name>_link`; these overrides keep the exact names of a
  // module imported from existing code (e.g. `cta_text` + `cta_link`).
  textName?: string
  linkName?: string
  /** Exact HubSpot definitions from an imported fields.json, by field name (exported as is). */
  specs?: { [name: string]: { [key: string]: Json } }
}

// Adjustments read only by Outlook for Windows (see outlook.ts): margin top /
// bottom, exact line height, spacer height, image width, section padding (px).
export interface OutlookTweaks {
  mt?: number
  mb?: number
  lh?: number
  h?: number
  w?: number
  pad?: number
}

// Spacing and visibility shared by every element (sections included). Absent =
// the historical values (12px under a block, 16px around a divider…).
export type Hide = 'mobile' | 'desktop'
export interface Spacing {
  /** Margin above / below, px. */
  mt?: number
  mb?: number
  /** Hidden on phones (≤ 480px) or shown only on phones. */
  hide?: Hide
}

export interface HeadingBlock extends Spacing {
  id: string
  outlook?: OutlookTweaks
  type: 'heading'
  /** Fixed content of an imported HubSpot module: written as is, not a field of its own. */
  fixed?: boolean
  field?: FieldDef
  text: string
  level: 1 | 2 | 3
  color: string
  align: Align
  size: number
  /** Line height as a ratio of the size (1.25 when absent). */
  lineHeight?: number
  /** 400–900, 700 when absent. */
  weight?: number
  /** Letter spacing, px. */
  letterSpacing?: number
}

export interface TextBlock extends Spacing {
  id: string
  outlook?: OutlookTweaks
  type: 'text'
  /** Fixed content of an imported HubSpot module: written as is, not a field of its own. */
  fixed?: boolean
  field?: FieldDef
  html: string
  color: string
  align: Align
  size: number
  /** Line height as a ratio of the size (1.6 when absent). */
  lineHeight?: number
  letterSpacing?: number
}

export interface ButtonBlock extends Spacing {
  id: string
  outlook?: OutlookTweaks
  type: 'button'
  /** Fixed content of an imported HubSpot module: written as is, not a field of its own. */
  fixed?: boolean
  field?: FieldDef
  label: string
  href: string
  bg: string
  color: string
  align: Align
  radius: number
  /** Width (px) of the VML shape for Outlook; estimated from the label when absent. */
  vmlWidth?: number
  /** Height (px) in Outlook only (VML shape and coloured cell); the button's height when absent. */
  vmlHeight?: number
  /** Optional look; the defaults reproduce the historical button (15px bold, 12/26px padding). */
  height?: number
  fontSize?: number
  bold?: boolean
  borderWidth?: number
  borderColor?: string
  /** Outlook without VML: a coloured box (ghost table cell) instead of highlighted text. */
  msoCell?: boolean
  /** Spans the whole column. */
  fullWidth?: boolean
  /** Left/right padding, px (26 when absent). */
  padX?: number
}

export interface ImageBlock extends Spacing {
  id: string
  outlook?: OutlookTweaks
  type: 'image'
  /** Fixed content of an imported HubSpot module: written as is, not a field of its own. */
  fixed?: boolean
  field?: FieldDef
  src: string
  alt: string
  width: number
  align: Align
  /** Link opened by a click on the image (CTA image). */
  href?: string
  radius?: number
}

export interface DividerBlock extends Spacing {
  id: string
  outlook?: OutlookTweaks
  type: 'divider'
  color: string
  thickness?: number
  lineStyle?: 'solid' | 'dashed' | 'dotted'
  /** Width in %, centred (100 when absent). */
  width?: number
}

export interface SpacerBlock extends Spacing {
  id: string
  outlook?: OutlookTweaks
  type: 'spacer'
  height: number
  /** Height on phones (≤ 480px). */
  mobileHeight?: number
}

// Free HTML/HuBL kept verbatim (e.g. `{% if contact.firstname %}`). Can be
// converted into editable blocks (htmlToBlocks in src/lib/hubl.ts).
export interface RawBlock {
  id: string
  type: 'raw'
  html: string
  /** On a `{% for %}` line: the repeated content is laid out side by side in that many columns (stacked on phones). */
  cols?: 2 | 3
}

export type Columns = 1 | 2 | 3
// side = columns stay side by side on mobile, stack = they stack vertically
export type Behavior = 'side' | 'stack'

export interface Section extends Spacing {
  id: string
  outlook?: OutlookTweaks
  type: 'section'
  columns: Columns
  behavior: Behavior
  bg: string
  padding: number
  radius: number
  cells: Block[][]
  /** Top/bottom and left/right padding when they differ from `padding`. */
  padY?: number
  padX?: number
  borderWidth?: number
  borderColor?: string
  /** Background image (https), the colour stays as a fallback (Outlook). */
  bgImage?: string
  /** Width of the first column in % (2 columns only, 50 when absent). */
  ratio?: number
  valign?: 'top' | 'middle' | 'bottom'
  /** Inline style declarations with HuBL kept from an imported module ({{ module.spacing.css }}…). */
  css?: string
  /** Name shown in the Structure tab (« En-tête », « Offre »…); not in the e-mail. */
  name?: string
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

// A module field that is not tied to one block: a variable the code uses
// ({{ module.date_fin }}, {% if module.afficher %}, a repeater…). Created
// automatically from pasted HuBL, kept in sync with the code, exported in
// fields.json. The variable itself stays in the content.
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

// How a module field is edited in the app. HubSpot types without an editor of
// their own (spacing, border, cta, icon, form…) use `json` and keep their exact
// type in `hsType`.
export type ExtraFieldType =
  | 'text'
  | 'richtext'
  | 'number'
  | 'boolean'
  | 'link'
  | 'url'
  | 'image'
  | 'file'
  | 'color'
  | 'font'
  | 'alignment'
  | 'textalignment'
  | 'backgroundimage'
  | 'date'
  | 'datetime'
  | 'choice'
  | 'group'
  | 'json'

export interface ExtraField {
  name: string
  label: string
  type: ExtraFieldType
  /** Exact HubSpot type when it differs from `type` (cta, spacing, border, icon, form, menu…). */
  hsType?: string
  // Value in the shape of fields.json (text, number, { url: … } for a link…).
  default?: Json
  // choice: the allowed values (a drop-down), the default is one of them.
  options?: { value: string; label: string }[]
  // group: its fields. repeater = several items ({% for %} loop, `occurrence` in HubSpot);
  // a non-group field can repeat too (a list of texts…).
  children?: ExtraField[]
  repeater?: boolean
  /** The rest of the HubSpot definition (display, min/max, occurrence, tab, id…), exported as is. */
  spec?: { [key: string]: Json }
  /** Imported (code or fields.json): kept even when the code stops using it. */
  keep?: boolean
  /** The imported definition had no default: the value shown is only a preview stand-in, not exported. */
  noDefault?: boolean
}

export interface ModuleTree {
  width: number
  bg: string
  font: string
  sections: Section[]
  fields?: ExtraField[]
  /** Draws the buttons as VML shapes for Outlook on Windows (see lib/vml.ts). */
  vml?: boolean
  /** Space above and below the module, px (24 when absent). */
  pad?: number
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
      // Plain HTML, editable in place; HuBL variables and logic work too.
      return {
        id,
        type,
        html: '<div style="padding:16px;background:#f4f4fa;border-radius:8px;font-size:15px;line-height:1.5;color:#1d1d1b;"><p style="margin:0 0 8px;font-weight:700;">Bonjour {{ contact.firstname }},</p><p style="margin:0;">Écris ou colle ton HTML ici, puis clique sur un élément de l\'aperçu pour le modifier.</p></div>',
      }
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
  raw: 'Bloc HTML',
  section: 'Card imbriquée',
}
