import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, createFileRoute, notFound } from '@tanstack/react-router'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Braces,
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
import { OPEN_MAILY_EVENT } from '@/components/OfflineManager'
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
import { interpretForPreview } from '@/lib/hubl-render'
import type { SampleContact } from '@/lib/hubl-render'
import { checkPreview } from '@/lib/preview-check'
import { fixCode, validateSyntax } from '@/lib/validator'
import { keepTemplateWhole, upgradeImported } from '@/lib/import-repair'
import { countLogic } from '@/lib/logic'
import { getPref } from '@/lib/settings-sync'
import { SHOW_LOGIC_KEY } from '@/lib/settings-keys'
import { KOFI_URL } from '@/lib/links'
import type { FieldSpec } from '@/lib/module-fields'
import { applyValues } from '@/lib/json-import'
import { HubSpotImport } from '@/components/editor/HubSpotImport'
import { findNode, findPath, insertInCell, moveNode, moveNodeTo, removeNode, replaceNode, updateNode } from '@/lib/tree'
import { BLOCK_LABELS, createBlock } from '@/lib/types'
import type { Block, ImageBlock, ModuleRecord, ModuleTree, Section } from '@/lib/types'
import { adoptServerModule, freshModule, loadModule, persistModule, showNotice } from '@/lib/data'
import { bringImages, findImageUrls, imagesNote, swapUrls, textsOf } from '@/lib/import-images'

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

// Emergency copy of unsaved changes, written synchronously when the page goes away.
const rescueKey = (id: string) => `nsp-rescue-${id}`
function writeRescue(id: string, name: string, tree: ModuleTree) {
  try {
    localStorage.setItem(rescueKey(id), JSON.stringify({ at: Date.now(), name, tree }))
  } catch {
    // Storage full or blocked: the normal save is still running.
  }
}
function readRescue(id: string): { at: number; name: string; tree: ModuleTree } | null {
  try {
    const v = JSON.parse(localStorage.getItem(rescueKey(id)) ?? 'null') as { at?: unknown; name?: unknown; tree?: { sections?: unknown } } | null
    return v && typeof v.at === 'number' && typeof v.name === 'string' && v.tree && Array.isArray(v.tree.sections) ? (v as { at: number; name: string; tree: ModuleTree }) : null
  } catch {
    return null
  }
}
function clearRescue(id: string) {
  try {
    localStorage.removeItem(rescueKey(id))
  } catch {
    // Nothing to do.
  }
}

function EditorGate() {
  const server = Route.useLoaderData()
  const [local, setLocal] = useState<ModuleRecord | null>(null)
  useEffect(() => {
    setLocal(null)
    void adoptServerModule(server).then(setLocal)
  }, [server])
  const initial = local ?? server

  // Changed on another device (phone, computer…) while this one was in the
  // background: reopen the latest version, as long as nothing here is unsaved.
  const idle = useRef(true)
  const shown = useRef(initial.updatedAt)
  shown.current = initial.updatedAt
  useEffect(() => {
    let alive = true
    const check = () => {
      if (document.visibilityState !== 'visible' || !idle.current) return
      void freshModule(initial.id, shown.current).then((rec) => {
        if (alive && rec && idle.current) {
          setLocal(rec)
          showNotice('Ce module a été modifié sur un autre appareil : voici sa dernière version.')
        }
      })
    }
    document.addEventListener('visibilitychange', check)
    window.addEventListener('online', check)
    const timer = setInterval(check, 60_000)
    return () => {
      alive = false
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('online', check)
      clearInterval(timer)
    }
  }, [initial.id])

  return <Editor key={`${initial.id}:${local ? `local:${local.updatedAt}` : 'server'}`} initial={initial} idle={idle} />
}

function Editor({ initial, idle }: { initial: ModuleRecord; idle: { current: boolean } }) {
  const openMaily = !!Route.useSearch().maily
  const [name, setName] = useState(initial.name)
  const [tree, setTree] = useState<ModuleTree>(initial.tree)
  const [code, setCode] = useState(() => treeToCode(initial.tree, initial.name))
  const [codeError, setCodeError] = useState<string | null>(null)
  const [codeImported, setCodeImported] = useState(false)
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
  const [hsImport, setHsImport] = useState(false)
  const [save, setSave] = useState<SaveState>('saved')
  const [conflictCopy, setConflictCopy] = useState<string | null>(null)
  const [past, setPast] = useState<ModuleTree[]>([])
  const [future, setFuture] = useState<ModuleTree[]>([])
  const [typing, setTyping] = useState(false)
  const [pageHidden, setPageHidden] = useState(() => typeof document !== 'undefined' && document.visibilityState === 'hidden')
  // A request the validator hands to Maily ("Maily" button): she explains and fixes.
  const [mailyRequest, setMailyRequest] = useState<{ text: string; n: number } | null>(null)
  const askMaily = (text: string) => {
    setLeftTab('maily')
    setPane('maily')
    setMailyRequest((r) => ({ text, n: (r?.n ?? 0) + 1 }))
  }

  // "Parler à Maily" from the offline status panel (OfflineManager).
  useEffect(() => {
    const open = () => {
      setLeftTab('maily')
      setPane('maily')
    }
    window.addEventListener(OPEN_MAILY_EVENT, open)
    return () => window.removeEventListener(OPEN_MAILY_EVENT, open)
  }, [])

  const lastPush = useRef(0)
  const codeTyped = useRef(false)

  useEffect(() => {
    const onVisibility = () => setPageHidden(document.visibilityState === 'hidden')
    onVisibility()
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const pushHistory = useCallback((prev: ModuleTree, next?: ModuleTree) => {
    const now = Date.now()
    if (now - lastPush.current > 600 || (next && structureKey(prev) !== structureKey(next))) setPast((p) => [...p.slice(-60), prev])
    lastPush.current = now
    setFuture([])
  }, [])

  const commit = (raw: ModuleTree, select?: string | null) => {
    const next = syncExtraFields(raw)
    pushHistory(tree, next)
    setTree(next)
    setCode(treeToCode(next, name))
    setCodeError(null)
    setCodeImported(false)
    if (select !== undefined) setSelectedId(select)
  }


  // Changes that were still being saved when the page went away (closed, reloaded,
  // killed in the background): put back, then saved like any change.
  useEffect(() => {
    const r = readRescue(initial.id)
    if (!r) return
    if (r.at <= Date.parse(initial.updatedAt) || (JSON.stringify(r.tree) === JSON.stringify(initial.tree) && r.name === initial.name)) return clearRescue(initial.id)
    pushHistory(initial.tree)
    setName(r.name)
    setTree(r.tree)
    setCode(treeToCode(r.tree, r.name))
    showNotice('Tes dernières modifications, pas encore enregistrées quand la page s’est fermée, ont été récupérées. « Annuler » revient à la version précédente.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A module imported before templates were kept whole: repaired once when
  // opened, if putting its template back together shows it better (undo restores).
  useEffect(() => {
    const up = upgradeImported(initial.tree)
    if (!up) return
    commit(up)
    showNotice('Module mis à jour : son modèle importé est maintenant gardé tel quel. « Annuler » revient à la version précédente.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onCodeChange = (text: string) => {
    codeTyped.current = true
    setCode(text)
    setSave('dirty')
  }
  // Code typed in the Code tab, read into the tree (also called at once when the
  // page is hidden or left, so the last keystrokes are never lost). Returns the
  // new tree, or null when there was nothing to read or the code doesn't parse.
  const readTypedCode = (): ModuleTree | null => {
    if (!codeTyped.current) return null
    codeTyped.current = false
    const res = codeToTree(code, tree)
    if (!res.ok) {
      setCodeError(res.error)
      return null
    }
    setCodeError(null)
    setCodeImported(!!res.imported)
    // Code from another tool pasted here: its images are copied into the tool.
    if (res.imported) bringPastedImages(code)
    pushHistory(tree)
    const synced = syncExtraFields({ ...reconcileIds(res.tree, tree), fields: res.imported ? undefined : tree.fields }, undefined, res.imported ? code : undefined)
    // Pasted template whose layout the blocks would lose: kept whole.
    const next = (res.imported && keepTemplateWhole(code, synced)) || synced
    const known = new Set((tree.fields ?? []).map((f) => f.name))
    setNewFields((next.fields ?? []).map((f) => f.name).filter((n) => !known.has(n)))
    setTree(next)
    return next
  }
  const readTyped = useRef(readTypedCode)
  readTyped.current = readTypedCode
  useEffect(() => {
    if (!codeTyped.current) return
    const t = setTimeout(() => readTyped.current(), 250)
    return () => clearTimeout(t)
  }, [code])

  // « Reformater » / « Appliquer »: reads the code as it is now (even typed a
  // moment ago), repairs what is mechanical when it doesn't parse, then rewrites
  // it cleanly indented. Never wipes the person's code: when it can't be read,
  // it says why and leaves it as typed.
  const [codeNote, setCodeNote] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    if (!codeNote) return
    const t = setTimeout(() => setCodeNote(null), codeNote.ok ? 2500 : 8000)
    return () => clearTimeout(t)
  }, [codeNote])
  const reformat = () => {
    let src = code
    let fixed = false
    // HuBL or HTML errors first: what the validator can repair is repaired, the
    // rest stops here (rewriting broken code could lose part of it).
    if (validateSyntax(src).errors > 0) {
      const repaired = fixCode(src).code
      const left = validateSyntax(repaired)
      if (left.errors > 0) {
        const first = left.issues.find((i) => i.severity === 'error')
        setCodeNote({ ok: false, text: `Reformatage impossible : ${first ? `ligne ${first.line}, ${first.message}.` : 'le code contient une erreur.'} Ton code est gardé tel quel ; corrige-la (le validateur en bas l'explique), puis reformate.` })
        return
      }
      src = repaired
      fixed = true
    }
    const res = codeToTree(src, tree)
    if (!res.ok) {
      setCodeError(res.error)
      setCodeNote({ ok: false, text: `Reformatage impossible : ${res.error} Ton code est gardé tel quel ; le validateur en bas indique la ligne à corriger.` })
      return
    }
    codeTyped.current = false
    const synced = syncExtraFields({ ...reconcileIds(res.tree, tree), fields: res.imported ? undefined : tree.fields }, undefined, res.imported ? src : undefined)
    const next = (res.imported && keepTemplateWhole(src, synced)) || synced
    pushHistory(tree, next)
    setTree(next)
    const out = treeToCode(next, name)
    setCodeNote({ ok: true, text: out === code ? 'Le code est déjà bien formaté.' : fixed ? 'Code corrigé puis reformaté.' : res.imported ? 'Code converti en blocs et reformaté.' : 'Code reformaté.' })
    setCode(out)
    setCodeError(null)
    setCodeImported(false)
  }

  // Module copied from another tool (« Importer »): its images are copied into
  // the tool first and their addresses swapped (src/lib/import-images.ts).
  const importWithImages = async ({ source, specs, values }: { source: string; specs?: FieldSpec[]; values?: Record<string, unknown> | null }) => {
    const text = [source, ...(specs ?? []).map((f) => JSON.stringify(f)), values ? JSON.stringify(values) : ''].join('\n')
    const got = await bringImages(text)
    for (const t of Object.keys(got.map)) brought.current.add(t)
    const p = swapUrls({ source, specs, values }, got.map)
    return applyCode(p.source, p.specs, p.values, imagesNote(got))
  }
  // Addresses already handled for code pasted in the Code tab (asked once each).
  const brought = useRef(new Set<string>())
  const bringPastedImages = (pasted: string) => {
    const fresh = findImageUrls(pasted).filter((t) => !brought.current.has(t))
    if (!fresh.length) return
    fresh.forEach((t) => brought.current.add(t))
    void bringImages(fresh.join('\n')).then((got) => {
      if (Object.keys(got.map).length) {
        // Swapped in the code as it is now (the user may have typed since), then read again.
        setCode((c) => swapUrls(c, got.map))
        codeTyped.current = true
      }
      const note = imagesNote(got)
      if (note) showNotice(note)
    })
  }

  // Code applied by Maily (a module recreated from another tool's code, a page,
  // a capture…): once applied, its outside images are copied into the tool and
  // swapped in the module as it is then (one more undoable step).
  const treeNow = useRef(tree)
  treeNow.current = tree
  const commitNow = useRef<(t: ModuleTree) => void>(() => {})
  commitNow.current = (t: ModuleTree) => commit(t)
  const bringTreeImages = (t: ModuleTree) => {
    const fresh = findImageUrls(textsOf(t).join('\n')).filter((u) => !brought.current.has(u))
    if (!fresh.length) return
    fresh.forEach((u) => brought.current.add(u))
    void bringImages(fresh.join('\n')).then((got) => {
      if (Object.keys(got.map).length) {
        if (codeTyped.current) {
          // The user is typing in Code: swapped in the code, read again from there.
          setCode((c) => swapUrls(c, got.map))
          codeTyped.current = true
        } else commitNow.current(swapUrls(treeNow.current, got.map))
      }
      const note = imagesNote(got)
      if (note) showNotice(note)
    })
  }
  const applyFromMaily = (generated: string, specs?: FieldSpec[], values?: Record<string, unknown> | null) => {
    const err = applyCode(generated, specs, values)
    if (!err) setTimeout(() => bringTreeImages(treeNow.current), 0)
    return err
  }

  const applyCode = (generated: string, specs?: FieldSpec[], values?: Record<string, unknown> | null, extraNote?: string | null) => {
    const res = codeToTree(generated, tree, specs)
    if (!res.ok) return res.error
    const synced = syncExtraFields({ ...res.tree, fields: undefined }, specs, generated)
    const next = applyValues((res.imported && keepTemplateWhole(generated, synced, specs)) || synced, values ?? null).tree
    setNewFields((next.fields ?? []).map((f) => f.name))
    commit(next, null)
    const logic = countLogic(next)
    const logicNote =
      res.imported && logic && getPref(SHOW_LOGIC_KEY) !== '1'
        ? `Import appliqué. ${logic} ligne${logic > 1 ? 's' : ''} de logique (conditions, boucles, variables) ${logic > 1 ? 'sont masquées' : 'est masquée'} dans la Structure : elle${logic > 1 ? 's' : ''} ne s’affiche${logic > 1 ? 'nt' : ''} pas dans l’e-mail. « Annuler » revient au module d’avant.`
        : null
    const note = [extraNote, logicNote].filter(Boolean).join(' ')
    if (note) showNotice(note)
    return null
  }

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

  // ---- Autosave ------------------------------------------------------------
  // Every change is written 1 s after the last one (locally first, then to the
  // account). Saves never overlap: one runs at a time and, if something changed
  // meanwhile, the newest version is saved right after. Hiding the page, leaving
  // the editor or Ctrl+S save at once; a failed save is retried by itself.
  const current = useRef({ name, tree })
  current.current = { name, tree }
  const version = useRef(0) // bumped on every change
  const savedVersion = useRef(0) // the version last written
  const running = useRef<Promise<void> | null>(null)
  const retry = useRef<{ timer?: ReturnType<typeof setTimeout>; delay: number }>({ delay: 0 })
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  // Retried by itself: 3 s, 10 s, 30 s, then every minute (and as soon as the connection is back).
  const later = () => {
    const d = retry.current.delay
    retry.current.delay = d ? (d < 10_000 ? 10_000 : d < 30_000 ? 30_000 : 60_000) : 3_000
    clearTimeout(retry.current.timer)
    retry.current.timer = setTimeout(() => void saveNow(), retry.current.delay)
  }
  const saveNow = useCallback((): Promise<void> => {
    if (running.current) return running.current.then(() => (savedVersion.current < version.current && !retry.current.timer ? saveNow() : undefined))
    clearTimeout(retry.current.timer)
    retry.current.timer = undefined
    const target = version.current
    const { name: n, tree: t } = current.current
    if (alive.current) setSave('saving')
    running.current = persistModule(initial.id, n.trim() || 'Sans titre', t)
      .then((r) => {
        // Kept on this device only while the connection is up (the server didn't
        // answer): not done yet, pushed again shortly. Offline, the sync on reconnect does it.
        const pending = r.state === 'local' && navigator.onLine
        if (!pending) {
          savedVersion.current = Math.max(savedVersion.current, target)
          retry.current.delay = 0
          if (savedVersion.current >= version.current) clearRescue(initial.id)
        }
        if (!alive.current) return
        setConflictCopy(r.copyId ?? null)
        setSave(version.current > target ? 'dirty' : r.state)
        if (pending) later()
      })
      .catch(() => {
        if (!alive.current) return
        setSave('error')
        later()
      })
      .finally(() => {
        running.current = null
      })
    // Newer changes made during this save: saved right after (a failed or
    // pending save waits for its retry instead of looping).
    return running.current.then(() => (savedVersion.current < version.current && version.current > target && alive.current ? saveNow() : undefined))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id])

  // Everything pending (code being typed included), saved now. When the page
  // goes away, a copy is also written synchronously on the device (localStorage):
  // the asynchronous save may not finish before the page is gone.
  const flush = useCallback(
    (leaving = false): Promise<void> => {
      const next = readTyped.current()
      if (next) {
        current.current = { ...current.current, tree: next }
        version.current++
      }
      if (savedVersion.current >= version.current) return Promise.resolve()
      if (leaving) writeRescue(initial.id, current.current.name, current.current.tree)
      return saveNow()
    },
    [saveNow, initial.id],
  )
  const persist = () => flush()

  const firstRender = useRef(true)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    version.current++
    setSave('dirty')
    const t = setTimeout(() => void saveNow(), 1000)
    return () => clearTimeout(t)
  }, [name, tree, saveNow])

  // Hidden (tab switched, phone locked, app in the background) or closed: save at once.
  useEffect(() => {
    const now = () => void flush(true)
    const onVisibility = () => document.visibilityState === 'hidden' && now()
    const onOnline = () => savedVersion.current < version.current && void saveNow()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', now)
    window.addEventListener('online', onOnline)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', now)
      window.removeEventListener('online', onOnline)
      clearTimeout(retry.current.timer)
      // Leaving the editor (another page of the app): what is pending is saved.
      void flush(true)
    }
  }, [flush, saveNow])

  // Nothing unsaved (and not typing): the gate may swap in a newer version from another device.
  idle.current = save === 'saved' && !typing

  useEffect(() => {
    if (save === 'saved' || save === 'local') return
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [save])

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

  // Phones held sideways (land): the preview stays on screen and the chosen
  // panel opens beside it, on the right.
  const vis = (k: Pane, desktop: boolean) =>
    `${pane === k ? 'flex' : 'hidden'} ${desktop ? 'lg:flex' : 'lg:hidden'} ${k === 'preview' ? 'land:flex' : `land:order-last land:flex-none land:border-l land:border-line ${k === 'code' ? 'land:w-[60%]' : 'land:w-[min(50%,27rem)]'}`}`
  const tabBtn = (active: boolean) =>
    `flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-xs font-semibold ${
      active ? 'border-pink text-white' : 'border-transparent text-mute hover:text-white'
    }`
  // Interpreted tree for the preview; `forced` = options switched on only to
  // show content they would otherwise hide entirely.
  const { tree: previewTree, forced, revealed } = useMemo(() => {
    if (pageHidden) return { tree, forced: [] as string[], revealed: false }
    return interpretForPreview(tree, contact, selectedId)
  }, [tree, contact, selectedId, pageHidden])
  // What the preview shows that the code validator can't see (empty preview, example items…).
  const previewNotes = useMemo(() => (pageHidden ? [] : checkPreview(tree, previewTree)), [tree, previewTree, pageHidden])
  // A version kept by the account, applied like any change (undoable, autosaved).
  const restoreVersion = (n: string, t: ModuleTree) => {
    commit(t, null)
    setName(n)
    showNotice('Version restaurée. « Annuler » revient à la version d’avant.')
  }
  const treeProps = { tree, selectedId, onSelect: select, commit, moduleId: initial.id, onRestore: restoreVersion }
  const selected = selectedId ? findNode(tree, selectedId) : null
  const selectedLabel =
    selected && (selected.type === 'section' && findPath(tree, selected.id).length === 1 ? 'Section' : BLOCK_LABELS[selected.type])
  const showSelectionBar = !!selected && (pane === 'preview' || pane === 'structure') && !typing

  return (
    <div className="flex h-[var(--app-h,100dvh)] flex-col bg-void land:grid land:grid-cols-[4.25rem_minmax(0,1fr)] land:grid-rows-[auto_minmax(0,1fr)]">
      <header className="flex shrink-0 flex-wrap items-center gap-1 border-b border-line bg-space px-2 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] sm:flex-nowrap sm:gap-2 sm:px-3 land:col-span-2 land:py-1 land:pt-[max(0.25rem,env(safe-area-inset-top))]">
        <Link to="/" title="Mes modules" aria-label="Mes modules" className="flex items-center gap-2 rounded-md p-1 hover:bg-white/5">
          <NeonLogo size={28} />
        </Link>
        <h1 className="sr-only">Éditeur · {name || 'Module sans nom'}</h1>
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
          {save === 'local' && <><CloudOff className="size-3.5 text-cyan" /> <span className="hidden md:inline" title="Enregistré sur cet appareil, envoyé dès que la connexion revient">Enregistré localement</span></>}
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
        <span className="order-1 h-0 basis-full sm:hidden" aria-hidden />
        <div className="order-2 flex flex-1 items-center sm:order-none sm:flex-none">
          <button onClick={undo} disabled={!past.length} title="Annuler (Ctrl+Z)" aria-label="Annuler" className="max-sm:flex-1 max-sm:justify-center rounded-md p-2 text-mute hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
            <Undo2 className="size-4" />
          </button>
          <button onClick={redo} disabled={!future.length} title="Rétablir (Ctrl+Shift+Z)" aria-label="Rétablir" className="max-sm:flex-1 max-sm:justify-center rounded-md p-2 text-mute hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-40">
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
          className={`order-2 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-sm hover:text-white max-sm:flex-1 sm:order-none sm:ml-1 sm:px-2.5 ${vmlOpen ? 'border-cyan bg-cyan/10 text-cyan' : 'border-line text-mute hover:border-cyan'}`}
        >
          <Shapes className="size-4" /> <span className="max-sm:text-xs sm:hidden xl:inline">VML</span>
          {tree.vml && <span className="size-1.5 rounded-full bg-cyan" aria-label="VML actif" />}
        </button>
        <button
          onClick={() => setTesting(true)}
          title="Tester dans les clients de messagerie"
          aria-label="Tester dans les clients de messagerie"
          className="order-2 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-sm text-mute hover:border-cyan hover:text-white max-sm:flex-1 sm:order-none"
        >
          <MailCheck className="size-4" /> <span className="max-sm:text-xs sm:hidden xl:inline">Clients</span>
        </button>
        <button
          onClick={openPreview}
          title="Aperçu du module dans un nouvel onglet"
          aria-label="Aperçu du module"
          className="order-2 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md border border-line px-2 py-1.5 text-sm text-mute hover:border-cyan hover:text-white max-sm:flex-1 sm:order-none"
        >
          <ExternalLink className="size-4" /> <span className="max-sm:text-xs sm:hidden xl:inline">Aperçu</span>
        </button>
        <a
          href="/fichiers"
          target="_blank"
          rel="noreferrer"
          aria-label="Fichiers"
          title="Fichiers (nouvel onglet)"
          className="hidden shrink-0 items-center rounded-md border border-line px-2 py-1.5 text-mute hover:border-cyan hover:text-cyan sm:inline-flex land:hidden"
        >
          <FolderOpen className="size-4" />
        </a>
        <a
          href={KOFI_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="Laisser un commentaire sur Ko-fi"
          title="Laisser un commentaire (Ko-fi)"
          className="hidden shrink-0 items-center rounded-md border border-line px-2 py-1.5 text-mute hover:border-pink hover:text-pink sm:inline-flex land:hidden"
        >
          <Heart className="size-4" />
        </a>
        <button
          onClick={() => setExporting(true)}
          aria-label="Exporter"
          className="glow-pink ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-md bg-pink-fill px-2.5 py-1.5 text-sm font-semibold text-white sm:px-3"
        >
          <Share className="size-4" /> <span className="hidden sm:inline">Exporter</span>
        </button>
      </header>

      <div className={`flex min-h-0 flex-1 flex-col [@media(max-height:500px)]:flex-row land:row-start-2 ${typing ? 'land:col-span-2 land:col-start-1' : 'land:col-start-2'}`}>
        <div className={`flex min-h-0 min-w-0 flex-1 flex-col ${vmlOpen ? 'land:hidden' : ''}`}>
          <div className="flex min-h-0 flex-1">
            <aside aria-label="Structure, champs et Maily" className="flex min-h-0 w-full flex-col border-line max-lg:contents lg:w-72 lg:shrink-0 lg:border-r xl:w-80 tablet:!w-60">
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
                <Structure {...treeProps} storageKey={initial.id} />
              </div>
              <div className={`${vis('fields', leftTab === 'fields')} min-h-0 w-full flex-1 flex-col bg-space`}>
                <FieldsPanel {...treeProps} />
              </div>
              <div className={`${vis('maily', leftTab === 'maily')} min-h-0 w-full flex-1 flex-col bg-space`}>
                <Suspense fallback={<div className="flex flex-1 items-center justify-center"><Loader2 className="size-5 animate-spin text-cyan" /></div>}>
                  <MailyPanel tree={tree} code={code} moduleName={name} applyCode={applyFromMaily} applyTree={(t) => commit(t)} selectedId={selectedId} addSection={addSection} request={mailyRequest} />
                </Suspense>
              </div>
            </aside>

            <main id="contenu" className={`${vis('preview', true)} neon-grid min-h-0 min-w-0 flex-1 flex-col`}>
              <div className={`min-h-0 flex-1 overflow-auto overscroll-contain p-3 sm:p-6 tablet:!p-3 ${showSelectionBar ? 'max-lg:pb-24' : ''}`}>
                {forced.length > 0 && (
                  <p role="status" className="mx-auto mb-3 max-w-[600px] rounded-lg border border-violet/50 bg-violet/10 px-3 py-2 text-xs text-[#e3a6ff]">
                    Tout le contenu dépend {forced.length > 1 ? 'des options' : 'de l’option'} « {forced.join(' », « ')} », désactivée{forced.length > 1 ? 's' : ''} dans le module : l’aperçu {forced.length > 1 ? 'les' : 'l’'}active pour te le montrer. Change sa valeur dans l’onglet Champs.
                  </p>
                )}
                {revealed && (
                  <p role="status" className="mx-auto mb-3 max-w-[600px] rounded-lg border border-violet/50 bg-violet/10 px-3 py-2 text-xs text-[#e3a6ff]">
                    Avec les données d’exemple, les conditions du code masquent tout le contenu : l’aperçu montre leur premier cas (et un exemple pour les listes vides) pour que tu le voies. L’e-mail envoyé suit les vraies conditions.
                  </p>
                )}
                <div className="mx-auto overflow-hidden rounded-xl shadow-[0_0_0_1px_#262642,0_20px_60px_-20px_rgba(188,19,254,0.35)]" style={{ maxWidth: mobile ? 420 : tree.width + 80 }}>
                  <Preview
                    tree={previewTree}
                    selectedId={selectedId}
                    onSelect={(id) => select(id ? id.split('~')[0] : id)}
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

            <aside aria-label="Réglages et code" className="flex min-h-0 w-full flex-col border-line max-lg:contents lg:w-[400px] lg:shrink-0 lg:border-l xl:w-[460px] tablet:!w-80">
              <div className="hidden border-b border-line lg:flex">
                <button className={tabBtn(rightTab === 'inspector')} onClick={() => setRightTab('inspector')}>
                  <Settings2 className="size-3.5" /> Réglages
                </button>
                <button className={tabBtn(rightTab === 'code')} onClick={() => setRightTab('code')}>
                  <Code2 className="size-3.5" /> Code
                  {codeError && <span className="size-1.5 rounded-full bg-pink-fill" />}
                </button>
              </div>
              <div className={`${vis('inspector', rightTab === 'inspector')} min-h-0 w-full flex-1 flex-col bg-space`}>
                <Inspector {...treeProps} />
              </div>
              <div className={`${vis('code', rightTab === 'code')} min-h-0 w-full flex-1 flex-col bg-space`}>
                <div className="flex items-center gap-2 border-b border-line px-3 py-2 text-xs">
                  {codeNote ? (
                    <span role="status" className={`flex min-w-0 flex-1 items-center gap-1.5 ${codeNote.ok ? 'text-cyan' : 'text-pink'}`}>
                      {codeNote.ok ? <Check className="size-3.5 shrink-0" /> : <AlertTriangle className="size-3.5 shrink-0" />}
                      <span className="line-clamp-2" title={codeNote.text}>{codeNote.text}</span>
                    </span>
                  ) : codeError ? (
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
                    onClick={reformat}
                    title={codeImported ? 'Réécrire le code au format blocs, synchronisé avec l\'aperçu' : 'Remettre le code en forme (indentation, une balise par ligne), sans rien perdre de tes modifications'}
                    className={`inline-flex shrink-0 items-center gap-1 rounded border px-2 py-1.5 lg:py-1 ${
                      codeImported ? 'border-cyan bg-cyan/10 text-cyan' : 'border-line text-mute hover:border-cyan hover:text-white'
                    }`}
                  >
                    <RefreshCw className="size-3" /> {codeImported ? 'Appliquer' : 'Reformater'}
                  </button>
                  <button
                    onClick={() => setHsImport(true)}
                    title="Importer un module existant (code, champs et styles) avec ses champs exacts"
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-2 py-1.5 text-mute hover:border-violet hover:text-white lg:py-1"
                  >
                    <Braces className="size-3" /> Importer
                  </button>
                </div>
                <CodeEditor value={code} onChange={onCodeChange} jump={codeJump} />
                <ValidatorPanel code={code} notes={previewNotes} onFix={onCodeChange} onJump={(line) => setCodeJump((j) => ({ line, n: (j?.n ?? 0) + 1 }))} onAskMaily={askMaily} onReimport={() => setHsImport(true)} />
              </div>
            </aside>
          </div>

          {showSelectionBar && selected && (
            <div className="pointer-events-none relative h-0 lg:hidden">
              <div className="pointer-events-auto absolute inset-x-2 bottom-2 flex items-center gap-1 rounded-xl border border-pink/50 bg-night/95 p-1.5 shadow-[0_8px_30px_-6px_rgba(255,0,127,0.45)]">
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
                  className="inline-flex items-center gap-1.5 rounded-lg bg-pink-fill px-3 py-2 text-sm font-semibold text-white"
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

      <nav
        aria-label="Panneaux de l'éditeur"
        className={`${typing ? 'hidden' : 'grid'} shrink-0 grid-cols-6 border-t border-line bg-space pb-[max(0px,env(safe-area-inset-bottom))] lg:hidden land:col-start-1 land:row-start-2 land:grid land:grid-cols-1 land:grid-rows-6 land:border-t-0 land:border-r land:pb-[max(0px,env(safe-area-inset-bottom))]`}
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
            onClick={() => {
              setPane(t.k)
              // Sideways the VML panel covers the work area: going to a pane closes it.
              if (vmlOpen && window.matchMedia('(orientation: landscape) and (max-height: 31.25rem) and (max-width: 63.99rem)').matches) setVmlOpen(false)
            }}
            aria-current={pane === t.k ? 'page' : undefined}
            className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors sm:text-[11px] [@media(max-height:500px)]:min-h-11 land:min-h-0 land:gap-0.5 land:text-[10px] ${
              pane === t.k ? 'text-white' : 'text-mute active:text-white'
            }`}
          >
            {pane === t.k && <span className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-pink-fill shadow-[0_0_10px_#ff2d95] land:inset-x-auto land:inset-y-2 land:left-0 land:h-auto land:w-0.5" />}
            <span className={`relative rounded-full px-2.5 py-0.5 ${pane === t.k ? 'bg-pink/15 text-pink' : ''}`}>
              <t.icon className="size-5" />
              {t.dot && <span className={`absolute top-0 right-2 size-1.5 rounded-full ${t.k === 'code' ? 'bg-pink-fill' : 'bg-cyan'}`} />}
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
      {hsImport && (
        <HubSpotImport
          tree={tree}
          onClose={() => setHsImport(false)}
          onImport={importWithImages}
        />
      )}
      {exporting && <ExportDialog tree={tree} name={name.trim() || 'Sans titre'} onClose={() => setExporting(false)} />}
    </div>
  )
}
