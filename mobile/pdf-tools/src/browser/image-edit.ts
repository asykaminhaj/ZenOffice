/** Browser stub for PDFium-backed content-stream image edits. */
import type {
  ImageEditFailure,
  ImageEditInput,
} from '../../../../apps/pdf/src/shared/ipc'

export async function applyImageEdits(
  bytes: Uint8Array,
  edits: ImageEditInput[],
): Promise<{ bytes: Uint8Array; skipped: ImageEditFailure[] }> {
  return {
    bytes,
    skipped: edits.map((edit, editIndex) => ({
      editIndex,
      pageIndex: edit.pageIndex,
      reason: 'Editing images already inside a PDF requires PDFium, which is not available on Android',
    })),
  }
}

export async function verifyImageEdits(): Promise<{ pageIndex: number; reason: string }[]> {
  return []
}
