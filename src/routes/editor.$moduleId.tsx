import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  FolderOpen,
  Heart,
  Layers,
  ListChecks,
  Loader2,
  MailCheck,
  Shapes,
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
import { VmlWindow } from '@/components/editor/VmlWindow'
import { ExportDialog } from '@/components/editor/ExportDialog'
import { FieldsPanel } from '@/components/editor/FieldsPanel'
import { Inspector } from '@/components/editor/Inspector'
import { Preview } from '@/components/editor/Preview'
import type { DropTarget } from '@/components/editor/Preview'
import { BLOCK_ICONS, Structure } from '@/components/editor/Structure'
import { codeToTree, reconcileIds, syncExtraFields, treeToCode } from '@/lib/hubl'
import { uploadImage } from '@/lib/images'
import { signature, withNewIds } from '@/lib/custom-blocks'
import { interpretTree, previewScope } from '@/lib/hubl-render'
import type { SampleContact } from '@/lib/hubl-render'
import { KOFI_URL } from '@/lib/links'
import type { FieldSpec } from '@/lib/module-fields'
import { findNode, findPath, insertInCell, moveNode, moveNodeTo, removeNode, replaceNode, updateNode } from '@/lib/tree'
import { BLOCK_LABELS, createBlock } from '@/lib/types'
import type { Block, ImageBlock, ModuleRecord, ModuleTree, Section } from '@/lib/types'
import { adoptServerModule, loadModule, persistModule } from '@/lib/data'

// Maily's panel (chat + Markdown renderer) is the heaviest part: loaded on demand.
const MailyPanel = lazy(() => import('@/components/editor/MailyPanel').then((m) => ({ default: m.MailyPanel })))

// Ids in document order: changes when blocks are added, removed or moved.
function structureKey(t: ModuleTree): string {
  const out: string[] = []
  const walk = (b: Block) => {
    out.push(b.id)
    if (b.type === 'section') b.cells.forEach((c, i) => (out.push(`|${i}`), c.forEach(walk)))
  }
  t.sections.forEach(walk)
  return out.join(',')
}

export const Route = createFileRoute('/editor/$moduleId')({
  // ?maily=1: open straight on Maily's chat (the "Parler à Maily" button of the home page).
  validateSearch: (search: Record<string, unknown>): { maily?: 1 } => (search.maily === 1 || search.maily === '1' ? { maily: 1 } : {}),
  loader: async ({ params }) => {
    const mod = await loadModule(params.moduleId).catch(() => null)
    if (!mod) throw notFound()
    return mod
  },
  head: ({ loaderData }) => ({ meta: [{ title: `${loaderData?.name ?? 'Module'} · Neon Sandbox Pro` }] }),
  // Keyed so editor state resets when navigating between modules
  component: EditorGate,
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
type SaveState = 'saved' | 'local' | 'conflict' | 'dirty' | 'saving' | 'error'

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)

const opensKeyboard = (el: EventTarget | null) =>
  isTyping(el) && !(el as HTMLElement).matches('input[type=range], input[type=color], select')

// The page may come from the server while newer edits wait in the local copy
// (made offline): those win, and the editor restarts from them.
function EditorGate() {
  const server = Route.useLoaderData()
  const [local, setLocal] = useState<ModuleRecord | null>(null)
  useEffect(() => {
    setLocal(null)
    void adoptServerModule(server).then(setLocal)
  }, [server])
  const initial = local ?? server
  return <Editor key={`${initial.id}:${local ? 'local' : 'server'}`} initial={initial} />
}

function Editor({ initial }: { initial: ModuleRecord }) {
  const openMaily = !!Route.useSearch().maily
  const [name, setName] = useState(initial.name)
  const [tree, setTree] = useState<ModuleTree>(initial.tree)
  const [code, setCode] = useState(() => treeToCode(initial.tree, initial.name))
  const [codeError, setCodeError] = useState<string | null>(null)
  // True when the code is free HTML (no data-neon markers) converted on the fly.
  const [codeImported, setCodeImported] = useState(false)
  // Fields the last pasted/typed code created (names), shown next to the code.
  const [newFields, setNewFields] = useState<string[]>([])
  const [codeJump, setCodeJump] = useState<{ line: number; n: number }>()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mobile, setMobile] = useState(false)
  const [contact, setContact] = useState<SampleContact>('known')
  const [leftTab, setLeftTab] = useState<'structure' | 'fields' | 'maily'>(openMaily ? 'maily' : 'structure')
  const [rightTab, setRightTab] = useState<'inspector' | 'code'>('inspector')
  const [pane, setPane] = useState<Pane>(openMaily ? 'maily' : 'preview')
  const [exporting, setExporting] = useState(false)
  const [testing, setTesting] = useState(false)
  const [vmlOpen, setVmlOpen] = useState(false)
  const [save, setSave] = useState<SaveState>('saved')
  const [conflictCopy, setConflictCopy] = useState<string | null>(null)
  const [past, setPast] = useState<ModuleTree[]>([])
  const [future, setFuture] = useState<ModuleTree[]>([])
  // Mobile: hide the tab bar while the on-screen keyboard is up.
  const [typing, setTyping] = useState(false)

  const lastPush = useRef(0)
  const codeTyped = useRef(false)

  // Rapid successive edits (slider drags, typing) collapse into one undo step.
  // Edits within 600 ms (typing, a slider) make one undo step; a change of
  // structure (add, delete, move, duplicate) always gets its own.
  const pushHistory = useCallback((prev: ModuleTree, next?: ModuleTree) => {
    const now = Date.now()
    if (now - lastPush.current > 600 || (next && structureKey(prev) !== structureKey(next))) setPast((p) => [...p.slice(-60), prev])
    lastPush.current = now
    setFuture([])
  }, [])

  // Visual edit → tree is the source of truth, code is regenerated.
  const commit = (raw: ModuleTree, select?: string | null) => {
    // Variables used by the code get their module field (and lose it when gone).
    const next = syncExtraFields(raw)
    pushHistory(tree, next)
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
      // Fields already created keep their edits; new variables get theirs.
      const next = syncExtraFields({ ...reconcileIds(res.tree, tree), fields: tree.fields })
      const known = new Set((tree.fields ?? []).map((f) => f.name))
      setNewFields((next.fields ?? []).map((f) => f.name).filter((n) => !known.has(n)))
      setTree(next)
    }, 250)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code])

  // Used by Maily: returns an error message, or null when applied.
  const applyCode = (generated: string, specs?: FieldSpec[]) => {
    const res = codeToTree(generated, tree, specs)
    if (!res.ok) return res.error
    // A whole new module: its variables become its fields (types from fields.json when given).
    const next = syncExtraFields({ ...res.tree, fields: undefined }, specs)
    setNewFields((next.fields ?? []).map((f) => f.name))
    commit(next, null)
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
      const r = await persistModule(initial.id, name.trim() || 'Sans titre', tree)
      if (seq !== saveSeq.current) return
      setConflictCopy(r.copyId ?? null)
      setSave(r.state)
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
    if (save === 'saved' || save === 'local') return
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
      <header className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-space px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:flex-nowrap sm:gap-2 sm:px-3">
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
          className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 font-display text-base font-semibold outline-none hover:border-line focus:border-cyan sm:max-w-64"
        />
        <span className="flex shrink-0 items-center gap-1 text-xs text-mute" aria-live="polite">
          {save === 'saving' && <><Loader2 className="size-3.5 animate-spin" /> <span className="hidden md:inline">Sauvegarde…</span></>}
          {save === 'saved' && <><Check className="size-3.5 text-cyan" /> <span className="hidden md:inline">Sauvegardé</span></>}
          {save === 'local' && <><CloudOff className="size-3.5 text-cyan" /> <span className="hidden md:inline" title="Enregistré sur cet appareil, envoyé dès que la connexion revient">Enregistré sur cet appareil</span></>}
          {save === 'conflict' && (
            <span className="flex items-center gap-1 text-pink">
              <CloudOff className="size-3.5" />
              <span className="hidden sm:inline">Modifié ailleurs : ta version est dans</span>
              {conflictCopy && (
                <Link to="/editor/$moduleId" params={{ moduleId: conflictCopy }} className="underline">
                  la copie
                </Link>
              )}
            </span>
          )}
          {save === 'dirty' && <><span className="size-1.5 rounded-full bg-mute sm:hidden" /><span className="hidden sm:inline">Modifications…</span></>}
          {save === 'error' && (
            <button onClick={persist} className="flex items-center gap-1 text-pink" aria-label="Échec de la sauvegarde, réessayer">
              <CloudOff className="size-3.5" /> <span className="hidden sm:inline">Échec — réessayer</span>
            </button>
          )}
        </span>
        <span className="hidden flex-1 sm:block" />
        {/* Phones: the tools go on a second row. */}
        <span className="order-1 h-0 basis-full sm:hidden" aria-hidden />
        <div className="order-2 flex flex-1 items-center sm:order-none sm:flex-none">
          <button onClick={undo} disabled={!past.length} title="Annuler (Ctrl+Z)" aria-label="Annuler" className="max-sm:flex-1 max-sm:justify-center rounded-md p-2 text-mute hover:bg-white/5 hover:text-white disabled:opacity-30">
            <Undo2 className="size-4" />
          </button>
          <button onClick={redo} disabled={!future.length} title="Rétablir (Ctrl+Shift+Z)" aria-label="Rétablir" className="max-sm:flex-1 max-sm:justify-center rounded-md p-2 text-mute hover:bg-white/5 hover:text-white disabled:opacity-30">
            <Redo2 className="size-4" />
          </button>
        </div>
        <div className="hidden shrink-0 rounded-md border border-line p-0.5 sm:flex">
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
          onClick={() => setVmlOpen((v) => !v)}
          title="Volet VML pour Outlook, structure en direct"
          aria-label="Volet VML pour Outlook"
          aria-pressed={vmlOpen}
          className={`order-2 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-sm hover:text-white max-sm:flex-1 sm:order-none sm:ml-1 sm:px-2.5 ${vmlOpen ? 'border-violet text-white' : 'border-line text-mute hover:border-violet'}`}
        >
          <Shapes className="size-4" /> <span className="max-sm:text-xs sm:hidden xl:inline">VML</span>
          {tree.vml && <span className="size-1.5 rounded-full bg-cyan" aria-label="VML actif" />}
        </button>
        <button
          onClick={() => setTesting(true)}
          title="Tester dans les clients de messagerie"
          aria-label="Tester dans les clients de messagerie"
          className="order-2 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-sm text-mute hover:border-cyan hover:text-white max-sm:flex-1 sm:order-none sm:ml-1 sm:px-2.5"
        >
          <MailCheck className="size-4" /> <span className="max-sm:text-xs sm:hidden xl:inline">Clients</span>
        </button>
        <button
          onClick={openPreview}
          title="Aperçu du module dans un nouvel onglet"
          aria-label="Aperçu du module"
          className="order-2 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-sm text-mute hover:border-cyan hover:text-white max-sm:flex-1 sm:order-none sm:px-2.5"
        >
          <ExternalLink className="size-4" /> <span className="max-sm:text-xs sm:hidden xl:inline">Aperçu</span>
        </button>
        <a
          href="/fichiers"
          target="_blank"
          rel="noreferrer"
          aria-label="Fichiers"
          title="Fichiers (nouvel onglet)"
          className="hidden shrink-0 items-center rounded-md border border-line px-2 py-1.5 text-mute hover:border-cyan hover:text-cyan sm:inline-flex"
        >
          <FolderOpen className="size-4" />
        </a>
        <a
          href={KOFI_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Laisser un commentaire sur Ko-fi"
          title="Laisser un commentaire (Ko-fi)"
          className="hidden shrink-0 items-center rounded-md border border-line px-2 py-1.5 text-mute hover:border-pink hover:text-pink sm:inline-flex"
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

      {/* Work area + docked VML panel: under the work, or beside it on a phone held sideways. */}
      <div className="flex min-h-0 flex-1 flex-col [@media(max-height:500px)]:flex-row">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
            <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-cyan" /></div>}>
              <MailyPanel tree={tree} code={code} moduleName={name} applyCode={applyCode} addSection={addSection} />
            </Suspense>
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
                onMove={(id, target) => commit(moveNodeTo(tree, id, target), id)}
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
                  <Wand2 className="size-3.5 shrink-0" />{' '}
                  <span className="truncate">
                    Code reconnu et converti en blocs
                    {newFields.length > 0 && ` · ${newFields.length} champ${newFields.length > 1 ? 's' : ''} créé${newFields.length > 1 ? 's' : ''}`}
                  </span>
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

      </div>

      {vmlOpen && (
        <VmlWindow
          tree={tree}
          name={name.trim() || 'Sans titre'}
          selectedId={selectedId}
          onSelect={select}
          onToggle={() => {
            const { vml: _v, ...rest } = tree
            void _v
            commit(tree.vml ? rest : { ...rest, vml: true })
          }}
          onClose={() => setVmlOpen(false)}
          commit={commit}
        />
      )}
      </div>

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
            className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors sm:text-[11px] [@media(max-height:500px)]:min-h-11 [@media(max-height:500px)]:flex-row [@media(max-height:500px)]:gap-1.5 ${
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
