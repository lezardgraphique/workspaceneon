import { Link, createFileRoute, useRouteContext } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

import { AppHeader } from '@/components/AppHeader'
import { KOFI_URL } from '@/lib/links'

// Public page (no account needed): legal notice (LCEN art. 6 III) and the
// privacy policy (RGPD art. 13). Keep it in step with what the code really
// sends where: Netlify (hosting, accounts, data), Google Gemini through the
// Netlify AI Gateway (Maily), Have I Been Pwned (5 hash characters),
// Hugging Face (offline model, on request), the security journal (30 days).
export const Route = createFileRoute('/mentions-legales')({
  head: () => ({
    meta: [
      { title: 'Mentions légales et confidentialité · Neon Sandbox Pro' },
      { name: 'description', content: 'Éditeur, hébergeur, données traitées par Neon Sandbox Pro, destinataires, durées de conservation et droits RGPD.' },
    ],
    links: [{ rel: 'canonical', href: 'https://workspaceneon.netlify.app/mentions-legales' }],
  }),
  component: MentionsLegales,
})

const UPDATED = '15 novembre 2026'

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10">
      <h2 id={id} className="font-display text-xl font-semibold text-white">
        {title}
      </h2>
      <div className="mt-3 space-y-3 leading-relaxed text-[#d9d9ec]">{children}</div>
    </section>
  )
}

const ext = 'text-cyan underline-offset-2 hover:underline'

function MentionsLegales() {
  const user = useRouteContext({ from: '__root__', select: (c) => c.user })
  return (
    <div className="min-h-screen">
      <AppHeader>
        <Link to={user ? '/' : '/connexion'} className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-sm text-mute hover:border-cyan hover:text-white">
          <ArrowLeft className="size-4" aria-hidden /> {user ? 'Mes modules' : 'Connexion'}
        </Link>
      </AppHeader>

      <main id="contenu" className="mx-auto max-w-3xl px-4 py-10 text-[15px] sm:px-6">
        <h1 className="font-display text-3xl font-bold">Mentions légales et confidentialité</h1>
        <p className="mt-2 text-sm text-mute">Mise à jour : {UPDATED}</p>

        <Section id="editeur" title="Éditeur du site">
          <p>
            Neon Sandbox Pro est édité à titre personnel par <strong className="text-white">Thomas Champeau</strong>, particulier, directeur de la publication.
          </p>
          <p>
            Contact : par le formulaire « Laisser un commentaire » de la page{' '}
            <a href={KOFI_URL} target="_blank" rel="noreferrer" className={ext}>
              ko-fi.com/thomaslzg75
            </a>
            . Les coordonnées personnelles de l'éditeur ont été communiquées à l'hébergeur, comme le permet l'article 6 III-2 de la loi n° 2004-575 du 21 juin 2004 (LCEN).
          </p>
        </Section>

        <Section id="hebergeur" title="Hébergement">
          <p>
            Netlify, Inc., 101 2nd Street, San Francisco, CA 94105, États-Unis ·{' '}
            <a href="https://www.netlify.com" target="_blank" rel="noreferrer" className={ext}>
              netlify.com
            </a>
            . Le site, les comptes, les modules, les fichiers et la base de données sont hébergés par Netlify.
          </p>
        </Section>

        <Section id="donnees" title="Données personnelles traitées">
          <p>Le responsable du traitement est l'éditeur. Le site ne traite que ce qui sert à son fonctionnement :</p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <strong className="text-white">Ton compte</strong> : adresse e-mail et mot de passe (chiffré, jamais lisible), gérés par Netlify Identity. Base : l'exécution du service que tu
              demandes (art. 6.1.b RGPD). Conservés tant que le compte existe.
            </li>
            <li>
              <strong className="text-white">Ton contenu</strong> : modules, blocs enregistrés, réglages, images et fichiers que tu déposes. Ils ne sont visibles que de ton compte, sauf les
              aperçus que tu choisis de partager. Conservés tant que tu ne les supprimes pas.
            </li>
            <li>
              <strong className="text-white">Maily, l'assistante IA</strong> : quand tu lui écris (ou demandes une génération), ton message et le code utile du module sont envoyés à Google
              Gemini par l'AI Gateway de Netlify, pour produire la réponse. Rien n'est envoyé si tu ne la sollicites pas. Le mode hors ligne, lui, fonctionne entièrement sur ton appareil.
            </li>
            <li>
              <strong className="text-white">Vérification des mots de passe</strong> : à la création d'un mot de passe, seuls les 5 premiers caractères de son empreinte SHA-1 sont envoyés à
              Have I Been Pwned (méthode k-anonymat) : ni le mot de passe ni ton e-mail ne quittent le site.
            </li>
            <li>
              <strong className="text-white">Sécurité du site</strong> : les requêtes suspectes ou malveillantes sont consignées (adresse IP, page demandée, logiciel, date) pour bloquer les
              attaques. Base : intérêt légitime à protéger le service (art. 6.1.f). Effacées au bout de 30 jours.
            </li>
            <li>
              <strong className="text-white">Sur ton appareil</strong> : la session de connexion, la copie de tes modules et le cache pour le mode hors ligne (stockage du navigateur). Ce sont des éléments
              strictement nécessaires, sans consentement à recueillir.
            </li>
          </ul>
          <p>
            Aucun cookie publicitaire, aucune mesure d'audience, aucun traceur tiers. Les polices sont servies par le site lui-même. Le modèle d'IA hors ligne n'est téléchargé depuis Hugging
            Face que si tu le demandes.
          </p>
        </Section>

        <Section id="destinataires" title="Destinataires et transferts">
          <p>
            Les seuls destinataires sont les prestataires techniques cités : Netlify (hébergement, comptes, AI Gateway) et Google (Gemini, pour les réponses de Maily). Ils sont établis aux
            États-Unis ; les transferts reposent sur le cadre de protection des données UE–États-Unis (Data Privacy Framework) et les clauses contractuelles types de la Commission
            européenne. Tes données ne sont ni vendues ni utilisées à des fins publicitaires.
          </p>
        </Section>

        <Section id="droits" title="Tes droits">
          <p>
            Tu peux accéder à tes données, les rectifier, les effacer, les exporter (sauvegarde depuis « Mes modules ») ou t'opposer à un traitement, en écrivant par la page Ko-fi
            ci-dessus. Tu peux aussi supprimer toi-même tes modules et tes fichiers à tout moment. En cas de désaccord, tu peux saisir la CNIL (
            <a href="https://www.cnil.fr/fr/plaintes" target="_blank" rel="noreferrer" className={ext}>
              cnil.fr
            </a>
            ).
          </p>
        </Section>

        <Section id="propriete" title="Propriété intellectuelle">
          <p>
            Le code du site est publié sur GitHub. Les modules, textes et images que tu crées restent les tiens. Les marques citées (HubSpot, Netlify, Google…) appartiennent à leurs
            propriétaires.
          </p>
        </Section>
      </main>
    </div>
  )
}
