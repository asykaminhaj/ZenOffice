/** POSIX-only path helpers for the browser slides host. */
export const sep = '/'

export function normalize(p: string): string {
  const s = String(p ?? '').replace(/\\/g, '/')
  const absolute = s.startsWith('/')
  const parts: string[] = []
  for (const part of s.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (parts.length && parts[parts.length - 1] !== '..') parts.pop()
      else if (!absolute) parts.push('..')
      continue
    }
    parts.push(part)
  }
  const out = parts.join('/')
  if (absolute) return '/' + out
  return out || '.'
}

export function join(...parts: string[]): string {
  return normalize(parts.filter((p) => p != null && p !== '').join('/'))
}

export function resolve(...parts: string[]): string {
  let out = ''
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = String(parts[i] ?? '')
    if (!part) continue
    out = out ? `${part}/${out}` : part
    if (part.startsWith('/')) break
  }
  return normalize(out || '.')
}

export function dirname(p: string): string {
  const norm = normalize(p)
  const i = norm.lastIndexOf('/')
  if (i < 0) return '.'
  if (i === 0) return '/'
  return norm.slice(0, i)
}

export function basename(p: string, ext?: string): string {
  const norm = normalize(p)
  let base = norm.slice(norm.lastIndexOf('/') + 1)
  if (ext && base.endsWith(ext)) base = base.slice(0, -ext.length)
  return base
}

export function extname(p: string): string {
  const base = basename(p)
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i) : ''
}

export function isAbsolute(p: string): boolean {
  return String(p ?? '').replace(/\\/g, '/').startsWith('/')
}

export function relative(from: string, to: string): string {
  const a = normalize(from).split('/').filter(Boolean)
  const b = normalize(to).split('/').filter(Boolean)
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') || ''
}

export function parse(p: string): { root: string; dir: string; base: string; ext: string; name: string } {
  const dir = dirname(p)
  const base = basename(p)
  const ext = extname(p)
  return { root: isAbsolute(p) ? '/' : '', dir, base, ext, name: ext ? base.slice(0, -ext.length) : base }
}

export const posix = { sep, normalize, join, resolve, dirname, basename, extname, isAbsolute, relative, parse }
export default posix
