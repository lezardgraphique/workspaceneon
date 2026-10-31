// Maily — the Neon Sandbox Pro mascot (see docs/design/maily-mascot.md):
// an envelope-drone with neon wings and dot-matrix eyes that change mood.

import { useId } from 'react'

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
  className = '',
}: {
  mood?: MailyMood
  size?: number
  bob?: boolean
  className?: string
}) {
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
      role="img"
      aria-label={`Maily (${mood === 'happy' ? 'contente' : mood === 'thinking' ? 'réfléchit' : 'succès'})`}
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
      <ellipse cx="60" cy="88" rx="22" ry="3" fill="#FF007F" opacity="0.35" className="maily-trail" />
      {/* wings */}
      <g filter={`url(#${glow})`}>
        <path
          className="maily-wing-l"
          d="M32 46 C18 30 6 30 4 40 C10 46 20 50 32 56 Z"
          fill="#FF007F"
          fillOpacity="0.28"
          stroke="#FF007F"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          className="maily-wing-r"
          d="M88 46 C102 30 114 30 116 40 C110 46 100 50 88 56 Z"
          fill="#FF007F"
          fillOpacity="0.28"
          stroke="#FF007F"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </g>
      {/* antenna */}
      <line x1="60" y1="30" x2="60" y2="20" stroke="#00E5FF" strokeWidth="2" strokeLinecap="round" />
      <circle cx="60" cy="17" r="3.5" fill="#FF007F" filter={`url(#${glow})`} className="maily-led" />
      {/* envelope body */}
      <rect x="30" y="30" width="60" height="44" rx="10" fill={`url(#${body})`} filter={`url(#${glow})`} />
      <path d="M33 71 L52 57 M87 71 L68 57" stroke="#0A0A12" strokeOpacity="0.35" strokeWidth="2" strokeLinecap="round" />
      {/* visor */}
      <rect x="38" y="38" width="44" height="18" rx="7" fill="#0A0A12" />
      <Eye x={44} mood={mood} />
      <Eye x={64} mood={mood} />
    </svg>
  )
}

export function NeonLogo({ size = 32 }: { size?: number }) {
  return <img src="/favicon.svg" width={size} height={size} alt="" aria-hidden="true" className="shrink-0" />
}
