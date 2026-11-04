import { useMemo, useState } from 'react'
import { AlertTriangle, Braces, Check, FileUp, X } from 'lucide-react'

import { useEscape } from '@/hooks/use-escape'
import { collectFields } from '@/lib/fields'
import { parseFieldsJson } from '@/lib/module-fields'
import { recognizeCode } from '@/lib/recognize'
import type { ExtraField, ModuleTree } from '@/lib/types'

// Import of a HubSpot module as it is downloaded (module.html + fields.json,
// optionally module.css): the report lists every field with its exact type and
// where it comes from before anything replaces the current module.

const input =
  'w-full rounded-md border border-line bg-void px-2.5 py-2 font-mono text-base text-white outline-none focus:border-cyan lg:text-xs'

interface Row {
  name: string
  label: string
  type: string
  origin: 'fields.json' | 'code'
  detail?: string
  depth: number
}

type Report = { error: string } | { rows: Row[]; missing: string[]; unknown: string[] }

function rows(f: ExtraField, specNames: Set<string>, depth = 0, prefix = ''): Row[] {
  const full = prefix ? `${prefix}.${f.name}` : f.name
  const own: Row = {
    name: f.name,
    label: f.label,
    type: `${f.hsType ?? f.type}${f.repeater ? ' (répété)' : ''}`,
    origin: specNames.has(full) ? 'fields.json' : 'code',
    detail: f.type === 'choice' ? (f.options ?? []).map((o) => o.value).join(', ') : undefined,
    depth,
  }
  return [own, ...(f.children ?? []).flatMap((c) => rows(c, specNames, depth + 1, full))]
}

export function HubSpotImport({ tree, onImport, onClose }: { tree: ModuleTree; onImport: (html: string, fieldsJson: string) => string | null; onClose: () => void }) {
  const [html, setHtml] = useState('')
  const [css, setCss] = useState('')
  const [json, setJson] = useState('')
  const [error, setError] = useState('')
  useEscape(onClose)

  const specs = useMemo(() => (json.trim() ? parseFieldsJson(json) : null), [json])
  const source = css.trim() ? `<style>\n${css}\n</style>\n${html}` : html
  const report = useMemo((): Report | null => {
    if (!html.trim()) return null
    const rec = recognizeCode(source, tree, specs ?? undefined)
    if (!rec.ok) return { error: rec.error }
    const specNames = new Set((specs ?? []).map((s) => s.name))
    const blockRows: Row[] = collectFields(rec.tree)
      .filter((f) => f.block.field)
      .flatMap((f) => {
        const b = f.block
        const names = b.type === 'button' ? [b.field?.textName, b.field?.linkName].filter((n): n is string => !!n) : [f.name]
        return names.map((n) => ({
          name: n,
          label: b.field?.label ?? f.label,
          type: String(b.field?.specs?.[n]?.type ?? (b.type === 'image' ? 'image' : b.type === 'button' && n === b.field?.linkName ? 'link' : b.type === 'text' ? 'richtext' : 'text')),
          origin: (specNames.has(n) ? 'fields.json' : 'code') as Row['origin'],
          detail: `bloc ${b.type === 'heading' ? 'titre' : b.type === 'text' ? 'texte' : b.type === 'button' ? 'bouton' : 'image'} modifiable`,
          depth: 0,
        }))
      })
    const extra = (rec.tree.fields ?? []).flatMap((f) => rows(f, specNames))
    const used = new Set([...blockRows, ...extra].filter((r) => r.depth === 0).map((r) => r.name))
    const missing = (specs ?? []).filter((s) => !s.name.includes('.') && !used.has(s.name)).map((s) => s.name)
    const unknown = specs ? [...used].filter((n) => !specNames.has(n)) : []
    return { rows: [...blockRows, ...extra], missing, unknown }
  }, [html, source, specs, tree])

  const load = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      const text = await f.text()
      if (/\.json$/i.test(f.name)) {
        // meta.json is not the fields.
        if (/fields/i.test(f.name) || Array.isArray(JSON.parse(text || 'null'))) setJson(text)
      } else if (/\.css$/i.test(f.name)) setCss(text)
      else if (/\.(html?|hubl)$/i.test(f.name)) setHtml(text)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Importer un module HubSpot" className="fixed inset-0 z-50 flex items-end justify-center bg-void/80 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-xl border border-line bg-night sm:rounded-xl">
        <header className="flex items-start gap-3 border-b border-line p-4">
          <Braces className="mt-0.5 size-5 shrink-0 text-violet" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold">Importer un module HubSpot</h2>
            <p className="text-sm text-mute">
              Colle ou dépose <code className="font-mono text-cyan">module.html</code> et son <code className="font-mono text-cyan">fields.json</code> (et{' '}
              <code className="font-mono text-cyan">module.css</code> si tu l'as). Les champs gardent leurs noms, types et réglages exacts ; l'export les redonne à l'identique.
            </p>
          </div>
          <button onClick={onClose} aria-label="Fermer" className="rounded p-1.5 text-mute hover:bg-white/10 hover:text-white">
            <X className="size-4" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-2">
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-line p-3 text-sm text-mute hover:border-cyan hover:text-white">
              <FileUp className="size-4" /> Choisir les fichiers du module (.html, fields.json, .css)
              <input type="file" multiple accept=".html,.htm,.json,.css,text/html,application/json,text/css" className="sr-only" onChange={(e) => void load(e.target.files)} />
            </label>
            <label className="block">
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-mute">module.html</span>
              <textarea className={`${input} min-h-40`} value={html} onChange={(e) => setHtml(e.target.value)} placeholder="<table>… {{ module.titre }} …" />
            </label>
            <label className="block">
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-mute">fields.json (facultatif, recommandé)</span>
              <textarea className={`${input} min-h-32`} value={json} onChange={(e) => setJson(e.target.value)} placeholder='[{ "name": "titre", "label": "Titre", "type": "text", … }]' />
              {json.trim() && !specs && <span className="mt-1 block text-xs text-pink">Ce fields.json n'est pas lisible (JSON invalide ou sans liste de champs).</span>}
            </label>
            <label className="block">
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-mute">module.css (facultatif)</span>
              <textarea className={`${input} min-h-16`} value={css} onChange={(e) => setCss(e.target.value)} />
            </label>
          </div>

          <section aria-label="Champs reconnus" className="min-w-0">
            <h3 className="mb-2 font-display font-semibold">Champs reconnus</h3>
            {!report && <p className="text-sm text-mute">Le détail des champs s'affiche ici dès que le code est collé.</p>}
            {report && 'error' in report && <p className="text-sm text-pink">{report.error}</p>}
            {report && 'rows' in report && (
              <>
                <p className="mb-2 text-xs text-mute">
                  {report.rows.filter((r) => r.depth === 0).length} champs
                  {report.rows.length > report.rows.filter((r) => r.depth === 0).length && ` (${report.rows.length} avec les sous-champs)`}
                  {specs
                    ? ` · ${report.rows.filter((r) => r.origin === 'fields.json').length === report.rows.length ? 'tous' : report.rows.filter((r) => r.origin === 'fields.json').length} définis par le fields.json`
                    : ' · types déduits du code (ajoute le fields.json pour les avoir à l’identique)'}
                </p>
                <ul className="divide-y divide-line overflow-hidden rounded-md border border-line text-xs">
                  {report.rows.map((r, i) => (
                    <li key={i} className="flex items-center gap-2 px-2.5 py-1.5" style={{ paddingLeft: 10 + r.depth * 14 }}>
                      <code className="min-w-0 flex-1 truncate font-mono text-[#e3a6ff]" title={r.label}>
                        {r.name}
                        {r.detail && <span className="ml-1.5 font-sans text-mute">· {r.detail}</span>}
                      </code>
                      <span className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-cyan">{r.type}</span>
                      <span className={`shrink-0 text-[10px] ${r.origin === 'fields.json' ? 'text-white' : 'text-mute'}`} title={r.origin === 'fields.json' ? 'Défini par le fields.json' : 'Déduit de l’usage dans le code'}>
                        {r.origin === 'fields.json' ? 'fields.json' : 'déduit'}
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
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> Utilisés dans le code mais absents du fields.json (type déduit) : {report.unknown.join(', ')}
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
              const err = onImport(source, json)
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
