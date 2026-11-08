/** The Android host writes through Capacitor, never this Node helper. */
export async function writePdfAtomically(): Promise<void> {
  throw new Error('writePdfAtomically is not available in the browser host')
}
