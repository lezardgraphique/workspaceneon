# Sécurité

## Signaler une faille

Ne publie pas la faille dans une issue publique. Utilise l'onglet **Security → Report a vulnerability** du dépôt GitHub, ou écris directement au propriétaire du dépôt. Indique la page ou la route concernée, les étapes pour reproduire et l'impact observé.

## Modèle de menace

L'application n'a **pas d'authentification** : toute personne qui connaît l'URL peut voir et modifier les modules, les blocs et les fichiers. La sécurité vise donc ce qu'un visiteur (ou une page tierce) ne doit jamais pouvoir faire : exécuter du code dans le navigateur d'un autre utilisateur, faire agir son navigateur à son insu, saturer les services payants ou stocker des fichiers dangereux. Pour restreindre l'accès, active la protection par mot de passe de Netlify ou ajoute Netlify Identity.

## Mesures en place

| Risque | Mesure | Où |
| --- | --- | --- |
| XSS via le HTML des modules (texte, code libre, import) | Assainisseur à liste blanche (balises, attributs, URL, styles) appliqué à l'import, à l'affichage et avant stockage ; les variables HuBL (`{{ }}`, `{% %}`) sont préservées | `src/lib/sanitize.ts`, `hubl.ts`, `Preview.tsx` |
| Données stockées forgées (appel direct des serveurs de fonctions) | L'arbre d'un module ou d'un bloc est reconstruit bloc par bloc (types connus, valeurs bornées, couleurs/polices filtrées, URL sûres) | `src/lib/sanitize-tree.ts`, `src/server/*.functions.ts` |
| CSRF | Toute requête d'écriture doit venir du même site (`Sec-Fetch-Site`/`Origin`/`Referer`) | `src/start.ts` |
| Injection de scripts, clickjacking, MIME sniffing | `Content-Security-Policy`, `X-Frame-Options`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy` | `src/start.ts`, `netlify.toml` |
| Abus des API payantes ou de stockage | Limitation de débit par IP (IA 20/min, envois 30/min, écritures 240/min), tailles bornées | `src/server/rate-limit.ts` |
| Fichiers déguisés | Extensions en liste blanche, signature (octets magiques) vérifiée, pas de SVG ni de scripts, téléchargement forcé hors images/PDF, CSP `sandbox` | `api.files*.ts`, `api.images*.ts`, `upload-check.ts` |
| Sortie de l'IA | Réponses de réécriture assainies ; modules créés par Maily validés puis assainis au stockage ; rendu Markdown filtré (Streamdown) | `api.generate.ts` |
| Dépendances vulnérables | `pnpm audit --prod` propre (surcharges `seroval`, `katex`) | `package.json` |
| Secrets | Aucune clé dans le dépôt ; la clé Gemini est injectée par Netlify AI Gateway | — |

## Limites connues

- La limitation de débit est en mémoire, par instance serveur : c'est un frein, pas un pare-feu. Pour une protection complète, ajoute une règle de limitation Netlify.
- Les commentaires HTML (dont les conditionnels Outlook `<!--[if mso]>`) sont retirés des blocs texte et code libre par l'assainisseur.
- Les fichiers et images téléversés sont publics pour quiconque connaît leur adresse (nécessaire pour les e-mails).
- La CSP autorise `'unsafe-inline'` pour les scripts (amorçage du rendu serveur) ; elle sert de seconde barrière derrière l'assainisseur.

## Garder le projet à jour

Lance `pnpm audit --prod` avant chaque mise en production et mets à jour les dépendances signalées.
