// Tools of the MCP server: what an AI client can do in the account behind a
// token. Read and write, never delete. Every query is scoped to that account;
// every write goes through the same checks as the editor and Maily.
import { and, asc, desc, eq } from 'drizzle-orm'

import { db } from '../../../db/index.js'
import { customBlocks, modules } from '../../../db/schema.js'
import { storeCustomBlock } from '@/server/custom-blocks.server'
import { auditOf, blankTree, codeOf, exportOf, fieldsOf, parseCode, prepareDom } from '@/server/mcp/engine.server'
import { FIELDS_SPEC, FORMAT_SPEC } from '@/lib/maily-prompts'
import { stripTags } from '@/lib/sanitize'
import { section as cleanSection } from '@/lib/sanitize-tree'
import { countBlocks } from '@/lib/tree'
import type { ModuleTree, Section } from '@/lib/types'

export interface ToolContext {
  userId: string
  /** https://host of the app, for links back to the editor. */
  origin: string
}

export interface ToolResult {
  content: { type: 'text'; text: string }[]
  structuredContent?: Record<string, unknown>
  isError?: boolean
}

type Args = Record<string, unknown>

interface Tool {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: { readOnlyHint: boolean; destructiveHint: false; idempotentHint: boolean; openWorldHint: false }
  run: (args: Args, ctx: ToolContext) => Promise<ToolResult>
}

class UserError extends Error {}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const str = (args: Args, key: string, max: number, required = true): string => {
  const v = args[key]
  if (v === undefined || v === null || v === '') {
    if (required) throw new UserError(`Paramètre « ${key} » manquant.`)
    return ''
  }
  if (typeof v !== 'string') throw new UserError(`« ${key} » doit être un texte.`)
  if (v.length > max) throw new UserError(`« ${key} » est trop long (${max} caractères au plus).`)
  return v
}
const id = (args: Args, key = 'id') => {
  const v = str(args, key, 64)
  if (!UUID.test(v)) throw new UserError(`« ${key} » n'est pas un identifiant valide (utilise lister_modules ou lister_blocs).`)
  return v
}
const name = (args: Args, key: string, max: number, fallback: string, required = true) =>
  stripTags(str(args, key, max, required)).trim() || fallback

const ok = (text: string, data?: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text: data ? `${text}\n\n${JSON.stringify(data, null, 2)}` : text }],
  ...(data ? { structuredContent: data } : {}),
})
const fail = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true })

const editorUrl = (ctx: ToolContext, moduleId: string) => `${ctx.origin}/editor/${moduleId}`
const TOO_BIG = 500_000

async function ownModule(userId: string, moduleId: string) {
  const [row] = await db.select().from(modules).where(and(eq(modules.id, moduleId), eq(modules.userId, userId)))
  if (!row) throw new UserError('Module introuvable dans ce compte (utilise lister_modules).')
  return row
}

const W = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const
const R = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const

const CODE_HELP = 'Code complet du module : de préférence au format Neon décrit par guide_format (data-neon), sinon n\'importe quel HTML e-mail ou HuBL, qui est alors importé et converti en blocs.'

export const TOOLS: Tool[] = [
  {
    name: 'guide_format',
    title: 'Guide du format des modules',
    description: 'À lire avant d\'écrire un module : le format du code (data-neon), les blocs disponibles et la façon de nommer les champs. Sans paramètre.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: R,
    run: async () =>
      ok(
        `Neon Sandbox Pro : éditeur de modules e-mail et web. Un module = sections (1 à 3 colonnes) contenant des blocs ; les textes, images et liens deviennent des champs.\n\n${FORMAT_SPEC}\n\n${FIELDS_SPEC}\n\nAvec ce serveur : creer_module et modifier_module prennent le code complet du module ; enregistrer_bloc prend un module qui ne contient qu'une section. Le code est vérifié comme dans l'éditeur : en cas de refus, le motif est renvoyé, corrige et renvoie.`,
      ),
  },
  {
    name: 'lister_modules',
    title: 'Lister les modules',
    description: 'Liste les modules du compte, du plus récemment modifié au plus ancien : identifiant, nom, nombre d\'éléments, date de modification et lien vers l\'éditeur.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: R,
    run: async (_args, ctx) => {
      const rows = await db.select().from(modules).where(eq(modules.userId, ctx.userId)).orderBy(desc(modules.updatedAt))
      const list = rows.map((r) => ({
        id: r.id,
        nom: r.name,
        elements: countBlocks(r.tree as ModuleTree),
        modifie_le: r.updatedAt.toISOString(),
        lien: editorUrl(ctx, r.id),
      }))
      return ok(list.length ? `${list.length} module${list.length > 1 ? 's' : ''}.` : 'Aucun module pour l\'instant.', { modules: list })
    },
  },
  {
    name: 'lire_module',
    title: 'Lire un module',
    description: 'Renvoie le code complet d\'un module (format Neon, celui de l\'onglet Code de l\'éditeur) et la liste de ses champs. À lire avant de le modifier.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Identifiant du module (lister_modules).' } }, required: ['id'], additionalProperties: false },
    annotations: R,
    run: async (args, ctx) => {
      const row = await ownModule(ctx.userId, id(args))
      const tree = row.tree as ModuleTree
      return ok(`Module « ${row.name} ». Le champ « code » est à reprendre tel quel dans modifier_module, avec tes changements.`, {
        id: row.id,
        nom: row.name,
        modifie_le: row.updatedAt.toISOString(),
        lien: editorUrl(ctx, row.id),
        champs: fieldsOf(tree),
        code: codeOf(tree, row.name),
      })
    },
  },
  {
    name: 'creer_module',
    title: 'Créer un module',
    description: `Crée un nouveau module dans la bibliothèque du compte (ne touche à aucun module existant). ${CODE_HELP} Pour importer un module existant, joins son fields.json. Évite les doublons : vérifie d'abord lister_modules.`,
    inputSchema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: 'Nom du module (court, 120 caractères au plus).' },
        code: { type: 'string', description: `${CODE_HELP} Peut rester vide si fields_json ou autre_json est donné : le module est alors construit à partir des champs.` },
        fields_json: { type: 'string', description: 'Facultatif : contenu du fields.json du module importé (noms et types exacts des champs). Un JSON imparfait (virgules en trop, commentaires, fin coupée) est réparé.' },
        autre_json: { type: 'string', description: 'Facultatif : JSON d\'un autre outil (valeurs du module, schéma Contentful, Strapi, Sanity…).' },
      },
      required: ['nom'],
      additionalProperties: false,
    },
    annotations: W,
    run: async (args, ctx) => {
      const moduleName = name(args, 'nom', 120, 'Sans titre')
      const fieldsJson = str(args, 'fields_json', 200_000, false)
      const otherJson = str(args, 'autre_json', 200_000, false)
      // The code may be left empty when a fields.json / module JSON is given: the module is built from the fields.
      const parsed = parseCode(str(args, 'code', 400_000, !fieldsJson && !otherJson), { fieldsJson, otherJson })
      if (!parsed.ok || !parsed.tree) return fail(`Module refusé : ${parsed.summary}${parsed.issues.length ? `\n- ${parsed.issues.join('\n- ')}` : ''}`)
      if (JSON.stringify(parsed.tree).length > TOO_BIG) return fail('Module trop volumineux.')
      const [row] = await db.insert(modules).values({ userId: ctx.userId, name: moduleName, tree: parsed.tree }).returning()
      return ok(`Module « ${row.name} » créé. ${parsed.summary}`, {
        id: row.id,
        nom: row.name,
        lien: editorUrl(ctx, row.id),
        avertissements: parsed.warnings,
      })
    },
  },
  {
    name: 'modifier_module',
    title: 'Modifier un module',
    description: `Remplace le contenu d'un module existant par le code donné (code complet, pas un extrait) et/ou le renomme. Lis-le d'abord avec lire_module. ${CODE_HELP} Si le module est ouvert dans l'éditeur sans modification en cours, l'éditeur affiche la nouvelle version.`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant du module.' },
        code: { type: 'string', description: 'Facultatif si seul le nom change. ' + CODE_HELP },
        nom: { type: 'string', description: 'Facultatif : nouveau nom.' },
        fields_json: { type: 'string', description: 'Facultatif : fields.json à appliquer.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: W,
    run: async (args, ctx) => {
      const row = await ownModule(ctx.userId, id(args))
      const code = str(args, 'code', 400_000, false)
      const newName = name(args, 'nom', 120, row.name, false)
      if (!code && newName === row.name) return fail('Rien à modifier : donne un code et/ou un nouveau nom.')
      let tree = row.tree as ModuleTree
      let summary = ''
      let warnings: string[] = []
      if (code) {
        const parsed = parseCode(code, { current: tree, fieldsJson: str(args, 'fields_json', 200_000, false) })
        if (!parsed.ok || !parsed.tree) return fail(`Modification refusée, le module reste inchangé : ${parsed.summary}${parsed.issues.length ? `\n- ${parsed.issues.join('\n- ')}` : ''}`)
        if (JSON.stringify(parsed.tree).length > TOO_BIG) return fail('Module trop volumineux.')
        tree = parsed.tree
        summary = parsed.summary
        warnings = parsed.warnings
      }
      const [saved] = await db
        .update(modules)
        .set({ name: newName, tree, updatedAt: new Date() })
        .where(and(eq(modules.id, row.id), eq(modules.userId, ctx.userId)))
        .returning()
      return ok(`Module « ${saved.name} » mis à jour. ${summary}`.trim(), { id: saved.id, nom: saved.name, lien: editorUrl(ctx, saved.id), avertissements: warnings })
    },
  },
  {
    name: 'exporter_module',
    title: 'Exporter un module',
    description: 'Renvoie les fichiers d\'export du module, comme le bouton « Exporter » : module.html (avec les variables des champs), module.css, fields.json et meta.json.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Identifiant du module.' } }, required: ['id'], additionalProperties: false },
    annotations: R,
    run: async (args, ctx) => {
      const row = await ownModule(ctx.userId, id(args))
      const files = exportOf(row.tree as ModuleTree, row.name)
      return ok(`Export de « ${row.name} » (4 fichiers).`, { fichiers: { ...files } })
    },
  },
  {
    name: 'auditer_module',
    title: 'Tester le rendu dans les messageries',
    description: 'Simule le module dans les messageries (Outlook Windows, Gmail, Apple Mail, mode sombre, images bloquées) et liste les problèmes, comme le bouton « Clients » : niveau, titre, détail, messageries concernées.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Identifiant du module.' } }, required: ['id'], additionalProperties: false },
    annotations: R,
    run: async (args, ctx) => {
      const row = await ownModule(ctx.userId, id(args))
      const { issues, bytes } = auditOf(row.tree as ModuleTree, row.name)
      const list = issues.map((i) => ({ niveau: i.level, titre: i.title, detail: i.detail, messageries: i.clients }))
      const errors = issues.filter((i) => i.level === 'error').length
      return ok(
        issues.length ? `${issues.length} point${issues.length > 1 ? 's' : ''} relevé${issues.length > 1 ? 's' : ''}, dont ${errors} erreur${errors > 1 ? 's' : ''}. Poids : ${Math.round(bytes / 1024)} Ko.` : `Aucun problème relevé. Poids : ${Math.round(bytes / 1024)} Ko.`,
        { poids_octets: bytes, problemes: list },
      )
    },
  },
  {
    name: 'lister_blocs',
    title: 'Lister les blocs réutilisables',
    description: 'Liste les blocs de « Mes blocs » (sections réutilisables proposées dans Structure > Ajouter) : identifiant, nom, description.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: R,
    run: async (_args, ctx) => {
      const rows = await db.select().from(customBlocks).where(eq(customBlocks.userId, ctx.userId)).orderBy(asc(customBlocks.name))
      const list = rows.map((r) => ({ id: r.id, nom: r.name, description: r.description }))
      return ok(list.length ? `${list.length} bloc${list.length > 1 ? 's' : ''}.` : 'Aucun bloc enregistré.', { blocs: list })
    },
  },
  {
    name: 'lire_bloc',
    title: 'Lire un bloc réutilisable',
    description: 'Renvoie le code d\'un bloc de « Mes blocs » (un module d\'une seule section, format Neon).',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Identifiant du bloc (lister_blocs).' } }, required: ['id'], additionalProperties: false },
    annotations: R,
    run: async (args, ctx) => {
      const [row] = await db.select().from(customBlocks).where(and(eq(customBlocks.id, id(args)), eq(customBlocks.userId, ctx.userId)))
      if (!row) throw new UserError('Bloc introuvable dans ce compte (utilise lister_blocs).')
      const tree = { ...blankTree(), sections: [row.section as Section] }
      return ok(`Bloc « ${row.name} ».`, { id: row.id, nom: row.name, description: row.description, code: codeOf(tree, row.name) })
    },
  },
  {
    name: 'enregistrer_bloc',
    title: 'Enregistrer un bloc réutilisable',
    description: 'Ajoute un bloc à « Mes blocs » à partir d\'un module qui ne contient qu\'UNE section (format Neon de guide_format). Jamais de doublon : un bloc de même contenu est réutilisé, un bloc de même nom est mis à jour.',
    inputSchema: {
      type: 'object',
      properties: {
        nom: { type: 'string', description: 'Nom du bloc (80 caractères au plus), ex. « Témoignage ».' },
        code: { type: 'string', description: 'Module complet ne contenant qu\'une seule section : la card du bloc.' },
        description: { type: 'string', description: 'Facultatif : à quoi sert le bloc (300 caractères au plus).' },
      },
      required: ['nom', 'code'],
      additionalProperties: false,
    },
    annotations: W,
    run: async (args, ctx) => {
      const blockName = name(args, 'nom', 80, 'Bloc')
      const parsed = parseCode(str(args, 'code', 100_000))
      if (!parsed.ok || !parsed.tree) return fail(`Bloc refusé : ${parsed.summary}`)
      if (parsed.tree.sections.length !== 1) return fail(`Un bloc contient exactement une section (ici ${parsed.tree.sections.length}).`)
      const section = cleanSection(parsed.tree.sections[0])
      if (!section) return fail('Bloc invalide.')
      const { status, block } = await storeCustomBlock(ctx.userId, { name: blockName, description: stripTags(str(args, 'description', 300, false)), section })
      const said = status === 'created' ? 'enregistré' : status === 'updated' ? 'mis à jour (même nom)' : 'déjà présent (même contenu), rien n\'a été dupliqué'
      return ok(`Bloc « ${block.name} » ${said}. Il apparaît dans Structure > Ajouter > Mes blocs.`, { id: block.id, nom: block.name, statut: status })
    },
  },
]

export async function callTool(toolName: string, args: Args, ctx: ToolContext): Promise<ToolResult> {
  const tool = TOOLS.find((t) => t.name === toolName)
  if (!tool) return fail(`Outil inconnu : ${toolName}.`)
  try {
    await prepareDom()
    return await tool.run(args ?? {}, ctx)
  } catch (e) {
    if (e instanceof UserError) return fail(e.message)
    console.error('mcp tool', toolName, e)
    return fail('Erreur interne de Neon Sandbox Pro : réessaie dans un instant.')
  }
}

export const toolList = () => TOOLS.map(({ run: _run, ...t }) => t)
