import { useEffect, useState } from 'react'

import type { SampleContact } from './hubl-render'

// The sample contact of the previews (« Contact connu / Contact inconnu »),
// shared by the editor, the preview page, the messaging tests and the VML
// panel, and remembered on this device (a display choice, not synced).
const KEY = 'nsp-preview-contact'
const EVENT = 'nsp-preview-contact'

export function readSampleContact(): SampleContact {
  try {
    return localStorage.getItem(KEY) === 'unknown' ? 'unknown' : 'known'
  } catch {
    return 'known'
  }
}

export function useSampleContact(): [SampleContact, (c: SampleContact) => void] {
  const [contact, setContact] = useState<SampleContact>('known')
  useEffect(() => {
    const read = () => setContact(readSampleContact())
    read()
    window.addEventListener(EVENT, read)
    window.addEventListener('storage', read)
    return () => {
      window.removeEventListener(EVENT, read)
      window.removeEventListener('storage', read)
    }
  }, [])
  return [
    contact,
    (c) => {
      try {
        localStorage.setItem(KEY, c)
      } catch {
        // Private mode: the choice lasts for this page only.
      }
      setContact(c)
      window.dispatchEvent(new Event(EVENT))
    },
  ]
}
