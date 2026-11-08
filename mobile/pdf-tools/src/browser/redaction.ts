/** Permanent redaction needs PDFium's content-stream removal pass. */
import type { RedactionInput } from '../../../../apps/pdf/src/shared/ipc'

export async function redactPdf(_bytes: Uint8Array, _redactions: RedactionInput[]): Promise<Uint8Array> {
  throw new Error(
    'Permanent redaction needs PDFium and is not available in the Android build. Save a normal edited copy instead.',
  )
}
