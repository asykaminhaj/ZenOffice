import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { createRoot } from 'react-dom/client'
import type { NoteInfo } from '@genoffice/docx-engine'
import { noteMarkText } from '../note-format'
import {
  IconCaret,
  IconCopy,
  IconCut,
  IconFontColorA,
  IconGrowFont,
  IconPaste,
  IconPasteText,
  IconSearch,
  IconShrinkFont,
} from './icons'
import { readClipboardPayload, zenNative } from '../editor/paste-actions'

const NOTE_FONTS = ['Arial', 'Times New Roman', 'Calibri', 'Cambria', 'Book Antiqua', 'Constantia', 'Verdana', 'Georgia', 'Courier New', 'Amiri', 'Carlito', 'Google Sans']
const NOTE_SIZES = [8, 9, 10, 10.5, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72]

type NoteMenuState = { x: number; y: number; top: number | null; hasSel: boolean }

const WORD_CHAR = /[\p{L}\p{N}_'’]/u

function wordBounds(text: string, at: number): [number, number] | null {
  let i = at
  if (!WORD_CHAR.test(text.charAt(i)) && WORD_CHAR.test(text.charAt(i - 1))) i -= 1
  if (!WORD_CHAR.test(text.charAt(i))) return null
  let a = i
  let b = i
  while (a > 0 && WORD_CHAR.test(text.charAt(a - 1))) a -= 1
  while (b < text.length && WORD_CHAR.test(text.charAt(b))) b += 1
  return [a, b]
}

function hitCaret(x: number, y: number): { node: Node; offset: number } | null {
  const d = document as unknown as {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  if (d.caretPositionFromPoint) {
    const p = d.caretPositionFromPoint(x, y)
    return p ? { node: p.offsetNode, offset: p.offset } : null
  }
  if (d.caretRangeFromPoint) {
    const r = d.caretRangeFromPoint(x, y)
    return r ? { node: r.startContainer, offset: r.startOffset } : null
  }
  return null
}

function offsetInEl(el: HTMLElement | null, x: number, y: number): number | null {
  const h = hitCaret(x, y)
  if (!el || !h || !el.contains(h.node)) return null
  const r = document.createRange()
  r.setStart(el, 0)
  r.setEnd(h.node, h.offset)
  return r.toString().length
}

type NoteFmtApi = {
  active: () => boolean
  apply: (p: (cur: Record<string, unknown>) => Record<string, unknown>) => boolean
  state?: () => Record<string, unknown>
  sizePt?: () => number
}
function noteFmtApi(): NoteFmtApi | null {
  const a = (window as unknown as { __zenNoteEdit?: NoteFmtApi }).__zenNoteEdit
  return a && a.active() ? a : null
}

/** Same look as the main-page context menu (ctx-menu / ctx-word classes); acts on the footnote's own selection. */
function NoteMenu({
  menu,
  getEl,
  onClose,
}: {
  menu: NoteMenuState
  getEl: () => HTMLElement | null
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: menu.x, top: menu.y })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const left = Math.min(Math.max(8, menu.x), window.innerWidth - r.width - 8)
    let top = menu.y
    if (top + r.height > window.innerHeight - 8) {
      top = menu.top !== null ? menu.top - r.height - 8 : menu.y - r.height
    }
    setPos({ left, top: Math.max(8, top) })
  }, [menu])
  useEffect(() => {
    const down = (e: Event) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('keydown', key, true)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const selText = () => window.getSelection()?.toString() ?? ''
  const copy = () => {
    const t = selText()
    if (!t) return
    if (!document.execCommand('copy')) void navigator.clipboard?.writeText(t)
  }
  const cut = () => {
    const t = selText()
    if (!t) return
    if (!document.execCommand('cut')) {
      void navigator.clipboard?.writeText(t)
      document.execCommand('delete')
    }
  }
  const paste = async () => {
    const sl0 = window.getSelection()
    const saved =
      sl0 && sl0.rangeCount > 0 && getEl()?.contains(sl0.anchorNode) ? sl0.getRangeAt(0).cloneRange() : null
    let t = ''
    try {
      const pl = await readClipboardPayload()
      t = pl.text
      if (!t && pl.html) t = new DOMParser().parseFromString(pl.html, 'text/html').body.textContent ?? ''
    } catch {
      t = ''
    }
    if (!t) return
    const el = getEl()
    if (!el) return
    el.focus({ preventScroll: true })
    if (saved) {
      const sl = window.getSelection()
      sl?.removeAllRanges()
      sl?.addRange(saved)
    }
    document.execCommand('insertText', false, t.replace(/\r\n?/g, '\n'))
  }
  const selectAll = () => {
    const el = getEl()
    if (!el) return
    el.focus()
    const r = document.createRange()
    r.selectNodeContents(el)
    const s = window.getSelection()
    s?.removeAllRanges()
    s?.addRange(r)
  }
  const run = (fn: () => void | Promise<void>) => () => {
    onClose()
    void Promise.resolve(fn()).finally(() => getEl()?.focus())
  }
  const stopAll = (e: { stopPropagation: () => void }) => e.stopPropagation()
  const [miniOpen, setMiniOpen] = useState<'font' | 'size' | null>(null)
  const fmt = noteFmtApi()
  const st = (fmt?.state?.() ?? {}) as Record<string, unknown>
  const curFont = typeof st.fontAscii === 'string' ? st.fontAscii : ''
  const curSize = fmt?.sizePt?.() ?? 0
  const patch = (p: Record<string, unknown>) => {
    fmt?.apply(() => p)
    onClose()
  }
  const toggle = (key: string) => {
    fmt?.apply((c) => ({ [key]: !c[key] }))
    onClose()
  }
  const step = (dir: 1 | -1) => {
    const cur = fmt?.sizePt?.() ?? 12
    const next = dir > 0 ? NOTE_SIZES.find((x) => x > cur) : [...NOTE_SIZES].reverse().find((x) => x < cur)
    if (next) patch({ sizeHalfPoints: Math.round(next * 2) })
    else onClose()
  }
  const recent = (window as unknown as { __genofficeFonts?: { recent?: () => string[] } }).__genofficeFonts?.recent?.() ?? []
  const fontList = [...new Set([...recent, ...NOTE_FONTS])]
  const item = (label: string, icon: React.ReactNode, key: string | null, onClick: () => void, disabled = false) => (
    <button className="ctx-item" disabled={disabled} onClick={onClick}>
      <span className="ctx-icon">{icon}</span>
      <span className="ctx-label">{label}</span>
      {key && <span className="ctx-key">{key}</span>}
    </button>
  )

  return (
    <div
      ref={ref}
      className="ctx-menu ctx-word"
      data-zen-note-menu="1"
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 100000 }}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onClick={stopAll}
      onPointerDown={stopAll}
      onTouchStart={stopAll}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      {fmt && (
        <div className={`ctx-mini ${pos.top >= 84 ? 'ctx-mini-above' : 'ctx-mini-below'}`}>
          <div className="ctx-mini-row">
            <button className="ctx-mini-box ctx-mini-font" onClick={() => setMiniOpen(miniOpen === 'font' ? null : 'font')}>
              <span>{curFont || 'Font'}</span>
              <IconCaret />
            </button>
            <button className="ctx-mini-box ctx-mini-size" onClick={() => setMiniOpen(miniOpen === 'size' ? null : 'size')}>
              <span>{curSize || '–'}</span>
            </button>
            <button className="ctx-mini-btn" title="Increase font size" onClick={() => step(1)}>
              <IconGrowFont />
            </button>
            <button className="ctx-mini-btn" title="Decrease font size" onClick={() => step(-1)}>
              <IconShrinkFont />
            </button>
          </div>
          {miniOpen && (
            <div className="ctx-mini-collapse">
              <div className="ctx-mini-list" role="listbox">
                {miniOpen === 'font' &&
                  fontList.map((f) => (
                    <button key={f} role="option" aria-selected={f === curFont} className={f === curFont ? 'active' : ''} style={{ fontFamily: f }} onClick={() => patch({ fontAscii: f })}>
                      {f}
                    </button>
                  ))}
                {miniOpen === 'size' &&
                  NOTE_SIZES.map((z) => (
                    <button key={z} role="option" aria-selected={z === curSize} className={z === curSize ? 'active' : ''} onClick={() => patch({ sizeHalfPoints: Math.round(z * 2) })}>
                      {z}
                    </button>
                  ))}
              </div>
            </div>
          )}
          <div className="ctx-mini-row">
            {([['bold', <b key="b">B</b>], ['italic', <i key="i">I</i>], ['underline', <u key="u">U</u>]] as const).map(([k, lab]) => (
              <button key={k} className={`ctx-mini-btn${st[k] ? ' active' : ''}`} disabled={!menu.hasSel} onClick={() => toggle(k)}>
                {lab}
              </button>
            ))}
            <button className={`ctx-mini-btn${st.strike ? ' active' : ''}`} disabled={!menu.hasSel} onClick={() => toggle('strike')}>
              <s>ab</s>
            </button>
            <button className="ctx-mini-btn" title="Font color" disabled={!menu.hasSel} onClick={() => patch({ color: st.color === 'FF0000' ? 'auto' : 'FF0000' })}>
              <IconFontColorA />
            </button>
          </div>
        </div>
      )}
      {item('Cut', <IconCut />, 'Ctrl+X', run(cut), !menu.hasSel)}
      {item('Copy', <IconCopy />, 'Ctrl+C', run(copy), !menu.hasSel)}
      <div className="ctx-paste-head">
        <span className="ctx-icon">
          <IconPaste />
        </span>
        <span className="ctx-label">Paste Options:</span>
        <span className="ctx-key">Ctrl+V</span>
      </div>
      <div className="ctx-paste-row">
        <button className="ctx-paste-btn" title="Paste" onClick={run(paste)}>
          <IconPaste />
        </button>
        <button className="ctx-paste-btn" title="Paste as text" onClick={run(paste)}>
          <IconPasteText />
        </button>
      </div>
      <div className="ctx-sep" />
      {item('Search', <IconSearch />, null, run(() => void zenNative()?.call('webSearch', { text: selText() })), !menu.hasSel)}
      <div className="ctx-sep" />
      {item('Select all', null, null, run(selectAll))}
    </div>
  )
}

/** One note row: tap the text to edit it in place (Word-style); saved on blur / Ctrl+Enter, Esc cancels. */
function NoteRow({
  marker,
  note,
  onCommit,
  kind,
}: {
  marker: string
  note: NoteInfo
  onCommit: (id: string, text: string) => void
  kind?: 'footnote' | 'endnote'
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const doneRef = useRef(false)
  const caretRef = useRef<number | null>(null)
  const wordRef = useRef<[number, number] | null>(null)
  const lastTapRef = useRef<{ x: number; y: number; t: number } | null>(null)
  const [menu, setMenu] = useState<NoteMenuState | null>(null)
  const [editing, setEditing] = useState(false)

  // Android: App opens a just-inserted note for typing through this registry
  useEffect(() => {
    const w = (window as unknown as { __zenNoteOpeners?: Map<string, () => boolean> })
    const reg = (w.__zenNoteOpeners ??= new Map())
    const key = `${kind ?? 'footnote'}:${note.id}`
    const open = () => {
      setEditing(true)
      return true
    }
    reg.set(key, open)
    return () => {
      if (reg.get(key) === open) reg.delete(key)
    }
  }, [kind, note.id])

  useEffect(() => {
    if (!editing) return
    const el = ref.current
    if (!el) return
    doneRef.current = false
    el.textContent = note.text
    el.focus()
    const sel = window.getSelection()
    const range = document.createRange()
    let wordSel = false
    const tn = el.firstChild
    const off = caretRef.current
    caretRef.current = null
    const w = wordRef.current
    wordRef.current = null
    if (tn && w) {
      const n = tn.textContent?.length ?? 0
      range.setStart(tn, Math.min(w[0], n))
      range.setEnd(tn, Math.min(w[1], n))
      wordSel = true
    } else if (tn && off !== null) range.setStart(tn, Math.min(off, tn.textContent?.length ?? 0))
    else range.selectNodeContents(el)
    if (!wordSel) range.collapse(false)
    sel?.removeAllRanges()
    sel?.addRange(range)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing])

  const finish = (commit: boolean) => {
    if (doneRef.current) return
    doneRef.current = true
    const text = (ref.current?.innerText ?? '').replace(/\u00a0/g, ' ').replace(/\n+$/, '')
    setEditing(false)
    {
      // a note inserted a moment ago and left empty (or cancelled) is not kept
      const fresh = (window as unknown as { __zenFreshNotes?: Set<string> }).__zenFreshNotes
      const fk = `${kind ?? 'footnote'}:${note.id}`
      if (fresh?.has(fk)) {
        fresh.delete(fk)
        if (!commit || text.trim() === '') {
          onCommit(note.id, '')
          return
        }
      }
    }
    if (commit && text !== note.text) onCommit(note.id, text)
  }

  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

  const showHandles = () =>
    (window as unknown as { __zenShowSelHandles?: () => void }).__zenShowSelHandles?.()

  const openMenuAt = (x: number, y: number, touch: boolean) => {
    const sel = window.getSelection()
    const hasSel = !!sel && !sel.isCollapsed
    let mx = x
    let my = y
    let top: number | null = null
    if (touch && sel && sel.rangeCount > 0 && hasSel) {
      const r = sel.getRangeAt(0).getBoundingClientRect()
      if (r.width > 0 || r.height > 0) {
        mx = r.left
        my = r.bottom + 8
        top = r.top
      }
    }
    setMenu({ x: mx, y: my, top, hasSel })
  }

  const selectWordAt = (x: number, y: number, touch: boolean) => {
    const el = ref.current
    const hit = hitCaret(x, y)
    const b =
      hit && el && el.contains(hit.node) && hit.node.nodeType === 3
        ? wordBounds(hit.node.textContent ?? '', hit.offset)
        : null
    if (!hit || !b) {
      if (!editing) setEditing(true)
      setTimeout(() => openMenuAt(x, y, touch), 80)
      return
    }
    if (editing) {
      const r = document.createRange()
      r.setStart(hit.node, b[0])
      r.setEnd(hit.node, b[1])
      const s = window.getSelection()
      s?.removeAllRanges()
      s?.addRange(r)
      showHandles()
      openMenuAt(x, y, touch)
    } else {
      wordRef.current = b
      setEditing(true)
      setTimeout(() => {
        showHandles()
        openMenuAt(x, y, touch)
      }, 80)
    }
  }
  return (
    <div className="page-note">
      {!note.noRefMark && <sup>{marker}</sup>}
      <span
        key={editing ? 'edit' : 'view'}
        ref={ref}
        className={`page-note-text${editing ? ' page-note-editing' : ''}`}
        contentEditable={editing ? (('plaintext-only' as unknown) as true) : undefined}
        suppressContentEditableWarning
        spellCheck={false}
        data-caret-from-tap={editing ? '1' : undefined}
        onClickCapture={(e) => {
          if ((e.nativeEvent as PointerEvent).pointerType !== 'touch') return
          const now = Date.now()
          const prev = lastTapRef.current
          lastTapRef.current = { x: e.clientX, y: e.clientY, t: now }
          if (!prev || now - prev.t > 320 || Math.hypot(e.clientX - prev.x, e.clientY - prev.y) > 28) return
          lastTapRef.current = null
          e.stopPropagation()
          selectWordAt(e.clientX, e.clientY, true)
        }}
        onContextMenu={(e) => {
          e.stopPropagation()
          const x = e.clientX
          const y = e.clientY
          const touch = (e.nativeEvent as PointerEvent).pointerType === 'touch'
          if (!touch) {
            e.preventDefault()
            if (editing) openMenuAt(x, y, false)
            else {
              caretRef.current = offsetInEl(ref.current, x, y)
              setEditing(true)
              setTimeout(() => openMenuAt(x, y, false), 80)
            }
          } else if (editing) {
            setTimeout(() => {
              const sel = window.getSelection()
              if (sel && !sel.isCollapsed && ref.current?.contains(sel.anchorNode)) openMenuAt(x, y, true)
              else selectWordAt(x, y, true)
            }, 80)
          } else selectWordAt(x, y, true)
        }}
        onMouseDown={stop}
        onTouchStart={stop}
        onPointerDown={stop}
        onClick={(e) => {
          e.stopPropagation()
          if (!editing) {
            const el = ref.current
            const d = document as unknown as {
              caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
              caretRangeFromPoint?: (x: number, y: number) => Range | null
            }
            let node: Node | null = null
            let o = 0
            if (d.caretPositionFromPoint) {
              const cp = d.caretPositionFromPoint(e.clientX, e.clientY)
              if (cp) { node = cp.offsetNode; o = cp.offset }
            } else if (d.caretRangeFromPoint) {
              const cr = d.caretRangeFromPoint(e.clientX, e.clientY)
              if (cr) { node = cr.startContainer; o = cr.startOffset }
            }
            if (el && node && el.contains(node)) {
              const r = document.createRange()
              r.setStart(el, 0)
              r.setEnd(node, o)
              caretRef.current = r.toString().length
            } else caretRef.current = null
            setEditing(true)
          }
        }}
        onKeyDown={(e) => {
          if (!editing) return
          e.stopPropagation()
          if (e.key === 'Escape') {
            e.preventDefault()
            finish(false)
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            finish(true)
          }
        }}
        onBlur={() => editing && finish(true)}
      >
        {editing ? null : note.text}
        {menu &&
          createPortal(
            <NoteMenu menu={menu} getEl={() => ref.current} onClose={() => setMenu(null)} />,
            document.body,
          )}
      </span>
    </div>
  )
}

type NoteListProps = {
  notes: NoteInfo[]
  numberOf?: (note: NoteInfo, index: number) => number
  /** inline edit committed; empty text means delete */
  onCommit: (id: string, text: string) => void
  /** kept for the caller's API; the buttons are gone (Word-style: edit by clicking, delete via the mark) */
  onEdit?: (id: string) => void
  onDelete?: (id: string) => void
}

/** Android: the end lists follow the numbers in the body, not the order the notes were created in */
function orderNotes(
  notes: NoteInfo[],
  numberOf?: (note: NoteInfo, index: number) => number,
): NoteInfo[] {
  if ((window as unknown as { __genofficeAndroidShim?: boolean }).__genofficeAndroidShim !== true || !numberOf) return notes
  const idx = new Map(notes.map((n, i) => [n.id, i] as const))
  return [...notes].sort((a, b) => numberOf(a, idx.get(a.id) ?? 0) - numberOf(b, idx.get(b.id) ?? 0))
}

/** End-of-document footnote list; entries already shown in canvas page gaps are skipped (numbering keeps full-list order) */
export function PageFootnotes({
  notes,
  skipIds,
  numberOf,
  onCommit,
}: NoteListProps & { skipIds: ReadonlySet<string> }) {
  const shown = orderNotes(notes, numberOf).filter((n) => !skipIds.has(n.id))
  if (shown.length === 0) return null
  return (
    <div className="page-notes">
      {shown.map((n) => (
        <NoteRow
          key={`f${n.id}`}
          kind="footnote"
          marker={noteMarkText('footnote', numberOf?.(n, notes.indexOf(n)) ?? notes.indexOf(n) + 1)}
          note={n}
          onCommit={onCommit}
        />
      ))}
    </div>
  )
}

/**
 * Endnote area (lowerRoman unless w:endnotePr says otherwise), never mixed into the footnote block. Word shows
 * no heading and places it right after the last body line, so when the measured
 * flow-end anchor is available the area is absolutely positioned there instead
 * of stacking after the (page-tall) editor.
 */
export function PageEndnotes({
  notes,
  top,
  numberOf,
  onCommit,
}: NoteListProps & {
  /** flow-end anchor (layout px from the page-wrap top); null = not measured yet */
  top: number | null
}) {
  if (notes.length === 0) return null
  return (
    <div
      className={`page-notes page-endnotes${top != null ? ' page-endnotes-anchored' : ''}`}
      style={top != null ? { top } : undefined}
    >
      {orderNotes(notes, numberOf).map((n) => (
        <NoteRow
          key={`e${n.id}`}
          kind="endnote"
          marker={noteMarkText('endnote', numberOf?.(n, notes.indexOf(n)) ?? notes.indexOf(n) + 1)}
          note={n}
          onCommit={onCommit}
        />
      ))}
    </div>
  )
}


/** Char offset (excluding the leading <sup> marker) of the point (x, y) inside a rendered note row. */
export function noteOffsetAt(row: HTMLElement, x: number, y: number): number | null {
  const h = hitCaret(x, y)
  if (!h || !row.contains(h.node)) return null
  const sup = row.querySelector('sup')
  if (sup && sup.contains(h.node)) return 0
  const r = document.createRange()
  if (sup) r.setStartAfter(sup)
  else r.setStart(row, 0)
  r.setEnd(h.node, h.offset)
  return r.toString().length
}

/** [start, end) char offsets of the word under (x, y), in the same coordinate as noteOffsetAt. */
export function noteWordAt(row: HTMLElement, x: number, y: number): [number, number] | null {
  const h = hitCaret(x, y)
  if (!h || h.node.nodeType !== 3 || !row.contains(h.node)) return null
  const sup = row.querySelector('sup')
  if (sup && sup.contains(h.node)) return null
  const b = wordBounds(h.node.textContent ?? '', h.offset)
  if (!b) return null
  const r = document.createRange()
  if (sup) r.setStartAfter(sup)
  else r.setStart(row, 0)
  r.setEnd(h.node, 0)
  const base = r.toString().length
  return [base + b[0], base + b[1]]
}

let activeNoteMenuClose: (() => void) | null = null

/** Imperative entry point for the page-gap footnote editor (App.tsx): same menu as NoteMenu. */
export function openNoteMenu(x: number, y: number, touch: boolean, getEl: () => HTMLElement | null): void {
  activeNoteMenuClose?.()
  const sel = window.getSelection()
  const hasSel = !!sel && !sel.isCollapsed
  let mx = x
  let my = y
  let top: number | null = null
  if (touch && sel && sel.rangeCount > 0 && hasSel) {
    const r = sel.getRangeAt(0).getBoundingClientRect()
    if (r.width > 0 || r.height > 0) {
      mx = r.left
      my = r.bottom + 8
      top = r.top
    }
  }
  const host = document.createElement('div')
  host.setAttribute('data-zen-gapnote-host', '1')
  document.body.appendChild(host)
  const root = createRoot(host)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    if (activeNoteMenuClose === close) activeNoteMenuClose = null
    setTimeout(() => {
      root.unmount()
      host.remove()
    }, 0)
  }
  activeNoteMenuClose = close
  root.render(<NoteMenu menu={{ x: mx, y: my, top, hasSel }} getEl={getEl} onClose={close} />)
}
