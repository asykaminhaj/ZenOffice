/** Minimal node:crypto surface needed by the pptx engine and slides main. */
import CryptoJS from 'crypto-js'

function wordsToBytes(words: CryptoJS.lib.WordArray): Uint8Array {
  const out = new Uint8Array(words.sigBytes)
  for (let i = 0; i < words.sigBytes; i++) {
    out[i] = (words.words[i >>> 2]! >>> (24 - (i % 4) * 8)) & 0xff
  }
  return out
}

export function createHash(algorithm: string) {
  const alg = String(algorithm || '').toLowerCase().replace('-', '')
  let chunks: Uint8Array[] = []
  function digestWords() {
    const total = chunks.reduce((n, c) => n + c.byteLength, 0)
    const all = new Uint8Array(total)
    let at = 0
    for (const c of chunks) {
      all.set(c, at)
      at += c.byteLength
    }
    const wordArray = CryptoJS.lib.WordArray.create(all as unknown as number[])
    if (alg === 'sha1') return CryptoJS.SHA1(wordArray)
    if (alg === 'sha512') return CryptoJS.SHA512(wordArray)
    if (alg === 'md5') return CryptoJS.MD5(wordArray)
    return CryptoJS.SHA256(wordArray)
  }
  return {
    update(data: unknown) {
      chunks.push(
        typeof data === 'string'
          ? new TextEncoder().encode(data)
          : data instanceof Uint8Array
            ? new Uint8Array(data)
            : new Uint8Array(data as ArrayBuffer),
      )
      return this
    },
    digest(encoding?: string) {
      const words = digestWords()
      if (encoding === 'hex' || encoding == null) return words.toString(CryptoJS.enc.Hex)
      if (encoding === 'base64') return words.toString(CryptoJS.enc.Base64)
      return wordsToBytes(words)
    },
  }
}

export function randomUUID(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  const bytes = new Uint8Array(16)
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const h = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export function randomBytes(size: number): Uint8Array {
  const out = new Uint8Array(size)
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(out)
  else for (let i = 0; i < size; i++) out[i] = Math.floor(Math.random() * 256)
  return out
}

export default { createHash, randomUUID, randomBytes }
