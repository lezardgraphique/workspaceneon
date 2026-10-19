# Neon Sandbox Pro — Web

Neon Sandbox Pro is an email module editor built for HubSpot (HuBL). This is the web version of the Kotlin Multiplatform app (workspace_neon), and it runs in any browser, on desktop or mobile.

## Features

- **Two-way live sync**: edit the HuBL/HTML code and the preview updates; click an element in the preview and the code is regenerated.
- **Layout engine**: sections with 1, 2 or 3 columns, kept side by side or stacked on mobile.
- **Nested sections**: put cards inside cards.
- **Interactive preview**: click any element to configure it, with desktop and mobile views.
- **Maily, the AI assistant** (Gemini Flash through Netlify AI Gateway): marketing advice, generating or changing a whole module, and one-click text rewrites.
- **HubSpot export**: `module.html`, `module.css`, `fields.json`, `meta.json`, plus a standalone HTML file for testing.
- **Autosave** to Netlify Database, with undo and redo.

## Tech stack

- TanStack Start (React 19, TanStack Router, server functions)
- Tailwind CSS 4
- Netlify Database (Postgres) with Drizzle ORM
- Netlify AI Gateway + `@google/genai` (Gemini)
- Netlify Image CDN for the starter visuals

## Running locally

```bash
pnpm install
netlify dev        # emulates Netlify Database and AI Gateway
```

The app is served at http://localhost:8888. No API key is needed: AI Gateway injects the Gemini credentials at runtime. The site needs at least one production deploy before AI Gateway is active.

### Database

The schema lives in `db/schema.ts`. After any change:

```bash
npx drizzle-kit generate --name <short_description>
```

Migrations in `netlify/database/migrations/` are applied automatically on deploy.

## Design

The palette (Deep Space `#0A0A12`, Neon Pink `#FF007F`, Cyber Blue `#00E5FF`, Neural Purple `#BC13FE`), the app icon and Maily the mascot come from the original project's design docs, kept in `docs/design/`.
