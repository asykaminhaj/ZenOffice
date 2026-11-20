/**
 * Fetches the PDFium / hb-subset wasm binaries and the bundled fonts next to
 * pdf-tools.js and registers them in the in-memory fs, so the desktop
 * text-edit and redaction modules can load them with readFileSync.
 */
import { registerFile } from './node-fs'
import { HB_SUBSET_WASM, PDFIUM_WASM } from './wasm-path'

const LIB = '/usr/share/fonts/truetype/liberation/'

/** Liberation Sans stands in for Arial (the desktop EDIT_FONT_PATHS / fallback paths). */
const FONT_FILES: Record<string, string> = {
  'LiberationSans-Regular.ttf': LIB + 'LiberationSans-Regular.ttf',
  'LiberationSans-Bold.ttf': LIB + 'LiberationSans-Bold.ttf',
  'LiberationSans-Italic.ttf': LIB + 'LiberationSans-Italic.ttf',
  'LiberationSans-BoldItalic.ttf': LIB + 'LiberationSans-BoldItalic.ttf',
}

export const BUNDLED_FONT_PATHS = Object.values(FONT_FILES)

function baseUrl(): string {
  const script = document.querySelector<HTMLScriptElement>('script[src*="pdf-tools.js"]')
  const src = script?.src || new URL('../shim/pdf-tools.js', location.href).href
  return src.replace(/pdf-tools\.js(\?.*)?$/, '')
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Gagal memuat ${url} (${res.status})`)
  return new Uint8Array(await res.arrayBuffer())
}

let ready: Promise<void> | null = null

/** Load every asset once; later calls share the same promise. */
export function ensurePdfiumAssets(): Promise<void> {
  ready ??= (async () => {
    const base = baseUrl()
    const jobs: Promise<void>[] = [
      fetchBytes(base + 'pdfium.wasm').then((b) => registerFile(PDFIUM_WASM, b)),
      fetchBytes(base + 'hb-subset.wasm').then((b) => registerFile(HB_SUBSET_WASM, b)),
    ]
    for (const [name, path] of Object.entries(FONT_FILES)) {
      jobs.push(
        fetchBytes(base + 'fonts/' + name)
          .then((b) => registerFile(path, b))
          .catch(() => undefined),
      )
    }
    await Promise.all(jobs)
  })()
  ready.catch(() => {
    ready = null
  })
  return ready
}
