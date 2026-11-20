/**
 * Browser-side PDF toolkit for the Android build.
 *
 * The desktop pdf-lib and PDFium stages are reused verbatim. PDFium runs as
 * WebAssembly (@embedpdf/pdfium), so direct text editing, text insertion,
 * annotation deletion and permanent redaction behave like the desktop app.
 * Node-only pieces (fs, crypto, wasm paths, the system font index) are swapped
 * for the modules in ./browser by build-pdf-tools.mjs. Only content-stream
 * image edits stay stubbed: they decode images with Electron's nativeImage.
 */
import { PDFDocument } from 'pdf-lib'
import {
  applySaveRequest as desktopApplySaveRequest,
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
import { canDrawText, listEditFonts, validateTextEdits } from '../../../apps/pdf/src/main/text-edit'
import type { SavePdfRequest, TextEditInput } from '../../../apps/pdf/src/shared/ipc'
import { ensurePdfiumAssets } from './browser/assets'

type SaveInput = Omit<SavePdfRequest, 'path' | 'targetPath'>

function needsPdfium(request: SaveInput): boolean {
  return Boolean(
    request.textEdits?.length ||
    request.textInserts?.length ||
    request.annotDeletes?.length ||
    request.redactions?.length,
  )
}

/** Same as the desktop save, but loads the PDFium wasm and fonts first when a stage needs them */
async function applySaveRequest(bytes: Uint8Array, request: SaveInput) {
  if (needsPdfium(request)) await ensurePdfiumAssets()
  return desktopApplySaveRequest(bytes, request as never)
}

async function validateTextEditsBytes(bytes: Uint8Array, edits: TextEditInput[]) {
  await ensurePdfiumAssets()
  return validateTextEdits(bytes, edits)
}

async function listEditFontsReady(): Promise<string[]> {
  await ensurePdfiumAssets()
  return listEditFonts()
}

async function canDrawTextReady(text: string, font?: string, bold = false, italic = false) {
  await ensurePdfiumAssets()
  return canDrawText(text, font, bold, italic)
}

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
  validateTextEdits: validateTextEditsBytes,
  listEditFonts: listEditFontsReady,
  canDrawText: canDrawTextReady,
  ensurePdfiumAssets,
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
