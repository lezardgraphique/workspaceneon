// The extension and the declared type come from the client, so they prove
// nothing: the first bytes must match what the file claims to be.

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v)
const ascii = (b: Uint8Array, at: number, s: string) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0))

const TEXT = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json', 'text/html', 'text/css'])

export function matchesType(bytes: Uint8Array, type: string): boolean {
  switch (type) {
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff])
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/gif':
      return ascii(bytes, 0, 'GIF87a') || ascii(bytes, 0, 'GIF89a')
    case 'image/webp':
      return ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')
    case 'application/pdf':
      return ascii(bytes, 0, '%PDF-')
    default:
      if (type === 'application/zip' || type.startsWith('application/vnd.openxmlformats')) return startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])
      // Text files: no binary content.
      if (TEXT.has(type)) return !bytes.subarray(0, 8192).includes(0)
      return false
  }
}

export async function readHead(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, 8192).arrayBuffer())
}
