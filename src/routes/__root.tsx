import { HeadContent, Scripts, createRootRoute, redirect } from '@tanstack/react-router'

import { AuthLinkRedirect } from '@/components/AuthLinkRedirect'
import { getSession } from '@/server/session.functions'

import '../styles.css'

const siteName = 'Neon Sandbox Pro'
const siteDescription =
  "L'éditeur de modules email et web avec synchronisation code ↔ visuel en temps réel, conversion de HTML en blocs modifiables, layouts multi-colonnes, cards imbriquées et Maily, l'assistante IA marketing."

export const Route = createRootRoute({
  // The whole app is behind the sign-in page. This is only the front door:
  // every server function and API route checks the session again.
  beforeLoad: async ({ location }) => {
    const user = await getSession()
    if (!user && !location.pathname.startsWith('/connexion')) throw redirect({ to: '/connexion' })
    return { user }
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content' },
      { title: siteName },
      { name: 'description', content: siteDescription },
      { property: 'og:title', content: siteName },
      { property: 'og:description', content: siteDescription },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'theme-color', content: '#0a0a12' },
    ],
    links: [
      { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap',
      },
    ],
  }),
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <head>
        <HeadContent />
      </head>
      <body>
        <AuthLinkRedirect />
        {children}
        <Scripts />
      </body>
    </html>
  )
}
