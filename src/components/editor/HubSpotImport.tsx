import { legacySpecs } from '@/lib/hubl-legacy'
import { useMemo, useState } from 'react'
import { AlertTriangle, Braces, Check, FileUp, X } from 'lucide-react'

import { useEscape } from '@/hooks/use-escape'
import { collectFields } from '@/lib/fields'
import { applyValues, importSpecs, parseForeignJson } from '@/lib/json-import'
import { parseFieldsJson } from '@/lib/module-fields'
import type { FieldSpec } from '@/lib/module-fields'
import { recognizeCode } from '@/lib/recognize'
import type { ExtraField, ModuleTree } from '@/lib/types'

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
}

export function HubSpotImport({ tree, onImport, onClose }: { tree: ModuleTree; onImport: (p: ImportPayload) => string | null; onClose: () => void }) {
  const [html, setHtml] = useState('')
  const [css, setCss] = useState('')
  const [json, setJson] = useState('')
  const [other, setOther] = useState('')
  const [error, setError] = useState('')
  useEscape(onClose)

  const fieldsJson = useMemo(() => (json.trim() ? parseFieldsJson(json) : null), [json])
  const foreign = useMemo(() => (other.trim() ? parseForeignJson(other) : null), [other])
  // The JSON may carry the code itself (HubSpot API module JSON: source, css).
  const code = html.trim() ? html : (foreign?.html ?? '')
  const style = css.trim() ? css : (foreign?.css ?? '')
  const source = style.trim() ? `<style>\n${style}\n</style>\n${code}` : code
  const specs = useMemo(() => (code.trim() ? importSpecs(source, fieldsJson, foreign) : undefined), [code, source, fieldsJson, foreign])

  const report = useMemo((): Report | null => {
    if (!code.trim()) return null
    const rec = recognizeCode(source, tree, specs)
    if (!rec.ok) return { error: rec.error }
    const { tree: valued, applied } = applyValues(rec.tree, foreign?.values ?? null)
    const fromFj = new Set((fieldsJson ?? []).map((s) => s.name))
    // Fields declared by old template tags come from the code, not from a JSON.
    const tags = new Set(legacySpecs(source).map((s) => s.name))
    const fromJson = new Set((specs ?? []).filter((s) => !fromFj.has(s.name) && !tags.has(s.name)).map((s) => s.name))
    const origin = (n: string): Origin => (fromFj.has(n) ? 'fields.json' : fromJson.has(n) ? 'JSON' : tags.has(n) ? 'balise' : 'code')
    const got = new Set(applied)
    const rows = (f: ExtraField, depth = 0, prefix = ''): Row[] => {
      const full = prefix ? `${prefix}.${f.name}` : f.name
      return [
        {
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
  }, [code, source, specs, tree, foreign, fieldsJson])

  const load = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      const text = await f.text()
      if (/\.json$/i.test(f.name)) {
        let data: unknown = null
        try {
          data = JSON.parse(text || 'null')
        } catch {
          /* shown as unreadable below */
        }
        // A HubSpot fields.json (a list of fields) goes to its own box; meta.json
        // and any other tool's JSON go to the second one.
        if ((/fields/i.test(f.name) || Array.isArray(data)) && parseFieldsJson(text)) setJson(text)
        else if (!/^meta\.json$/i.test(f.name)) setOther(text)
      } else if (/\.css$/i.test(f.name)) setCss(text)
      else if (/\.(html?|hubl)$/i.test(f.name)) setHtml(text)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Importer un module HubSpot" className="fixed inset-0 z-50 flex items-end justify-center bg-void/80 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-xl border border-line bg-night sm:rounded-xl">
        <div className="flex items-start gap-3 border-b border-line p-4">
          <Braces className="mt-0.5 size-5 shrink-0 text-violet" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold">Importer un module HubSpot</h2>
            <p className="text-sm text-mute">
              Colle ou dépose <code className="font-mono text-cyan">module.html</code> et son <code className="font-mono text-cyan">fields.json</code> (et{' '}
              <code className="font-mono text-cyan">module.css</code> si tu l'as), plus, si tu en as, le JSON d'un autre outil. Les champs gardent leurs noms, types et réglages
              exacts ; l'export les redonne à l'identique.
            </p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded p-1.5 text-mute hover:bg-white/10 hover:text-white">
            <X className="size-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-line p-3 text-sm text-mute hover:border-cyan hover:text-white">
              <FileUp className="size-4" /> Choisir les fichiers (.html, fields.json, .css, autre .json)
              <input type="file" multiple accept=".html,.htm,.json,.css,text/html,application/json,text/css" className="sr-only" onChange={(e) => void load(e.target.files)} />
            </label>
            <label className="block">
              <span className={caption}>module.html</span>
              <textarea className={`${input} min-h-36`} value={html} onChange={(e) => setHtml(e.target.value)} placeholder={foreign?.html ? 'Repris du JSON importé (colle ici pour le remplacer)' : '<table>… {{ module.titre }} …'} />
            </label>
            <label className="block">
              <span className={caption}>fields.json (facultatif, recommandé)</span>
              <textarea className={`${input} min-h-28`} value={json} onChange={(e) => setJson(e.target.value)} placeholder='[{ "name": "titre", "label": "Titre", "type": "text", … }]' />
              {json.trim() && !fieldsJson && <span className="mt-1 block text-xs text-pink">Ce fields.json n'est pas lisible (JSON invalide ou sans liste de champs).</span>}
            </label>
            <label className="block">
              <span className={caption}>JSON d'un autre outil (facultatif)</span>
              <textarea
                className={`${input} min-h-28`}
                value={other}
                onChange={(e) => setOther(e.target.value)}
                placeholder='Valeurs du module ({ "titre": "…", "cartes": [ … ] }), widget_data, JSON Schema, modèle ou entrée Contentful, Storyblok, Sanity, Strapi, Prismic, Webflow, Directus, Builder.io, Airtable, liste de champs d’un autre outil, JSON du module via l’API HubSpot…'
              />
              {other.trim() &&
                (foreign ? (
                  <span className="mt-1 flex items-start gap-1.5 text-xs text-cyan">
                    <Check className="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Reconnu : {foreign.format}
                      {foreign.specs.length > 0 && ` · ${foreign.specs.filter((s) => !s.name.includes('.')).length} définition${foreign.specs.length > 1 ? 's' : ''} de champ`}
                      {foreign.values && ` · ${Object.keys(foreign.values).length} valeur${Object.keys(foreign.values).length > 1 ? 's' : ''}`}
                      {foreign.html && ' · code du module'}
                      {foreign.css && ' · CSS'}
                    </span>
                  </span>
                ) : (
                  <span className="mt-1 block text-xs text-pink">Rien de reconnu dans ce JSON (invalide, ou sans champs ni valeurs).</span>
                ))}
            </label>
            <label className="block">
              <span className={caption}>module.css (facultatif)</span>
              <textarea className={`${input} min-h-14`} value={css} onChange={(e) => setCss(e.target.value)} placeholder={foreign?.css ? 'Repris du JSON importé' : undefined} />
            </label>
          </div>

          <section aria-label="Champs reconnus" className="min-w-0">
            <h2 className="mb-2 font-display font-semibold">Champs reconnus</h2>
            {!report && <p className="text-sm text-mute">Le détail des champs s'affiche ici dès que le code est collé (ou repris d'un JSON).</p>}
            {report && 'error' in report && <p className="text-sm text-pink">{report.error}</p>}
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
                <ul className="divide-y divide-line overflow-hidden rounded-md border border-line text-xs">
                  {report.rows.map((r, i) => (
                    <li key={i} className="flex items-center gap-2 px-2.5 py-1.5" style={{ paddingLeft: 10 + r.depth * 14 }}>
                      <code className="min-w-0 flex-1 truncate font-mono text-[#e3a6ff]" title={r.label}>
                        {r.name}
                        {r.detail && <span className="ml-1.5 font-sans text-mute">· {r.detail}</span>}
                        {r.valued && <span className="ml-1.5 font-sans text-cyan">· valeur du JSON</span>}
                      </code>
                      <span className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-cyan">{r.type}</span>
                      <span className={`w-16 shrink-0 text-right text-[10px] ${r.origin !== 'code' ? 'text-white' : 'text-mute'}`} title={ORIGIN_TITLE[r.origin]}>
                        {r.origin === 'code' ? 'déduit' : r.origin}
                      </span>
                    </li>
                  ))}
                </ul>
                {report.missing.length > 0 && (
                  <p className="mt-2 flex gap-1.5 text-xs text-mute">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-cyan" /> Gardés même s'ils ne sont pas utilisés dans le code : {report.missing.join(', ')}
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
            disabled={!report || 'error' in report}
            onClick={() => {
              const err = onImport({ source, specs, values: foreign?.values ?? null })
              if (err) setError(err)
              else onClose()
            }}
            className="rounded-md bg-cyan px-3 py-2 text-sm font-semibold text-void disabled:opacity-50"
          >
            Remplacer le module par cet import
          </button>
        </footer>
      </div>
    </div>
  )
}
