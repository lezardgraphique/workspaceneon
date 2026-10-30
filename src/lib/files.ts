// File space: documents and images kept on the site (Netlify Blobs, store
// "files"), served by /api/files/<key>. Extensions are whitelisted; SVG and
// scripts are refused and everything but images and PDFs is a download.

export const FILE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export const INLINE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'])

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const QUOTA_BYTES = 200 * 1024 * 1024
export const PAGE_SIZE = 24

export interface StoredFile {
  key: string
  name: string
  type: string
  size: number
  uploadedAt: string
  url: string
}

export interface FileList {
  files: StoredFile[]
  total: number
  usage: { bytes: number; quota: number }
}

export const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? ''

export const isImageType = (t: string) => t.startsWith('image/')

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`
  return `${(bytes / 1024 / 1024).toFixed(1)} Mo`
}

// Keys sort chronologically within an account: [<owner tag>_]<time in base 36>-<random>.<ext>
export const keyTime = (key: string) => new Date(Number.parseInt(key.split('-')[0].split('_').pop()!, 36))
