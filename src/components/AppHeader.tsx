import type { ReactNode } from 'react'
import { Link } from '@tanstack/react-router'

import { NeonLogo } from '@/components/Maily'

// Top bar of the library, files and account pages. On a phone the title shrinks
// and the buttons keep only their icon so nothing ever scrolls sideways.
export function AppHeader({ web, children }: { web?: boolean; children?: ReactNode }) {
  return (
    <header className="mx-auto flex max-w-6xl items-center gap-2 px-3 py-4 sm:gap-3 sm:px-6 sm:py-5">
      <Link to="/" className="flex min-w-0 items-center gap-2 sm:gap-3" aria-label="Neon Sandbox Pro, retour à Mes modules">
        <NeonLogo size={30} />
        <span className="truncate font-display text-sm font-semibold tracking-wide whitespace-nowrap min-[380px]:text-[15px] sm:text-lg">
          Neon Sandbox <span className="text-pink">Pro</span>
        </span>
      </Link>
      {web && <span className="ml-1 hidden rounded border border-line px-1.5 py-0.5 font-mono text-[10px] text-mute sm:inline">WEB</span>}
      <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">{children}</div>
    </header>
  )
}

// Shared look of the header buttons (icon only on a phone).
export const headerButton =
  'inline-flex items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-sm text-mute sm:px-3'
