// Maily's internal tests: the tool checks itself, in the browser, without
// sending anything anywhere. Two families:
// - the ENGINE (code ↔ blocks round trip, export, preview, import of existing
//   code, validator) on the built-in templates and on the open module;
// - the OPEN MODULE (what an e-mail client will do with it: images, links,
//   contrast, Outlook, fields) and the LIBRARY (gaps, duplicates).
// Each test is isolated: one failure never stops the others.
import { auditModule, contrast } from './clients'
import { collectFields } from './fields'
import { codeToTree, previewEmail, treeToCode, treeToHubSpot } from './hubl'
import { recognizeCode } from './recognize'
import { STARTERS } from './templates'
import type { Block, ModuleTree } from './types'
import { validateSyntax } from './validator'

export type TestStatus = 'ok' | 'warn' | 'fail'
export interface TestResult {
  area: 'Moteur' | 'Module ouvert' | 'Bibliothèque' | 'Appareil'
  name: string
  status: TestStatus
  detail: string
}

export interface TestContext {
  tree: ModuleTree
  name: string
  /** Names of the library's modules and custom blocks (for gaps and duplicates). */
  modules?: string[]
  blocks?: string[]
  pending?: number
}

// Same structure (ids and key order aside): the round trip lost nothing.
const canon = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(canon) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).filter((k) => k !== 'id' && (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v
const shape = (t: ModuleTree) => JSON.stringify(canon(t.sections))

const walk = (blocks: Block[], fn: (b: Block) => void) =>
  blocks.forEach((b) => {
    fn(b)
    if (b.type === 'section') b.cells.forEach((c) => walk(c, fn))
  })
const allBlocks = (t: ModuleTree) => {
  const out: Block[] = []
  walk(t.sections, (b) => out.push(b))
  return out
}

async function attempt(results: TestResult[], area: TestResult['area'], name: string, fn: () => Promise<Omit<TestResult, 'area' | 'name'>> | Omit<TestResult, 'area' | 'name'>) {
  try {
    results.push({ area, name, ...(await fn()) })
  } catch (e) {
    results.push({ area, name, status: 'fail', detail: `erreur inattendue : ${e instanceof Error ? e.message : String(e)}` })
  }
}

function engineOn(t: ModuleTree, label: string) {
  const problems: string[] = []
  const code = treeToCode(t, label)
  const back = codeToTree(code, t)
  if (!back.ok) problems.push(`relecture du code impossible (${back.error})`)
  else if (shape(back.tree) !== shape(t)) problems.push('aller-retour code ↔ blocs instable')
  const lint = validateSyntax(code)
  if (!lint.ok) problems.push(`${lint.errors} erreur(s) de syntaxe dans le code généré`)
  const out = treeToHubSpot(t, label)
  if (!validateSyntax(out['module.html']).ok) problems.push('code exporté invalide')
  try {
    JSON.parse(out['fields.json'])
  } catch {
    problems.push('fichier de champs exporté illisible')
  }
  const html = previewEmail(t, label)
  if (!/<html/i.test(html) || html.length < 200) problems.push('aperçu vide')
  return problems
}

// The modules a complete e-mail library usually has (to spot what is missing).
const ESSENTIALS: { label: string; match: RegExp }[] = [
  { label: 'En-tête (logo, navigation)', match: /en-?t[eê]te|header|logo|banni[eè]re/i },
  { label: 'Hero (accroche, image, bouton)', match: /hero|accroche|annonce|une\b|lancement/i },
  { label: 'Texte + image', match: /texte.*image|image.*texte|article|edito|édito|contenu/i },
  { label: 'Appel à l’action', match: /cta|appel|bouton|inscri|r[ée]serv/i },
  { label: 'Cartes (produits, formations, offres)', match: /carte|card|produit|formation|offre|catalogue/i },
  { label: 'Témoignage / avis', match: /t[ée]moign|avis|citation|review/i },
  { label: 'Compte à rebours', match: /compte.*rebours|countdown|minuteur/i },
  { label: 'Réseaux sociaux', match: /r[ée]seaux|social|instagram|linkedin/i },
  { label: 'Pied de page (coordonnées, désinscription)', match: /pied|footer|d[ée]sinscri|mentions/i },
]

export async function runSelfTests(ctx: TestContext): Promise<TestResult[]> {
  const results: TestResult[] = []

  // ---- Engine, on every built-in template and on the open module
  await attempt(results, 'Moteur', 'Code ↔ blocs, export et aperçu des modèles', () => {
    const bad = STARTERS.flatMap((s) => engineOn(s.build(), s.name).map((p) => `${s.name} : ${p}`))
    return bad.length ? { status: 'fail', detail: bad.join(' ; ') } : { status: 'ok', detail: `${STARTERS.length} modèles : aller-retour stable, code valide, export et aperçu corrects` }
  })
  await attempt(results, 'Moteur', 'Code ↔ blocs, export et aperçu du module ouvert', () => {
    const bad = engineOn(ctx.tree, ctx.name)
    return bad.length ? { status: 'fail', detail: bad.join(' ; ') } : { status: 'ok', detail: 'aller-retour stable, code valide, export et aperçu corrects' }
  })
  await attempt(results, 'Moteur', 'Import de code existant (champs exacts)', () => {
    const sample = `<table role="presentation" width="100%"><tr><td style="padding:24px;background:#ffffff">
<h2 style="color:#1d1d1b">{{ module.titre }}</h2><p>{{ module.intro }}</p>
<img src="{{ module.visuel.src }}" alt="{{ module.visuel.alt }}" width="560">
{% if module.afficher_cta %}<a href="{{ module.cta_link.url.href }}" style="display:inline-block;background:#e0006f;color:#ffffff;padding:12px 22px;border-radius:8px">{{ module.cta_text }}</a>{% endif %}
{% for c in module.cartes %}<p>{{ c.nom }}</p>{% endfor %}
</td></tr></table>`
    const rec = recognizeCode(sample, { width: 600, bg: '#f2f2f7', font: 'Arial', sections: [] })
    if (!rec.ok) return { status: 'fail', detail: `code d'exemple non reconnu (${rec.error})` }
    const names = new Set([...collectFields(rec.tree).map((f) => f.name), ...(rec.tree.fields ?? []).map((f) => f.name)])
    const missing = ['titre', 'intro', 'visuel', 'afficher_cta', 'cartes'].filter((n) => !names.has(n))
    return missing.length ? { status: 'fail', detail: `champs non reconnus : ${missing.join(', ')}` } : { status: 'ok', detail: 'titre, texte, image, condition et répétition reconnus avec leurs noms exacts' }
  })

  // ---- Open module: what e-mail clients and readers will get
  const blocks = allBlocks(ctx.tree)
  await attempt(results, 'Module ouvert', 'Images', () => {
    const imgs = blocks.filter((b) => b.type === 'image') as Extract<Block, { type: 'image' }>[]
    const noSrc = imgs.filter((b) => !b.src.trim()).length
    const noAlt = imgs.filter((b) => !b.alt.trim()).length
    const http = imgs.filter((b) => /^http:\/\//i.test(b.src)).length
    const notes = [noSrc && `${noSrc} sans adresse`, noAlt && `${noAlt} sans texte alternatif`, http && `${http} en http (bloquées par certaines messageries)`].filter(Boolean)
    return notes.length ? { status: noSrc ? 'fail' : 'warn', detail: notes.join(', ') } : { status: 'ok', detail: imgs.length ? `${imgs.length} image(s) avec adresse et texte alternatif` : 'aucune image' }
  })
  await attempt(results, 'Module ouvert', 'Boutons et liens', () => {
    const btns = blocks.filter((b) => b.type === 'button') as Extract<Block, { type: 'button' }>[]
    const empty = btns.filter((b) => !b.href.trim() || b.href.trim() === '#').length
    const weak = btns.filter((b) => {
      const c = contrast(b.color, b.bg)
      return c !== null && c < 4.5
    }).length
    const notes = [empty && `${empty} bouton(s) sans lien`, weak && `${weak} bouton(s) au contraste insuffisant (< 4,5:1)`].filter(Boolean)
    return notes.length ? { status: empty ? 'fail' : 'warn', detail: notes.join(', ') } : { status: 'ok', detail: btns.length ? `${btns.length} bouton(s) avec lien et contraste lisible` : 'aucun bouton' }
  })
  await attempt(results, 'Module ouvert', 'Messageries (Outlook, Gmail, mode sombre…)', () => {
    const { issues, bytes } = auditModule(ctx.tree, ctx.name)
    const errors = issues.filter((i) => i.level === 'error')
    const warns = issues.filter((i) => i.level === 'warn')
    const weight = bytes > 102_000 ? ` ; poids ${Math.round(bytes / 1024)} Ko (Gmail coupe au-delà de 102 Ko)` : ''
    if (errors.length) return { status: 'fail', detail: errors.map((i) => i.title).join(' ; ') + weight }
    if (warns.length || weight) return { status: 'warn', detail: warns.map((i) => i.title).slice(0, 4).join(' ; ') + weight }
    return { status: 'ok', detail: `aucun problème relevé (${Math.round(bytes / 1024)} Ko)` }
  })
  await attempt(results, 'Module ouvert', 'Champs', () => {
    const names = [...collectFields(ctx.tree).map((f) => f.name), ...(ctx.tree.fields ?? []).map((f) => f.name)]
    const dup = [...new Set(names.filter((n, i) => names.indexOf(n) !== i))]
    const bad = names.filter((n) => !/^[a-z_][a-z0-9_]*$/i.test(n))
    const notes = [dup.length && `noms en double : ${dup.join(', ')}`, bad.length && `noms invalides : ${bad.join(', ')}`].filter(Boolean)
    return notes.length ? { status: 'fail', detail: notes.join(' ; ') } : { status: 'ok', detail: `${names.length} champ(s), noms uniques et valides` }
  })
  await attempt(results, 'Module ouvert', 'Structure', () => {
    const heads = blocks.filter((b) => b.type === 'heading').length
    const empty = ctx.tree.sections.filter((s) => s.cells.every((c) => c.length === 0)).length
    const notes = [!heads && 'aucun titre (repère utile pour la lecture et l’accessibilité)', empty && `${empty} section(s) vide(s)`].filter(Boolean)
    return notes.length ? { status: 'warn', detail: notes.join(' ; ') } : { status: 'ok', detail: `${ctx.tree.sections.length} section(s), ${blocks.length - ctx.tree.sections.length} élément(s)` }
  })

  // ---- Library: gaps and duplicates
  if (ctx.modules || ctx.blocks) {
    const names = [...(ctx.modules ?? []), ...(ctx.blocks ?? [])]
    await attempt(results, 'Bibliothèque', 'Modules et blocs essentiels', () => {
      const missing = ESSENTIALS.filter((e) => !names.some((n) => e.match.test(n))).map((e) => e.label)
      return missing.length
        ? { status: 'warn', detail: `manquants : ${missing.join(', ')}` }
        : { status: 'ok', detail: 'tous les types de modules courants sont présents' }
    })
    await attempt(results, 'Bibliothèque', 'Doublons', () => {
      const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\(copie[^)]*\)|\s+\d+$/g, '').trim()
      const seen = new Map<string, number>()
      names.forEach((n) => seen.set(norm(n), (seen.get(norm(n)) ?? 0) + 1))
      const dup = [...seen].filter(([, n]) => n > 1).map(([k]) => k)
      return dup.length ? { status: 'warn', detail: `noms très proches : ${dup.slice(0, 5).join(', ')}` } : { status: 'ok', detail: `${names.length} élément(s), sans doublon` }
    })
  }

  // ---- This device
  await attempt(results, 'Appareil', 'Stockage hors ligne et synchronisation', async () => {
    const idb = typeof indexedDB !== 'undefined'
    const sw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? !!(await navigator.serviceWorker.getRegistration().catch(() => undefined)) : false
    const online = typeof navigator === 'undefined' || navigator.onLine
    const notes = [!idb && 'stockage local indisponible (navigation privée ?)', !online && 'hors ligne', ctx.pending ? `${ctx.pending} modification(s) en attente d’envoi` : ''].filter(Boolean)
    return {
      status: !idb ? 'fail' : notes.length ? 'warn' : 'ok',
      detail: notes.length ? notes.join(' ; ') : `stockage local actif${sw ? ', mode hors ligne installé' : ''}, tout est synchronisé`,
    }
  })
  return results
}

const ICON: Record<TestStatus, string> = { ok: '✅', warn: '⚠️', fail: '❌' }

// Report shown in the chat and sent to Maily.
export function formatReport(results: TestResult[]): string {
  const count = (s: TestStatus) => results.filter((r) => r.status === s).length
  const head = `**Tests internes** : ${count('ok')} réussi(s), ${count('warn')} à surveiller, ${count('fail')} en échec.`
  const areas = [...new Set(results.map((r) => r.area))]
  return [head, ...areas.map((a) => `\n**${a}**\n${results.filter((r) => r.area === a).map((r) => `- ${ICON[r.status]} ${r.name} : ${r.detail}`).join('\n')}`)].join('\n')
}
