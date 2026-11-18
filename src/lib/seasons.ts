// Maily's seasonal accessories: which period of the year it is (French calendar).
// Decided in the browser, with the visitor's own date (the signed-out pages are
// kept a day by the CDN, so the server must not bake an accessory into them).
// Preview any of them with ?maily=<key> in the address (?maily=aucun hides them).

import { useEffect, useState } from 'react'

export type Season = 'noel' | 'nouvel-an' | 'epiphanie' | 'valentin' | 'paques' | 'poisson-avril' | 'musique' | 'quatorze-juillet' | 'ete' | 'halloween'

export const SEASONS: Record<Season, { label: string; emoji: string }> = {
  noel: { label: 'Noël', emoji: '🎄' },
  'nouvel-an': { label: 'Nouvel an', emoji: '🎉' },
  epiphanie: { label: 'Épiphanie', emoji: '👑' },
  valentin: { label: 'Saint-Valentin', emoji: '💗' },
  paques: { label: 'Pâques', emoji: '🐣' },
  'poisson-avril': { label: "Poisson d'avril", emoji: '🐟' },
  musique: { label: 'Fête de la musique', emoji: '🎧' },
  'quatorze-juillet': { label: '14 juillet', emoji: '🎆' },
  ete: { label: 'Été', emoji: '😎' },
  halloween: { label: 'Halloween', emoji: '🎃' },
}

// Easter Sunday (Gregorian calendar, anonymous algorithm): [month 1-12, day].
export function easter(year: number): [number, number] {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return [month, day]
}

const DAY = 86_400_000

export function seasonOf(date: Date): Season | null {
  const y = date.getFullYear()
  const m = date.getMonth() + 1
  const d = date.getDate()
  const md = m * 100 + d
  if (md >= 1229 || md <= 102) return 'nouvel-an'
  if (md >= 103 && md <= 110) return 'epiphanie'
  if (md >= 1201 && md <= 1228) return 'noel'
  if ((md >= 1024 && md <= 1031) || md === 1101) return 'halloween'
  if (md >= 212 && md <= 214) return 'valentin'
  if (md === 401) return 'poisson-avril'
  // Good Friday to Easter Monday.
  const [em, ed] = easter(y)
  const today = Date.UTC(y, m - 1, d)
  const sunday = Date.UTC(y, em - 1, ed)
  if (today >= sunday - 2 * DAY && today <= sunday + DAY) return 'paques'
  if (md === 621) return 'musique'
  if (md === 713 || md === 714) return 'quatorze-juillet'
  if (md >= 701 && md <= 831) return 'ete'
  return null
}

// The accessory to show now, or null. Empty on the server and on the first
// render, so the page hydrates the same everywhere.
export function useSeason(): Season | null {
  const [season, setSeason] = useState<Season | null>(null)
  useEffect(() => {
    let forced: string | null = null
    try {
      forced = new URLSearchParams(location.search).get('maily')
    } catch {}
    if (forced === 'aucun') return setSeason(null)
    if (forced && forced in SEASONS) return setSeason(forced as Season)
    setSeason(seasonOf(new Date()))
  }, [])
  return season
}
