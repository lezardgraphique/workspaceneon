import { legacySpecs } from '@/lib/hubl-legacy'
import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Braces, Check, Eye, FileUp, Wrench, X } from 'lucide-react'

import { EmailFrame } from '@/components/EmailFrame'
import { ImportImages } from '@/components/editor/ImportImages'
import { previewEmail } from '@/lib/hubl'
import { countLogic } from '@/lib/logic'

import { useEscape } from '@/hooks/use-escape'
import { collectFields } from '@/lib/fields'
import { parseForeignJson } from '@/lib/json-import'
import { parseFieldsJson } from '@/lib/module-fields'
import type { FieldSpec } from '@/lib/module-fields'
import { prepareImport } from '@/lib/import-repair'
import type { ExtraField, ExtraFieldType, Json, ModuleTree } from '@/lib/types'
import { retypeField } from '@/lib/field-edit'
import { TYPE_LABEL } from '@/components/editor/FieldsPanel'

// Import of a HubSpot module as it is downloaded (module.html + fields.json,
// optionally module.css), plus any JSON copied from another tool (values of
// the module, JSON Schema, Contentful/Storyblok/Sanity/Strapi/Prismic/Webflow/Directus/Builder.io/Airtable models and entries, another tool's field
// list, the HubSpot API's module JSON…) that helps recognise the fields. The
// report lists every field with its exact type and where it comes from before
// anything replaces the current module.

const input =
  'w-full rounded-md border border-line bg-void px-2.5 py-2 font-mono text-base text-white outline-none focus:border-cyan lg:text-xs'
const caption = 'mb-1 block font-mono text-[10px] uppercase tracking-wider text-mute'

type Origin = 'fields.json' | 'JSON' | 'balise' | 'code'

interface Row {
  /** Path of the field from the top (extra fields only). */
  path?: string[]
  /** Other likely types: the guess needs a look. */
  doubt?: ExtraFieldType[]
  kind?: ExtraFieldType
  name: string
  label: string
  type: string
  origin: Origin
  valued: boolean
  detail?: string
  depth: number
}

type Report = { error: string } | { rows: Row[]; missing: string[]; unknown: string[] }

const ORIGIN_TITLE: Record<Origin, string> = {
  'fields.json': 'Défini par le fields.json',
  JSON: 'Défini par le JSON importé',
  balise: 'Déclaré par une balise du code ({% text "nom" %}, {% choice %}…)',
  code: 'Déduit de l’usage dans le code',
}

export interface ImportPayload {
  source: string
  specs?: FieldSpec[]
  values: Record<string, unknown> | null
  /** module.js (web pages only), '' when none. */
  js: string
  /** The module exactly as the dialog shows it (kept whole or cut into blocks). */
  tree: ModuleTree
  /** meta.json given with the files, exported back as it was. */
  meta?: { [key: string]: Json }
}

export function HubSpotImport({ tree, onImport, onClose }: { tree: ModuleTree; onImport: (p: ImportPayload) => string | null | Promise<string | null>; onClose: () => void }) {
  // Two zones: the code of the module (HTML + CSS), and its fields (fields.json
  // and / or any other tool's JSON). What each holds is sorted here.
  const [codeText, setCodeText] = useState('')
  const [fieldsText, setFieldsText] = useState('')
  const [jsText, setJsText] = useState('')
  const [meta, setMeta] = useState<{ [key: string]: Json } | null>(null)
  const { html, css } = useMemo(() => splitCode(codeText), [codeText])
  const { json, other, parts } = useMemo(() => splitFields(fieldsText), [fieldsText])
  // meta.json pasted in the fields zone counts too.
  const pastedMeta = useMemo(() => metaIn(fieldsText), [fieldsText])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEscape(onClose)

  const fieldsJson = useMemo(() => (json.trim() ? parseFieldsJson(json) : null), [json])
  const foreign = useMemo(() => (other.trim() ? parseForeignJson(other) : null), [other])
  // Everything goes through the repairing import: cleaned code (or a module
  // built from the fields when there is no code), repairs listed.
  const prep = useMemo(
    () => (html.trim() || json.trim() || other.trim() ? prepareImport({ html, css, fieldsJson: json, other }, tree) : null),
    [html, css, json, other, tree],
  )

  // Types the user settled for doubtful fields (path → type), and those confirmed as guessed.
  const [types, setTypes] = useState<Record<string, ExtraFieldType>>({})
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set())
  const effective = useMemo(() => {
    if (!prep?.ok) return null
    let t = prep.tree
    for (const [path, type] of Object.entries(types)) t = retypeField(t, path.split('.'), type)
    return t
  }, [prep, types])

  const report = useMemo((): Report | null => {
    if (!prep) return null
    if (!prep.ok) return { error: prep.error }
    const { source, specs } = prep
    const valued = effective ?? prep.tree
    const fromFj = new Set((fieldsJson ?? []).map((s) => s.name))
    // Fields declared by old template tags come from the code, not from a JSON.
    const tags = new Set(legacySpecs(source).map((s) => s.name))
    const fromJson = new Set((specs ?? []).filter((s) => !fromFj.has(s.name) && !tags.has(s.name)).map((s) => s.name))
    const origin = (n: string): Origin => (fromFj.has(n) ? 'fields.json' : fromJson.has(n) ? 'JSON' : tags.has(n) ? 'balise' : 'code')
    const got = new Set(prep.applied)
    const rows = (f: ExtraField, depth = 0, prefix = ''): Row[] => {
      const full = prefix ? `${prefix}.${f.name}` : f.name
      return [
        {
          path: full.split('.'),
          doubt: f.doubt && !types[full] && !confirmed.has(full) ? f.doubt : undefined,
          kind: f.type,
          name: f.name,
          label: f.label,
          type: `${f.hsType ?? f.type}${f.repeater ? ' (répété)' : ''}`,
          origin: origin(full),
          valued: depth === 0 && got.has(f.name),
          detail: f.type === 'choice' ? (f.options ?? []).map((o) => o.value).join(', ') : undefined,
          depth,
        },
        ...(f.children ?? []).flatMap((c) => rows(c, depth + 1, full)),
      ]
    }
    const blockRows: Row[] = collectFields(valued)
      .filter((f) => f.block.field)
      .flatMap((f) => {
        const b = f.block
        const names = b.type === 'button' ? [b.field?.textName, b.field?.linkName].filter((n): n is string => !!n) : [f.name]
        return names.map((n) => ({
          name: n,
          label: b.field?.label ?? f.label,
          type: String(b.field?.specs?.[n]?.type ?? (b.type === 'image' ? 'image' : b.type === 'button' && n === b.field?.linkName ? 'link' : b.type === 'text' ? 'richtext' : 'text')),
          origin: origin(n),
          valued: got.has(n),
          detail: `bloc ${b.type === 'heading' ? 'titre' : b.type === 'text' ? 'texte' : b.type === 'button' ? 'bouton' : 'image'} modifiable`,
          depth: 0,
        }))
      })
    const extra = (valued.fields ?? []).flatMap((f) => rows(f))
    const used = new Set([...blockRows, ...extra].filter((r) => r.depth === 0).map((r) => r.name))
    const missing = (fieldsJson ?? []).filter((s) => !s.name.includes('.') && !used.has(s.name)).map((s) => s.name)
    const unknown = fieldsJson ? [...used].filter((n) => !fromFj.has(n) && !fromJson.has(n)) : []
    return { rows: [...blockRows, ...extra], missing, unknown }
  }, [prep, fieldsJson, effective, types, confirmed])

  // What the module will look like, before replacing anything (debounced: large pastes stay fluid).
  const [shownTree, setShownTree] = useState<ModuleTree | null>(null)
  useEffect(() => {
    const t = setTimeout(() => setShownTree(prep?.ok ? effective : null), 300)
    return () => clearTimeout(t)
  }, [prep, effective])
  const preview = useMemo(() => {
    if (!shownTree) return null
    try {
      return { html: previewEmail(shownTree, 'Import'), logic: countLogic(shownTree) }
    } catch {
      return null
    }
  }, [shownTree])

  // Dropped / chosen files go to the right zone (several JSON files follow each other).
  const load = async (files: FileList | null) => {
    let code = codeText
    let fields = fieldsText
    let js = jsText
    for (const f of Array.from(files ?? [])) {
      const text = await f.text()
      if (/^meta(\s*\(\d+\))?\.json$|^meta[_-]?\d*\.json$/i.test(f.name) || isMetaJson(text)) {
        try {
          const m = JSON.parse(text)
          if (m && typeof m === 'object' && !Array.isArray(m)) setMeta(m)
        } catch {
          /* not JSON: ignored */
        }
        continue
      }
      if (/\.(m?js)$/i.test(f.name)) {
        js = js.trim() ? `${js.trim()}\n\n${text}` : text
        continue
      }
      if (/\.json$/i.test(f.name)) fields = fields.trim() ? `${fields.trim()}\n\n${text}` : text
      // module.css goes after the HTML as it is (read back apart as module.css).
      else if (/\.css$/i.test(f.name)) code = code.trim() ? `${code.trim()}\n\n${text.trim()}` : text.trim()
      else if (/\.(html?|hubl|hbs|handlebars|mustache|liquid|mjml|j2|jinja|twig)$/i.test(f.name)) code = code.trim() && !splitCode(code).html.trim() ? `${text.trim()}\n\n${code.trim()}` : text
    }
    setCodeText(code)
    setFieldsText(fields)
    setJsText(js)
  }


  return (
    <div role="dialog" aria-modal="true" aria-label="Importer un module" className="fixed inset-0 z-50 flex items-end justify-center bg-void/80 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-xl border border-line bg-night sm:rounded-xl">
        <div className="flex items-start gap-3 border-b border-line p-4">
          <Braces className="mt-0.5 size-5 shrink-0 text-violet" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold">Importer un module</h2>
            <p className="text-sm text-mute">
              Deux zones : le <strong className="text-white">code</strong> (module.html, et module.css à la suite) et les <strong className="text-white">champs</strong>{' '}
              (fields.json, ou le JSON d’un autre outil). Les champs gardent leurs noms, types et réglages exacts ; ceux que le code n’utilisait pas sont rendus opérationnels.
            </p>
            <p className="mt-1 text-xs text-mute">
              Le code d’autres plateformes est converti : Liquid (Shopify, Klaviyo, Braze, Brevo), Handlebars et Mustache, balises Mailchimp, AMPscript, Mailjet, Marketo et MJML. Les variables de personnalisation sont reliées au contact, les autres données deviennent des champs, et la logique sans effet visible est masquée.
            </p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded p-1.5 text-mute hover:bg-white/10 hover:text-white">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-line p-3 text-sm text-mute hover:border-cyan hover:text-white">
              <FileUp className="size-4" /> Choisir les fichiers (module.html, module.css, fields.json, module.js…) : chacun va dans la bonne zone
              <input type="file" multiple accept=".html,.htm,.hbs,.handlebars,.liquid,.mjml,.json,.css,.js,.mjs,text/html,application/json,text/css,text/javascript" className="sr-only" onChange={(e) => void load(e.target.files)} />
            </label>
            <label className="block">
              <span className={caption}>1 · Code du module (HTML et CSS)</span>
              <textarea
                className={`${input} min-h-40`}
                value={codeText}
                onChange={(e) => setCodeText(e.target.value)}
                placeholder={foreign?.html ? 'Repris du JSON importé (colle ici pour le remplacer)' : 'Colle ici module.html, et module.css à la suite si tu l’as.\n<table>… {{ module.titre }} …\n(HuBL, Liquid, Handlebars, Mailchimp, MJML…)'}
              />
              {codeText.trim() && (
                <span className="mt-1 flex items-start gap-1.5 text-xs text-cyan">
                  <Check className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    {html.trim() ? 'Code reconnu' : 'Pas de HTML : seul le CSS est repris'}
                    {css.trim() && ' · CSS'}
                  </span>
                </span>
              )}
            </label>
            <label className="block">
              <span className={caption}>2 · Champs (fields.json ou JSON d’un autre outil) · facultatif</span>
              <textarea
                className={`${input} min-h-32`}
                value={fieldsText}
                onChange={(e) => setFieldsText(e.target.value)}
                placeholder={'Colle ici le fields.json (recommandé), ou le JSON d’un autre outil : valeurs du module, widget_data, JSON Schema, Contentful, Storyblok, Sanity, Strapi, Webflow, Airtable, API HubSpot… Plusieurs JSON peuvent se suivre.'}
              />
              {fieldsText.trim() && (
                <span className={`mt-1 flex items-start gap-1.5 text-xs ${fieldsJson || foreign ? 'text-cyan' : 'text-pink'}`}>
                  {fieldsJson || foreign ? <Check className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                  <span>
                    {fieldsJson && `fields.json : ${fieldsJson.filter((f) => !f.name.includes('.')).length} champ${fieldsJson.length > 1 ? 's' : ''}`}
                    {fieldsJson && foreign && ' · '}
                    {foreign &&
                      `${foreign.format}${foreign.specs.length ? ` · ${foreign.specs.filter((x) => !x.name.includes('.')).length} définition${foreign.specs.length > 1 ? 's' : ''}` : ''}${foreign.values ? ` · ${Object.keys(foreign.values).length} valeur${Object.keys(foreign.values).length > 1 ? 's' : ''}` : ''}${foreign.html ? ' · code du module' : ''}`}
                    {!fieldsJson && !foreign && 'Rien de reconnu : ce n’est ni un fields.json ni un JSON lisible, même après réparation.'}
                    {parts > 2 && ` · ${parts - 2} JSON en plus ignoré${parts > 3 ? 's' : ''}`}
                    {pastedMeta && ' · meta.json gardé pour l’export'}
                  </span>
                </span>
              )}
            </label>
            <label className="block">
              <span className={caption}>3 · JavaScript (module.js) · facultatif</span>
              <textarea
                className={`${input} min-h-20`}
                value={jsText}
                onChange={(e) => setJsText(e.target.value)}
                placeholder={'Colle ici le module.js (modules de pages web). Gardé et réexporté tel quel ; testé dans une fenêtre isolée, jamais exécuté dans un e-mail.'}
              />
              {jsText.trim() && (
                <span className="mt-1 flex items-start gap-1.5 text-xs text-cyan">
                  <Check className="mt-0.5 size-3.5 shrink-0" />
                  <span>
                    JavaScript gardé ({jsText.trim().split('\n').length} ligne{jsText.trim().split('\n').length > 1 ? 's' : ''}) : onglet Code › « JavaScript du module » pour le modifier et le tester.
                  </span>
                </span>
              )}
            </label>
            <ImportImages code={codeText} fields={fieldsText} setCode={setCodeText} setFields={setFieldsText} />
            {meta && (
              <p className="flex items-start gap-1.5 text-xs text-cyan">
                <Check className="mt-0.5 size-3.5 shrink-0" /> meta.json gardé : l’export le redonne tel quel (nom, types de contenu, ressources).
              </p>
            )}
          </div>

          <section aria-label="Champs reconnus" className="min-w-0">
            {preview && (
              <div className="mb-4">
                <h2 className="mb-2 flex items-center gap-1.5 font-display font-semibold">
                  <Eye className="size-4 text-cyan" aria-hidden /> Aperçu de l’import
                </h2>
                <div className="overflow-hidden rounded-md border border-line bg-white">
                  <EmailFrame html={preview.html} width={(shownTree?.width ?? 600) + 40} maxHeight={720} title="Aperçu du module importé" />
                </div>
                {preview.logic > 0 && (
                  <p className="mt-1.5 text-xs text-mute">
                    {preview.logic} ligne{preview.logic > 1 ? 's' : ''} de logique (conditions, boucles, variables) : appliquée{preview.logic > 1 ? 's' : ''} dans l’aperçu, masquée{preview.logic > 1 ? 's' : ''} dans la Structure.
                  </p>
                )}
              </div>
            )}
            <h2 className="mb-2 font-display font-semibold">Champs reconnus</h2>
            {!report && <p className="text-sm text-mute">Le détail des champs s'affiche ici dès que le code, le fields.json ou un JSON est collé : un JSON seul suffit, le module est alors construit à partir de ses champs.</p>}
            {report && 'error' in report && <p className="text-sm text-pink">{report.error}</p>}
            {prep && prep.repairs.length > 0 && (
              <div className="mb-3 rounded-md border border-cyan/40 bg-cyan/5 p-2.5 text-xs">
                <p className="mb-1 flex items-center gap-1.5 font-semibold text-cyan">
                  <Wrench className="size-3.5" /> Corrigé automatiquement avant l’import
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-mute">
                  {prep.repairs.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {report && 'rows' in report && (
              <>
                <p className="mb-2 text-xs text-mute">
                  {report.rows.filter((r) => r.depth === 0).length} champs
                  {report.rows.length > report.rows.filter((r) => r.depth === 0).length && ` (${report.rows.length} avec les sous-champs)`}
                  {report.rows.some((r) => r.origin === 'balise') && ` · ${report.rows.filter((r) => r.origin === 'balise').length} déclarés par des balises`}
                  {(fieldsJson || foreign) && report.rows.some((r) => r.origin === 'fields.json' || r.origin === 'JSON')
                    ? ` · ${report.rows.filter((r) => r.origin === 'fields.json' || r.origin === 'JSON').length === report.rows.length ? 'tous' : report.rows.filter((r) => r.origin === 'fields.json' || r.origin === 'JSON').length} définis par un JSON`
                    : fieldsJson || foreign
                      ? ''
                    : report.rows.some((r) => r.origin === 'balise') ? '' : ' · types déduits du code (ajoute le fields.json ou le JSON d’un autre outil pour plus d’exactitude)'}
                  {report.rows.some((r) => r.valued) && ` · ${report.rows.filter((r) => r.valued).length} valeur${report.rows.filter((r) => r.valued).length > 1 ? 's' : ''} reprise${report.rows.filter((r) => r.valued).length > 1 ? 's' : ''} du JSON`}
                </p>
                {report.rows.some((r) => r.doubt) && (
                  <p className="mb-2 flex gap-1.5 rounded-md border border-[#ffb36b]/50 bg-[#ffb36b]/5 p-2 text-xs text-[#ffb36b]">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      {report.rows.filter((r) => r.doubt).length} type{report.rows.filter((r) => r.doubt).length > 1 ? 's' : ''} à confirmer : le code seul ne permet pas de trancher. Choisis le bon type ou « OK » pour garder la proposition. Le fields.json du module, s’il existe, règle tout.
                    </span>
                  </p>
                )}
                <ul className="divide-y divide-line overflow-hidden rounded-md border border-line text-xs">
                  {report.rows.map((r, i) => (
                    <li key={i} className="flex items-center gap-2 px-2.5 py-1.5" style={{ paddingLeft: 10 + r.depth * 14 }}>
                      <code className="min-w-0 flex-1 truncate font-mono text-[#e3a6ff]" title={r.label}>
                        {r.name}
                        {r.detail && <span className="ml-1.5 font-sans text-mute">· {r.detail}</span>}
                        {r.valued && <span className="ml-1.5 font-sans text-cyan">· valeur du JSON</span>}
                      </code>
                      {r.doubt && r.path && r.kind ? (
                        <span className="flex shrink-0 items-center gap-1">
                          <select
                            aria-label={`Type du champ ${r.name} (à confirmer)`}
                            value={r.kind}
                            onChange={(e) => setTypes((t) => ({ ...t, [r.path!.join('.')]: e.target.value as ExtraFieldType }))}
                            className="rounded-full border border-[#ffb36b] bg-void px-1.5 py-0.5 text-[10px] text-[#ffb36b] outline-none focus:border-cyan"
                          >
                            {[r.kind, ...r.doubt].map((t) => (
                              <option key={t} value={t}>
                                {TYPE_LABEL[t]}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => setConfirmed((c) => new Set(c).add(r.path!.join('.')))}
                            className="rounded-full border border-line px-1.5 py-0.5 text-[10px] text-mute hover:text-white"
                          >
                            OK<span className="sr-only"> : garder {TYPE_LABEL[r.kind]} pour {r.name}</span>
                          </button>
                        </span>
                      ) : (
                        <span className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-cyan">{r.type}</span>
                      )}
                      <span className={`w-16 shrink-0 text-right text-[10px] ${r.origin !== 'code' ? 'text-white' : 'text-mute'}`} title={ORIGIN_TITLE[r.origin]}>
                        {r.origin === 'code' ? 'déduit' : r.origin}
                      </span>
                    </li>
                  ))}
                </ul>
                {prep?.ok && prep.wiring.wired.length > 0 && (
                  <div className="mt-2 rounded-md border border-cyan/30 bg-cyan/5 p-2 text-xs">
                    <p className="flex gap-1.5 font-semibold text-cyan">
                      <Wrench className="mt-0.5 size-3.5 shrink-0" /> Rendus opérationnels (le code ne les utilisait pas)
                    </p>
                    <ul className="mt-1 space-y-0.5 pl-5 text-[#d9d9ec]">
                      {prep.wiring.wired.map((w) => (
                        <li key={w} className="list-disc">
                          {w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="mt-2 text-xs text-mute">
                  Un champ manque ou est mal reconnu ? Importe quand même : dans l’onglet <strong className="text-white">Champs</strong>, tu peux l’ajouter ou corriger son
                  nom, son type et « Répété », à chaque niveau, y compris dans les groupes imbriqués.
                </p>
                {prep?.ok && prep.wiring.settings.length > 0 && (
                  <p className="mt-2 flex gap-1.5 text-xs text-mute">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-cyan" /> Gardés comme réglages (onglet Champs, exportés), sans effet tant que le code ne les utilise pas : {prep.wiring.settings.join(', ')}
                  </p>
                )}
                {report.unknown.length > 0 && (
                  <p className="mt-2 flex gap-1.5 text-xs text-[#ffb36b]">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Utilisés dans le code mais absents des JSON (type déduit) : {report.unknown.join(', ')}
                  </p>
                )}
              </>
            )}
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line p-4">
          {error && <p className="mr-auto text-sm text-pink">{error}</p>}
          <button onClick={onClose} className="rounded-md border border-line px-3 py-2 text-sm text-mute hover:text-white">
            Annuler
          </button>
          <button
            disabled={!prep || !prep.ok || busy}
            onClick={async () => {
              if (!prep?.ok || busy) return
              // The images are copied into the tool first (can take a few seconds).
              setBusy(true)
              const err = await onImport({ source: prep.source, specs: prep.specs, values: prep.values, js: jsText.trim(), tree: effective ?? prep.tree, meta: meta ?? pastedMeta ?? undefined })
              setBusy(false)
              if (err) setError(err)
              else onClose()
            }}
            className="rounded-md bg-cyan px-3 py-2 text-sm font-semibold text-void disabled:opacity-50"
          >
            {busy ? 'Copie des images…' : 'Remplacer le module par cet import'}
          </button>
        </footer>
      </div>
    </div>
  )
}

// The code zone: HTML (with its <style>), or CSS alone, or HTML followed by the
// module.css pasted below it (rules after the last tag).
export function splitCode(text: string): { html: string; css: string } {
  const t = text.trim()
  if (!t) return { html: '', css: '' }
  // A rule, or an at-rule (@media, @keyframes…) first.
  const looksCss = (x: string) => (/^[^<{}]*\{[^{}]*:[^{}]*\}/.test(x.trim()) || /^@(media|keyframes|font-face|import|supports|charset|layer|container)\b[^{;]*[{;]/i.test(x.trim()) || /^\/\*/.test(x.trim())) && !/<[a-z!]/i.test(x)
  if (looksCss(t)) return { html: '', css: t }
  // module.css pasted after the HTML: everything after the last closing tag that reads as CSS.
  // (a CSS selector may hold « > », so the end of the HTML is its last closing tag)
  let end = -1
  for (const m of t.matchAll(/<\/[a-z][\w-]*\s*>|\/>|%\}|-->|<img\b[^>]*>|<br\s*>/gi)) end = m.index! + m[0].length
  const tail = end >= 0 ? t.slice(end) : ''
  if (tail.trim() && looksCss(tail)) return { html: t.slice(0, t.length - tail.length), css: tail.trim() }
  return { html: t, css: '' }
}

// The fields zone: one or several JSON documents one after the other. The first
// fields.json (a list of fields) is « json », the first other JSON is « other ».
export function splitFields(text: string): { json: string; other: string; parts: number } {
  const docs: string[] = []
  let depth = 0
  let start = -1
  let str: string | null = null
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (str) {
      if (c === '\\') i++
      else if (c === str) str = null
      continue
    }
    if (c === '"' || (c === "'" && depth > 0)) str = c
    else if (c === '{' || c === '[') {
      if (depth === 0) start = i
      depth++
    } else if ((c === '}' || c === ']') && depth > 0) {
      depth--
      if (depth === 0 && start >= 0) {
        docs.push(text.slice(start, i + 1))
        start = -1
      }
    }
  }
  // Unbalanced (a broken JSON): kept whole, the lenient reader repairs it.
  if (depth > 0 || !docs.length) return isFieldsJson(text) ? { json: text, other: '', parts: 1 } : { json: '', other: text, parts: text.trim() ? 1 : 0 }
  let json = ''
  let other = ''
  for (const d of docs) {
    // A meta.json pasted with the rest: read by the dialog, not a field list.
    if (isMetaJson(d)) continue
    if (!json && isFieldsJson(d)) json = d
    else if (!other) other = d
  }
  return { json, other, parts: docs.length }
}

// A list of field definitions, even written loosely (the import repairs it).
const isFieldsJson = (t: string) => {
  if (!/^\s*\[/.test(t)) return false
  const f = parseFieldsJson(t)
  return (!!f && f.length > 0) || (/\bname\b/.test(t) && /\btype\b/.test(t))
}

// HubSpot's meta.json (module settings), whatever the file is called.
const isMetaJson = (t: string) => /^\s*\{/.test(t) && /"host_template_types"|"smart_type"|"is_available_for_new_content"/.test(t) && !/"type"\s*:\s*"(text|richtext|image|group)"/.test(t)

function metaIn(text: string): { [key: string]: Json } | null {
  if (!/host_template_types|smart_type/.test(text)) return null
  for (const m of text.matchAll(/\{[^{}]*(?:\[[^\]]*\][^{}]*)*\}/g)) {
    if (!isMetaJson(m[0])) continue
    try {
      const v = JSON.parse(m[0])
      if (v && typeof v === 'object' && !Array.isArray(v)) return v
    } catch {
      /* not this one */
    }
  }
  return null
}
