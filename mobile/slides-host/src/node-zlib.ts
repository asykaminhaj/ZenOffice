/** node:zlib's deflateSync is used when a PNG/icon is embedded into a deck. */
import { zlibSync } from 'fflate'
import { Buffer } from 'buffer'

export function deflateSync(data: Uint8Array): Buffer {
  return Buffer.from(zlibSync(new Uint8Array(data)))
}

export function inflateSync(data: Uint8Array): Buffer {
  const { unzlibSync } = requireFflate()
  return Buffer.from(unzlibSync(new Uint8Array(data)))
}

function requireFflate(): typeof import('fflate') {
  // Keep the named import above tree-shakeable while allowing inflateSync too.
  return fflateModule
}

import * as fflateModule from 'fflate'

export default { deflateSync, inflateSync }
