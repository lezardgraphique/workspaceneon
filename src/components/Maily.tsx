// Maily — the Neon Sandbox Pro mascot (see docs/design/maily-mascot.md):
// an envelope-drone with neon wings and dot-matrix eyes that change mood.

import { useId } from 'react'

import { type Season, useSeason } from '@/lib/seasons'

export type MailyMood = 'happy' | 'thinking' | 'success'

const EYES: Record<MailyMood, string[]> = {
  happy: ['01110', '10001', '00000'],
  thinking: ['00000', '11111', '00000'],
  success: ['01110', '11111', '01110'],
}

function Eye({ x, mood }: { x: number; mood: MailyMood }) {
  return (
    <g>
      {EYES[mood].flatMap((row, r) =>
        row.split('').map((on, c) =>
          on === '1' ? <circle key={`${r}-${c}`} cx={x + c * 3} cy={44 + r * 3} r={1.1} fill="#00E5FF" /> : null,
        ),
      )}
    </g>
  )
}

export function Maily({
  mood = 'happy',
  size = 64,
  bob = true,
  decorative = false,
  className = '',
  season,
}: {
  mood?: MailyMood
  size?: number
  bob?: boolean
  // Inside a labelled button or next to text that already says it: hidden from screen readers.
  decorative?: boolean
  className?: string
  // Seasonal accessory; by default the one of today's date (null: none).
  season?: Season | null
}) {
  const today = useSeason()
  const wear = season === undefined ? today : season
  // Several Maily can share a page; ids must be unique or a hidden one steals the gradient.
  const uid = useId().replace(/:/g, '')
  const glow = `maily-glow-${uid}`
  const body = `maily-body-${uid}`
  return (
    <svg
      viewBox="0 0 120 96"
      width={size}
      height={(size * 96) / 120}
      className={`${bob ? 'maily-bob' : ''} ${mood === 'thinking' ? 'maily-thinking' : ''} ${className}`}
      {...(decorative
        ? { 'aria-hidden': true }
        : { role: 'img', 'aria-label': `Maily (${mood === 'happy' ? 'contente' : mood === 'thinking' ? 'réfléchit' : 'succès'})` })}
    >
      <defs>
        <filter id={glow} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <linearGradient id={body} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5ff2ff" />
          <stop offset="1" stopColor="#00b8d4" />
        </linearGradient>
      </defs>
      {/* thrust trail */}
      <ellipse cx="60" cy="88" rx="22" ry="3" fill="#ff2d95" opacity="0.35" className="maily-trail" />
      {/* wings */}
      <g filter={`url(#${glow})`}>
        <path
          className="maily-wing-l"
          d="M32 46 C18 30 6 30 4 40 C10 46 20 50 32 56 Z"
          fill="#ff2d95"
          fillOpacity="0.28"
          stroke="#ff2d95"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          className="maily-wing-r"
          d="M88 46 C102 30 114 30 116 40 C110 46 100 50 88 56 Z"
          fill="#ff2d95"
          fillOpacity="0.28"
          stroke="#ff2d95"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </g>
      {/* antenna */}
      <line x1="60" y1="30" x2="60" y2="20" stroke="#00E5FF" strokeWidth="2" strokeLinecap="round" />
      <circle cx="60" cy="17" r="3.5" fill="#ff2d95" filter={`url(#${glow})`} className="maily-led" />
      {/* envelope body */}
      <rect x="30" y="30" width="60" height="44" rx="10" fill={`url(#${body})`} filter={`url(#${glow})`} />
      <path d="M33 71 L52 57 M87 71 L68 57" stroke="#0A0A12" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" />
      {/* visor */}
      <rect x="38" y="38" width="44" height="18" rx="7" fill="#0A0A12" />
      <Eye x={44} mood={mood} />
      <Eye x={64} mood={mood} />
      {wear && <Accessory season={wear} />}
    </svg>
  )
}

export function NeonLogo({ size = 32 }: { size?: number }) {
  // logo.svg is the favicon drawn at 64 px (the favicon says 512): the browser
  // then sees a file the size it shows. Lazy: in view, it loads at once anyway.
  return <img src="/logo.svg" width={size} height={size} alt="" aria-hidden="true" loading="lazy" decoding="async" className="shrink-0" />
}

// Drawn over the 120×96 drone: envelope 30–90 × 30–74, visor 38–82 × 38–56,
// antenna x 60 from y 13 to 30.
function Accessory({ season }: { season: Season }) {
  switch (season) {
    case 'noel':
      return (
        <g transform="rotate(14 78 30)">
          <path d="M65 30 C66 16 80 6 96 9 C91 13 88 20 91 30 Z" fill="#E11D48" />
          <path d="M70 29 C72 20 79 13 88 11" stroke="#fff" strokeOpacity="0.25" strokeWidth="2" fill="none" strokeLinecap="round" />
          <rect x="62" y="27" width="32" height="7" rx="3.5" fill="#F8FAFC" />
          <circle cx="97" cy="9" r="4.2" fill="#F8FAFC" />
        </g>
      )
    case 'nouvel-an':
      return (
        <g>
          <g transform="rotate(-16 42 31)">
            <path d="M31 32 L42 4 L53 32 Z" fill="#7B2CFF" />
            <path d="M34.5 23 L49.5 23 M37.5 15.5 L46.5 15.5" stroke="#FACC15" strokeWidth="2.4" />
            <circle cx="42" cy="4" r="3.2" fill="#FACC15" />
          </g>
          <rect x="94" y="14" width="4" height="2" rx="1" fill="#FACC15" transform="rotate(30 96 15)" />
          <rect x="100" y="26" width="4" height="2" rx="1" fill="#00E5FF" transform="rotate(-25 102 27)" />
          <rect x="74" y="8" width="4" height="2" rx="1" fill="#ff2d95" transform="rotate(50 76 9)" />
          <circle cx="86" cy="20" r="1.4" fill="#FACC15" />
          <circle cx="20" cy="22" r="1.4" fill="#00E5FF" />
        </g>
      )
    case 'epiphanie':
      return (
        <g>
          <path d="M40 32 L40 18 L48 25 L54 15 L58 24 L62 24 L66 15 L72 25 L80 18 L80 32 Z" fill="#FACC15" stroke="#B45309" strokeWidth="1.2" strokeLinejoin="round" />
          <circle cx="47" cy="28.5" r="1.8" fill="#ff2d95" />
          <circle cx="60" cy="28.5" r="1.8" fill="#00E5FF" />
          <circle cx="73" cy="28.5" r="1.8" fill="#ff2d95" />
        </g>
      )
    case 'valentin':
      return (
        <g>
          <path d="M60 22.5 C56 19 53.5 16.5 55 13.5 C56.5 11 59 11.5 60 13.5 C61 11.5 63.5 11 65 13.5 C66.5 16.5 64 19 60 22.5 Z" fill="#ff2d95" />
          <ellipse cx="41" cy="61" rx="4" ry="2.2" fill="#FF4FA3" opacity="0.7" />
          <ellipse cx="79" cy="61" rx="4" ry="2.2" fill="#FF4FA3" opacity="0.7" />
        </g>
      )
    case 'paques':
      return (
        <g>
          <g transform="rotate(-14 45 30)">
            <ellipse cx="45" cy="16" rx="6" ry="15" fill="#F8FAFC" />
            <ellipse cx="45" cy="17" rx="3" ry="11" fill="#FBCFE8" />
          </g>
          <g transform="rotate(14 75 30)">
            <ellipse cx="75" cy="16" rx="6" ry="15" fill="#F8FAFC" />
            <ellipse cx="75" cy="17" rx="3" ry="11" fill="#FBCFE8" />
          </g>
        </g>
      )
    case 'poisson-avril':
      return (
        <g transform="rotate(-12 78 66)">
          <path d="M86 66 L95 60 L95 72 Z" fill="#F97316" />
          <ellipse cx="78" cy="66" rx="10" ry="6" fill="#FB923C" />
          <path d="M80 61 C83 64 83 68 80 71" stroke="#F97316" strokeWidth="1.4" fill="none" />
          <circle cx="73" cy="64.5" r="1.4" fill="#0A0A12" />
        </g>
      )
    case 'musique':
      return (
        <g>
          <path d="M28 48 C28 10 92 10 92 48" stroke="#2A1B4D" strokeWidth="4.5" fill="none" strokeLinecap="round" />
          <path d="M28 48 C28 10 92 10 92 48" stroke="#7B2CFF" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          <rect x="22" y="40" width="11" height="18" rx="4" fill="#7B2CFF" />
          <rect x="87" y="40" width="11" height="18" rx="4" fill="#7B2CFF" />
          <path d="M102 22 L102 12 L108 10 L108 20" stroke="#00E5FF" strokeWidth="1.5" fill="none" />
          <circle cx="100.5" cy="22.5" r="2" fill="#00E5FF" />
          <circle cx="106.5" cy="20.5" r="2" fill="#00E5FF" />
        </g>
      )
    case 'quatorze-juillet':
      return (
        <g>
          <circle cx="38" cy="34" r="7.5" fill="#1D4ED8" />
          <circle cx="38" cy="34" r="5" fill="#F8FAFC" />
          <circle cx="38" cy="34" r="2.6" fill="#E11D48" />
          <g stroke="#FACC15" strokeWidth="1.3" strokeLinecap="round">
            <path d="M100 14 L100 8 M100 20 L100 26 M94 17 L88 17 M106 17 L112 17 M96 13 L92 9 M104 21 L108 25 M104 13 L108 9 M96 21 L92 25" />
          </g>
        </g>
      )
    case 'ete':
      return (
        <g>
          <rect x="40" y="40" width="18" height="13" rx="5" fill="#0A0A12" fillOpacity="0.9" stroke="#ff2d95" strokeWidth="1.6" />
          <rect x="62" y="40" width="18" height="13" rx="5" fill="#0A0A12" fillOpacity="0.9" stroke="#ff2d95" strokeWidth="1.6" />
          <path d="M58 44 L62 44" stroke="#ff2d95" strokeWidth="1.6" />
          <path d="M44 44 L49 42 M66 44 L71 42" stroke="#00E5FF" strokeWidth="1.3" strokeLinecap="round" />
        </g>
      )
    case 'halloween':
      return (
        <g>
          <path d="M44 31 C50 24 54 14 58 6 C62 2 68 4 70 8 C66 7 63 9 63 14 C64 20 70 26 76 31 Z" fill="#2A1B4D" stroke="#7B2CFF" strokeWidth="1.3" strokeLinejoin="round" />
          <path d="M47.5 28 L72.5 28" stroke="#F97316" strokeWidth="3.4" />
          <ellipse cx="60" cy="31.5" rx="25" ry="3.6" fill="#2A1B4D" stroke="#7B2CFF" strokeWidth="1.3" />
          <g transform="translate(96 66)">
            <ellipse cx="0" cy="0" rx="7.5" ry="6" fill="#F97316" />
            <path d="M0 -6 L1 -9" stroke="#16A34A" strokeWidth="1.8" strokeLinecap="round" />
            <path d="M-3.5 -1.5 L-1.5 -1.5 L-2.5 -3.2 Z M1.5 -1.5 L3.5 -1.5 L2.5 -3.2 Z M-3.5 2 Q0 4.5 3.5 2" fill="#0A0A12" stroke="#0A0A12" strokeWidth="0.8" strokeLinejoin="round" />
          </g>
        </g>
      )
  }
}
