/**
 * Browser-side PDF toolkit for the Android build.
 *
 * The desktop pdf-lib stages are reused verbatim; only the PDFium stages
 * (text/image content-stream edits and permanent redaction) are replaced by
 * no-op/stub modules in ./browser. Annotations, forms, stamps, drawings, page
 * operations and metadata all stay byte-compatible with the desktop app.
 */
import { PDFDocument } from 'pdf-lib'
import {
  applySaveRequest,
  cropPagesBytes,
  extractPagesBytes,
  insertBlankPageBytes,
  insertPdfBytes,
  mergePagesBytes,
  mergePdfBytes,
  readStaticFormFills,
  replacePagesBytes,
  setPageSizeBytes,
  splitPagesBytes,
  splitPdfBytes,
} from '../../../apps/pdf/src/main/save-pdf'
import type { SavePdfRequest } from '../../../apps/pdf/src/shared/ipc'

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk) as unknown as number[])
  }
  return btoa(bin)
}

function fromBase64(value: string): Uint8Array {
  const bin = atob(String(value || ''))
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function mergeBase64(parts: string[]): Promise<Uint8Array> {
  const merged = await PDFDocument.create()
  for (const b64 of parts) {
    const part = await PDFDocument.load(fromBase64(b64))
    const pages = await merged.copyPages(part, part.getPageIndices())
    for (const page of pages) merged.addPage(page)
  }
  return merged.save({ useObjectStreams: false })
}

const api = {
  applySaveRequest,
  cropPagesBytes,
  extractPagesBytes,
  insertBlankPageBytes,
  insertPdfBytes,
  mergePagesBytes,
  mergePdfBytes,
  readStaticFormFills,
  replacePagesBytes,
  setPageSizeBytes,
  splitPagesBytes,
  splitPdfBytes,
  mergeBase64,
  toBase64,
  fromBase64,
  PDFDocument,
}

declare global {
  interface Window {
    __genofficePdfTools?: typeof api
  }
}

window.__genofficePdfTools = api
export type PdfTools = typeof api
export type { SavePdfRequest }
