import { loadBlocks, loadModules, queueBlock, createLocalFirst, syncAll } from '@/lib/data'
import { sanitizeTree } from '@/lib/sanitize-tree'
import { section as cleanSection } from '@/lib/sanitize-tree'
import type { ModuleTree, Section } from '@/lib/types'

// Portable database: every module and custom block of the account in one JSON
// file that can be kept, moved to another account or another computer, and
// re-imported later (online or not).

const KIND = 'neon-sandbox-pro-backup'
const VERSION = 1

export interface BackupFile {
  kind: typeof KIND
  version: number
  exportedAt: string
  modules: { id: string; name: string; tree: ModuleTree; createdAt: string; updatedAt: string }[]
  blocks: { name: string; description: string; section: Section }[]
}

export async function buildBackup(): Promise<BackupFile> {
  const [mods, blocks] = await Promise.all([loadModules(), loadBlocks()])
  return {
    kind: KIND,
    version: VERSION,
    exportedAt: new Date().toISOString(),
    modules: mods.map((m) => ({ id: m.id, name: m.name, tree: m.tree, createdAt: m.createdAt, updatedAt: m.updatedAt })),
    blocks: blocks.map((b) => ({ name: b.name, description: b.description, section: b.section })),
  }
}

export async function downloadBackup(): Promise<{ modules: number; blocks: number }> {
  const data = await buildBackup()
  const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `neon-sandbox-pro-${data.exportedAt.slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return { modules: data.modules.length, blocks: data.blocks.length }
}

// Same content whatever the ids and the key order (the database reorders keys,
// and sanitizing a tree can renumber its nodes).
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([k]) => k !== 'id')
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, x]) => [k, canon(x)]),
    )
  }
  return v
}
const fingerprint = (tree: unknown) => JSON.stringify(canon(tree))

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

export interface ImportResult {
  modules: number
  blocks: number
  skipped: number
}

// Never overwrites: modules already present (same name and same content) are
// skipped, the others are added as new modules.
export async function importBackup(file: File): Promise<ImportResult> {
  if (file.size > 30_000_000) throw new Error('Fichier trop volumineux.')
  let data: unknown
  try {
    data = JSON.parse(await file.text())
  } catch {
    throw new Error('Ce fichier n’est pas une sauvegarde valide.')
  }
  if (!isObj(data) || data.kind !== KIND || !Array.isArray(data.modules)) throw new Error('Ce fichier n’est pas une sauvegarde Neon Sandbox Pro.')
  if (typeof data.version === 'number' && data.version > VERSION) throw new Error('Cette sauvegarde vient d’une version plus récente de l’application.')

  const existing = await loadModules()
  const seen = new Set(existing.map((m) => `${m.name}\u0000${fingerprint(m.tree)}`))
  const res: ImportResult = { modules: 0, blocks: 0, skipped: 0 }

  for (const raw of data.modules.slice(0, 500)) {
    if (!isObj(raw) || typeof raw.name !== 'string' || !isObj(raw.tree) || !Array.isArray(raw.tree.sections)) continue
    const tree = sanitizeTree(raw.tree as never) as ModuleTree
    const name = raw.name.trim().slice(0, 120) || 'Sans titre'
    const key = `${name}\u0000${fingerprint(tree)}`
    if (seen.has(key)) {
      res.skipped++
      continue
    }
    seen.add(key)
    await createLocalFirst(name, tree)
    res.modules++
  }

  const blocks = await loadBlocks()
  const known = new Set(blocks.map((b) => b.name.trim().toLowerCase()))
  for (const raw of (Array.isArray(data.blocks) ? data.blocks : []).slice(0, 200)) {
    if (!isObj(raw) || typeof raw.name !== 'string' || !isObj(raw.section)) continue
    const sec = cleanSection(raw.section as never)
    const name = raw.name.trim().slice(0, 80)
    if (!sec || !name || known.has(name.toLowerCase())) {
      res.skipped++
      continue
    }
    known.add(name.toLowerCase())
    await queueBlock(name, typeof raw.description === 'string' ? raw.description.slice(0, 300) : '', sec as Section)
    res.blocks++
  }
  void syncAll()
  return res
}
