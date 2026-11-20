import { Link } from '@tanstack/react-router'

/** Link to the legal notice and privacy page, for page footers. */
export function LegalLink({ className = '' }: { className?: string }) {
  return (
    <Link to="/mentions-legales" className={`text-mute underline-offset-2 hover:text-white hover:underline ${className}`}>
      Mentions légales et confidentialité
    </Link>
  )
}

// The site is one of LZG's projects: a discreet credit linking to the LZG Paris
// site (portfolio), shown at the bottom of the public pages.
export const LZG_URL = 'https://lzgparis.webflow.io/'

export function ByLzg({ className = '' }: { className?: string }) {
  return (
    <a href={LZG_URL} target="_blank" rel="noopener" className={`text-mute underline-offset-2 hover:text-pink hover:underline ${className}`}>
      par <span className="font-semibold tracking-wide">LZG</span>
    </a>
  )
}
