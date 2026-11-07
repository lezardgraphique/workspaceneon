import { useEffect } from 'react'
import { HeadContent, Scripts, createRootRoute, redirect } from '@tanstack/react-router'

import { AuthLinkRedirect } from '@/components/AuthLinkRedirect'
import { OfflineManager } from '@/components/OfflineManager'
import { bindUser, isOffline } from '@/lib/data'
import { cachedUser, rememberUser } from '@/lib/session-cache'
import { bindSettingsUser } from '@/lib/settings-sync'
import { getSession } from '@/server/session.functions'

import '../styles.css'

const siteName = 'Neon Sandbox Pro'
const siteDescription =
  "L'éditeur de modules email et web avec synchronisation code ↔ visuel en temps réel, conversion de HTML en blocs modifiables, layouts multi-colonnes, cards imbriquées et Maily, l'assistante IA spécialisée en marketing, accessibilité et intégration email."

function ReducedMotionGuard() {
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      const reduced = media.matches || document.visibilityState === 'hidden'
      document.body.dataset.reducedMotion = String(reduced)
    }
    apply()
    const onVisibility = () => apply()
    document.addEventListener('visibilitychange', onVisibility)
    if (typeof media.addEventListener === 'function') media.addEventListener('change', onVisibility)
    else media.addListener(onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (typeof media.removeEventListener === 'function') media.removeEventListener('change', onVisibility)
      else media.removeListener(onVisibility)
    }
  }, [])
  return null
}

export const Route = createRootRoute({
  // The whole app is behind the sign-in page. This is only the front door:
  // every server function and API route checks the session again.
  beforeLoad: async ({ location }) => {
    let user: Awaited<ReturnType<typeof getSession>>
    const browser = typeof window !== 'undefined'
    const known = browser ? cachedUser() : null
    if (browser && known && isOffline()) {
      user = known // offline: the last signed-in account
    } else {
      try {
        user = await getSession()
        if (browser) rememberUser(user)
      } catch (e) {
        if (!known) throw e
        user = known
      }
    }
    if (browser) {
      bindUser(user?.id)
      bindSettingsUser(user?.id)
    }
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
      { rel: 'manifest', href: '/manifest.webmanifest' },
      { rel: 'apple-touch-icon', href: '/icon-192.png' },
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
        <ReducedMotionGuard />
        <AuthLinkRedirect />
        <OfflineManager />
        {children}
        <Scripts />
      </body>
    </html>
  )
}
