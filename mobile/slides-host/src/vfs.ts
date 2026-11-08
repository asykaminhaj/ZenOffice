/**
 * Tiny in-memory filesystem used only by the Android slides host.
 *
 * The desktop slides main process is written against Node's fs. Rather than
 * rewriting every handler, the host gives it a private filesystem and syncs the
 * files that matter (the deck, imported images) to Capacitor around open/save.
 */

export interface VfsFile {
  bytes: Uint8Array
  mtimeMs: number
}

const files = new Map<string, VfsFile>()
const dirs = new Set<string>(['', '.', '/'])

export function normalizePath(path: string): string {
  let s = String(path == null ? '' : path).replace(/\\/g, '/').trim()
  if (!s) return ''
  const absolute = s.startsWith('/')
  const parts: string[] = []
  for (const part of s.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length) parts.pop()
      continue
    }
    parts.push(part)
  }
  s = parts.join('/')
  return absolute ? `/${s}` : s
}

function parentOf(path: string): string {
  const norm = normalizePath(path)
  const i = norm.lastIndexOf('/')
  if (i < 0) return ''
  if (i === 0) return '/'
  return norm.slice(0, i)
}

export function toBytes(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return new Uint8Array(data)
  if (data instanceof ArrayBuffer) return new Uint8Array(data.slice(0))
  if (ArrayBuffer.isView(data)) {
    const view = data as ArrayBufferView
    return new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice()
  }
  if (typeof data === 'string') return new TextEncoder().encode(data)
  if (data == null) return new Uint8Array()
  return new TextEncoder().encode(String(data))
}

export function writeBytes(path: string, data: unknown): number {
  const key = normalizePath(path)
  const bytes = toBytes(data)
  files.set(key, { bytes, mtimeMs: Date.now() })
  dirs.add(parentOf(key))
  return bytes.byteLength
}

export function readBytes(path: string): Uint8Array {
  const hit = files.get(normalizePath(path))
  if (!hit) {
    const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as Error & {
      code?: string
    }
    err.code = 'ENOENT'
    throw err
  }
  return new Uint8Array(hit.bytes)
}

export function readText(path: string): string {
  return new TextDecoder('utf-8').decode(readBytes(path))
}

export function hasFile(path: string): boolean {
  return files.has(normalizePath(path))
}

export function hasDir(path: string): boolean {
  return dirs.has(normalizePath(path))
}

export function statFile(path: string): VfsFile | null {
  return files.get(normalizePath(path)) ?? null
}

export function removeFile(path: string): boolean {
  return files.delete(normalizePath(path))
}

export function renameFile(from: string, to: string): void {
  const src = files.get(normalizePath(from))
  if (!src) {
    const err = new Error(`ENOENT: no such file or directory, rename '${from}'`) as Error & {
      code?: string
    }
    err.code = 'ENOENT'
    throw err
  }
  files.delete(normalizePath(from))
  files.set(normalizePath(to), { bytes: src.bytes, mtimeMs: Date.now() })
  dirs.add(parentOf(to))
}

export function copyFile(from: string, to: string): void {
  const src = files.get(normalizePath(from))
  if (!src) {
    const err = new Error(`ENOENT: no such file or directory, copy '${from}'`) as Error & {
      code?: string
    }
    err.code = 'ENOENT'
    throw err
  }
  files.set(normalizePath(to), { bytes: new Uint8Array(src.bytes), mtimeMs: Date.now() })
  dirs.add(parentOf(to))
}

export function makeDir(path: string): void {
  let norm = normalizePath(path)
  dirs.add(norm)
  while (norm) {
    const parent = parentOf(norm)
    dirs.add(parent)
    if (!parent || parent === '/') break
    norm = parent
  }
}

export function listDir(path: string): string[] {
  const norm = normalizePath(path)
  const prefix = norm ? `${norm}/` : ''
  const out = new Set<string>()
  for (const key of files.keys()) {
    if (!key.startsWith(prefix)) continue
    const rest = key.slice(prefix.length)
    if (!rest) continue
    out.add(rest.split('/')[0]!)
  }
  return [...out]
}

export function listFiles(): string[] {
  return [...files.keys()]
}

export function setFileTimes(path: string, mtimeMs: number): void {
  const hit = files.get(normalizePath(path))
  if (hit) hit.mtimeMs = mtimeMs
}

export const vfs = {
  normalizePath,
  writeBytes,
  readBytes,
  readText,
  hasFile,
  hasDir,
  statFile,
  removeFile,
  renameFile,
  copyFile,
  makeDir,
  listDir,
  listFiles,
}

declare global {
  interface Window {
    __genofficeVfs?: typeof vfs
  }
}
