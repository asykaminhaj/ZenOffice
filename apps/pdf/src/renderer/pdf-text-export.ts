/**
 * Text extraction for the "convert PDF to Word / Excel / PowerPoint / Markdown / HTML"
 * exports on Android. Runs in the PDF app, which already holds the pdf.js document, and
 * hands plain paragraphs to the shell shim. Layout (columns, tables, images, fonts) is
 * not reproduced; this is flowing text only.
 */

export interface ExportParagraph {
  t: string
  rtl: boolean
}

export interface ExportPage {
  paragraphs: ExportParagraph[]
  /** a real page that yielded no selectable text (scan / pure image) */
  noText: boolean
}

export interface PdfTextExport {
  name: string
  /** first page size in PDF points */
  pageSize: [number, number] | null
  pages: ExportPage[]
}

interface PageLike {
  getTextContent(): Promise<{ items: unknown[] }>
  getViewport(params: { scale: number }): { width: number; height: number }
  cleanup?: () => unknown
}

interface DocLike {
  getPage(pageNumber: number): Promise<PageLike>
}

interface Frag {
  s: string
  x: number
  y: number
  w: number
  h: number
}

interface Line {
  text: string
  x0: number
  x1: number
  y: number
}

const RTL_RE = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g
const LTR_RE = /[A-Za-z\u00C0-\u024F\u0370-\u03FF\u0400-\u04FF]/g

function isRtl(text: string): boolean {
  const r = (text.match(RTL_RE) ?? []).length
  if (r === 0) return false
  const l = (text.match(LTR_RE) ?? []).length
  return r >= l
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

function buildLines(frags: Frag[]): Line[] {
  const sorted = [...frags].sort((a, b) => b.y - a.y || a.x - b.x)
  const groups: Frag[][] = []
  let cur: Frag[] = []
  let refY = 0
  let refH = 0
  for (const f of sorted) {
    if (cur.length === 0) {
      cur = [f]
      refY = f.y
      refH = f.h
      continue
    }
    if (Math.abs(f.y - refY) <= 0.45 * Math.max(refH, f.h)) {
      cur.push(f)
      refH = Math.max(refH, f.h)
    } else {
      groups.push(cur)
      cur = [f]
      refY = f.y
      refH = f.h
    }
  }
  if (cur.length > 0) groups.push(cur)

  const lines: Line[] = []
  for (const g of groups) {
    const rtl = isRtl(g.map((f) => f.s).join(''))
    const y = g.reduce((sum, f) => sum + f.y, 0) / g.length
    g.sort((a, b) => (rtl ? b.x + b.w - (a.x + a.w) : a.x - b.x))
    let text = ''
    for (let i = 0; i < g.length; i++) {
      const f = g[i]!
      if (i > 0) {
        const p = g[i - 1]!
        const gap = rtl ? p.x - (f.x + f.w) : f.x - (p.x + p.w)
        const h = Math.max(p.h, f.h)
        if (gap > 0.12 * h && !/\s$/.test(text) && !/^\s/.test(f.s)) text += ' '
      }
      text += f.s
    }
    text = text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    lines.push({
      text,
      x0: Math.min(...g.map((f) => f.x)),
      x1: Math.max(...g.map((f) => f.x + f.w)),
      y,
    })
  }
  return lines
}

function buildParagraphs(lines: Line[]): ExportParagraph[] {
  if (lines.length === 0) return []
  const gaps: number[] = []
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1]!.y - lines[i]!.y
    if (gap > 0) gaps.push(gap)
  }
  const typical = median(gaps)
  const maxW = Math.max(...lines.map((l) => l.x1 - l.x0))
  const paras: ExportParagraph[] = []
  let cur: Line[] = [lines[0]!]
  const flush = () => {
    const text = cur
      .map((l) => l.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (text) paras.push({ t: text, rtl: isRtl(text) })
  }
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1]!
    const line = lines[i]!
    const bigGap = typical > 0 && prev.y - line.y > 1.45 * typical
    const shortPrev = prev.x1 - prev.x0 < 0.7 * maxW
    if (bigGap || shortPrev) {
      flush()
      cur = [line]
    } else {
      cur.push(line)
    }
  }
  flush()
  return paras
}

export async function extractPdfTextForExport(
  doc: DocLike,
  visList: number[],
  isBlank: (origIdx: number) => boolean,
  name: string,
): Promise<PdfTextExport> {
  const pages: ExportPage[] = []
  let pageSize: [number, number] | null = null
  let n = 0
  for (const origIdx of visList) {
    if (++n % 20 === 0) await new Promise((r) => setTimeout(r, 0)) // keep the UI alive
    if (isBlank(origIdx)) {
      pages.push({ paragraphs: [], noText: false })
      continue
    }
    const page = await doc.getPage(origIdx + 1)
    if (!pageSize) {
      const vp = page.getViewport({ scale: 1 })
      pageSize = [vp.width, vp.height]
    }
    const content = await page.getTextContent()
    const frags: Frag[] = []
    for (const raw of content.items) {
      const item = raw as { str?: unknown; transform?: unknown; width?: unknown; height?: unknown }
      if (typeof item.str !== 'string' || !Array.isArray(item.transform)) continue
      if (item.str.trim() === '') continue
      const tr = item.transform as number[]
      const h = Math.abs(Number(item.height) || tr[3]!) || Math.abs(tr[0]!) || 10
      frags.push({ s: item.str, x: tr[4]!, y: tr[5]!, w: Number(item.width) || 0, h })
    }
    const paragraphs = buildParagraphs(buildLines(frags))
    pages.push({ paragraphs, noText: paragraphs.length === 0 })
    page.cleanup?.()
  }
  return { name, pageSize, pages }
}
