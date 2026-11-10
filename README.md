# Neon Sandbox Pro

[![Soutenir sur Ko-fi](https://img.shields.io/badge/Ko--fi-Soutenir-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/thomaslzg75)
[![Sécurité](https://github.com/lezardgraphique/workspaceneon/actions/workflows/securite.yml/badge.svg)](https://github.com/lezardgraphique/workspaceneon/actions/workflows/securite.yml)

Éditeur de modules e-mail (HTML + HuBL) dans le navigateur, sur ordinateur, tablette et téléphone, avec Maily, son assistante intégrée. En ligne sur **https://workspaceneon.netlify.app**.

C'est la version web de l'application Kotlin Multiplatform *workspace_neon* (seuls ses documents de design ont été repris, dans `docs/design/`).

## Ce que fait l'application

**Édition**
- Code et visuel synchronisés dans les deux sens : modifier le code met l'aperçu à jour, cliquer dans l'aperçu règle l'élément et régénère le code.
- Sections de 1 à 3 colonnes, cartes imbriquées (4 niveaux), glisser-déposer (appui long sur écran tactile), onglet Structure repliable avec recherche et clavier.
- Bloc HTML éditable sur place : le code collé s'affiche et chaque élément se modifie, se déplace ou se duplique sans perdre les commentaires Outlook ni la logique HuBL.
- Champs du module (comme le gestionnaire de design) : noms, libellés et valeurs, répéteurs, groupes, `fields.json` exact.
- Annuler / rétablir, enregistrement automatique.

**Import et export**
- Import de modules existants (code + `fields.json`) avec reconnaissance exacte des champs, des boucles, des macros et des anciennes balises ; JSON d'autres outils (Contentful, Strapi, Sanity, Prismic, Webflow, Directus, Builder.io, Airtable…).
- Export : `module.html`, `module.css`, `fields.json`, `meta.json` et un fichier HTML autonome pour tester.

**Qualité des e-mails**
- Test multi-messageries simulé (Outlook Windows, Gmail, Apple Mail, mode sombre, images bloquées) avec la liste des problèmes par bloc.
- Fenêtre VML pour Outlook : boutons arrondis, largeur et hauteur propres à Outlook, réglages fins par élément.
- Estimation indicative des clics et ouvertures par bloc, cartes prêtes à l'emploi (réseaux sociaux, vidéo, comptes à rebours, image dynamique).

**Maily**
- Conseils marketing, création ou modification d'un module entier, réécriture de textes, lecture de captures d'écran et de fichiers joints.
- Crée des modules et des blocs dans la bibliothèque, sans doublon.
- Tests internes de l'outil (« Lance les tests internes de l'outil ») et création des modules qui manquent à la bibliothèque, sur demande.
- Hors ligne : peut être téléchargée sur l'appareil, sinon répond aux questions sur l'application.

**Connexion IA (MCP)**
- Serveur MCP intégré : depuis « Mon compte », crée une connexion et colle son adresse dans Claude (connecteur personnalisé) ou dans un autre client MCP. L'IA peut lister, lire, créer et modifier tes modules et tes blocs, les exporter et tester leur rendu, jamais rien supprimer.

**Partout**
- Comptes personnels : chaque compte ne voit que ses modules, ses blocs et ses fichiers.
- Espace fichiers (10 Mo par fichier, 200 Mo par compte), images hébergées pour les e-mails.
- Fonctionne hors ligne (copie locale synchronisée au retour du réseau), préférences synchronisées entre appareils, sauvegarde / restauration en JSON.
- Installable comme application (raccourcis, widget Windows 11). Compatible iPhone et iPad à partir d'iOS 15.

## Technique

- TanStack Start (React 19, TanStack Router, fonctions serveur), Tailwind CSS 4, Vite
- Netlify Database (Postgres) avec Drizzle ORM, Netlify Blobs (images, fichiers), Netlify Identity (comptes)
- Netlify AI Gateway pour Maily en ligne (aucune clé dans le dépôt), WebAssembly / WebGPU pour Maily sur l'appareil
- Service worker et IndexedDB pour le mode hors ligne

## Lancer en local

```bash
pnpm install
netlify link                      # une fois : relie le dossier au site Netlify
NEON_DEV_USER=dev netlify dev     # http://localhost:8888
```

`netlify dev` émule la base de données, les blobs et AI Gateway (l'IA demande qu'au moins un déploiement de production existe). Netlify Identity ne fonctionne pas en local : `NEON_DEV_USER` simule un compte ; la variable est ignorée en production et retirée du build. La vraie connexion se teste sur un déploiement.

### Base de données

Le schéma est dans `db/schema.ts`. Après toute modification :

```bash
npx drizzle-kit generate --name <description_courte>
```

Les migrations de `netlify/database/migrations/` sont appliquées automatiquement au déploiement.

### Déploiement

Chaque envoi sur `main` est déployé par Netlify. Le workflow `Sécurité` (audit des dépendances, recherche de secrets, typage, build) tourne à chaque envoi, sur chaque demande de fusion et chaque jour.

## Documentation

- `AGENTS.md` : architecture détaillée et conventions (à lire avant de modifier le code).
- `SECURITY.md` : modèle de menace, protections en place et signalement d'une faille.
- `docs/import-field-mapping.md` : correspondance des champs à l'import.

## Design

Palette Deep Space `#0A0A12`, Neon Pink `#FF007F`, Cyber Blue `#00E5FF`, Neural Purple `#BC13FE` ; l'icône et Maily, la mascotte, viennent des documents de design du projet d'origine (`docs/design/`).
