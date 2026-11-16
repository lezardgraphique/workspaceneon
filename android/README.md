# Neon Sandbox Pro sur Google Play

L’app Android est une **Trusted Web Activity** : elle ouvre https://workspaceneon.netlify.app en plein écran, sans barre de navigateur, avec l’icône et l’écran de démarrage de Neon Sandbox. C’est le site lui-même : chaque mise en ligne du site met l’app à jour, sans nouvelle version sur le store. On ne republie l’app que pour changer son nom, son icône, ses couleurs ou sa version minimale d’Android.

- Identifiant de l’app (définitif après le premier envoi) : `com.lezardgraphique.neonsandbox`
- Android 7 (API 24) et plus, cible API 36 (exigée par Google Play depuis le 31 août 2026)
- Projet : `android/` · construction : GitHub Actions, workflow **Android** (`.github/workflows/android.yml`)

## 1. Clé d’envoi (une seule fois)

Google Play signe l’app avec sa propre clé (Play App Signing). Toi, tu signes seulement le fichier que tu envoies, avec ta **clé d’envoi** `upload.jks`.

- Garde `upload.jks` et son mot de passe en lieu sûr (gestionnaire de mots de passe). Ne les mets jamais dans le dépôt : il est public.
- Dans GitHub : dépôt → Settings → Secrets and variables → Actions → New repository secret, crée :
  - `ANDROID_KEYSTORE_BASE64` : le fichier en base64 (`base64 -w0 upload.jks`, ou `certutil -encode` sous Windows en retirant les lignes BEGIN/END)
  - `ANDROID_KEYSTORE_PASSWORD` et `ANDROID_KEY_PASSWORD` : le mot de passe
  - `ANDROID_KEY_ALIAS` : `neon-upload`
- Clé perdue ? Google Play permet d’en déclarer une nouvelle (Console → Intégrité de l’app → Demander la réinitialisation de la clé d’importation).

## 2. Construire le fichier .aab

GitHub → Actions → **Android** → Run workflow (indique la version, ex. `1.0.0`). Au bout de 5 à 10 minutes, télécharge `neon-sandbox-….aab` dans la section **Artifacts** du run. Le numéro de version interne (versionCode) augmente tout seul à chaque run. Les dépôts publics ont les minutes GitHub Actions gratuites.

## 3. Créer l’app dans la Play Console

1. Compte développeur : https://play.google.com/console (25 $ une fois, vérification d’identité).
2. Créer une application : nom « Neon Sandbox Pro », langue français, application, gratuite.
3. Fiche du store : textes de `android/STORE.md`, icône `android/store/icon-512.png`, image de présentation `android/store/feature-graphic-1024x500.png`, captures `android/store/screenshots/` (refais-les depuis ton téléphone si tu préfères, 2 à 8 captures).
4. Contenu de l’app : réponses prêtes dans `android/STORE.md` (règles de confidentialité, accès, publicité, classification, sécurité des données, suppression du compte).

## 4. Relier l’app au site (obligatoire, sinon une barre d’adresse s’affiche)

Le site publie `/.well-known/assetlinks.json` avec l’empreinte de la clé d’envoi. Après le premier envoi : Play Console → Intégrité de l’app → Signature de l’app → copie l’empreinte **SHA-256 du certificat de la clé de signature d’application**, et ajoute-la à `public/.well-known/assetlinks.json` (à côté de celle qui y est déjà), puis mets le site en ligne. Vérification : https://developers.google.com/digital-asset-links/tools/generator

## 5. Test fermé puis production

Un compte développeur **personnel** récent doit d’abord faire un test fermé avec **au moins 12 testeurs inscrits pendant 14 jours d’affilée** avant de pouvoir demander l’accès à la production. Ensuite : Production → Créer une version → envoyer le .aab → examen par Google (quelques jours).

## Plus tard : iOS

Apple refuse souvent une app qui ne fait qu’afficher un site (règle 4.2). La version iOS se fera avec Capacitor et des fonctions natives (partage, fichiers, notifications), compilée par un service en ligne (Codemagic) : compte Apple Developer requis (99 $/an).
