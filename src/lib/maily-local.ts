// Maily without a connection, with no model to download: instant answers built
// from what the tool already knows, the way help assistants of other sites
// work offline (Intercom / HubSpot help widgets answer from their articles,
// messaging apps keep a message and send it when the network is back):
// - questions about the tool or e-mailing: the closest passages of her guide and
//   of her expert notes;
// - « corrige » : the validator's exact repairs, applied to the open module;
// - « vérifie / analyse » : the audit of the test clients (Outlook, Gmail, dark
//   mode, weight, accessibility…);
// - « teste l'outil » : the internal tests;
// - anything that needs writing (create, rewrite, translate…): kept and sent to
//   Maily as soon as the connection is back.
// No server-only import: this file ships to the browser.

import { auditModule } from '@/lib/clients'
import { APP_GUIDE, EDIT_ASK, EXPERT_SPEC } from '@/lib/maily-prompts'
import type { ModuleTree } from '@/lib/types'
import { fixCode, validateSyntax } from '@/lib/validator'

export interface LocalReply {
  text: string
  /** Needs the online Maily: kept and sent when the connection is back. */
  queued?: boolean
  /** Corrected code to apply to the open module. */
  fixedCode?: string
  /** The internal tests should run (the panel runs them and shows the report). */
  runTests?: boolean
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
const STOP = new Set([
  'comment', 'faire', 'quoi', 'pour', 'avec', 'dans', 'cette', 'quel', 'quelle', 'quels', 'quelles', 'peux', 'veux', 'faut', 'mais', 'donc', 'alors', 'tout', 'tous',
  'bonjour', 'merci', 'maily', 'sont', 'etre', 'avoir', 'plus', 'moins', 'notre', 'votre', 'leur', 'aussi', 'encore', 'comme', 'quand', 'marche', 'fonctionne',
  'les', 'des', 'une', 'est', 'que', 'qui', 'pas', 'mon', 'ton', 'son', 'mes', 'tes', 'ses', 'sur', 'par', 'aux', 'ces', 'ete', 'peut', 'puis', 'elle', 'faut',
])
// Words of 3 letters or more (VML, CSS, CTA, GIF count), cut to 6 letters so
// « enregistrés » meets « enregistrée » and « exporter » meets « export ».
const tokens = (s: string) => (fold(s).match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)).map((w) => w.slice(0, 6))
const words = (s: string) => new Set(tokens(s))

export const TEST_ASK = /\b(teste|tester|test|tests|diagnostic|v[ée]rifie (que )?(tout|l['’]outil|l['’]appli))/i
const FIX_ASK = /\b(corrige|corriger|r[ée]pare|r[ée]parer|erreurs?|bugs?|cass[ée]e?|valide|validateur|balises?)\b/i
// Asks to look at the open module (not a general question about Outlook or dark mode).
const AUDIT_ASK = /\b(v[ée]rifie|audit|analyse|contr[ôo]le|regarde|relis|check|qu['’ ]?en penses|ton avis|avis sur|il va bien|est-il (bon|bien|correct|compatible))\b/i
const HELLO_ASK = /^\s*(bonjour|salut|hello|coucou|hey|merci|aide|help|que (sais|peux)[- ]tu|tu (sais|peux) faire quoi)\b/i

// E-mailing know-how for offline questions (same advice as online Maily's notes).
const EMAIL_TIPS = `- Objet de l'email : 30 à 45 caractères pour qu'il s'affiche en entier sur mobile ; le bénéfice d'abord, un verbe d'action, pas de majuscules ni de « !!! » qui sentent le spam ; teste 2 variantes.
- Pré-en-tête (preheader) : le texte gris affiché après l'objet ; 40 à 90 caractères qui complètent l'objet au lieu de le répéter. Sinon la messagerie affiche le début du contenu (« Voir la version en ligne »…).
- Appel à l'action (bouton, CTA) : un seul principal par email, un verbe précis (« Je m'inscris », « Voir la formation »), au moins 44 px de haut pour le pouce, contraste fort ; bouton en VML pour Outlook sur Windows.
- Largeur et responsive : 600 px de large, colonnes empilées sur mobile vers 480 px, texte d'au moins 14 px (16 px sur mobile), zones cliquables de 44 px.
- Images : toujours un texte alternatif (alt), une largeur fixée, display:block ; beaucoup de messageries bloquent les images par défaut : le message doit rester compréhensible sans elles. Pas plus de 40 % d'image environ.
- Mode sombre : évite le blanc pur et le noir pur, prévois un logo lisible sur fond sombre (contour ou version claire), vérifie le rendu « Gmail iPhone sombre » et « Outlook.com sombre » dans « Tester ».
- Outlook sur Windows : ignore border-radius, max-width, les images de fond et le padding des liens ; utilise des tableaux, des boutons VML et des tables fantômes <!--[if mso]>.
- Gmail : coupe les messages au-delà d'environ 102 Ko (« Message tronqué ») : garde le code léger ; il supprime aussi les styles mal formés de <style>.
- Délivrabilité : SPF, DKIM et DMARC alignés sur le domaine d'envoi, lien de désinscription visible et en un clic, pas de liens raccourcis, un bon équilibre texte / images, une liste propre (pas de contacts achetés).
- Personnalisation HuBL : {{ contact.firstname }} avec un repli ({% if contact.firstname %}Bonjour {{ contact.firstname }}{% else %}Bonjour{% endif %}) pour les contacts sans prénom.
- Accessibilité : contraste du texte d'au moins 4,5:1, vrai texte plutôt que texte dans une image, titres dans l'ordre (H1 puis H2), langue déclarée (lang="fr"), liens explicites (pas « cliquez ici »).
- Polices : les polices web ne marchent pas partout (Outlook, Gmail) : prévois toujours une police de repli (Arial, Helvetica, Georgia).
- Taux d'ouverture et de clic : ils dépendent de l'objet, de l'expéditeur reconnu, du moment d'envoi et de la pertinence pour la cible ; segmente plutôt que d'envoyer à tous.`

// Knowledge: the app guide (one entry per line), the expert notes and the e-mailing tips.
interface Entry {
  title: string
  text: string
  set: Set<string>
  titleSet: Set<string>
  folded: string
}
let knowledge: Entry[] | null = null
function entries(): Entry[] {
  if (knowledge) return knowledge
  const lines = [...APP_GUIDE.split('\n'), ...EXPERT_SPEC.split('\n'), ...EMAIL_TIPS.split('\n')].filter((l) => l.startsWith('- '))
  knowledge = lines.map((l) => {
    const cut = l.indexOf(' : ')
    const title = cut > 0 && cut < 70 ? l.slice(2, cut) : ''
    return { title, text: title ? l.slice(cut + 3) : l.slice(2), set: words(l), titleSet: words(title), folded: tokens(l).join(' ') }
  })
  return knowledge
}

// The start of a long entry, cut at the end of a sentence.
const brief = (s: string, max = 650) => {
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' ; '))
  return `${cut.slice(0, end > 200 ? end + 1 : max).trim()} …`
}

/** The guide passages closest to the question (rare shared words count most). */
export function searchKnowledge(query: string, max = 2): Entry[] {
  const list = entries()
  const seq = tokens(query)
  const q = [...new Set(seq)]
  if (!q.length) return []
  const df = (w: string) => list.filter((e) => e.set.has(w)).length
  const weight = new Map(q.map((w) => [w, df(w) ? Math.log((list.length + 1) / df(w)) : 0]))
  // Two words of the question side by side (« image de fond ») weigh more.
  const pairs = seq.slice(1).map((w, i) => `${seq[i]} ${w}`)
  const scored = list
    .map((e) => ({
      e,
      score:
        q.reduce((n, w) => n + (e.set.has(w) ? weight.get(w)! : 0) + (e.titleSet.has(w) ? 2.5 * weight.get(w)! : 0), 0) +
        pairs.reduce((n, p) => n + (e.folded.includes(p) ? 2 : 0), 0),
    }))
    .filter((r) => r.score > 1.8)
    .sort((a, b) => b.score - a.score)
  const top = scored[0]?.score ?? 0
  return scored
    .filter((r) => r.score >= top * 0.7)
    .slice(0, max)
    .map((r) => r.e)
}

const CAN =
  "Sans connexion, je réponds tout de suite :\n- tes questions sur l'outil et l'emailing (« Comment exporter vers HubSpot ? », « Pourquoi Gmail coupe mon email ? ») ;\n- les retouches du module : « change le titre en … », « mets le bouton en rouge », « centre le texte », « mets les pictos côte à côte », « ajoute un bouton », « supprime la section 2 » ;\n- les champs : « ajoute un champ couleur couleur_fond », « renomme le champ cta en cta_principal », « liste les champs » ;\n- « Corrige le code » : je répare les erreurs de balises et de HuBL du module ouvert ;\n- « Vérifie mon module » : rendu Outlook, Gmail, mode sombre, poids, accessibilité ;\n- « Lance les tests internes ».\nPour écrire ou créer un module, je garde ta demande et je l'envoie dès le retour du réseau."

const queuedText = (offline: boolean) =>
  offline
    ? "Pour ça, j'ai besoin d'Internet : je garde ta demande et je m'y mets dès le retour du réseau (rien à refaire). En attendant, je peux corriger le code, vérifier ton module ou répondre à tes questions sur l'outil."
    : "Le service d'IA ne répond pas pour l'instant : réessaie dans un instant. En attendant, je peux corriger le code, vérifier ton module ou répondre à tes questions sur l'outil."

function fixReply(code: string): LocalReply {
  const issues = validateSyntax(code).issues
  if (!issues.length) return { text: "J'ai passé le code du module au validateur : aucune erreur de balise ni de HuBL. ✨" }
  const safe = issues.filter((i) => i.fix?.safe)
  const left = issues.filter((i) => !i.fix?.safe)
  const list = (xs: typeof issues) => xs.slice(0, 5).map((i) => `- ligne ${i.line} : ${i.message}`).join('\n')
  if (!safe.length) return { text: `Le validateur trouve ${issues.length} point${issues.length > 1 ? 's' : ''} à corriger à la main (je n'ai pas de réparation sûre hors ligne) :\n${list(left)}\n\nOnglet Code : le validateur en bas montre chaque ligne.` }
  const fixed = fixCode(code).code
  return {
    fixedCode: fixed,
    text:
      `J'ai réparé ${safe.length} erreur${safe.length > 1 ? 's' : ''} (« Annuler » revient en arrière) :\n${list(safe)}` +
      (left.length ? `\n\nReste à voir à la main :\n${list(left)}` : ''),
  }
}

function auditReply(tree: ModuleTree, name: string): LocalReply {
  let audit: ReturnType<typeof auditModule>
  try {
    audit = auditModule(tree, name)
  } catch {
    return { text: "Je n'ai pas pu analyser ce module hors ligne. Le bouton « Tester » de l'en-tête montre son rendu dans chaque messagerie." }
  }
  const { issues, bytes } = audit
  const kb = Math.round(bytes / 1024)
  const order = { error: 0, warn: 1, info: 2 } as const
  const top = [...issues].sort((a, b) => order[a.level] - order[b.level]).slice(0, 6)
  const icon = { error: '🔴', warn: '🟠', info: 'ℹ️' } as const
  if (!top.length) return { text: `Ton module est propre : rien à signaler pour Outlook, Gmail, Apple Mail ni le mode sombre (${kb} Ko). ✨` }
  return {
    text: `Voici ce que montre le test des messageries (${kb} Ko) :\n${top.map((i) => `- ${icon[i.level]} **${i.title}** : ${brief(i.detail, 220)}`).join('\n')}${issues.length > top.length ? `\n- … et ${issues.length - top.length} autre${issues.length - top.length > 1 ? 's' : ''} point${issues.length - top.length > 1 ? 's' : ''} dans « Tester ».` : ''}\n\nLe bouton « Tester » de l'en-tête montre le rendu de chaque messagerie.`,
  }
}

/**
 * Maily's instant answer without the online model. `offline`: no connection
 * (writing requests are queued); otherwise the AI service is down.
 */
export function localReply(ask: string, ctx: { tree: ModuleTree; name: string; code: string; offline: boolean }): LocalReply {
  const q = ask.trim()
  if (!q || HELLO_ASK.test(q)) return { text: `${ctx.offline ? 'Hors ligne, mais toujours là ! 👋' : 'Je suis là ! 👋'}\n\n${CAN}` }
  if (TEST_ASK.test(q)) return { text: 'Je lance les tests internes…', runTests: true }
  if (FIX_ASK.test(q) && ctx.code) return fixReply(ctx.code)
  if (AUDIT_ASK.test(q) && ctx.tree.sections.length && !/\b(comment|pourquoi|c['’]est quoi|qu['’]est-ce)\b/i.test(q)) return auditReply(ctx.tree, ctx.name)
  const found = searchKnowledge(q)
  // Writing, creating, changing: the online Maily's job.
  if ((EDIT_ASK.test(q) || EDIT_ASK.test(fold(q))) && !/\b(comment|o[uù]|pourquoi|c['’]est quoi|qu['’]est-ce|est-ce que)\b/i.test(q)) return { text: queuedText(ctx.offline), queued: ctx.offline }
  if (!found.length) return { text: ctx.offline ? `Je n'ai pas la réponse sans Internet. ${queuedText(true)}` : queuedText(false), queued: ctx.offline }
  const answer = found.map((e) => (e.title ? `**${e.title}** : ${brief(e.text)}` : brief(e.text))).join('\n\n')
  // Online but the AI service is down: say where this answer comes from.
  return { text: ctx.offline ? answer : `Le service d'IA ne répond pas pour l'instant (« Réessayer » ci-dessous). Voici ce que dit mon guide :\n\n${answer}` }
}
