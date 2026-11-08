/** Promise wrapper over the host virtual filesystem. */
import { Buffer } from 'buffer'
import * as sync from './node-fs'
import * as vfs from './vfs'

function bytesOf(data: unknown): Uint8Array {
  return vfs.toBytes(data)
}

export async function readFile(p: string, encoding?: unknown): Promise<Buffer | string> {
  return sync.readFileSync(p, encoding)
}

export async function writeFile(p: string, data: unknown, _opts?: unknown): Promise<void> {
  vfs.writeBytes(p, bytesOf(data))
}

export async function appendFile(p: string, data: unknown, _opts?: unknown): Promise<void> {
  sync.appendFileSync(p, data)
}

export async function mkdir(p: string, _opts?: unknown): Promise<void> {
  vfs.makeDir(p)
}

export async function rm(p: string, opts?: { force?: boolean; recursive?: boolean }): Promise<void> {
  sync.rmSync(p, opts)
}

export async function unlink(p: string): Promise<void> {
  sync.unlinkSync(p)
}

export async function rename(from: string, to: string): Promise<void> {
  vfs.renameFile(from, to)
}

export async function copyFile(from: string, to: string): Promise<void> {
  vfs.copyFile(from, to)
}

export async function stat(p: string) {
  return sync.statSync(p)
}

export async function lstat(p: string) {
  return sync.lstatSync(p)
}

export async function readdir(p: string): Promise<string[]> {
  return sync.readdirSync(p)
}

export async function mkdtemp(prefix: string): Promise<string> {
  return sync.mkdtempSync(prefix)
}

export async function open(p: string, _flags?: string) {
  const bytes = vfs.readBytes(p)
  let pos = 0
  return {
    async read(buffer: Uint8Array, offset: number, length: number, position?: number | null) {
      const at = position == null ? pos : position
      const end = Math.min(bytes.byteLength, at + length)
      const n = Math.max(0, end - at)
      buffer.set(bytes.subarray(at, at + n), offset)
      pos = at + n
      return { bytesRead: n, buffer }
    },
    async write(buffer: Uint8Array, offset: number, length: number) {
      void buffer
      void offset
      void length
      throw new Error('read-only virtual file handle')
    },
    async close() {},
    async stat() {
      return sync.statSync(p)
    },
    async truncate() {},
    async sync() {},
  }
}

export async function mkdirp(p: string): Promise<void> {
  vfs.makeDir(p)
}
