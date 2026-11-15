import { Link } from '@tanstack/react-router'

/** Link to the legal notice and privacy page, for page footers. */
export function LegalLink({ className = '' }: { className?: string }) {
  return (
    <Link to="/mentions-legales" className={`text-mute underline-offset-2 hover:text-white hover:underline ${className}`}>
      Mentions légales et confidentialité
    </Link>
  )
}
