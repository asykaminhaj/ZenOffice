/**
 * Android/browser replacement for the Electron annot-delete stage.
 *
 * The desktop implementation walks PDFium's annotation list. The objects are
 * ordinary PDF dictionaries, so pdf-lib can remove the same annotations by
 * object number with a subtype/rect/contents fallback after a rewrite.
 */
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFString,
} from 'pdf-lib'
import type { AnnotDeleteInput } from '../../../../apps/pdf/src/shared/ipc'

const SUBTYPE: Record<AnnotDeleteInput['subtype'], string> = {
  highlight: 'Highlight',
  underline: 'Underline',
  strikeout: 'Strikeout',
  note: 'Text',
}

function numberValue(value: unknown): number | null {
  if (value instanceof PDFNumber) return value.asNumber()
  return null
}

function textValue(value: unknown): string {
  if (value instanceof PDFString) return value.decodeText()
  if (value instanceof PDFHexString) return value.decodeText()
  return ''
}

function rectOf(dict: PDFDict): [number, number, number, number] | null {
  const raw = dict.lookup(PDFName.of('Rect'))
  if (!(raw instanceof PDFArray) || raw.size() < 4) return null
  const points = [0, 1, 2, 3].map((i) => numberValue(raw.lookup(i)))
  if (points.some((n) => n == null)) return null
  return points as [number, number, number, number]
}

function subtypeOf(dict: PDFDict): string {
  const raw = dict.lookup(PDFName.of('Subtype'))
  if (raw instanceof PDFName) return raw.asString().replace(/^\//, '')
  return ''
}

/** PDF /Rect can be stored in either corner order; compare normalized bounds. */
function rectsMatch(a: [number, number, number, number], b: [number, number, number, number]) {
  const ac = [Math.min(a[0], a[2]), Math.min(a[1], a[3]), Math.max(a[0], a[2]), Math.max(a[1], a[3])]
  const bc = [Math.min(b[0], b[2]), Math.min(b[1], b[3]), Math.max(b[0], b[2]), Math.max(b[1], b[3])]
  return ac.every((n, i) => Math.abs(n - bc[i]!) <= 2)
}

function removeAt(page: ReturnType<PDFDocument['getPage']>, doc: PDFDocument, index: number): void {
  const annots = page.node.Annots()
  if (!annots) return
  annots.remove(index)
  if (annots.size() === 0) page.node.delete(PDFName.of('Annots'))
  void doc
}

export async function applyAnnotDeletes(
  bytes: Uint8Array,
  deletes: AnnotDeleteInput[],
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  for (const del of deletes) {
    const page = doc.getPage(del.pageIndex)
    const annots = page.node.Annots()
    if (!annots) continue

    let found = -1
    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i)
      if (ref instanceof PDFRef && ref.objectNumber === del.objNum) {
        found = i
        break
      }
    }

    if (found < 0) {
      const wantedSubtype = SUBTYPE[del.subtype]
      for (let i = 0; i < annots.size(); i++) {
        const ref = annots.get(i)
        const dict = ref instanceof PDFRef ? doc.context.lookupMaybe(ref, PDFDict) : null
        if (!dict || subtypeOf(dict) !== wantedSubtype) continue
        const rect = rectOf(dict)
        if (!rect || !rectsMatch(rect, del.rect)) continue
        if (del.subtype === 'note' && del.contents != null) {
          if (textValue(dict.lookup(PDFName.of('Contents'))) !== del.contents) continue
        }
        found = i
        break
      }
    }

    if (found >= 0) removeAt(page, doc, found)
  }
  return doc.save({ useObjectStreams: false })
}
