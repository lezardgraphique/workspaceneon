// VML (Vector Markup Language): the drawing language Outlook for Windows (Word
// engine) reads in conditional comments. It ignores border-radius and link
// padding, so a "bulletproof" button is redrawn there as a VML shape while every
// other client keeps the normal link. Pure helpers shared by the generated code
// (hubl.ts), the test clients (clients.ts) and the VML window.
//
// Strings passed in are already escaped for HTML attributes (HuBL tokens kept).

export const BUTTON_FONT_SIZE = 15
export const BUTTON_HEIGHT = 42 // 15px text + 12px padding top and bottom, as in the HTML button
const SIDE_PADDING = 26

// The optional look of a button, shared by the HTML link, the VML shape and the previews.
export interface ButtonLook {
  height?: number
  fontSize?: number
  bold?: boolean
  borderWidth?: number
  borderColor?: string
  color?: string
}

export const buttonFontSize = (b: ButtonLook) => b.fontSize ?? BUTTON_FONT_SIZE
export const buttonBold = (b: ButtonLook) => b.bold !== false
export const buttonBorder = (b: ButtonLook) => (b.borderWidth && b.borderWidth > 0 ? b.borderWidth : 0)
export const buttonBorderColor = (b: ButtonLook) => b.borderColor || b.color || '#ffffff'
// Total height in px: explicit, or what the padded text makes (42 by default).
export const buttonHeight = (b: ButtonLook) => b.height ?? Math.round(buttonFontSize(b) * 1.2) + 24 + 2 * buttonBorder(b)

export interface VmlButtonParams {
  href: string
  label: string
  bg: string
  color: string
  radius: number
  font: string
  width: number
  height?: number
  fontSize?: number
  bold?: boolean
  borderWidth?: number
  borderColor?: string
}

const TOKEN = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g

// Text width of a bold 15px label (Arial-like metrics, good to a few pixels).
// A HuBL variable counts for a typical word since its value isn't known.
export function estimateTextWidth(label: string, size = BUTTON_FONT_SIZE): number {
  const plain = label.replace(TOKEN, 'MMMMMMMM')
  let em = 0
  for (const ch of plain) {
    if (/[WM@%]/.test(ch)) em += 0.95
    else if (/[A-Z]/.test(ch)) em += 0.74
    else if (/[ijlIft.,:;!'|\s]/.test(ch)) em += 0.31
    else if (/[mw]/.test(ch)) em += 0.84
    else em += 0.58
  }
  return Math.ceil(em * size)
}

export const buttonWidth = (label: string, look: ButtonLook = {}) =>
  Math.max(80, Math.ceil(estimateTextWidth(label, buttonFontSize(look)) * (buttonBold(look) ? 1 : 0.94)) + SIDE_PADDING * 2 + 2 * buttonBorder(look) + 4)

// arcsize is a percentage of the shorter side, 50 % being a full pill.
export const arcSize = (radius: number, width: number, height = BUTTON_HEIGHT) =>
  Math.min(50, Math.round((radius / Math.min(width, height)) * 100))

export function vmlShape(p: VmlButtonParams): string {
  const h = p.height ?? BUTTON_HEIGHT
  const shape = p.radius > 0 ? 'roundrect' : 'rect'
  const arc = p.radius > 0 ? ` arcsize="${arcSize(p.radius, p.width, h)}%"` : ''
  const bw = p.borderWidth && p.borderWidth > 0 ? p.borderWidth : 0
  const stroke = bw ? `stroke="t" strokecolor="${p.borderColor || p.color}" strokeweight="${bw}px"` : 'stroke="f"'
  const weight = p.bold === false ? 'normal' : 'bold'
  return `<v:${shape} xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${p.href}" style="height:${h}px;v-text-anchor:middle;width:${p.width}px;"${arc} ${stroke} fillcolor="${p.bg}">
  <w:anchorlock/>
  <center style="color:${p.color};font-family:${p.font};font-size:${p.fontSize ?? BUTTON_FONT_SIZE}px;font-weight:${weight};">${p.label}</center>
</v:${shape}>`
}

// The Outlook-only branch; the regular link goes in the `[if !mso]` branch.
export const msoOnly = (inner: string) => `<!--[if mso]>\n${inner}\n<![endif]-->`
export const notMso = (inner: string) => `<!--[if !mso]><!-->\n${inner}\n<!--<![endif]-->`
