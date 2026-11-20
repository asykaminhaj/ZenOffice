/** Virtual paths for the wasm binaries registered by assets.ts. */
export const PDFIUM_WASM = '/zen-assets/pdfium.wasm'
export const HB_SUBSET_WASM = '/zen-assets/hb-subset.wasm'

export function pdfiumWasmPath(): string {
  return PDFIUM_WASM
}

export function hbSubsetWasmPath(): string {
  return HB_SUBSET_WASM
}
