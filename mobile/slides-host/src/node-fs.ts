/** Browser replacement for the synchronous subset of node:fs used by Slides. */
import { Buffer } from 'buffer'
import * as vfs from './vfs'
import * as path from './node-path'

export interface StatsLike {
  size: number
  mtimeMs: number
  mtime: Date
  ctimeMs: number
  ctime: Date
  isFile(): boolean
  isDirectory(): boolean
  isSymbolicLink(): boolean
}

function statsFor(p: string): StatsLike {
  const file = vfs.statFile(p)
  if (file) {
    const ms = file.mtimeMs
    return {
      size: file.bytes.byteLength,
      mtimeMs: ms,
      mtime: new Date(ms),
      ctimeMs: ms,
      ctime: new Date(ms),
      isFile: () => true,
      isDirectory: () => false,
      isSymbolicLink: () => false,
    }
  }
  const dir = vfs.hasDir(p)
  if (dir) {
    const ms = Date.now()
    return {
      size: 0,
      mtimeMs: ms,
      mtime: new Date(ms),
      ctimeMs: ms,
      ctime: new Date(ms),
      isFile: () => false,
      isDirectory: () => true,
      isSymbolicLink: () => false,
    }
  }
  const err = new Error(`ENOENT: no such file or directory, stat '${p}'`) as Error & { code?: string }
  err.code = 'ENOENT'
  throw err
}

function bytesOf(data: unknown): Uint8Array {
  return vfs.toBytes(data)
}

export function existsSync(p: string): boolean {
  return vfs.hasFile(p) || vfs.hasDir(p)
}

export function mkdirSync(p: string, _opts?: unknown): void {
  vfs.makeDir(p)
}

export function readFileSync(p: string, encoding?: unknown): Buffer | string {
  const bytes = vfs.readBytes(p)
  const enc = typeof encoding === 'string' ? encoding : undefined
  if (enc) return Buffer.from(bytes).toString(enc as BufferEncoding)
  return Buffer.from(bytes)
}

export function writeFileSync(p: string, data: unknown, _opts?: unknown): void {
  vfs.writeBytes(p, bytesOf(data))
}

export function appendFileSync(p: string, data: unknown, _opts?: unknown): void {
  let old = new Uint8Array()
  try {
    old = vfs.readBytes(p)
  } catch {
    /* new file */
  }
  const next = bytesOf(data)
  const merged = new Uint8Array(old.byteLength + next.byteLength)
  merged.set(old, 0)
  merged.set(next, old.byteLength)
  vfs.writeBytes(p, merged)
}

export function unlinkSync(p: string): void {
  if (!vfs.removeFile(p)) {
    const err = new Error(`ENOENT: no such file or directory, unlink '${p}'`) as Error & { code?: string }
    err.code = 'ENOENT'
    throw err
  }
}

export function rmSync(p: string, opts?: { force?: boolean; recursive?: boolean }): void {
  if (vfs.removeFile(p)) return
  if (opts?.recursive) {
    for (const file of vfs.listFiles()) {
      if (file === p || file.startsWith(`${p}/`)) vfs.removeFile(file)
    }
  }
  if (!opts?.force && !vfs.hasDir(p)) {
    const err = new Error(`ENOENT: no such file or directory, rm '${p}'`) as Error & { code?: string }
    err.code = 'ENOENT'
    throw err
  }
}

export function renameSync(from: string, to: string): void {
  vfs.renameFile(from, to)
}

export function copyFileSync(from: string, to: string): void {
  vfs.copyFile(from, to)
}

export function statSync(p: string): StatsLike {
  return statsFor(p)
}

export function lstatSync(p: string): StatsLike {
  return statsFor(p)
}

export function readdirSync(p: string): string[] {
  if (!vfs.hasDir(p)) {
    const err = new Error(`ENOENT: no such file or directory, scandir '${p}'`) as Error & {
      code?: string
    }
    err.code = 'ENOENT'
    throw err
  }
  return vfs.listDir(p)
}

export function mkdtempSync(prefix: string): string {
  const dir = `${prefix}${Date.now().toString(36)}`
  vfs.makeDir(dir)
  return dir
}

export function openSync(p: string, flags?: string): number {
  void flags
  return vfs.hasFile(p) ? 1 : 0
}

export function closeSync(_fd: number): void {
  /* no descriptors in the virtual filesystem */
}

export function fsyncSync(_fd: number): void {
  /* writes are synchronous */
}

export function createWriteStream(p: string) {
  const chunks: Uint8Array[] = []
  return {
    write(chunk: unknown) {
      chunks.push(bytesOf(chunk))
      return true
    },
    end(chunk?: unknown) {
      if (chunk != null) chunks.push(bytesOf(chunk))
      const total = chunks.reduce((n, c) => n + c.byteLength, 0)
      const out = new Uint8Array(total)
      let at = 0
      for (const c of chunks) {
        out.set(c, at)
        at += c.byteLength
      }
      vfs.writeBytes(p, out)
    },
    on() {
      return this
    },
    once() {
      return this
    },
    emit() {
      return true
    },
    destroy() {},
  }
}

export function createReadStream(p: string) {
  const bytes = vfs.readBytes(p)
  return {
    on(event: string, cb: (...args: unknown[]) => void) {
      if (event === 'data') cb(Buffer.from(bytes))
      if (event === 'end') setTimeout(() => cb(), 0)
      return this
    },
    pipe() {
      return this
    },
  }
}

export const promises = import('./node-fs-promises')
export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1 }
export { path }
