/** Browser stub for PDFium-backed content-stream text editing. */
import type {
  TextEditFailure,
  TextEditInput,
  TextInsertFailure,
  TextInsertInput,
} from '../../../../apps/pdf/src/shared/ipc'

export async function applyTextEdits(
  bytes: Uint8Array,
  edits: TextEditInput[],
): Promise<{ bytes: Uint8Array; skipped: TextEditFailure[] }> {
  return {
    bytes,
    skipped: edits.map((edit) => ({
      pageIndex: edit.pageIndex,
      oldText: edit.oldText,
      reason: 'Direct text editing requires PDFium, which is not available in the Android build',
    })),
  }
}

export async function applyTextInserts(
  bytes: Uint8Array,
  inserts: TextInsertInput[],
): Promise<{ bytes: Uint8Array; skipped: TextInsertFailure[] }> {
  return {
    bytes,
    skipped: inserts.map((insert, editIndex) => ({
      editIndex,
      pageIndex: insert.pageIndex,
      reason: 'Text insertion requires PDFium, which is not available in the Android build',
    })),
  }
}

export async function verifyTextEdits(): Promise<TextEditFailure[]> {
  return []
}
