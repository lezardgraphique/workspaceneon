import { useMemo } from 'react'

import { CONTACT_LABELS, contactUses } from '@/lib/hubl-render'
import type { SampleContact } from '@/lib/hubl-render'
import type { ModuleTree } from '@/lib/types'

// « Contact connu / Contact inconnu »: which sample contact the previews use.
// It only changes something when the module reads contact data, so it says
// which (« prénom, entreprise ») and is switched off otherwise.
export function ContactSwitch({ tree, contact, onChange, className = '' }: { tree: ModuleTree; contact: SampleContact; onChange: (c: SampleContact) => void; className?: string }) {
  const uses = useMemo(() => contactUses(tree), [tree])
  const names = uses.map((u) => CONTACT_LABELS[u] ?? u).join(', ')
  const title = uses.length
    ? `Aperçu pour un contact connu (prénom, entreprise… de Camille Martin, exemple) ou inconnu (champs vides : valeurs par défaut et branches « sinon »). Ce module utilise : ${names}.`
    : 'Ce module n’utilise aucune donnée du contact ({{ contact.… }} ou personalization_token) : l’aperçu est le même pour tous.'
  return (
    <select
      value={uses.length ? contact : 'none'}
      onChange={(e) => onChange(e.target.value as SampleContact)}
      disabled={!uses.length}
      aria-label="Contact d'exemple pour l'aperçu"
      title={title}
      className={`shrink-0 rounded-md border border-line bg-void px-1.5 py-1.5 text-xs outline-none hover:border-cyan disabled:cursor-not-allowed disabled:opacity-50 ${uses.length ? 'text-white' : 'text-mute'} ${className}`}
    >
      {uses.length ? (
        <>
          <option value="known">Contact connu</option>
          <option value="unknown">Contact inconnu</option>
        </>
      ) : (
        <option value="none">Sans données contact</option>
      )}
    </select>
  )
}
