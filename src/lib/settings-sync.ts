import { isSyncedKey } from '@/lib/settings-keys'
import type { Prefs } from '@/lib/settings-keys'
import { getSettings, pushSettings } from '@/server/settings.functions'

// Account preferences synced between devices. Values live in localStorage (so
// they work offline); `nsp-sync-stamps` keeps the time of each local change and
// `nsp-sync-dirty` the keys not yet sent. `pullSettings` merges the server's
// copy (latest change wins) and pushes what's pending; screens listen to
// SETTINGS_EVENT to pick up values that came from another device.

export const SETTINGS_EVENT = 'nsp:settings'

const STAMPS = 'nsp-sync-stamps'
const DIRTY = 'nsp-sync-dirty'
const OWNER = 'nsp-sync-user'

const browser = () => typeof window !== 'undefined'

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = JSON.parse(localStorage.getItem(key) || 'null')
    return v && typeof v === 'object' ? (v as T) : fallback
  } catch {
    return fallback
  }
}
function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* private mode: kept for this page only */
  }
}

export function getPref(key: string): string | null {
  if (!browser()) return null
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

/** The account has (or had) a value for this key, from this device or another. */
export const knowsPref = (key: string) => key in readJson<Record<string, number>>(STAMPS, {})

/** Writes a preference here and sends it to the account's other devices. */
export function setPref(key: string, value: string | null) {
  if (!browser()) return
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    return
  }
  if (!isSyncedKey(key)) return
  const stamps = readJson<Record<string, number>>(STAMPS, {})
  stamps[key] = Date.now()
  writeJson(STAMPS, stamps)
  const dirty = new Set(readJson<string[]>(DIRTY, []))
  dirty.add(key)
  writeJson(DIRTY, [...dirty])
  schedulePush()
}

let timer: ReturnType<typeof setTimeout> | null = null
function schedulePush() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => void pullSettings(), 1500)
}

let running: Promise<void> | null = null

/** Merges with the server copy and sends local changes. Silent when offline. */
export function pullSettings(): Promise<void> {
  if (!browser() || navigator.onLine === false) return Promise.resolve()
  running ??= (async () => {
    try {
      const remote = await getSettings()
      apply(remote)
      const dirty = readJson<string[]>(DIRTY, []).filter(isSyncedKey)
      if (!dirty.length) return
      const stamps = readJson<Record<string, number>>(STAMPS, {})
      const prefs: Prefs = {}
      for (const k of dirty.slice(0, 400)) prefs[k] = { v: getPref(k), t: stamps[k] ?? Date.now() }
      const merged = await pushSettings({ data: { prefs } })
      // Keys changed again while sending stay pending.
      const after = readJson<Record<string, number>>(STAMPS, {})
      writeJson(DIRTY, readJson<string[]>(DIRTY, []).filter((k) => !prefs[k] || after[k] !== prefs[k].t))
      apply(merged)
    } catch {
      /* signed out, network…: retried at the next pull */
    } finally {
      running = null
    }
  })()
  return running
}

// Takes every server entry newer than the local one.
function apply(remote: Prefs) {
  const stamps = readJson<Record<string, number>>(STAMPS, {})
  const changed: string[] = []
  for (const [k, e] of Object.entries(remote)) {
    if (!isSyncedKey(k) || !e || typeof e.t !== 'number') continue
    if ((stamps[k] ?? 0) >= e.t) continue
    stamps[k] = e.t
    try {
      if (e.v === null) localStorage.removeItem(k)
      else localStorage.setItem(k, e.v)
    } catch {
      continue
    }
    changed.push(k)
  }
  writeJson(STAMPS, stamps)
  if (changed.length) window.dispatchEvent(new CustomEvent(SETTINGS_EVENT, { detail: changed }))
}

/** The synced preferences belong to one account: another one starts clean. */
export function bindSettingsUser(id: string | null | undefined) {
  if (!browser() || !id) return
  const prev = getPref(OWNER)
  if (prev && prev !== id) clearSyncedPrefs()
  if (prev !== id) {
    try {
      localStorage.setItem(OWNER, id)
    } catch {
      /* private mode */
    }
  }
}

/** Sign-out: drops this account's synced preferences from the device. */
export function clearSyncedPrefs() {
  if (!browser()) return
  try {
    const keys: string[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && isSyncedKey(k)) keys.push(k)
    }
    for (const k of keys) localStorage.removeItem(k)
    for (const k of [STAMPS, DIRTY, OWNER]) localStorage.removeItem(k)
  } catch {
    /* storage blocked */
  }
}
