type JsonObject = Record<string, unknown>

/** Normalize names across CMSs without changing the original/exported field key. */
export const normalizeFieldKey = (name: string): string =>
  name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[./[\]_-]+/)
    .filter(Boolean)
    .join('')

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizedEntries = (object: JsonObject) =>
  Object.entries(object).map(([key, value]) => [normalizeFieldKey(key), value] as const)

/**
 * Resolve HuBL aliases such as `{% set c = module.card_settings %}` and chained
 * aliases such as `{% set img = c.banner_image %}` to their full module paths.
 * The result maps the alias to a path; it never renames the source field.
 */
export function codeFieldAliases(code: string): Map<string, string[]> {
  const aliases = new Map<string, string[]>([['module', []], ['widget', []]])
  const statements = code.match(/\{%[\s\S]*?%\}/g) ?? []
  // Repeated passes resolve aliases declared in either order and simple chains.
  for (let pass = 0; pass < 6; pass++) {
    let changed = false
    for (const statement of statements) {
      const set = /^\{%[-+]?\s*set\s+([A-Za-z_]\w*)\s*=\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*[-+]?%\}$/.exec(statement)
      if (!set) continue
      const [, alias, expression] = set
      const [base, ...tail] = expression.split('.')
      const parent = aliases.get(base)
      if (!parent) continue
      const path = [...parent, ...tail]
      if (JSON.stringify(aliases.get(alias)) !== JSON.stringify(path)) {
        aliases.set(alias, path)
        changed = true
      }
    }
    if (!changed) break
  }
  return aliases
}

/** Extract full module field paths, including references made through aliases. */
export function codeFieldPaths(code: string): string[][] {
  const aliases = codeFieldAliases(code)
  const found = new Map<string, string[]>()
  const expression = /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}/g
  const ref = /\b([A-Za-z_]\w*)((?:\.[A-Za-z_]\w*)*)/g
  for (const statement of code.match(expression) ?? []) {
    for (const match of statement.matchAll(ref)) {
      const base = aliases.get(match[1])
      if (!base) continue
      const tail = (match[2] ?? '').split('.').filter(Boolean)
      const path = [...base, ...tail]
      if (path.length) found.set(path.join('.'), path)
    }
  }
  return [...found.values()]
}

const getNested = (values: JsonObject, path: string[]): unknown => {
  let current: unknown = values
  for (const segment of path) {
    if (!isObject(current)) return undefined
    const key = normalizeFieldKey(segment)
    const entry = normalizedEntries(current).find(([normalized]) => normalized === key)
    if (!entry) return undefined
    current = entry[1]
  }
  return current
}

/**
 * Read values from either nested objects (`card_settings.banner_image`) or
 * flat CMS exports (`card_settings.banner_image`, `card-settings/banner-image`).
 * A unique leaf-name match is the last resort; ambiguous leaves are rejected.
 */
export function resolveImportedValue(values: JsonObject, fieldPath: string, aliases: Map<string, string[]> = new Map()): unknown {
  const parts = fieldPath.split(/[./]+/).filter(Boolean)
  const alias = aliases.get(parts[0])
  const candidates = [parts, ...(alias ? [[...alias, ...parts.slice(1)]] : [])]
  const flat = Object.entries(values)
  for (const path of candidates) {
    const nested = getNested(values, path)
    if (nested !== undefined) return nested
    const normalizedPath = normalizeFieldKey(path.join('.'))
    const exact = flat.find(([key]) => normalizeFieldKey(key) === normalizedPath)
    if (exact) return exact[1]
  }
  const leaf = normalizeFieldKey(parts.at(-1) ?? fieldPath)
  const matches: unknown[] = []
  const visit = (value: unknown, path: string[], depth: number) => {
    if (depth > 8 || !isObject(value)) return
    for (const [key, child] of Object.entries(value)) {
      const next = [...path, key]
      if (normalizeFieldKey(key) === leaf) matches.push(child)
      if (isObject(child)) visit(child, next, depth + 1)
    }
  }
  visit(values, [], 0)
  return matches.length === 1 ? matches[0] : undefined
}

/**
 * Match an imported definition against a code path. Exact hierarchy wins,
 * then a code alias, then a unique normalized leaf-name match.
 */
export function matchImportedFieldPath(codePath: string[], importedPaths: string[], aliases: Map<string, string[]> = new Map()): string | undefined {
  const normalized = (path: string) => normalizeFieldKey(path)
  const codeName = codePath.join('.')
  const exact = importedPaths.find((path) => normalized(path) === normalized(codeName))
  if (exact) return exact
  const alias = aliases.get(codePath[0])
  if (alias) {
    const aliased = [...alias, ...codePath.slice(1)].join('.')
    const match = importedPaths.find((path) => normalized(path) === normalized(aliased))
    if (match) return match
  }
  const leaf = normalized(codePath.at(-1) ?? '')
  const leaves = importedPaths.filter((path) => normalized(path.split(/[./]+/).filter(Boolean).at(-1) ?? '') === leaf)
  return leaves.length === 1 ? leaves[0] : undefined
}
