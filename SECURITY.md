# Sécurité

## Signaler une faille

Ne publie pas la faille dans une issue publique. Utilise l'onglet **Security → Report a vulnerability** du dépôt GitHub, ou écris directement au propriétaire du dépôt. Indique la page ou la route concernée, les étapes pour reproduire et l'impact observé.

## Modèle de menace

L'accès se fait par **compte** (Netlify Identity : e-mail et mot de passe, confirmation par e-mail, récupération du mot de passe). Chaque module, bloc personnalisé et fichier appartient à un compte et personne d'autre ne peut le lire, le modifier ni le supprimer. La sécurité vise aussi ce qu'un visiteur (ou une page tierce) ne doit jamais pouvoir faire : exécuter du code dans le navigateur d'un autre utilisateur, faire agir son navigateur à son insu, saturer les services payants ou stocker des fichiers dangereux.

Réglages Netlify à connaître (tableau de bord, *Identity*) : **Registration** en *Invite only* pour réserver l'application à des personnes invitées (sinon n'importe qui peut créer un compte, mais il n'accède qu'à son propre espace) ; *Confirmation* des e-mails activée.

## Serveur MCP (connexion d'une IA)

- `/mcp/…` laisse une IA (Claude…) lister, lire, créer et modifier les modules et blocs d'un compte, les exporter et les auditer. **Aucune suppression possible**.
- Accès par **jeton personnel** uniquement (créé dans « Mon compte », affiché une seule fois, 32 octets aléatoires, seule son empreinte SHA-256 est stockée, révocable, 10 au plus) : dans l'adresse (`/mcp/<jeton>`, les connecteurs de claude.ai ne prennent qu'une URL) ou en `Authorization: Bearer`. Le cookie de session n'y est jamais accepté : une page web ne peut pas s'en servir à la place d'un visiteur, d'où l'exemption de la vérification CSRF sur ce seul chemin.
- Tout ce qui est écrit passe par les mêmes contrôles que l'éditeur (validateur, `sanitizeTree`, tailles maximales) ; chaque requête est limitée au compte du jeton ; 120 appels par minute et par jeton.
- Le jeton figurant dans l'adresse peut apparaître dans les journaux de Netlify (visibles par le seul propriétaire du site) : révoque-le et crée-en un autre au moindre doute.

## Connexion et mots de passe

- **Nouveaux mots de passe** (création de compte, invitation, réinitialisation) : 12 caractères minimum, 72 octets maximum (au-delà, le hachage bcrypt de Netlify Identity ignorerait la fin), pas trop répétitif, pas l'adresse e-mail, pas un mot de passe courant ; indicateur de solidité. Recommandations ANSSI et NIST SP 800-63B : la longueur compte, pas de règles de composition imposées.
- **Fuites connues** : le mot de passe est comparé à la base *Have I Been Pwned* par k-anonymat : seuls les 5 premiers caractères de son empreinte SHA-1 quittent le navigateur, jamais le mot de passe. Refusé s'il apparaît dans une fuite ; si le service ne répond pas (4 s, hors ligne), le mot de passe passe.
- **Essais répétés** : sur un appareil, à partir du 5ᵉ mot de passe refusé, attente de 30 s, doublée à chaque nouvel échec (15 min au plus). Netlify Identity applique aussi sa propre limite côté serveur.
- **Pas d'énumération des comptes** : « Mot de passe oublié » donne la même réponse que l'adresse ait un compte ou non.
- **Liens reçus par e-mail** : le jeton est retiré de la barre d'adresse et de l'historique dès qu'il est lu.
- **Session** : le jeton (cookie `nf_jwt`, environ une heure, renouvelé) est vérifié côté serveur à chaque appel ; la déconnexion efface aussi la copie locale.
- **Cache** : les pages et les réponses des fonctions serveur sont marquées `Cache-Control: private, no-cache` : aucun cache partagé (CDN, proxy) ne garde les données d'un compte.
- **Données d'avant les comptes** : attribuées uniquement au compte `LEGACY_OWNER_EMAIL` (sans cette variable, à personne).

## Mesures en place

| Risque | Mesure | Où |
| --- | --- | --- |
| Accès aux données d'autrui | Session Netlify Identity vérifiée côté serveur à chaque appel ; toutes les requêtes sont filtrées par `user_id` ; un identifiant étranger se comporte comme un identifiant inexistant ; clés de fichiers préfixées par l'empreinte du propriétaire | `src/server/auth.server.ts`, `*.functions.ts`, `file-owner.ts` |
| XSS via le HTML des modules (texte, code libre, import) | Assainisseur à liste blanche (balises, attributs, URL, styles) appliqué à l'import, à l'affichage et avant stockage ; les variables HuBL (`{{ }}`, `{% %}`) sont préservées | `src/lib/sanitize.ts`, `hubl.ts`, `Preview.tsx` |
| Données stockées forgées (appel direct des serveurs de fonctions) | L'arbre d'un module ou d'un bloc est reconstruit bloc par bloc (types connus, valeurs bornées, couleurs/polices filtrées, URL sûres) | `src/lib/sanitize-tree.ts`, `src/server/*.functions.ts` |
| CSRF | Toute requête d'écriture doit venir du même site (`Sec-Fetch-Site`/`Origin`/`Referer`), sauf `/mcp/` qui n'accepte qu'un jeton personnel | `src/start.ts` |
| Accès d'une IA au compte | Jetons personnels hachés, révocables, sans droit de suppression, limités en débit | `src/routes/mcp.$.ts`, `src/server/api-tokens.server.ts` |
| Mots de passe faibles ou divulgués, essais en série | Règles de longueur, vérification *Have I Been Pwned* (k-anonymat), attente croissante après 5 échecs, réponse identique pour « mot de passe oublié » | `src/lib/password.ts`, `src/routes/connexion.tsx` |
| Redirection vers un autre site | Les adresses internes passées en paramètre (`offline-go`) doivent être un chemin du site (`//` et `/\` refusés) | `src/components/OfflineManager.tsx` |
| Injection de scripts, clickjacking, MIME sniffing | `Content-Security-Policy`, `X-Frame-Options`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy` | `src/start.ts`, `netlify.toml` |
| Abus des API payantes ou de stockage | Limitation Netlify au niveau plateforme (`/api/maily` 20/min, `/api/*` 120/min par IP) + limitation applicative par IP (IA 20/min, envois 30/min, écritures 240/min), tailles bornées | `netlify.toml`, `src/server/rate-limit.ts` |
| Fichiers déguisés | Extensions en liste blanche, signature (octets magiques) vérifiée, pas de SVG ni de scripts, téléchargement forcé hors images/PDF, CSP `sandbox` | `api.files*.ts`, `api.images*.ts`, `upload-check.ts` |
| Sortie de l'IA | Réponses de réécriture assainies ; modules créés par Maily validés puis assainis au stockage ; rendu Markdown filtré (Streamdown) | `api.generate.ts` |
| IA sur l'appareil (Maily hors ligne) | Activée seulement à la demande ; sa sortie suit le même chemin que celle de Gemini (blocs `neon` validés par `validateModuleCode`, puis `sanitizeTree` au stockage, Markdown filtré) ; la CSP n'ouvre en plus que `wasm-unsafe-eval` (WebAssembly, pas d'`eval` JS) et, en `connect-src`, Hugging Face et `raw.githubusercontent.com` pour le téléchargement du modèle Gemma | `src/lib/offline-ai.ts`, `src/start.ts` |
| Dépendances vulnérables | `pnpm audit --prod` propre (surcharges `seroval`, `katex`) | `package.json` |
| Secrets | Aucune clé dans le dépôt ; la clé Gemini est injectée par Netlify AI Gateway | — |

- `/countdown.gif` est public (chargé par les messageries) : la date doit être un horodatage entre 2020 et 2100, les couleurs 6 chiffres hexadécimaux, sinon 400 ; toutes les autres options (taille, arrondi, unités, langue, message de fin limité aux caractères que la police sait dessiner) sont bornées ou ignorées ; le GIF est dessiné à la volée (~25 ms), mis en cache 2 s et limité à 300 requêtes par minute et par IP. Il ne lit ni n'écrit aucune donnée.
- Les champs de module (`tree.fields`) sont reconstruits côté serveur à l'enregistrement : noms, types et valeurs par défaut filtrés comme le reste de l'arbre.

## Pare-feu et garde IA

- **Pare-feu dans le site** (`src/server/firewall.server.ts`, premier middleware de `src/start.ts`) : refuse (403) sans attendre les attaques sans ambiguïté — sondes de fichiers (`.env`, `.git`, `.php`, `wp-login`…), traversée de répertoires, injections SQL / XSS / commandes / Log4Shell dans l'adresse, outils de piratage connus (sqlmap, nikto, nuclei…). Seules l'adresse et le User-Agent sont lus : jamais le contenu des requêtes ni les données des fonctions serveur, qui contiennent légitimement du HTML.
- **Bannissement automatique prudent** : 3 attaques en 10 minutes depuis une adresse la bloquent 24 h. Une adresse privée n'est jamais bannie, et une personne connectée n'est jamais bloquée par son adresse (bureau, réseau mobile partagés).
- **Journal** (`security_events`, 30 jours) : attaques, abus (limites de débit dépassées) et pages introuvables, limité à une ligne par minute et par adresse pour les abus.
- **Analyse IA quotidienne** (`src/server/security-ai.server.ts`, fonction planifiée `netlify/functions/securite-quotidienne.mts`) : Gemini, via Netlify AI Gateway, relit les 24 dernières heures et propose des blocages. Des garde-fous écrits dans le code, et non laissés à l'IA, filtrent ses propositions : seulement ce qui figure dans le journal, jamais une page du site, un navigateur, un moteur de recherche ni une adresse privée, jamais ce qui a déjà été refusé ou levé. Seule une adresse qui a déjà attaqué au moins 2 fois peut être bloquée sans validation, et pour 7 jours au plus. Tout le reste attend la décision de l'administrateur.
- **Page « Sécurité du site »** (Compte), réservée au compte dont l'e-mail est `SECURITY_ADMIN_EMAIL` (ou `LEGACY_OWNER_EMAIL`) : chiffres sur 24 h, rapport de l'IA, propositions à valider ou ignorer, blocages à lever, journal et blocage d'une adresse en un clic (sauf la sienne). Sans cette variable, la page n'apparaît pour personne. Le pare-feu et l'analyse fonctionnent quand même.
- Si la base ou l'IA ne répondent pas, le site continue de répondre et les signatures continuent de bloquer : la garde ne peut pas mettre le site hors ligne.

## Copie locale (hors ligne)

Les modules, blocs et pages de l'application sont copiés dans le navigateur (IndexedDB, Cache Storage, dernier compte dans `localStorage`) pour le mode hors ligne. Ces copies sont effacées à la déconnexion et quand un autre compte se connecte ; sur un appareil partagé, se déconnecter est donc nécessaire. Un fichier de sauvegarde exporté contient tous les modules en clair : à garder comme un document privé. À l'import, chaque arbre est nettoyé (`sanitizeTree`) avant d'être affiché ou envoyé.

## Limites connues

- La limitation de débit est en mémoire, par instance serveur : c'est un frein, pas un pare-feu. Pour une protection complète, ajoute une règle de limitation Netlify.
- Les commentaires HTML (dont les conditionnels Outlook `<!--[if mso]>`) sont retirés des blocs texte et code libre par l'assainisseur.
- Les fichiers et images téléversés sont servis sans connexion à qui connaît leur adresse (nécessaire pour qu'ils s'affichent dans les e-mails) ; les adresses sont aléatoires et la liste des fichiers est privée.
- Les données créées avant l'arrivée des comptes sont attribuées une seule fois, au compte de `LEGACY_OWNER_EMAIL` uniquement (déjà fait si l'attribution a eu lieu avant ce changement).
- Le cookie de session est posé par la bibliothèque Netlify Identity dans le navigateur, donc lisible par un script de la page : l'assainisseur et la CSP sont ce qui empêche un script étranger d'y accéder.
- Changer de mot de passe ne déconnecte pas les autres appareils déjà connectés (limite de Netlify Identity) : leur session expire au plus tard au prochain renouvellement refusé.
- L'attente après des échecs de connexion est propre à l'appareil ; contre un robot, c'est la limite de Netlify Identity qui protège. L'authentification à deux facteurs n'est pas proposée par Netlify Identity.
- Une session ouverte reste valide environ une heure avant renouvellement ; supprimer un compte dans Netlify Identity ne coupe pas instantanément une session déjà émise.
- La CSP autorise `'unsafe-inline'` pour les scripts (amorçage du rendu serveur) ; elle sert de seconde barrière derrière l'assainisseur.

## Garder le projet à jour

- Dependabot (`.github/dependabot.yml`) ouvre chaque lundi une demande de mise à jour groupée des dépendances.
- Le workflow `.github/workflows/securite.yml` lance `pnpm audit --audit-level=high`, le typage et le build à chaque envoi, sur chaque demande de fusion et chaque jour, avec une recherche de secrets (gitleaks) et le contrôle des dépendances ajoutées par une demande de fusion ; il échoue dès qu'une faille haute ou critique est connue.
- Les alertes restantes de gravité faible viennent d'outils de développement (`@netlify/dev`) sans correctif publié ; elles ne sont pas embarquées dans l'application en ligne.
- Avant une mise en production, lance aussi `pnpm audit` à la main.
