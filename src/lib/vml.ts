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
  padY?: number
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
export const buttonHeight = (b: ButtonLook) => b.height ?? Math.round(buttonFontSize(b) * 1.2) + 2 * (b.padY ?? 12) + 2 * buttonBorder(b)
// Height in Outlook (VML shape, coloured cell): its own setting, else the button's.
export const outlookHeight = (b: ButtonLook & { vmlHeight?: number }) => b.vmlHeight ?? buttonHeight(b)

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

// Outlook without VML ignores a link's padding and display, so the button shrinks
// to highlighted text. A table cell read only by Outlook (conditional comments)
// gives it back its coloured box and padding; corners stay square and only the
// text is clickable. Other clients never see the table.
export function msoCell(p: { bg: string; align: 'left' | 'center' | 'right'; look: ButtonLook; width?: number; border?: string }): [string, string] {
  const bw = buttonBorder(p.look)
  const v = p.look.height ? Math.max(0, Math.round((p.look.height - 2 * bw - Math.round(buttonFontSize(p.look) * 1.2)) / 2)) : 12
  const h = p.width ? 0 : SIDE_PADDING
  const align = p.align === 'left' ? '' : ` align="${p.align}"`
  const open = `<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0"${align}><tr><td bgcolor="${p.bg}" align="center"${p.width ? ` width="${p.width}"` : ''} style="background:${p.bg};padding:${v}px ${h}px;${p.border ?? ''}"><![endif]-->`
  return [open, '<!--[if mso]></td></tr></table><![endif]-->']
}

// The Outlook-only branch; the regular link goes in the `[if !mso]` branch.
export const msoOnly = (inner: string) => `<!--[if mso]>\n${inner}\n<![endif]-->`
export const notMso = (inner: string) => `<!--[if !mso]><!-->\n${inner}\n<!--<![endif]-->`

// Background image of a section for Outlook for Windows (bulletproof background):
// a VML rectangle filled with the image, as wide as the section and growing with
// its content; the section's padding becomes the text box's inset. Every other
// client reads the CSS background-image and skips the conditional comments.
export function vmlBackground(p: { src: string; color: string; width: number; inset: [number, number, number, number] }): [string, string] {
  const [t, r, b, l] = p.inset
  const color = p.color && p.color !== 'transparent' ? ` color="${p.color}"` : ''
  const open = `<!--[if mso]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:${p.width}px;"><v:fill type="frame" aspect="atleast" origin="0.5,0.5" position="0.5,0.5" src="${p.src}"${color} /><v:textbox inset="${l}px,${t}px,${r}px,${b}px" style="mso-fit-shape-to-text:true"><![endif]-->`
  return [open, '<!--[if mso]></v:textbox></v:rect><![endif]-->']
}
