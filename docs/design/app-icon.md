# Design de l'Icône : Neon Sandbox Pro

L'icône a été conçue pour refléter la fusion entre la structure modulaire (Sandbox) et l'intelligence artificielle (Neural Gemini).

## Concept Visuel
- **La Base** : Un carré aux coins arrondis (Squircle) en dégradé de noir profond (#0F0F1A) vers un bleu nuit (#1A1A2E).
- **Le Symbole Central** : Un cube isométrique stylisé évoquant une "Card" ou un module.
- **L'Éclat Neural** : Un cœur pulsant en néon violet (#BC13FE) et bleu électrique (#00E5FF) qui s'échappe des bords du cube, symbolisant l'IA qui donne vie au code.
- **L'Accent Code** : Deux chevrons discrets `< >` intégrés dans les facettes du cube pour rappeler l'export HuBL/HTML.

## Palette de Couleurs
| Élément | Couleur | Code Hex |
| :--- | :--- | :--- |
| Fond | Deep Space | #0A0A12 |
| Primaire | Neon Pink | #FF007F |
| Secondaire | Cyber Blue | #00E5FF |
| Accent | Neural Purple | #BC13FE |

## Aperçu SVG (Code-Ready)
```xml
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Background Squircle -->
  <rect width="512" height="512" rx="128" fill="#0A0A12"/>

  <!-- Glow Effect -->
  <circle cx="256" cy="256" r="180" fill="url(#paint0_radial)" fill-opacity="0.3"/>

  <!-- Isometric Sandbox Cube -->
  <path d="M256 120L380 190V330L256 400L132 330V190L256 120Z" fill="#1A1A2E" stroke="#00E5FF" stroke-width="8"/>
  <path d="M256 120V260L380 190M256 260L132 190M256 260V400" stroke="#00E5FF" stroke-width="4" stroke-opacity="0.5"/>

  <!-- Neural Core -->
  <circle cx="256" cy="260" r="40" fill="#BC13FE">
    <animate attributeName="r" values="35;45;35" dur="2s" repeatCount="indefinite" />
  </circle>

  <!-- Neon Accents -->
  <path d="M200 230L170 260L200 290" stroke="#FF007F" stroke-width="12" stroke-linecap="round"/>
  <path d="M312 230L342 260L312 290" stroke="#FF007F" stroke-width="12" stroke-linecap="round"/>

  <defs>
    <radialGradient id="paint0_radial" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(256 256) rotate(90) scale(180)">
      <stop stop-color="#BC13FE"/>
      <stop offset="1" stop-color="#0A0A12" stop-opacity="0"/>
    </radialGradient>
  </defs>
</svg>
```

## Instructions d'intégration
1.  **Fichier source** : Enregistrez le code ci-dessus en `.svg`.
2.  **Android Studio** : Utilisez l'outil `Image Asset` (Click droit sur `res` -> `New` -> `Image Asset`).
3.  **Foreground** : Importez le SVG.
4.  **Background** : Utilisez la couleur unie `#0A0A12`.
