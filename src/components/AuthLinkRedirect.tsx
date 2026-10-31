import { useEffect } from 'react'

// Links in Netlify's e-mails (confirmation, password reset, invitation) open the
// site root with a token in the URL hash. Whatever page they land on, the
// sign-in page is the one that knows how to use it.
const TOKEN = /(?:^|[#&])(confirmation_token|recovery_token|invite_token|email_change_token|access_token)=/

export function AuthLinkRedirect() {
  useEffect(() => {
    if (window.location.pathname.startsWith('/connexion')) return
    if (TOKEN.test(window.location.hash)) window.location.replace(`/connexion${window.location.hash}`)
  }, [])
  return null
}
