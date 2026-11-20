/**
 * In-memory stand-in for `node:fs` in the Android PDF bundle.
 *
 * The desktop PDFium modules read their wasm binaries and font files with
 * readFileSync. In the WebView those files are fetched once (see assets.ts)
 * and registered here under the same paths the desktop code asks for.
 */
import { Buffer } from 'buffer'

const files = new Map<string, Uint8Array>()

export function registerFile(path: string, bytes: Uint8Array): void {
  files.set(path, bytes)
}

function enoent(path: string): Error {
  const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as Error & {
    code: string
  }
  err.code = 'ENOENT'
  return err
}

export function readFileSync(path: string): Buffer {
  const bytes = files.get(String(path))
  if (!bytes) throw enoent(String(path))
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

export function existsSync(path: string): boolean {
  return files.has(String(path))
}

export async function readFile(path: string): Promise<Buffer> {
  return readFileSync(path)
}

export default { readFileSync, existsSync, readFile }
