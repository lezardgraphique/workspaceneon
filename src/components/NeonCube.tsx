import { useEffect, useRef } from 'react'

// The app logo (the cube of favicon.svg) drawn as a neon sign, for the
// background of the home and sign-in screens. Purely decorative: hidden from
// assistive tech and never catches a click.
//
// The glow is baked into the drawing (each line drawn three times, wide and
// faint under thin and bright) instead of a CSS/SVG blur, so low-end phones
// never recompute a large blur. Only `opacity` (and `transform` for the slow
// spin) is animated, both handled by the compositor.
//
// Lighting: the first time per visit (sessionStorage) the sign flickers on like
// a real neon tube; afterwards it simply fades in. Reduced motion: shown at once.
// The final strength comes from the `--neon-o` custom property set by the page.

const LIT_KEY = 'nsp-neon-lit'

const SQUIRCLE = 'M134 6H378A128 128 0 0 1 506 134V378A128 128 0 0 1 378 506H134A128 128 0 0 1 6 378V134A128 128 0 0 1 134 6Z'
const CUBE = 'M256 120L380 190V330L256 400L132 330V190Z'
const EDGES = 'M256 120V260L380 190M256 260L132 190M256 260V400'
const CHEVRONS = 'M200 230L170 260L200 290M312 230L342 260L312 290'

// [path, colour, core width, extra attributes]
const LINES: [string, string, number, { opacity?: number }][] = [
  [SQUIRCLE, '#bc13fe', 5, { opacity: 0.7 }],
  [CUBE, '#00e5ff', 8, {}],
  [EDGES, '#00e5ff', 4, { opacity: 0.65 }],
  [CHEVRONS, '#ff007f', 11, {}],
]

// Decided once per visit. Signs mounted together (two on one screen, React's
// double effect run in development) agree; a sign shown later in the same visit
// (another screen opened in the app) only fades in.
let litAt = 0
let firstLight = false
function isFirstLight() {
  const now = Date.now()
  if (litAt && now - litAt < 1000) return firstLight
  if (litAt) return false
  litAt = now
  try {
    firstLight = sessionStorage.getItem(LIT_KEY) !== '1'
    sessionStorage.setItem(LIT_KEY, '1')
  } catch {
    // Storage blocked (private mode…): always a plain fade-in.
    firstLight = false
  }
  return firstLight
}

export function NeonCube({ className = '' }: { className?: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    ref.current?.setAttribute('data-lit', isFirstLight() ? 'first' : 'again')
  }, [])

  return (
    <svg
      ref={ref}
      viewBox="0 0 512 512"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={`neon-cube pointer-events-none select-none ${className}`}
    >
      <g strokeLinecap="round" strokeLinejoin="round">
        {LINES.map(([d, color, w, extra]) => (
          <g key={d} stroke={color} {...extra}>
            <path d={d} strokeWidth={w * 5} strokeOpacity={0.07} />
            <path d={d} strokeWidth={w * 2.4} strokeOpacity={0.18} />
            <path d={d} strokeWidth={w} />
          </g>
        ))}
        {/* Neural core: outline only, like the rest of the sign */}
        <g stroke="#bc13fe">
          <circle cx="256" cy="260" r="40" strokeWidth={40} strokeOpacity={0.07} />
          <circle cx="256" cy="260" r="40" strokeWidth={19} strokeOpacity={0.18} />
          <circle cx="256" cy="260" r="40" strokeWidth={8} />
        </g>
      </g>
    </svg>
  )
}
