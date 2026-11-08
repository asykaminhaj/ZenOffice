import { decodeEntities } from './parse-xml-text'
import { patchParagraphTexts } from './text-patch'
import type { NoteInfo, NoteRun } from './types'
import { escapeXmlAttr, escapeXmlText } from './xml-utils'

/**
 * Footnotes / endnotes part handling (word/footnotes.xml, word/endnotes.xml).
 *
 * Both parts share one schema: a list of w:footnote / w:endnote elements.
 * Entries carrying a w:type attribute (separator, continuationSeparator, ...)
 * are structural and must be preserved; only typeless entries are real notes.
 */

export type NoteKind = 'footnote' | 'endnote'

const ROOT: Record<NoteKind, string> = { footnote: 'w:footnotes', endnote: 'w:endnotes' }
const ENTRY: Record<NoteKind, string> = { footnote: 'w:footnote', endnote: 'w:endnote' }

export const NOTE_PART_PATH: Record<NoteKind, string> = {
  footnote: 'word/footnotes.xml',
  endnote: 'word/endnotes.xml',
}

export const NOTE_REL_TYPE: Record<NoteKind, string> = {
  footnote: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes',
  endnote: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes',
}

export const NOTE_CONTENT_TYPE: Record<NoteKind, string> = {
  footnote: 'application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml',
  endnote: 'application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml',
}

const NOTE_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

/**
 * Root attributes for a regenerated part. Entries are spliced back in as original bytes, so
 * the root has to keep declaring whatever prefixes those bytes use: Word puts w14:paraId on
 * every paragraph it writes, and a literal namespace list leaves that prefix unbound.
 *
 * `required` lists namespaces the rebuild itself emits (e.g. w14 on rebuilt comments): they
 * are appended when the reused original root does not declare them, since an original from
 * a non-Word producer may bind fewer prefixes than our generated markup uses.
 */
export function rootAttributes(
  originalXml: string | null,
  rootTag: string,
  fallback: string,
  required: Record<string, string> = {},
): string {
  const attrs = originalXml
    ? new RegExp(`<${rootTag}\\b([^>]*?)/?>`).exec(originalXml)?.[1]?.trim()
    : undefined
  const base = attrs && attrs.includes('xmlns:') ? attrs : fallback
  const missing = Object.entries(required)
    .filter(([prefix]) => !base.includes(`xmlns:${prefix}=`))
    .map(([prefix, uri]) => ` xmlns:${prefix}="${uri}"`)
    .join('')
  return base + missing
}

/**
 * The note's self-reference mark run (`<w:footnoteRef/>` / `<w:endnoteRef/>`).
 * Tolerates the spaced self-closing form (`<w:footnoteRef />`, .NET XmlWriter /
 * Open XML SDK output) and the open/close pair; the exact `<w:footnoteRef/>`
 * match hid every note number in such documents.
 */
const NOTE_REF_MARK_RE = /<w:(?:footnote|endnote)Ref\b\s*\/?>/

/** one note paragraph read through the document's run extraction and property resolver */
export interface NoteParagraph {
  /** display runs, the self-reference mark run excluded */
  runs: NoteRun[]
  /** w:pStyle of the paragraph */
  styleId?: string
  /** before / after / line resolved through the style chain and docDefaults */
  spacing: NonNullable<NoteInfo['spacing']>
}

/** supplied by the document parser; without it notes carry plain text only */
export type NoteParagraphReader = (pXml: string) => NoteParagraph

type NoteParaProps = NonNullable<NoteInfo['paraProps']>[number]

/** direct (not style-inherited) alignment / indent of one <w:p> slice, raw twips */
function directParaProps(pXml: string): NoteParaProps {
  const out: NoteParaProps = {}
  const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(pXml)?.[1]
  if (!pPr) return out
  const jc = /<w:jc\s+w:val="([A-Za-z]+)"/.exec(pPr)?.[1]
  if (jc) out.jc = jc
  const sp = /<w:spacing\s([^>]*?)\/?>/.exec(pPr)?.[1]
  if (sp) {
    const n = (a: string): number | undefined => {
      const m = new RegExp(`w:${a}="(-?\\d+)"`).exec(sp)
      return m ? Number(m[1]) : undefined
    }
    const rule = /w:lineRule="([A-Za-z]+)"/.exec(sp)?.[1]
    const line = n('line')
    const before = n('before')
    const after = n('after')
    if (line !== undefined && (!rule || rule === 'auto')) {
      const mult = Math.round((line / 240) * 100) / 100
      if (mult !== 1) out.lineSpacing = mult
    }
    if (before) out.spaceBefore = before
    if (after) out.spaceAfter = after
  }
  const ind = /<w:ind\s([^>]*?)\/?>/.exec(pPr)?.[1]
  if (ind) {
    const num = (n: string): number | undefined => {
      const m = new RegExp(`w:${n}="(-?\\d+)"`).exec(ind)
      return m ? Number(m[1]) : undefined
    }
    const left = num('left') ?? num('start')
    const right = num('right') ?? num('end')
    const firstLine = num('firstLine')
    const hanging = num('hanging')
    if (left !== undefined) out.left = left
    if (right !== undefined) out.right = right
    if (firstLine !== undefined) out.firstLine = firstLine
    if (hanging !== undefined) out.hanging = hanging
  }
  return out
}

/** real notes (separator entries excluded), in file order */
export function parseNotesXml(xml: string, kind: NoteKind, read?: NoteParagraphReader): NoteInfo[] {
  return noteEntriesOf(xml, kind).map(({ id, text, xml: entryXml }) => {
    const paras = read ? noteParagraphsOf(entryXml).map(read) : []
    const first = paras[0]
    const richParas = paras.map((p) => p.runs)
    // the first paragraph opens with the self-reference mark and a spacer; a
    // spacer that was its own run empties out and is dropped entirely
    if (richParas[0]?.[0]) {
      richParas[0][0] = { ...richParas[0][0], text: richParas[0][0].text.replace(/^\s+/, '') }
      if (richParas[0][0].text === '') richParas[0].shift()
    }
    const paraProps = first ? noteParagraphsOf(entryXml).map(directParaProps) : []
    const styleId = first ? first.styleId : /<w:pStyle w:val="([^"]+)"/.exec(entryXml)?.[1]
    // Word draws the entry number only where a self-reference mark run exists
    // (empty-body notes keep their line but show no numeral — Word probe 2026-09-01)
    const noRefMark = !NOTE_REF_MARK_RE.test(entryXml)
    return {
      id,
      text,
      ...(first ? { richParas } : {}),
      ...(paraProps.some((pp) => Object.keys(pp).length > 0) ? { paraProps } : {}),
      ...(styleId ? { styleId } : {}),
      ...(/ADDIN\s+(?:ZOTERO_|CSL_)/.test(entryXml) ? { zoteroField: true as const } : {}),
      ...(first ? { spacing: first.spacing } : {}),
      ...(noRefMark ? { noRefMark: true as const } : {}),
    }
  })
}

/** the entry's paragraph slices in order (self-closing form first: the
 *  open-to-close alternative would swallow it) */
function noteParagraphsOf(entryXml: string): string[] {
  return entryXml.match(/<w:p(?:\s[^>]*)?\/>|<w:p[\s>][\s\S]*?<\/w:p>/g) ?? []
}

/** typeless (real) note entries with their exact XML slice + plain text */
function noteEntriesOf(
  xml: string,
  kind: NoteKind,
): Array<{ id: string; text: string; xml: string }> {
  const out: Array<{ id: string; text: string; xml: string }> = []
  const entry = ENTRY[kind]
  // the attribute run must not end in "/" so a self-closing empty entry
  // ("<w:footnote w:id="1"/>") is not read as an open tag over the next entry
  const re = new RegExp(`<${entry}(\\s[^>]*[^/>])?>([\\s\\S]*?)</${entry}>`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] ?? ''
    if (/w:type=(?:"[^"]*"|'[^']*')/.test(attrs)) continue // separator / continuation entries
    const id = /w:id=(?:"([^"]+)"|'([^']+)')/.exec(attrs)?.slice(1, 3).find(Boolean)
    if (!id) continue
    const paras: string[] = []
    // the self-closing form first: the open-to-close alternative would swallow it
    const pRe = /<w:p(?:\s[^>]*)?\/>|<w:p[\s>][\s\S]*?<\/w:p>/g
    let p: RegExpExecArray | null
    while ((p = pRe.exec(m[2])) !== null) paras.push(notePlainText(p[0]))
    // the first paragraph starts with the self-reference mark + a spacer
    if (paras.length > 0) paras[0] = paras[0].replace(/^\s+/, '')
    out.push({ id, text: paras.join('\n'), xml: m[0] })
  }
  return out
}

function notePlainText(xml: string): string {
  const texts: string[] = []
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) texts.push(m[1])
  return decodeEntities(texts.join(''))
}

/** default separator entries required by Word when the part is created fresh */
function separatorEntries(kind: NoteKind): string {
  const entry = ENTRY[kind]
  return (
    `<${entry} w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></${entry}>` +
    `<${entry} w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></${entry}>`
  )
}

/** one rich display run → run XML (size/font/bold…; save-side of NoteRun) */
function noteRunXml(run: NoteRun): string {
  const props: string[] = []
  const fonts: string[] = []
  if (run.fontAscii) {
    fonts.push(
      `w:ascii="${escapeXmlAttr(run.fontAscii)}" w:hAnsi="${escapeXmlAttr(run.fontAscii)}"`,
    )
  }
  if (run.font) fonts.push(`w:eastAsia="${escapeXmlAttr(run.font)}"`)
  if (fonts.length > 0) props.push(`<w:rFonts ${fonts.join(' ')}/>`)
  if (run.bold) props.push('<w:b/>')
  if (run.italic) props.push('<w:i/>')
  if (run.underline) props.push('<w:u w:val="single"/>')
  if (run.strike) props.push('<w:strike/>')
  if (run.color) props.push(`<w:color w:val="${escapeXmlAttr(run.color)}"/>`)
  if (run.sizeHalfPoints) {
    props.push(`<w:sz w:val="${run.sizeHalfPoints}"/><w:szCs w:val="${run.sizeHalfPoints}"/>`)
  }
  const rPr = props.length > 0 ? `<w:rPr>${props.join('')}</w:rPr>` : ''
  const body = run.text
    .split('\t')
    .map((t) => `<w:t xml:space="preserve">${escapeXmlText(t)}</w:t>`)
    .join('<w:tab/>')
  return `<w:r>${rPr}${body}</w:r>`
}

function noteEntryXml(kind: NoteKind, note: NoteInfo): string {
  const entry = ENTRY[kind]
  const refTag = kind === 'footnote' ? 'w:footnoteRef' : 'w:endnoteRef'
  if (note.richParas?.length) {
    // rich rebuild (P17): runs keep their measured size/font, the reference
    // mark + spacer shrink to the first run's size, and the paragraph pins
    // single spacing — a note rendered from measured source content must not
    // inflate past its source area via template docDefaults (after=120,
    // line=276) or a body-sized marker run
    const paras = note.richParas.map((runs, i) => {
      const sz = runs[0]?.sizeHalfPoints
      const szXml = sz ? `<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>` : ''
      const refRun =
        i === 0
          ? `<w:r><w:rPr><w:vertAlign w:val="superscript"/>${szXml}</w:rPr><${refTag}/></w:r>` +
            `<w:r>${sz ? `<w:rPr>${szXml}</w:rPr>` : ''}<w:t xml:space="preserve"> </w:t></w:r>`
          : ''
      const pp = note.paraProps?.[i]
      const indParts: string[] = []
      for (const k of ['left', 'right', 'firstLine', 'hanging'] as const) {
        const v = pp?.[k]
        if (typeof v === 'number' && Number.isFinite(v)) indParts.push(`w:${k}="${Math.round(v)}"`)
      }
      const indXml = indParts.length > 0 ? `<w:ind ${indParts.join(' ')}/>` : ''
      const jcXml = pp?.jc && /^[A-Za-z]+$/.test(pp.jc) ? `<w:jc w:val="${pp.jc}"/>` : ''
      const pPr = `<w:pPr>${spacingXml({ spaceAfter: 0, lineSpacing: 1, ...pp }, '')}${indXml}${jcXml}</w:pPr>`
      return `<w:p>${pPr}${refRun}${runs.map(noteRunXml).join('')}</w:p>`
    })
    return `<${entry} w:id="${escapeXmlAttr(note.id)}">${paras.join('')}</${entry}>`
  }
  const paras = note.text.split('\n').map((line, i) => {
    // OOXML convention: the note body starts with the self-reference mark
    const refRun =
      i === 0
        ? `<w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><${refTag}/></w:r>` +
          '<w:r><w:t xml:space="preserve"> </w:t></w:r>'
        : ''
    const textRun =
      line === '' ? '' : `<w:r><w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r>`
    return `<w:p>${refRun}${textRun}</w:p>`
  })
  return `<${entry} w:id="${escapeXmlAttr(note.id)}">${paras.join('')}</${entry}>`
}

const paraKey = (q: NoteParaProps): string =>
  JSON.stringify([
    q.jc ?? null,
    q.left ?? null,
    q.right ?? null,
    q.firstLine ?? null,
    q.hanging ?? null,
    q.lineSpacing ?? null,
    q.spaceBefore ?? null,
    q.spaceAfter ?? null,
  ])

/** <w:spacing> from wanted props; anything `want` leaves unset (incl. exact/atLeast line rules) is kept from the old element's attrs */
function spacingXml(want: NoteParaProps, old: string): string {
  const num = (a: string): number | undefined => {
    const m = new RegExp(`w:${a}="(-?\\d+)"`).exec(old)
    return m ? Number(m[1]) : undefined
  }
  const before = want.spaceBefore ?? num('before')
  const after = want.spaceAfter ?? num('after')
  const parts: string[] = []
  if (before !== undefined) parts.push(`w:before="${Math.round(before)}"`)
  if (after !== undefined) parts.push(`w:after="${Math.round(after)}"`)
  if (want.lineSpacing !== undefined) {
    parts.push(`w:line="${Math.round(want.lineSpacing * 240)}"`, 'w:lineRule="auto"')
  } else {
    const line = num('line')
    const rule = /w:lineRule="([A-Za-z]+)"/.exec(old)?.[1]
    if (line !== undefined) parts.push(`w:line="${line}"`)
    if (rule) parts.push(`w:lineRule="${rule}"`)
  }
  return parts.length > 0 ? `<w:spacing ${parts.join(' ')}/>` : ''
}

/** one <w:p> slice with its direct jc / ind replaced by `want` (schema order kept: before rPr / sectPr / pPrChange) */
function paraSliceWithProps(sl: string, want: NoteParaProps): string {
  if (paraKey(directParaProps(sl)) === paraKey(want)) return sl
  const indParts: string[] = []
  for (const k of ['left', 'right', 'firstLine', 'hanging'] as const) {
    const v = want[k]
    if (typeof v === 'number' && Number.isFinite(v)) indParts.push(`w:${k}="${Math.round(v)}"`)
  }
  const add =
    (indParts.length > 0 ? `<w:ind ${indParts.join(' ')}/>` : '') +
    (want.jc && /^[A-Za-z]+$/.test(want.jc) ? `<w:jc w:val="${want.jc}"/>` : '')
  const m = /<w:pPr(?:\s[^>]*)?>([\s\S]*?)<\/w:pPr>/.exec(sl)
  if (m) {
    const k0 = m[1].search(/<w:(?:rPr|sectPr|pPrChange)[\s>/]/)
    const post = k0 >= 0 ? m[1].slice(k0) : ''
    let pre = k0 >= 0 ? m[1].slice(0, k0) : m[1]
    const oldSp = /<w:spacing\s([^>]*?)\/?>/.exec(pre)?.[1] ?? ''
    pre = pre
      .replace(/<w:spacing\s[^>]*?\/>/g, '')
      .replace(/<w:ind\s[^>]*?\/>/g, '')
      .replace(/<w:jc\s[^>]*?\/>/g, '')
    const inner = pre + spacingXml(want, oldSp) + add + post
    const head = m[0].slice(0, m[0].length - m[1].length - '</w:pPr>'.length)
    return sl.slice(0, m.index) + head + inner + '</w:pPr>' + sl.slice(m.index + m[0].length)
  }
  const add0 = spacingXml(want, '') + add
  if (!add0) return sl
  if (sl.includes('<w:pPr/>')) return sl.replace('<w:pPr/>', () => `<w:pPr>${add0}</w:pPr>`)
  return sl.replace(/^<w:p(?:\s[^>]*)?>/, (open) => `${open}<w:pPr>${add0}</w:pPr>`)
}

/** write per-paragraph jc / ind into an original entry without touching anything else in it */
function withParaProps(entryXml: string, pps: NonNullable<NoteInfo['paraProps']>): string {
  const slices = noteParagraphsOf(entryXml)
  if (slices.length !== pps.length) return entryXml
  let out = ''
  let pos = 0
  slices.forEach((sl, i) => {
    const at = entryXml.indexOf(sl, pos)
    if (at < 0) return
    out += entryXml.slice(pos, at) + paraSliceWithProps(sl, pps[i] ?? {})
    pos = at + sl.length
  })
  return out + entryXml.slice(pos)
}

/**
 * Regenerate the notes part from the full desired list. Structural entries
 * (separator/continuation) from the original part are kept byte-identical;
 * when there is no original part, standard separators are created.
 * Surgical: existing entries whose text is unchanged keep their original bytes (inline
 * formatting, images, and hyperlinks are preserved); entries with changed text first try
 * an in-paragraph w:t-level patch (formatting still preserved), and only fall back to a
 * plain-text rebuild when patching fails (paragraph count changed, etc.).
 */
export function buildNotesXml(
  kind: NoteKind,
  notes: NoteInfo[],
  originalXml: string | null,
): string {
  const entry = ENTRY[kind]
  let structural = ''
  const originals = new Map<string, { text: string; xml: string }>()
  if (originalXml) {
    const re = new RegExp(
      `<${entry}\\s[^>]*w:type=(?:"[^"]*"|'[^']*')[^>]*>[\\s\\S]*?</${entry}>`,
      'g',
    )
    structural = (originalXml.match(re) ?? []).join('')
    for (const e of noteEntriesOf(originalXml, kind)) originals.set(e.id, e)
  }
  if (!structural) structural = separatorEntries(kind)
  const body = notes
    .map((n) => {
      const orig = originals.get(n.id)
      if (!orig) return noteEntryXml(kind, n)
      const base =
        orig.text === n.text
          ? orig.xml
          : patchParagraphTexts(orig.xml, n.text, { stripFirstParaLeadingSpace: true })
      if (base == null) return noteEntryXml(kind, n)
      return n.paraProps ? withParaProps(base, n.paraProps) : base
    })
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    `<${ROOT[kind]} ${rootAttributes(originalXml, ROOT[kind], NOTE_NS)}>${structural}${body}</${ROOT[kind]}>`
  )
}

/** next free numeric note id (separator ids -1/0 and existing notes considered) */
export function nextNoteId(notes: NoteInfo[]): string {
  let max = 0
  for (const note of notes) {
    const n = parseInt(note.id, 10)
    if (Number.isFinite(n)) max = Math.max(max, n)
  }
  return String(max + 1)
}
