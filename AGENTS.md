# AGENTS.md

## Project

Neon Sandbox Pro (web): an email module editor for HubSpot/HuBL. It is the web port of a Kotlin Multiplatform Android app ("workspace_neon"). Only that app's design docs were carried over (`docs/design/`); no Kotlin code exists here. The UI copy is in French and uses tutoiement. Blocks target both emails and the web: keep the UI copy platform-neutral (no HubSpot mentions).

## Stack

TanStack Start (React 19, file-based routes, `createServerFn`) · Tailwind 4 (theme tokens in `src/styles.css`) · Netlify Database + Drizzle (`drizzle-orm@beta`, `drizzle-orm/netlify-db`) · Netlify AI Gateway with `@google/genai`, model `gemini-3-flash-preview`.

## Architecture

- `src/lib/types.ts`: the **ModuleTree** model. Sections hold `cells` (one block list per column); a block can itself be a `section` (nested card). This tree is the single source of truth and is stored as `jsonb` in the `modules` table.
- `src/lib/hubl.ts`: the heart of the two-way sync.
  - `treeToCode` writes email-safe HTML where every node carries `data-neon="<type>"` plus `data-*` settings.
  - `codeToTree` parses it back with DOMParser (browser only) and sanitizes it (no scripts or `on*` attributes). Content without a marker inside a column becomes a `raw` block, so hand-written HuBL survives.
  - `htmlToBlocks` / `importHtml` convert free HTML/HuBL (no markers) into editable blocks: headings, text, styled links → buttons, images, rules, layout tables → columns, coloured boxes → cards. `{% … %}` statements and unknown elements stay `raw`. `codeToTree` falls back to `importHtml` when the code has no section marker.
  - `reconcileIds` keeps node ids stable across parses so the selection doesn't get lost.
  - `treeToHubSpot` generates the export: text, button and image content becomes `{{ module.field }}` + `fields.json`.
  - Keep `Preview.tsx` visually aligned with the HTML generated here (same metrics).
- `src/lib/clients.ts`: Litmus-style email client tests, simulated in the browser. `renderForClient` applies each engine's known limits to `page.html` (Outlook Windows reads `<!--[if mso]>` and drops border-radius, max-width, media queries and link padding; Gmail IMAP drops `<style>`; full or partial dark mode; images blocked). `auditModule` lists issues per client with the block concerned. UI: `ClientsDialog`.
- Images: uploaded through `POST /api/images` into Netlify Blobs (store `images`) and served by `/api/images/<key>` with an absolute URL. `src/lib/images.ts` downscales to 1600px and converts formats email clients don't support (WebP, HEIC…) to JPEG; GIFs are kept as-is. Image files can also be dropped onto the preview.
- `src/routes/apercu.$moduleId.tsx`: module preview page (final HTML in a sandboxed `EmailFrame`, desktop/mobile, light/dark). `EmailFrame` also renders the library thumbnails.
- `src/lib/fields.ts`: module fields (simplified design manager). Every heading/text/button/image is a field; an optional `field: { name, label }` on the block overrides the automatic name (`heading_1`…). `collectFields` gives unique names in document order and is used by both the Champs panel and `treeToHubSpot`. Custom definitions round-trip through the code as `data-field` / `data-label`.
- `src/lib/tree.ts`: immutable tree operations (update, move, duplicate, insert, change column count without losing content).
- `src/routes/editor.$moduleId.tsx`: editor state.
  - Visual edits go through `commit()`, which regenerates the code.
  - Code edits are parsed with a debounce and **never rewrite the text being typed**.
  - Undo/redo history coalesces edits closer than 600 ms. Autosave runs after 1 s of inactivity.
  - Desktop has 3 columns (Structure/Maily | Preview | Settings/Code). Mobile has a single pane with a bottom tab bar (hidden while the keyboard is open) and a floating action bar for the selected element. Form fields are 16px below `lg` to avoid the iOS zoom on focus.
- `src/components/editor/*`: Structure, FieldsPanel (Champs: label, HuBL name and value per field), Preview (headings, texts and button labels are editable in place once selected), Inspector, CodeEditor (transparent textarea over a highlighted `<pre>`), MailyPanel, ExportDialog.
- `src/components/Maily.tsx`: the mascot as an animated SVG with moods `happy | thinking | success`.
- `src/server/modules.functions.ts`: module CRUD (server functions).
- `src/routes/api.maily.ts`: streams the Maily chat (plain text), modes `chat | build`, with optional images (screenshots/mockups, base64) per message. When Maily creates, recreates or edits the module, her answer contains one ` ```neon ` block holding the full module; `MailyPanel` hides it while streaming and applies it with `applyCode` (undoable). Attached HTML files and long pasted HTML are sent inline in the message. `src/routes/api.generate.ts` only handles text rewrites.
- Prompts live in `src/lib/gemini.server.ts`: `MAILY_PERSONA`, `APP_GUIDE` (description of every screen and button so Maily can answer questions about the app: **update it when a feature or UI label changes**), `MODULE_REPLY_SPEC` and `FORMAT_SPEC`.

## Conventions

- Use `@/` imports for `src/`. Server functions use `.validator(zod)` (the API exposed by the pinned `@tanstack/react-start` version; `.inputValidator` does not exist there).
- Never pass an API key to `GoogleGenAI`: AI Gateway injects it.
- Any schema change requires `npx drizzle-kit generate --name …` (migrations go in `netlify/database/migrations`).
- Starter images are referenced by absolute Image CDN URL (`src/lib/templates.ts`) so they keep working in emails exported to HubSpot.
- No authentication: the app is personal and anyone with the URL can see and edit the modules. Add Netlify Identity if it needs to be locked down.
