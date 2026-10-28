import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CloudOff,
  Code2,
  ExternalLink,
  Eye,
  Heart,
  Layers,
  ListChecks,
  Loader2,
  MailCheck,
  Monitor,
  Pencil,
  Redo2,
  RefreshCw,
  Settings2,
  Share,
  Smartphone,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
} from 'lucide-react'

import { NeonLogo } from '@/components/Maily'
import { CodeEditor } from '@/components/editor/CodeEditor'
import { ValidatorPanel } from '@/components/editor/ValidatorPanel'
import { ClientsDialog } from '@/components/editor/ClientsDialog'
import { ExportDialog } from '@/components/editor/ExportDialog'
import { FieldsPanel } from '@/components/editor/FieldsPanel'
import { Inspector } from '@/components/editor/Inspector'
import { MailyPanel } from '@/components/editor/MailyPanel'
import { Preview } from '@/components/editor/Preview'
import type { DropTarget } from '@/components/editor/Preview'
import { BLOCK_ICONS, Structure } from '@/components/editor/Structure'
import { codeToTree, reconcileIds, treeToCode } from '@/lib/hubl'
import { uploadImage } from '@/lib/images'
import { signature, withNewIds } from '@/lib/custom-blocks'
import { interpretTree, previewScope } from '@/lib/hubl-render'
import type { SampleContact } from '@/lib/hubl-render'
import { KOFI_URL } from '@/lib/links'
import type { FieldSpec } from '@/lib/module-fields'
import { findNode, findPath, insertInCell, moveNode, removeNode, replaceNode, updateNode } from '@/lib/tree'
import { BLOCK_LABELS, createBlock } from '@/lib/types'
import type { ImageBlock, ModuleTree, Section } from '@/lib/types'
import { getModule, saveModule } from '@/server/modules.functions'

export const Route = createFileRoute('/editor/$moduleId')({
  loader: async ({ params }) => {
    const mod = await getModule({ data: { id: params.moduleId } }).catch(() => null)
    if (!mod) throw notFound()
    return mod
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.name ?? 'Module'} · Neon Sandbox Pro` }] }),
  // Keyed so editor state resets when navigating between modules
  component: () => <Editor key={Route.useLoaderData().id} />,
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
      <p className="font-display text-2xl">Module introuvable</p>
      <Link to="/" className="text-cyan hover:underline">
        Retour à mes modules
      </Link>
    </div>
  ),
})

type Pane = 'structure' | 'fields' | 'maily' | 'preview' | 'inspector' | 'code'
type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

const opensKeyboard = (el: EventTarget | null) =>
  isTyping(el) && !(el as HTMLElement).matches('input[type=range], input[type=color], select')

function Editor() {
  const initial = Route.useLoaderData()
  const [name, setName] = useState(initial.name)
  const [tree, setTree] = useState<ModuleTree>(initial.tree)
  const [code, setCode] = useState(() => treeToCode(initial.tree, initial.name))
  const [codeError, setCodeError] = useState<string | null>(null)
  // True when the code is free HTML (no data-neon markers) converted on the fly.
  const [codeImported, setCodeImported] = useState(false)
  const [codeJump, setCodeJump] = useState<{ line: number; n: number }>()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobile, setMobile] = useState(false)
  const [contact, setContact] = useState<SampleContact>('known')
  const [leftTab, setLeftTab] = useState<'structure' | 'fields' | 'maily'>('structure')
  const [rightTab, setRightTab] = useState<'inspector' | 'code'>('inspector')
  const [pane, setPane] = useState<Pane>('preview')
  const [exporting, setExporting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [save, setSave] = useState<SaveState>('saved')
  const [past, setPast] = useState<ModuleTree[]>([])
  const [future, setFuture] = useState<ModuleTree[]>([])
  // Mobile: hide the tab bar while the on-screen keyboard is up.
  const [typing, setTyping] = useState(false)

  const lastPush = useRef(0)
  const codeTyped = useRef(false)

  // Rapid successive edits (slider drags, typing) collapse into one undo step.
  const pushHistory = useCallback((prev: ModuleTree) => {
    const now = Date.now()
    if (now - lastPush.current > 600) setPast((p) => [...p.slice(-60), prev])
    lastPush.current = now
    setFuture([])
  }, [])

  // Visual edit → tree is the source of truth, code is regenerated.
  const commit = (next: ModuleTree, select?: string | null) => {
    pushHistory(tree)
    setTree(next)
    setCode(treeToCode(next, name))
    setCodeError(null)
    setCodeImported(false)
    if (select !== undefined) setSelectedId(select)
  }

  // Code edit → parse (debounced) and update the tree, but never rewrite the
  // text the user is typing.
  const onCodeChange = (text: string) => {
    codeTyped.current = true
    setCode(text)
  }
  useEffect(() => {
    if (!codeTyped.current) return
    const t = setTimeout(() => {
      codeTyped.current = false
      const res = codeToTree(code, tree)
      if (!res.ok) return setCodeError(res.error)
      setCodeError(null)
      setCodeImported(!!res.imported)
      pushHistory(tree)
      setTree(reconcileIds(res.tree, tree))
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  // Used by Maily: returns an error message, or null when applied.
  const applyCode = (generated: string, specs?: FieldSpec[]) => {
    const res = codeToTree(generated, tree, specs)
    if (!res.ok) return res.error
    commit(res.tree, null)
    return null
  }

  // Used by Maily's custom blocks: appends the section unless the module already has the same one.
  const addSection = (section: Section): string | null => {
    const sig = signature(section)
    if (tree.sections.some((s) => signature(s) === sig)) return 'Ce bloc est déjà dans le module : je ne l\'ai pas ajouté une seconde fois.'
    const copy = withNewIds(section)
    commit({ ...tree, sections: [...tree.sections, copy] }, copy.id)
    return null
  }

  const undo = () => {
    const prev = past.at(-1)
    if (!prev) return
    setPast(past.slice(0, -1))
    setFuture([tree, ...future])
    setTree(prev)
    setCode(treeToCode(prev, name))
    setCodeError(null)
    lastPush.current = 0
  }
  const redo = () => {
    const [next, ...rest] = future
    if (!next) return
    setFuture(rest)
    setPast([...past, tree])
    setTree(next)
    setCode(treeToCode(next, name))
    setCodeError(null)
    lastPush.current = 0
  }

  // Autosave to Netlify Database
  const saveSeq = useRef(0)
  const firstRender = useRef(true)
  const persist = useCallback(async () => {
    const seq = ++saveSeq.current
    setSave('saving')
    try {
      await saveModule({ data: { id: initial.id, name: name.trim() || 'Sans titre', tree } })
      if (seq === saveSeq.current) setSave('saved')
    } catch {
      if (seq === saveSeq.current) setSave('error')
    }
  }, [initial.id, name, tree])

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    setSave('dirty')
    const t = setTimeout(persist, 1000)
    return () => clearTimeout(t)
  }, [persist])

  useEffect(() => {
    if (save === 'saved') return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [save])

  // Keyboard shortcuts
  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => {})
  keyHandler.current = (e) => {
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault()
      persist()
      return
    }
    if (isTyping(e.target)) return
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      e.shiftKey ? redo() : undo()
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      redo()
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault()
      commit(removeNode(tree, selectedId), null)
    } else if (e.key === 'Escape') {
      setSelectedId(null)
    }
  }
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyHandler.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // Phones get the mobile preview by default.
  useEffect(() => {
    if (window.matchMedia('(max-width: 639px)').matches) setMobile(true)
  }, [])

  useEffect(() => {
    const onFocus = (e: FocusEvent) => setTyping(opensKeyboard(e.target))
    const onBlur = () => setTimeout(() => setTyping(opensKeyboard(document.activeElement)), 50)
    window.addEventListener('focusin', onFocus)
    window.addEventListener('focusout', onBlur)
    return () => {
      window.removeEventListener('focusin', onFocus)
      window.removeEventListener('focusout', onBlur)
    }
  }, [])

  // Image files dropped on the preview: uploaded, then applied to the tree as
  // it is once the upload finishes (the user may keep editing meanwhile).
  const [uploading, setUploading] = useState<string | null>(null)
  const latest = useRef({ tree, commit })
  latest.current = { tree, commit }
  const dropImage = async (target: DropTarget, file: File) => {
    setUploading('Téléversement de l\'image…')
    try {
      const src = await uploadImage(file)
      const { tree: t, commit: c } = latest.current
      const alt = file.name.replace(/\.\w+$/, '').replace(/[-_]+/g, ' ')
      const block = { ...(createBlock('image') as ImageBlock), src, alt }
      if ('block' in target) {
        const node = findNode(t, target.block)
        if (!node) return
        if (node.type === 'image') c(updateNode(t, node.id, { src }), node.id)
        else c(replaceNode(t, node.id, [node, block]), block.id)
      } else c(insertInCell(t, target.section, target.cell, block), block.id)
      setUploading(null)
    } catch (e) {
      setUploading(e instanceof Error ? e.message : 'Échec du téléversement')
      setTimeout(() => setUploading(null), 3000)
    }
  }

  // The preview page reads the saved module: save first. The tab is opened
  // right away so the browser doesn't treat it as a popup.
  const openPreview = async () => {
    const tab = window.open('about:blank', '_blank')
    if (save !== 'saved') await persist()
    const url = `/apercu/${initial.id}`
    if (tab) tab.location.href = url
    else window.location.href = url
  }

  const select = (id: string | null) => {
    setSelectedId(id)
    if (id && rightTab !== 'code') setRightTab('inspector')
  }

  // A pane is visible on mobile when it is the active pane, and on desktop
  // when it is the active tab of its column.
  const vis = (k: Pane, desktop: boolean) => `${pane === k ? 'flex' : 'hidden'} ${desktop ? 'lg:flex' : 'lg:hidden'}`
  const tabBtn = (active: boolean) =>
    `flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-xs font-semibold ${
      active ? 'border-pink text-white' : 'border-transparent text-mute hover:text-white'
    }`
  // The preview shows the HuBL as the platform would render it; the block being
  // edited in place keeps its source text.
  const previewTree = useMemo(() => interpretTree(tree, previewScope(tree, contact), selectedId), [tree, contact, selectedId])
  const treeProps = { tree, selectedId, onSelect: select, commit }
  const selected = selectedId ? findNode(tree, selectedId) : null
  const selectedLabel =
    selected && (selected.type === 'section' && findPath(tree, selected.id).length === 1 ? 'Section' : BLOCK_LABELS[selected.type])
  const showSelectionBar = !!selected && (pane === 'preview' || pane === 'structure') && !typing

  return (
    <div className="flex h-dvh flex-col bg-void">
      {/* Top bar */}
      <header className="flex shrink-0 items-center gap-1 border-b border-line bg-space px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:gap-2 sm:px-3">
        <Link to="/" title="Mes modules" className="flex items-center gap-2 rounded-md p-1 hover:bg-white/5">
          <NeonLogo size={28} />
        </Link>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setCode(treeToCode(tree, e.target.value))
          }}
          aria-label="Nom du module"
          className="min-w-0 max-w-64 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 font-display text-base font-semibold outline-none hover:border-line focus:border-cyan"
        />
        <span className="flex shrink-0 items-center gap-1 text-xs text-mute" aria-live="polite">
          {save === 'saving' && <><Loader2 className="size-3.5 animate-spin" /> <span className="hidden sm:inline">Sauvegarde…</span></>}
          {save === 'saved' && <><Check className="size-3.5 text-cyan" /> <span className="hidden sm:inline">Sauvegardé</span></>}
          {save === 'dirty' && <><span className="size-1.5 rounded-full bg-mute sm:hidden" /><span className="hidden sm:inline">Modifications…</span></>}
          {save === 'error' && (
            <button onClick={persist} className="flex items-center gap-1 text-pink" aria-label="Échec de la sauvegarde, réessayer">
              <CloudOff className="size-3.5" /> <span className="hidden sm:inline">Échec — réessayer</span>
            </button>
          )}
        </span>
        <span className="flex-1" />
        <div className="flex items-center">
          <button onClick={undo} disabled={!past.length} title="Annuler (Ctrl+Z)" aria-label="Annuler" className="rounded-md p-2 text-mute hover:bg-white/5 hover:text-white disabled:opacity-30">
            <Undo2 className="size-4" />
          </button>
          <button onClick={redo} disabled={!future.length} title="Rétablir (Ctrl+Shift+Z)" aria-label="Rétablir" className="rounded-md p-2 text-mute hover:bg-white/5 hover:text-white disabled:opacity-30">
            <Redo2 className="size-4" />
          </button>
        </div>
        <div className="flex shrink-0 rounded-md border border-line p-0.5">
          {[
            { m: false, icon: Monitor, label: 'Bureau' },
            { m: true, icon: Smartphone, label: 'Mobile' },
          ].map((v) => (
            <button
              key={v.label}
              onClick={() => setMobile(v.m)}
              title={`Aperçu ${v.label}`}
              aria-label={`Aperçu ${v.label}`}
              className={`rounded p-1.5 ${mobile === v.m ? 'bg-cyan/15 text-cyan' : 'text-mute hover:text-white'}`}
            >
              <v.icon className="size-4" />
            </button>
          ))}
        </div>
        <select
          value={contact}
          onChange={(e) => setContact(e.target.value as SampleContact)}
          aria-label="Contact d'exemple pour l'aperçu"
          title="Contact d'exemple : les {{ contact.… }} et les conditions {% if %} sont interprétés"
          className="ml-1 hidden shrink-0 rounded-md border border-line bg-void px-1.5 py-1.5 text-xs text-mute outline-none hover:border-cyan lg:block"
        >
          <option value="known">Contact connu</option>
          <option value="unknown">Contact inconnu</option>
        </select>
        <button
          onClick={() => setTesting(true)}
          title="Tester dans les clients de messagerie"
          aria-label="Tester dans les clients de messagerie"
          className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-sm text-mute hover:border-cyan hover:text-white sm:px-2.5"
        >
          <MailCheck className="size-4" /> <span className="hidden xl:inline">Clients</span>
        </button>
        <button
          onClick={openPreview}
          title="Aperçu du module dans un nouvel onglet"
          aria-label="Aperçu du module"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-sm text-mute hover:border-cyan hover:text-white sm:px-2.5"
        >
          <ExternalLink className="size-4" /> <span className="hidden xl:inline">Aperçu</span>
        </button>
        <a
          href={KOFI_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Laisser un commentaire sur Ko-fi"
          title="Laisser un commentaire (Ko-fi)"
          className="inline-flex shrink-0 items-center rounded-md border border-line px-2 py-1.5 text-mute hover:border-pink hover:text-pink"
        >
          <Heart className="size-4" />
        </a>
        <button
          onClick={() => setExporting(true)}
          aria-label="Exporter"
          className="glow-pink ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-md bg-pink px-2.5 py-1.5 text-sm font-semibold text-white sm:px-3"
        >
          <Share className="size-4" /> <span className="hidden sm:inline">Exporter</span>
        </button>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Left column: structure / Maily */}
        <aside className="flex min-h-0 w-full flex-col border-line max-lg:contents lg:w-72 lg:shrink-0 lg:border-r xl:w-80">
          <div className="hidden border-b border-line lg:flex">
            <button className={tabBtn(leftTab === 'structure')} onClick={() => setLeftTab('structure')}>
              <Layers className="size-3.5" /> Structure
            </button>
            <button className={tabBtn(leftTab === 'fields')} onClick={() => setLeftTab('fields')}>
              <ListChecks className="size-3.5" /> Champs
            </button>
            <button className={tabBtn(leftTab === 'maily')} onClick={() => setLeftTab('maily')}>
              <Sparkles className="size-3.5" /> Maily
            </button>
          </div>
          <div className={`${vis('structure', leftTab === 'structure')} min-h-0 w-full flex-1 flex-col bg-space ${showSelectionBar ? 'max-lg:pb-20' : ''}`}>
            <Structure {...treeProps} />
          </div>
          <div className={`${vis('fields', leftTab === 'fields')} min-h-0 w-full flex-1 flex-col bg-space`}>
            <FieldsPanel {...treeProps} />
          </div>
          <div className={`${vis('maily', leftTab === 'maily')} min-h-0 w-full flex-1 flex-col bg-space`}>
            <MailyPanel tree={tree} code={code} moduleName={name} applyCode={applyCode} addSection={addSection} />
          </div>
        </aside>

        {/* Center: live preview */}
        <main className={`${vis('preview', true)} neon-grid min-h-0 min-w-0 flex-1 flex-col`}>
          <div className={`min-h-0 flex-1 overflow-auto overscroll-contain p-3 sm:p-6 ${showSelectionBar ? 'max-lg:pb-24' : ''}`}>
            <div className="mx-auto overflow-hidden rounded-xl shadow-[0_0_0_1px_#262642,0_20px_60px_-20px_rgba(188,19,254,0.35)]" style={{ maxWidth: mobile ? 420 : tree.width + 80 }}>
              <Preview
                tree={previewTree}
                selectedId={selectedId}
                onSelect={(id) => select(id ? id.split('~')[0] : id)}
                // Loop clones (id~k) are display-only: edit the source block instead.
                onEdit={(id, patch) => !id.includes('~') && commit(updateNode(tree, id, patch))}
                onDropImage={dropImage}
                mobile={mobile}
              />
            </div>
            {uploading && (
              <div role="status" className="sticky bottom-3 mx-auto mt-3 flex w-max max-w-full items-center gap-2 rounded-full border border-line bg-night/95 px-4 py-2 text-sm shadow-lg">
                {uploading.endsWith('…') ? <Loader2 className="size-4 animate-spin text-cyan" /> : <AlertTriangle className="size-4 text-pink" />}
                {uploading}
              </div>
            )}
          </div>
        </main>

        {/* Right column: settings / code */}
        <aside className="flex min-h-0 w-full flex-col border-line max-lg:contents lg:w-[400px] lg:shrink-0 lg:border-l xl:w-[460px]">
          <div className="hidden border-b border-line lg:flex">
            <button className={tabBtn(rightTab === 'inspector')} onClick={() => setRightTab('inspector')}>
              <Settings2 className="size-3.5" /> Réglages
            </button>
            <button className={tabBtn(rightTab === 'code')} onClick={() => setRightTab('code')}>
              <Code2 className="size-3.5" /> Code
              {codeError && <span className="size-1.5 rounded-full bg-pink" />}
            </button>
          </div>
          <div className={`${vis('inspector', rightTab === 'inspector')} min-h-0 w-full flex-1 flex-col bg-space`}>
            <Inspector {...treeProps} />
          </div>
          <div className={`${vis('code', rightTab === 'code')} min-h-0 w-full flex-1 flex-col bg-space`}>
            <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs">
              {codeError ? (
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-pink">
                  <AlertTriangle className="size-3.5 shrink-0" /> <span className="truncate" title={codeError}>{codeError}</span>
                </span>
              ) : codeImported ? (
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-cyan">
                  <Wand2 className="size-3.5 shrink-0" /> <span className="truncate">Code libre converti en blocs</span>
                </span>
              ) : (
                <span className="flex flex-1 items-center gap-1.5 text-cyan">
                  <Check className="size-3.5" /> Synchronisé avec l'aperçu
                </span>
              )}
              <button
                onClick={() => {
                  setCode(treeToCode(tree, name))
                  setCodeError(null)
                  setCodeImported(false)
                }}
                title={codeImported ? 'Réécrire le code au format blocs, synchronisé avec l\'aperçu' : 'Régénérer le code depuis l\'aperçu'}
                className={`inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1.5 lg:py-1 ${
                  codeImported ? 'border-cyan bg-cyan/10 text-cyan' : 'border-line text-mute hover:border-cyan hover:text-white'
                }`}
              >
                <RefreshCw className="size-3" /> {codeImported ? 'Appliquer' : 'Reformater'}
              </button>
            </div>
            <CodeEditor value={code} onChange={onCodeChange} jump={codeJump} />
            <ValidatorPanel code={code} onFix={onCodeChange} onJump={(line) => setCodeJump((j) => ({ line, n: (j?.n ?? 0) + 1 }))} />
          </div>
        </aside>
      </div>

      {/* Mobile: quick actions on the selected element */}
      {showSelectionBar && selected && (
        <div className="pointer-events-none relative h-0 lg:hidden">
          <div className="pointer-events-auto absolute inset-x-2 bottom-2 flex items-center gap-1 rounded-xl border border-pink/50 bg-night/95 p-1.5 shadow-[0_8px_30px_-6px_rgba(255,0,127,0.45)] backdrop-blur">
            {(() => {
              const Icon = BLOCK_ICONS[selected.type]
              return <Icon className="ml-1.5 size-4 shrink-0 text-cyan" />
            })()}
            <span className="min-w-0 flex-1 truncate px-1 text-sm font-semibold">{selectedLabel}</span>
            {[
              { icon: ArrowUp, label: 'Monter', fn: () => commit(moveNode(tree, selected.id, -1)) },
              { icon: ArrowDown, label: 'Descendre', fn: () => commit(moveNode(tree, selected.id, 1)) },
              { icon: Trash2, label: 'Supprimer', fn: () => commit(removeNode(tree, selected.id), null) },
            ].map((a) => (
              <button key={a.label} onClick={a.fn} aria-label={a.label} className="rounded-lg p-2.5 text-mute active:bg-white/10 active:text-white">
                <a.icon className="size-4" />
              </button>
            ))}
            <button
              onClick={() => setPane('inspector')}
              className="inline-flex items-center gap-1.5 rounded-lg bg-pink px-3 py-2 text-sm font-semibold text-white"
            >
              <Pencil className="size-3.5" /> Modifier
            </button>
          </div>
        </div>
      )}

      {/* Mobile pane switcher */}
      <nav
        aria-label="Panneaux de l'éditeur"
        className={`${typing ? 'hidden' : 'grid'} shrink-0 grid-cols-6 border-t border-line bg-space pb-[env(safe-area-inset-bottom)] lg:hidden`}
      >
        {(
          [
            { k: 'preview', icon: Eye, label: 'Aperçu', dot: false },
            { k: 'structure', icon: Layers, label: 'Structure', dot: false },
            { k: 'fields', icon: ListChecks, label: 'Champs', dot: false },
            { k: 'inspector', icon: Settings2, label: 'Réglages', dot: !!selected },
            { k: 'code', icon: Code2, label: 'Code', dot: !!codeError },
            { k: 'maily', icon: Sparkles, label: 'Maily', dot: false },
          ] as const
        ).map((t) => (
          <button
            key={t.k}
            onClick={() => setPane(t.k)}
            aria-current={pane === t.k ? 'page' : undefined}
            className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 text-[10px] sm:text-[11px] font-medium transition-colors ${
              pane === t.k ? 'text-white' : 'text-mute active:text-white'
            }`}
          >
            {pane === t.k && <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-pink shadow-[0_0_10px_#ff007f]" />}
            <span className={`relative rounded-full px-2.5 py-0.5 ${pane === t.k ? 'bg-pink/15 text-pink' : ''}`}>
              <t.icon className="size-5" />
              {t.dot && <span className={`absolute top-0 right-2 size-1.5 rounded-full ${t.k === 'code' ? 'bg-pink' : 'bg-cyan'}`} />}
            </span>
            {t.label}
          </button>
        ))}
      </nav>

      {testing && (
        <ClientsDialog
          tree={tree}
          name={name.trim() || 'Sans titre'}
          onClose={() => setTesting(false)}
          onSelect={(id) => {
            select(id)
            setPane('preview')
          }}
        />
      )}
      {exporting && <ExportDialog tree={tree} name={name.trim() || 'Sans titre'} onClose={() => setExporting(false)} />}
    </div>
  )
}
