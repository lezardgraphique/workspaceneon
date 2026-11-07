# Sécurité

## Signaler une faille

Ne publie pas la faille dans une issue publique. Utilise l'onglet **Security → Report a vulnerability** du dépôt GitHub, ou écris directement au propriétaire du dépôt. Indique la page ou la route concernée, les étapes pour reproduire et l'impact observé.

## Modèle de menace

L'accès se fait par **compte** (Netlify Identity : e-mail et mot de passe, confirmation par e-mail, récupération du mot de passe). Chaque module, bloc personnalisé et fichier appartient à un compte et personne d'autre ne peut le lire, le modifier ni le supprimer. La sécurité vise aussi ce qu'un visiteur (ou une page tierce) ne doit jamais pouvoir faire : exécuter du code dans le navigateur d'un autre utilisateur, faire agir son navigateur à son insu, saturer les services payants ou stocker des fichiers dangereux.

Réglages Netlify à connaître (tableau de bord, *Identity*) : **Registration** en *Invite only* pour réserver l'application à des personnes invitées (sinon n'importe qui peut créer un compte, mais il n'accède qu'à son propre espace) ; *Confirmation* des e-mails activée.

## Mesures en place

| Risque | Mesure | Où |
| --- | --- | --- |
| Accès aux données d'autrui | Session Netlify Identity vérifiée côté serveur à chaque appel ; toutes les requêtes sont filtrées par `user_id` ; un identifiant étranger se comporte comme un identifiant inexistant ; clés de fichiers préfixées par l'empreinte du propriétaire | `src/server/auth.server.ts`, `*.functions.ts`, `file-owner.ts` |
| XSS via le HTML des modules (texte, code libre, import) | Assainisseur à liste blanche (balises, attributs, URL, styles) appliqué à l'import, à l'affichage et avant stockage ; les variables HuBL (`{{ }}`, `{% %}`) sont préservées | `src/lib/sanitize.ts`, `hubl.ts`, `Preview.tsx` |
| Données stockées forgées (appel direct des serveurs de fonctions) | L'arbre d'un module ou d'un bloc est reconstruit bloc par bloc (types connus, valeurs bornées, couleurs/polices filtrées, URL sûres) | `src/lib/sanitize-tree.ts`, `src/server/*.functions.ts` |
| CSRF | Toute requête d'écriture doit venir du même site (`Sec-Fetch-Site`/`Origin`/`Referer`) | `src/start.ts` |
| Injection de scripts, clickjacking, MIME sniffing | `Content-Security-Policy`, `X-Frame-Options`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy` | `src/start.ts`, `netlify.toml` |
| Abus des API payantes ou de stockage | Limitation Netlify au niveau plateforme (`/api/maily` 20/min, `/api/*` 120/min par IP) + limitation applicative par IP (IA 20/min, envois 30/min, écritures 240/min), tailles bornées | `netlify.toml`, `src/server/rate-limit.ts` |
| Fichiers déguisés | Extensions en liste blanche, signature (octets magiques) vérifiée, pas de SVG ni de scripts, téléchargement forcé hors images/PDF, CSP `sandbox` | `api.files*.ts`, `api.images*.ts`, `upload-check.ts` |
| Sortie de l'IA | Réponses de réécriture assainies ; modules créés par Maily validés puis assainis au stockage ; rendu Markdown filtré (Streamdown) | `api.generate.ts` |
| IA sur l'appareil (Maily hors ligne) | Activée seulement à la demande ; sa sortie suit le même chemin que celle de Gemini (blocs `neon` validés par `validateModuleCode`, puis `sanitizeTree` au stockage, Markdown filtré) ; la CSP n'ouvre en plus que `wasm-unsafe-eval` (WebAssembly, pas d'`eval` JS) et, en `connect-src`, Hugging Face et `raw.githubusercontent.com` pour le téléchargement du modèle Gemma | `src/lib/offline-ai.ts`, `src/start.ts` |
| Dépendances vulnérables | `pnpm audit --prod` propre (surcharges `seroval`, `katex`) | `package.json` |
| Secrets | Aucune clé dans le dépôt ; la clé Gemini est injectée par Netlify AI Gateway | — |

- `/countdown.gif` est public (chargé par les messageries) : la date doit être un horodatage entre 2020 et 2100, les couleurs 6 chiffres hexadécimaux, sinon 400 ; toutes les autres options (taille, arrondi, unités, langue, message de fin limité aux caractères que la police sait dessiner) sont bornées ou ignorées ; le GIF est dessiné à la volée (~25 ms), mis en cache 2 s et limité à 300 requêtes par minute et par IP. Il ne lit ni n'écrit aucune donnée.
- Les champs de module (`tree.fields`) sont reconstruits côté serveur à l'enregistrement : noms, types et valeurs par défaut filtrés comme le reste de l'arbre.

## Copie locale (hors ligne)

Les modules, blocs et pages de l'application sont copiés dans le navigateur (IndexedDB, Cache Storage, dernier compte dans `localStorage`) pour le mode hors ligne. Ces copies sont effacées à la déconnexion et quand un autre compte se connecte ; sur un appareil partagé, se déconnecter est donc nécessaire. Un fichier de sauvegarde exporté contient tous les modules en clair : à garder comme un document privé. À l'import, chaque arbre est nettoyé (`sanitizeTree`) avant d'être affiché ou envoyé.

## Limites connues

- La limitation de débit est en mémoire, par instance serveur : c'est un frein, pas un pare-feu. Pour une protection complète, ajoute une règle de limitation Netlify.
- Les commentaires HTML (dont les conditionnels Outlook `<!--[if mso]>`) sont retirés des blocs texte et code libre par l'assainisseur.
- Les fichiers et images téléversés sont servis sans connexion à qui connaît leur adresse (nécessaire pour qu'ils s'affichent dans les e-mails) ; les adresses sont aléatoires et la liste des fichiers est privée.
- Les données créées avant l'arrivée des comptes sont attribuées une seule fois à un compte : celui de `LEGACY_OWNER_EMAIL` si cette variable d'environnement est définie, sinon le premier compte qui ouvre l'application.
- Une session ouverte reste valide environ une heure avant renouvellement ; supprimer un compte dans Netlify Identity ne coupe pas instantanément une session déjà émise.
- La CSP autorise `'unsafe-inline'` pour les scripts (amorçage du rendu serveur) ; elle sert de seconde barrière derrière l'assainisseur.

## Garder le projet à jour

- Dependabot (`.github/dependabot.yml`) ouvre chaque lundi une demande de mise à jour groupée des dépendances.
- Le workflow `.github/workflows/securite.yml` lance `pnpm audit --audit-level=high`, le typage et le build à chaque envoi, sur chaque demande de fusion et chaque lundi ; il échoue dès qu'une faille haute ou critique est connue.
- Les alertes restantes de gravité faible viennent d'outils de développement (`@netlify/dev`) sans correctif publié ; elles ne sont pas embarquées dans l'application en ligne.
- Avant une mise en production, lance aussi `pnpm audit` à la main.
