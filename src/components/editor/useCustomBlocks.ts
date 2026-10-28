import { useEffect, useState } from 'react'

import type { CustomBlock } from '@/lib/custom-blocks'
import { listCustomBlocks } from '@/server/custom-blocks.functions'

// Library of custom blocks, loaded once and shared by every "Ajouter" menu and
// Maily's panel. `refreshCustomBlocks()` reloads it after a block is created.
let cache: CustomBlock[] = []
let loaded = false
let loading: Promise<void> | null = null
const listeners = new Set<(b: CustomBlock[]) => void>()

function load(): Promise<void> {
  loading ??= listCustomBlocks()
    .then((b) => {
      cache = b
      loaded = true
      listeners.forEach((l) => l(b))
    })
    .catch(() => {})
    .finally(() => {
      loading = null
    })
  return loading
}

export const refreshCustomBlocks = () => void load()

export function useCustomBlocks(): CustomBlock[] {
  const [blocks, setBlocks] = useState<CustomBlock[]>(cache)
  useEffect(() => {
    listeners.add(setBlocks)
    if (loaded) setBlocks(cache)
    else void load()
    return () => void listeners.delete(setBlocks)
  }, [])
  return blocks
}
