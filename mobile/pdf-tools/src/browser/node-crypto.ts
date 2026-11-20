/** Synchronous sha256 `createHash` for the redaction pass (image fingerprints). */
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

export function createHash(algorithm: string) {
  if (algorithm !== 'sha256') throw new Error(`Unsupported hash in Android build: ${algorithm}`)
  const h = sha256.create()
  const api = {
    update(data: Uint8Array) {
      h.update(data)
      return api
    },
    digest(encoding?: string) {
      const out = h.digest()
      return encoding === 'hex' ? bytesToHex(out) : out
    },
  }
  return api
}

export default { createHash }
