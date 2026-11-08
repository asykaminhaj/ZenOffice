import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Editor } from '@tiptap/core'
import type { Command } from '@tiptap/pm/state'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import {
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  splitCell,
} from '@tiptap/pm/tables'
import { platformShortcuts } from '@genoffice/i18n'
import { redactTextBetween, type RedactableNode } from '../ai/redact-view'
import type { TextboxDisplay } from '@genoffice/docx-engine'

import { useI18n, type StringKey } from '../i18n/locale'
import { wordRangeAtCaret } from '../editor/comments'
import {
  bringForward,
  bringToFront,
  sendBackward,
  sendToBack,
  setFloatingWrap,
  shapeWrapOf,
} from '../editor/floating-z-order'
import { pasteFromClipboard, zenNative } from '../editor/paste-actions'
import type { RibbonExtraActions } from './Ribbon'
import { setTableAutoFit } from '../editor/table-properties'
import { distributeSelectedColumns } from '../editor/table-sizing'
import {
  distributeRowsEvenly,
  inTableOrSelected,
  selectTablePart,
  setCellAlignment,
  setCellTextDirection,
  splitTableAtSelection,
  type CellHAlign,
  type CellTextDirection,
  type CellVAlign,
  type TableSelectKind,
} from '../editor/table-ops'
import type { TableDialogKind } from './TableDialogs'
import {
  IconCaret,
  IconComment,
  IconCopy,
  IconGrowFont,
  IconCut,
  IconLink,
  IconPaste,
  IconPasteText,
  IconPilcrow,
  IconSearch,
  IconBullets,
  IconFontColorA,
  IconFormatPainter,
  IconHighlight,
  IconNumbered,
  IconShrinkFont,
  IconSparkle,
  IconStylesPane,
} from './icons'
import { spellcheckEnabled } from '../spellcheck-pref'
import { applySpellingSuggestion } from '../editor/spell-replace'
import { linkRangeAt, linkTarget, removeLink } from '../editor/link-actions'
import { fieldRangeAt, toggleFieldCodes, type FieldRange } from '../editor/field-codes'
import { hasRedactionIn } from '../editor/redaction'
import type { SpellLanguages } from '../../shared/ipc'
import { TRANSLATE_LANGS, appLangKey } from './translate-langs'

export { FontDialog } from './FontDialog'

/**
 * Editor context menu (right click in the document body):
 * Cut/Copy/Paste · Font… · Paragraph… · Synonyms · Translate · Hyperlink (insert or Edit/Open/Copy/Remove) · New Comment.
 */

export interface ContextMenuState {
  x: number
  y: number
  /** src of the picture under the pointer, when the click landed on one */
  imageSrc?: string | null
  /** claim sequence of the right-click this menu answers (pairs it with Chromium's data) */
  seq?: number
  /** document position under the click (the caret for a keyboard-invoked menu) */
  pos?: number | null
  /** Chromium's misspelling under the pointer, relayed by the main process after the menu opened */
  spell?: { word: string; suggestions: string[] } | null
  /** hyperlink under the pointer as rendered (a TOC line counts: Word treats its entries as links) */
  link?: { href: string; toc?: boolean; tocTitle?: string } | null
}

interface EditorContextMenuProps {
  editor: Editor
  menu: ContextMenuState
  onClose: () => void
  onFontDialog: () => void
  onParagraphDialog: () => void
  onLink: () => void
  onNewComment: () => void
  /** Android mini toolbar: A+/A- through the ribbon's coalescing font step */
  onFontStep?: (dir: 1 | -1) => void
  /** Android mini toolbar: ribbon closures (lists, painter, highlight, font color) */
  ribbon?: RibbonExtraActions
  /** Android mini toolbar: open the Styles pane */
  onStyles?: () => void
  onViewImage: (src: string) => void
  onSaveImageAs: (src: string) => void
  onAiPreset: (instruction: string) => void
  /** List items: restart numbering / continue numbering (shown when the cursor is on a docListItem) */
  onRestartNumbering?: () => void
  onContinueNumbering?: () => void
  onSetNumberingValue?: () => void
  onAdjustListIndents?: () => void
  onChangeListLevel?: (ilvl: number) => void
  /** F9 update fields (shown when the cursor is on an inline field) */
  onUpdateFields?: () => void
  /** Edit Field…: open the field-code dialog for that field */
  onEditField?: (field: FieldRange) => void
  /** Open Hyperlink: browser for http(s), in-document jump for #bookmark */
  onOpenLink?: (href: string) => void
  /** Ask for a label, then withhold the selection from the model */
  onRedact?: () => void
  /** Stop withholding a selection that already carries the mark, keeping the text */
  onUnredact?: () => void
  /** Word's table dialogs (Split Cells… / Insert Cells… / Delete Cells… / Table Properties…) */
  onTableDialog?: (kind: TableDialogKind) => void
  /** section content width the AutoFit / Distribute commands fit the grid into */
  sectionContentWidthPx?: number
  /** re-mark existing text after the session dictionary or languages changed */
  onRespell?: () => void
}

const MENU_WIDTH = 240

const CTX_CELL_ALIGN: Array<[CellVAlign, CellHAlign, StringKey]> = [
  ['top', 'left', 'ribbonAlignTopLeft'],
  ['top', 'center', 'ribbonAlignTopCenter'],
  ['top', 'right', 'ribbonAlignTopRight'],
  ['center', 'left', 'ribbonAlignMiddleLeft'],
  ['center', 'center', 'ribbonAlignMiddleCenter'],
  ['center', 'right', 'ribbonAlignMiddleRight'],
  ['bottom', 'left', 'ribbonAlignBottomLeft'],
  ['bottom', 'center', 'ribbonAlignBottomCenter'],
  ['bottom', 'right', 'ribbonAlignBottomRight'],
]

const CTX_TEXT_DIRECTIONS: Array<[CellTextDirection, StringKey]> = [
  ['lrTb', 'ribbonTextDirectionHorizontal'],
  ['tbRl', 'ribbonTextDirectionRotate90'],
  ['btLr', 'ribbonTextDirectionRotate270'],
]

export function EditorContextMenu({
  editor,
  menu,
  onClose,
  onFontDialog,
  onParagraphDialog,
  onLink,
  onNewComment,
  onFontStep,
  ribbon,
  onStyles,
  onViewImage,
  onSaveImageAs,
  onAiPreset,
  onRestartNumbering,
  onContinueNumbering,
  onSetNumberingValue,
  onAdjustListIndents,
  onChangeListLevel,
  onUpdateFields,
  onEditField,
  onOpenLink,
  onRedact,
  onUnredact,
  onTableDialog,
  sectionContentWidthPx = 624,
  onRespell,
}: EditorContextMenuProps) {
  const { t, lang } = useI18n()
  const ref = useRef<HTMLDivElement>(null)
  const [submenu, setSubmenu] = useState<string | null>(null)
  const [miniOpen, setMiniOpen] = useState<'font' | 'size' | null>(null)
  const [miniLeaving, setMiniLeaving] = useState(false)
  const miniTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (miniTimer.current) clearTimeout(miniTimer.current)
    },
    [],
  )

  // ---- spelling section (Word: suggestions · Add to Dictionary · Language) ----
  const spell = spellcheckEnabled() && editor.isEditable ? menu.spell : null
  const [spellLangs, setSpellLangs] = useState<SpellLanguages | null>(null)
  useEffect(() => {
    if (!spell) return
    let alive = true
    void window.desktop.spellLanguages?.().then((langs) => {
      if (alive) setSpellLangs(langs)
    })
    return () => {
      alive = false
    }
  }, [spell])
  const langNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([lang], { type: 'language' })
    } catch {
      return null
    }
  }, [lang])
  // active dictionaries first, the rest by display name
  const spellLangOrder = useMemo(() => {
    if (!spellLangs) return []
    const name = (code: string) => langNames?.of(code) ?? code
    const rest = spellLangs.available
      .filter((code) => !spellLangs.active.includes(code))
      .sort((a, b) => name(a).localeCompare(name(b), lang))
    return [...spellLangs.active, ...rest]
  }, [spellLangs, langNames, lang])
  const applySuggestion = (replacement: string) => {
    if (!spell) return
    applySpellingSuggestion(
      editor,
      menu.pos ?? null,
      spell.word,
      replacement,
      window.desktop.spellReplace,
    )
  }
  const addToDictionary = () => {
    if (spell) void window.desktop.spellAddWord?.(spell.word).then(() => onRespell?.())
  }
  const ignoreAll = () => {
    if (spell) void window.desktop.spellIgnoreWord?.(spell.word).then(() => onRespell?.())
  }
  const toggleLanguage = (code: string) => {
    if (!spellLangs) return
    const active = spellLangs.active.includes(code)
      ? spellLangs.active.filter((l) => l !== code)
      : [...spellLangs.active, code]
    if (!active.length) return
    // the respell kick that follows must not run under an open menu (Word closes it too)
    onClose()
    void window.desktop.spellSetLanguages?.(active).then(() => onRespell?.())
  }

  const { from, to } = editor.state.selection
  const hasSelection = from !== to
  const clickPos = menu.pos ?? from
  // ---- hyperlink / field under the pointer (Word acts on the run, not the selection) ----
  const linkRange = linkRangeAt(editor.state, clickPos)
  const linkHref = menu.link?.href ?? linkRange?.href ?? null
  const onLinkRun = linkHref !== null
  const linkEditable = !!linkRange && !menu.link?.toc && editor.isEditable
  const editLink = () => {
    if (linkRange) editor.commands.setTextSelection({ from: linkRange.from, to: linkRange.to })
    onLink()
  }
  const copyLink = () => {
    if (linkHref) void navigator.clipboard.writeText(linkHref)
  }
  const field = fieldRangeAt(editor.state, clickPos)
  const canComment = hasSelection || wordRangeAtCaret(editor) !== null
  const canEdit = editor.isEditable
  // Whether stopping the withholding is an option here. Decided from the live
  // selection rather than from a list kept alongside the document, so it cannot
  // drift from the marks the editor is actually carrying. A bare caret answers
  // false on its own, so no selection test is needed here either.
  const isRedactedSelection = hasRedactionIn(editor, from, to)
  // the presets quote the selection back to the model, so it reads the projection
  const selectedText = hasSelection
    ? redactTextBetween(editor.getJSON() as RedactableNode, from, to, ' ').trim()
    : ''
  // Synonyms targets a word / short phrase, not long selections
  const synonymText = selectedText.length > 0 && selectedText.length <= 20 ? selectedText : ''

  // keep the menu inside the viewport (flip up / clamp left near the edges)
  const [pos, setPos] = useState({ left: menu.x, top: menu.y })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let left = menu.x
    let top = menu.y
    if (left + rect.width > window.innerWidth - 8) left = window.innerWidth - rect.width - 8
    if (top + rect.height > window.innerHeight - 8) top = Math.max(8, menu.y - rect.height)
    if ((window as unknown as { __genofficeAndroidShim?: boolean }).__genofficeAndroidShim === true) {
      // Android: keep menu + mini toolbar + selection handles off the selected text
      const sel = window.getSelection()
      let avoided = false
      if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
        const rs = Array.from(sel.getRangeAt(0).getClientRects()).filter((r) => r.width > 0 && r.height > 0)
        if (rs.length > 0) {
          type Box = { l: number; t: number; r: number; b: number }
          const pad = 4
          const vw = window.innerWidth
          const vh = window.innerHeight
          const first = rs[0]
          const last = rs[rs.length - 1]
          const obs: Box[] = rs.map((r) => ({ l: r.left - pad, t: r.top - pad, r: r.right + pad, b: r.bottom + pad }))
          obs.push({ l: first.left - 40, t: first.bottom, r: first.left + 12, b: first.bottom + 48 })
          obs.push({ l: last.right - 12, t: last.bottom, r: last.right + 40, b: last.bottom + 48 })
          const mini = el.querySelector('.ctx-mini') as HTMLElement | null
          let mh = 0
          let gap = 6
          if (mini) {
            const mr = mini.getBoundingClientRect()
            mh = mr.height
            gap = Math.max(0, mr.top >= rect.bottom - 1 ? mr.top - rect.bottom : rect.top - mr.bottom)
          }
          const overlap = (a: Box, b: Box): number =>
            Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) *
            Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t))
          const minL = Math.min(...rs.map((r) => r.left))
          const maxR = Math.max(...rs.map((r) => r.right))
          const midX = (minL + maxR) / 2
          const midY = (first.top + last.bottom) / 2
          const cx = (a: number): number => Math.min(Math.max(8, a), vw - rect.width - 8)
          const lefts = [cx(midX - rect.width / 2), cx(maxR + 40), cx(minL - rect.width - 40), 8, vw - rect.width - 8]
          const tops: number[] = []
          for (let t = 8; t <= vh - rect.height - 8; t += 16) tops.push(t)
          tops.push(Math.max(8, vh - rect.height - 8))
          let best: { l: number; t: number; s: number } | null = null
          for (const l of lefts) {
            for (const t of tops) {
              // same rule as the render: mini toolbar goes above when pos.top >= 84
              const above = t >= 84
              const menuBox: Box = { l, t, r: l + rect.width, b: t + rect.height }
              const miniBox: Box = above
                ? { l, t: t - gap - mh, r: l + rect.width, b: t - gap }
                : { l, t: t + rect.height + gap, r: l + rect.width, b: t + rect.height + gap + mh }
              let sc = 0
              if (miniBox.t < 8 || miniBox.b > vh - 8) sc += 1e9
              for (const o of obs) sc += (overlap(menuBox, o) + overlap(miniBox, o)) * 1000
              sc += Math.abs(t + rect.height / 2 - midY) + Math.abs(l + rect.width / 2 - midX) * 0.3
              if (!best || sc < best.s) best = { l, t, s: sc }
            }
          }
          if (best) {
            left = best.l
            top = best.t
            avoided = true
          }
        }
      }
      el.setAttribute('data-zen-fit', avoided ? '1' : '0')
    }
    setPos({ left, top })
  }, [menu])

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onClose)
    // shell tab-strip presses never reach this document; the preload relays
    // them (app:chrome-pressed) so the menu still dismisses
    const offChrome = window.desktop?.onChromePressed?.(onClose)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onClose)
      offChrome?.()
    }
  }, [onClose])

  const run = (action: () => void) => () => {
    onClose()
    action()
  }

  // ---- table section (shown when the cursor is inside a table, Word parity) ----
  const inTable = inTableOrSelected(editor.state)
  /** cell commands can't run on a whole-table NodeSelection: drop the caret into the first cell */
  const enterFirstCell = () => {
    const sel = editor.state.selection
    if (sel instanceof NodeSelection && sel.node.type.name === 'docTable') {
      editor.view.dispatch(
        editor.state.tr.setSelection(TextSelection.near(editor.state.doc.resolve(sel.from + 1))),
      )
    }
  }
  const runTable = (command: Command) => {
    editor.view.focus()
    enterFirstCell()
    command(editor.state, editor.view.dispatch)
  }

  const protAttrs = editor.getAttributes('docProtected')
  const isImage = protAttrs?.blockType === 'image'
  const isFloating =
    isImage ||
    (Array.isArray(protAttrs?.textboxes) && (protAttrs.textboxes as unknown[]).length > 0)
  const boxes = protAttrs?.textboxes as TextboxDisplay[] | undefined
  const currentWrap = boxes?.length
    ? shapeWrapOf(boxes[0])
    : ((protAttrs?.imageWrap as string | null) ?? null)

  const clipboard = (action: 'cut' | 'copy') => {
    editor.commands.focus()
    document.execCommand(action)
  }

  // Word-style menu (icons, paste-options row) only on the Android shell; Electron is unchanged
  const wordStyle =
    (window as unknown as { __genofficeAndroidShim?: boolean }).__genofficeAndroidShim === true
  const selText = () =>
    editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to, '\n')

  const item = (
    label: string,
    opts: {
      key?: string
      disabled?: boolean
      onClick?: () => void
      submenuKey?: string
      ai?: boolean
      icon?: ReactNode
    },
  ) => (
    <button
      className="ctx-item"
      disabled={opts.disabled}
      data-ai={opts.ai ? 'true' : undefined}
      data-tip={opts.ai ? t('appAiBadgeTip') : undefined}
      onMouseEnter={() => setSubmenu(opts.submenuKey ?? null)}
      onClick={opts.submenuKey ? undefined : opts.onClick}
    >
      {wordStyle && <span className="ctx-icon">{opts.icon ?? null}</span>}
      <span className="ctx-label">{label}</span>
      {opts.ai && (
        <span className="copilot-badge copilot-badge-menu">
          <IconSparkle size={10} />
        </span>
      )}
      {opts.key && <span className="ctx-key">{platformShortcuts(opts.key)}</span>}
      {opts.submenuKey && <span className="ctx-arrow">›</span>}
    </button>
  )

  // Android mini toolbar: font/size boxes show the caret's values and open the Font dialog
  const miniStyle = editor.getAttributes('docTextStyle') as Record<string, unknown>
  const miniFontEntry = Object.entries(miniStyle).find(
    ([k, v]) => /font|family|ascii/i.test(k) && typeof v === 'string' && v !== '',
  )
  const miniFont = miniFontEntry ? String(miniFontEntry[1]) : ''
  const miniSizeHp = Number(miniStyle.sizeHalfPoints)
  const miniSize = Number.isFinite(miniSizeHp) && miniSizeHp > 0 ? String(miniSizeHp / 2) : ''
  const miniFontItems: Array<{ key: string; name: string; section: string }> =
    miniOpen === 'font' ? [...(ribbon?.fontItems?.() ?? [])] : []
  const miniSizeItems = miniOpen === 'size' ? (ribbon?.sizeOptions?.() ?? []) : []
  const MINI_CLOSE_MS = 480
  const closeMini = (after?: () => void) => {
    if (miniLeaving) return
    setMiniLeaving(true)
    miniTimer.current = setTimeout(() => {
      miniTimer.current = null
      setMiniOpen(null)
      setMiniLeaving(false)
      after?.()
    }, MINI_CLOSE_MS)
  }
  const toggleMini = (kind: 'font' | 'size') => {
    if (miniLeaving) return
    if (miniOpen === kind) closeMini()
    else setMiniOpen(kind)
  }
  const miniPick = (action: () => void) => () => {
    action()
    closeMini(onClose)
  }
  const miniMark = (name: string, tip: string, label: ReactNode) => (
    <button
      className={`ctx-mini-btn${editor.isActive(name) ? ' active' : ''}`}
      disabled={!canEdit}
      title={tip}
      aria-label={tip}
      onClick={run(() => void editor.chain().focus().toggleMark(name).run())}
    >
      {label}
    </button>
  )

  return (
    <div
      ref={ref}
      className={wordStyle ? 'ctx-menu ctx-word' : 'ctx-menu'}
      style={{ left: pos.left, top: pos.top, minWidth: MENU_WIDTH }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {spell && (
        <>
          {spell.suggestions.length === 0 && item(t('appSpellNoSuggestions'), { disabled: true })}
          {spell.suggestions.slice(0, 5).map((word) => (
            <button
              key={word}
              className="ctx-item ctx-item-strong"
              onClick={run(() => applySuggestion(word))}
            >
              <span className="ctx-label">{word}</span>
            </button>
          ))}
          <div className="ctx-sep" />
          {item(t('appSpellIgnoreAll'), { onClick: run(ignoreAll) })}
          {item(t('appSpellAddToDictionary'), { onClick: run(addToDictionary) })}
          {spellLangs && spellLangs.available.length > 0 && (
            <div className="ctx-item-wrap" onMouseLeave={() => setSubmenu(null)}>
              {item(t('appSpellLanguage'), { submenuKey: 'spellLang' })}
              {submenu === 'spellLang' && (
                <div className="ctx-submenu ctx-submenu-scroll">
                  {spellLangOrder.map((code) => (
                    <button key={code} className="ctx-item" onClick={() => toggleLanguage(code)}>
                      <span className="ctx-label">
                        {spellLangs.active.includes(code) ? '✓ ' : ''}
                        {langNames?.of(code) ?? code}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <div className="ctx-sep" />
        </>
      )}
      {menu.imageSrc && (
        <>
          {item(t('appViewImage'), { onClick: run(() => onViewImage(menu.imageSrc!)) })}
          {item(t('appSaveImageAs'), { onClick: run(() => onSaveImageAs(menu.imageSrc!)) })}
          <div className="ctx-sep" />
        </>
      )}
      {item(t('appCut'), {
        icon: <IconCut />,
        key: '⌘X',
        disabled: !hasSelection || !canEdit,
        onClick: run(() => clipboard('cut')),
      })}
      {item(t('appCopy'), {
        icon: <IconCopy />,
        key: '⌘C',
        disabled: !hasSelection,
        onClick: run(() => clipboard('copy')),
      })}
      {wordStyle ? (
        <>
          <div className="ctx-paste-head" onMouseEnter={() => setSubmenu(null)}>
            <span className="ctx-icon">
              <IconPaste />
            </span>
            <span className="ctx-label">Paste Options:</span>
            <span className="ctx-key">{platformShortcuts('⌘V')}</span>
          </div>
          <div className="ctx-paste-row">
            <button
              className="ctx-paste-btn"
              disabled={!canEdit}
              title={t('appPaste')}
              aria-label={t('appPaste')}
              onClick={run(() => void pasteFromClipboard(editor))}
            >
              <IconPaste />
            </button>
            <button
              className="ctx-paste-btn"
              disabled={!canEdit}
              title={t('appPastePlain')}
              aria-label={t('appPastePlain')}
              onClick={run(() => void pasteFromClipboard(editor, 'text'))}
            >
              <IconPasteText />
            </button>
          </div>
        </>
      ) : (
        <>
          {item(t('appPaste'), {
            key: '⌘V',
            disabled: !canEdit,
            onClick: run(() => void pasteFromClipboard(editor)),
          })}
          {item(t('appPastePlain'), {
            disabled: !canEdit,
            onClick: run(() => void pasteFromClipboard(editor, 'text')),
          })}
        </>
      )}
      <div className="ctx-sep" />
      {item(t('appFontMenu'), {
        icon: <span className="ctx-glyph">A</span>,
        key: '⌘D',
        onClick: run(onFontDialog),
      })}
      {item(t('appParagraphMenu'), {
        icon: <IconPilcrow />,
        key: '⌥⌘M',
        onClick: run(onParagraphDialog),
      })}
      {wordStyle &&
        item('Search', {
          icon: <IconSearch />,
          disabled: !hasSelection,
          onClick: run(() => void zenNative()?.call('webSearch', { text: selText() })),
        })}
      {inTable && (
        <>
          <div className="ctx-sep" />
          <div className="ctx-item-wrap" onMouseLeave={() => setSubmenu(null)}>
            {item(t('ribbonInsert'), { submenuKey: 'tableInsert', disabled: !canEdit })}
            {submenu === 'tableInsert' && canEdit && (
              <div className="ctx-submenu">
                {(
                  [
                    ['ribbonInsertAbove', addRowBefore],
                    ['ribbonInsertBelow', addRowAfter],
                    ['ribbonInsertLeft', addColumnBefore],
                    ['ribbonInsertRight', addColumnAfter],
                  ] as Array<[StringKey, Command]>
                ).map(([labelKey, command]) => (
                  <button
                    key={labelKey}
                    className="ctx-item"
                    onClick={run(() => runTable(command))}
                  >
                    <span className="ctx-label">{t(labelKey)}</span>
                  </button>
                ))}
                {onTableDialog && (
                  <button className="ctx-item" onClick={run(() => onTableDialog('insertCells'))}>
                    <span className="ctx-label">{t('ribbonInsertCells')}</span>
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="ctx-item-wrap" onMouseLeave={() => setSubmenu(null)}>
            {item(t('ribbonTableDeleteMenu'), { submenuKey: 'tableDelete', disabled: !canEdit })}
            {submenu === 'tableDelete' && canEdit && (
              <div className="ctx-submenu">
                {(
                  [
                    ['ribbonDeleteRow', deleteRow],
                    ['ribbonDeleteColumn', deleteColumn],
                    ['ribbonDeleteTable', deleteTable],
                  ] as Array<[StringKey, Command]>
                ).map(([labelKey, command]) => (
                  <button
                    key={labelKey}
                    className="ctx-item"
                    onClick={run(() => runTable(command))}
                  >
                    <span className="ctx-label">{t(labelKey)}</span>
                  </button>
                ))}
                {onTableDialog && (
                  <button className="ctx-item" onClick={run(() => onTableDialog('deleteCells'))}>
                    <span className="ctx-label">{t('ribbonDeleteCells')}</span>
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="ctx-item-wrap" onMouseLeave={() => setSubmenu(null)}>
            {item(t('ribbonSelect'), { submenuKey: 'tableSelect' })}
            {submenu === 'tableSelect' && (
              <div className="ctx-submenu">
                {(
                  [
                    ['row', 'ribbonSelectRow'],
                    ['column', 'ribbonSelectColumn'],
                    ['table', 'ribbonSelectTable'],
                    ['cell', 'ribbonSelectCell'],
                  ] as Array<[TableSelectKind, StringKey]>
                ).map(([kind, labelKey]) => (
                  <button
                    key={kind}
                    className="ctx-item"
                    onClick={run(() => runTable(selectTablePart(kind)))}
                  >
                    <span className="ctx-label">{t(labelKey)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {item(t('ribbonMergeCells'), {
            disabled: !canEdit || !mergeCells(editor.state),
            onClick: run(() => runTable(mergeCells)),
          })}
          {item(t('ribbonSplitCellsDialog'), {
            disabled: !canEdit,
            onClick: run(() => {
              enterFirstCell()
              if (onTableDialog) onTableDialog('splitCells')
              else runTable(splitCell)
            }),
          })}
          {item(t('ribbonSplitTable'), {
            disabled: !canEdit || !splitTableAtSelection()(editor.state),
            onClick: run(() => runTable(splitTableAtSelection())),
          })}
          <div className="ctx-item-wrap" onMouseLeave={() => setSubmenu(null)}>
            {item(t('ribbonDistribute'), { submenuKey: 'tableDistribute', disabled: !canEdit })}
            {submenu === 'tableDistribute' && canEdit && (
              <div className="ctx-submenu">
                <button
                  className="ctx-item"
                  onClick={run(() => {
                    enterFirstCell()
                    distributeRowsEvenly(editor.view)
                  })}
                >
                  <span className="ctx-label">{t('ribbonDistributeRows')}</span>
                </button>
                <button
                  className="ctx-item"
                  onClick={run(() => runTable(distributeSelectedColumns(sectionContentWidthPx)))}
                >
                  <span className="ctx-label">{t('ribbonDistributeColumns')}</span>
                </button>
              </div>
            )}
          </div>
          <div className="ctx-item-wrap" onMouseLeave={() => setSubmenu(null)}>
            {item(t('ribbonCellAlignment'), { submenuKey: 'tableAlign', disabled: !canEdit })}
            {submenu === 'tableAlign' && canEdit && (
              <div className="ctx-submenu">
                {CTX_CELL_ALIGN.map(([v, h, labelKey]) => (
                  <button
                    key={`${v}-${h}`}
                    className="ctx-item"
                    onClick={run(() => runTable(setCellAlignment(v, h)))}
                  >
                    <span className="ctx-label">{t(labelKey)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ctx-item-wrap" onMouseLeave={() => setSubmenu(null)}>
            {item(t('ribbonTextDirection'), { submenuKey: 'tableTextDir', disabled: !canEdit })}
            {submenu === 'tableTextDir' && canEdit && (
              <div className="ctx-submenu">
                {CTX_TEXT_DIRECTIONS.map(([dir, labelKey]) => (
                  <button
                    key={dir}
                    className="ctx-item"
                    onClick={run(() => runTable(setCellTextDirection(dir)))}
                  >
                    <span className="ctx-label">{t(labelKey)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ctx-item-wrap" onMouseLeave={() => setSubmenu(null)}>
            {item(t('ribbonAutoFit'), { submenuKey: 'tableAutoFit', disabled: !canEdit })}
            {submenu === 'tableAutoFit' && canEdit && (
              <div className="ctx-submenu">
                {(
                  [
                    ['contents', 'ribbonAutoFitContents'],
                    ['window', 'ribbonAutoFitWindow'],
                    ['fixed', 'ribbonFixedColumnWidth'],
                  ] as Array<['contents' | 'window' | 'fixed', StringKey]>
                ).map(([mode, labelKey]) => (
                  <button
                    key={mode}
                    className="ctx-item"
                    onClick={run(() => runTable(setTableAutoFit(mode, sectionContentWidthPx)))}
                  >
                    <span className="ctx-label">{t(labelKey)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          {onTableDialog &&
            item(t('ribbonTableProperties'), {
              disabled: !canEdit,
              onClick: run(() => {
                enterFirstCell()
                onTableDialog('properties')
              }),
            })}
        </>
      )}
      {(field || editor.isActive('instrField')) && onUpdateFields && (
        <>
          <div className="ctx-sep" />
          {item(t('appUpdateField'), { key: 'F9', onClick: run(() => onUpdateFields()) })}
          {field && (
            <>
              {item(t('appToggleFieldCodes'), {
                onClick: run(() => toggleFieldCodes(editor.view, field)),
              })}
              {item(t('appEditField'), {
                disabled: !canEdit || !onEditField,
                onClick: run(() => onEditField?.(field)),
              })}
            </>
          )}
        </>
      )}
      {editor.isActive('docListItem') && !!editor.getAttributes('docListItem').numId && (
        <>
          <div className="ctx-sep" />
          {item(t('appRestartNumbering'), {
            disabled: !onRestartNumbering,
            onClick: run(() => onRestartNumbering?.()),
          })}
          {item(t('appContinueNumbering'), {
            disabled: !onContinueNumbering,
            onClick: run(() => onContinueNumbering?.()),
          })}
          {item(t('appSetNumberingValue'), {
            disabled: !onSetNumberingValue || !canEdit,
            onClick: run(() => onSetNumberingValue?.()),
          })}
          {item(t('appAdjustListIndents'), {
            disabled: !onAdjustListIndents || !canEdit,
            onClick: run(() => onAdjustListIndents?.()),
          })}
          <div className="ctx-item-wrap" onMouseLeave={() => setSubmenu(null)}>
            {item(t('appChangeListLevel'), {
              disabled: !onChangeListLevel || !canEdit,
              submenuKey: 'listLevel',
            })}
            {submenu === 'listLevel' && onChangeListLevel && canEdit && (
              <div className="ctx-submenu">
                {Array.from({ length: 9 }, (_, i) => (
                  <button
                    key={i}
                    className="ctx-item"
                    aria-current={
                      (Number(editor.getAttributes('docListItem').ilvl) || 0) === i
                        ? 'true'
                        : undefined
                    }
                    onClick={run(() => onChangeListLevel(i))}
                  >
                    <span className="ctx-label" style={{ paddingLeft: i * 8 }}>
                      {t('appParaOutlineLevelN', { n: String(i + 1) })}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      <div className="ctx-sep" />
      {item(t('appSynonyms'), {
        disabled: !synonymText,
        ai: true,
        onClick: run(() => onAiPreset(t('appSynonymsPrompt', { text: synonymText }))),
      })}
      <div className="ctx-item-wrap" onMouseLeave={() => setSubmenu(null)}>
        {item(t('appTranslate'), { disabled: !hasSelection, submenuKey: 'translate', ai: true })}
        {submenu === 'translate' && hasSelection && (
          <div className="ctx-submenu">
            {TRANSLATE_LANGS.map(({ code }) => (
              <button
                key={code}
                className="ctx-item"
                onClick={run(() =>
                  onAiPreset(
                    t('appTranslateSelectionPrompt', {
                      lang: t(appLangKey(code)),
                      text: selectedText,
                    }),
                  ),
                )}
              >
                <span className="ctx-label">
                  {t('appTranslateTo', { lang: t(appLangKey(code)) })}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Withholding a span. No AI badge: the item spends the words rather
          than using the model, and the badge would read "Uses AI".
          Text only, deliberately. A picture alone in a paragraph is a *block*
          node (docProtected), which takes no marks at all, and a picture
          beside text is an inline atom whose mark is dropped by the docx save
          (convert.ts reads the run's node attrs, never the node's marks) — so
          offering it for a picture would hide it for one session and then lose
          the decision on the next save, with nothing to tell the reader. */}
      {onRedact &&
        item(t('redactMenuLabel'), {
          disabled: !canEdit || !hasSelection,
          onClick: run(onRedact),
        })}
      {/* The other half of the item above, and its mirror: offered only when the
          selection really carries the mark. Without this the sole way to stop
          withholding a span was to delete the words, which loses the reader's
          own text to undo a decision they made in the editor. Same reason as
          the item beside it for no AI badge — this one only moves a mark. */}
      {onUnredact &&
        isRedactedSelection &&
        item(t('redactShowLabel'), {
          disabled: !canEdit,
          onClick: run(onUnredact),
        })}
      {isFloating && (
        <>
          <div className="ctx-sep" />
          <div className="ctx-item-wrap" onMouseLeave={() => setSubmenu(null)}>
            {item(t('appWrapTextMenu'), { submenuKey: 'wrap' })}
            {submenu === 'wrap' && (
              <div className="ctx-submenu">
                {WRAP_OPTIONS.map((opt) => (
                  <button
                    key={String(opt.value)}
                    className="ctx-item"
                    onClick={run(() => setFloatingWrap(editor, opt.value))}
                  >
                    <span className="ctx-label">
                      {currentWrap === opt.value ? '✓ ' : ''}
                      {t(opt.labelKey)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="ctx-item-wrap" onMouseLeave={() => setSubmenu(null)}>
            {item(t('appArrangeMenu'), { submenuKey: 'arrange' })}
            {submenu === 'arrange' && (
              <div className="ctx-submenu">
                <button className="ctx-item" onClick={run(() => bringToFront(editor))}>
                  <span className="ctx-label">{t('appBringToFront')}</span>
                </button>
                <button className="ctx-item" onClick={run(() => bringForward(editor))}>
                  <span className="ctx-label">{t('appBringForward')}</span>
                </button>
                <button className="ctx-item" onClick={run(() => sendBackward(editor))}>
                  <span className="ctx-label">{t('appSendBackward')}</span>
                </button>
                <button className="ctx-item" onClick={run(() => sendToBack(editor))}>
                  <span className="ctx-label">{t('appSendToBack')}</span>
                </button>
              </div>
            )}
          </div>
        </>
      )}
      <div className="ctx-sep" />
      {onLinkRun ? (
        <>
          {item(t('appEditHyperlink'), { disabled: !linkEditable, onClick: run(editLink) })}
          {item(t('appOpenHyperlink'), {
            disabled: !onOpenLink || !(linkTarget(linkHref) || menu.link?.toc),
            onClick: run(() => onOpenLink?.(linkHref)),
          })}
          {item(t('appCopyHyperlink'), { onClick: run(copyLink) })}
          {item(t('appRemoveHyperlink'), {
            disabled: !linkEditable,
            onClick: run(() => linkRange && removeLink(editor, linkRange)),
          })}
        </>
      ) : (
        item(t('appHyperlinkMenu'), {
          icon: <IconLink />,
          key: '⌘K',
          disabled: !canEdit,
          onClick: run(onLink),
        })
      )}
      {item(t('appNewComment'), {
        icon: <IconComment />,
        disabled: !canComment,
        onClick: run(onNewComment),
      })}
      {wordStyle && (
        <>
          <div className="ctx-sep" />
          {item('Select all', { onClick: run(() => void editor.chain().focus().selectAll().run()) })}
          {item('Share', {
            disabled: !hasSelection,
            onClick: run(() => void zenNative()?.call('share', { text: selText() })),
          })}
        </>
      )}
      {wordStyle && !menu.imageSrc && !isFloating && (
        <div
          className={`ctx-mini ${pos.top >= 84 ? 'ctx-mini-above' : 'ctx-mini-below'}`}
          onMouseEnter={() => setSubmenu(null)}
        >
          <div className="ctx-mini-row">
            <button
              className="ctx-mini-box ctx-mini-font"
              disabled={!canEdit}
              title="Font"
              aria-label="Font"
              aria-expanded={miniOpen === 'font' && !miniLeaving}
              onClick={() => {
                if (!ribbon?.setFont) return run(onFontDialog)()
                ribbon.loadSystemFonts?.()
                toggleMini('font')
              }}
            >
              <span>{miniFont || 'Font'}</span>
              <IconCaret />
            </button>
            <button
              className="ctx-mini-box ctx-mini-size"
              disabled={!canEdit}
              title="Font size"
              aria-label="Font size"
              aria-expanded={miniOpen === 'size' && !miniLeaving}
              onClick={() => {
                if (!ribbon?.setSize) return run(onFontDialog)()
                toggleMini('size')
              }}
            >
              <span>{miniSize || '–'}</span>
            </button>
            {onFontStep && (
              <>
                <button
                  className="ctx-mini-btn"
                  disabled={!canEdit}
                  title="Increase font size"
                  aria-label="Increase font size"
                  onClick={run(() => onFontStep(1))}
                >
                  <IconGrowFont />
                </button>
                <button
                  className="ctx-mini-btn"
                  disabled={!canEdit}
                  title="Decrease font size"
                  aria-label="Decrease font size"
                  onClick={run(() => onFontStep(-1))}
                >
                  <IconShrinkFont />
                </button>
              </>
            )}
            <button
              className="ctx-mini-btn"
              disabled={!canEdit || !ribbon?.armPainter}
              title="Format painter"
              aria-label="Format painter"
              onClick={run(() => ribbon?.armPainter?.(false))}
            >
              <IconFormatPainter />
            </button>
            <button
              className="ctx-mini-btn"
              disabled={!canComment}
              title={t('appNewComment')}
              aria-label={t('appNewComment')}
              onClick={run(onNewComment)}
            >
              <IconComment />
            </button>
          </div>
          {miniOpen && (
            <div className={`ctx-mini-collapse${miniLeaving ? ' ctx-mini-leaving' : ''}`}>
            <div key={miniOpen} className="ctx-mini-list" role="listbox">
              {miniOpen === 'font' && (
                <>
                  {ribbon?.addFont && (
                    <button style={{ fontWeight: 600 }} onClick={miniPick(() => ribbon?.addFont?.())}>
                      Add font…
                    </button>
                  )}
                  {(['r', 's', 'b'] as const).map((section) => {
                    const items = miniFontItems.filter((it) => it.section === section)
                    if (items.length === 0) return null
                    return (
                      <div key={section}>
                        <div className="ctx-mini-group">
                          {section === 'r'
                            ? 'Recent fonts'
                            : t(section === 'b' ? 'ribbonFontsCommon' : 'ribbonFontsSystem')}
                        </div>
                        {items.map((it) => (
                          <button
                            key={it.key}
                            role="option"
                            aria-selected={it.name === miniFont}
                            className={it.name === miniFont ? 'active' : ''}
                            style={{ fontFamily: ribbon?.fontCss?.(it.name) }}
                            onClick={miniPick(() => ribbon?.setFont?.(it.name))}
                          >
                            {it.name}
                          </button>
                        ))}
                      </div>
                    )
                  })}
                </>
              )}
              {miniOpen === 'size' &&
                miniSizeItems.map((o) => (
                  <button
                    key={o.name}
                    role="option"
                    aria-selected={String(o.pt) === miniSize}
                    className={String(o.pt) === miniSize ? 'active' : ''}
                    onClick={miniPick(() => ribbon?.setSize?.(o.pt))}
                  >
                    {o.name}
                  </button>
                ))}
            </div>
            </div>
          )}
          <div className="ctx-mini-row">
            {miniMark('bold', t('ribbonBoldTip'), <b>B</b>)}
            {miniMark('italic', t('ribbonItalicTip'), <i>I</i>)}
            {miniMark('underline', t('ribbonUnderlineTip'), <u>U</u>)}
            <button
              className={`ctx-mini-btn${miniStyle.highlight ? ' active' : ''}`}
              disabled={!canEdit || !ribbon?.toggleHighlight}
              title="Text highlight"
              aria-label="Text highlight"
              onClick={run(() => ribbon?.toggleHighlight?.())}
            >
              <IconHighlight />
            </button>
            <button
              className="ctx-mini-btn"
              disabled={!canEdit || !ribbon?.applyPenColor}
              title="Font color"
              aria-label="Font color"
              onClick={run(() => ribbon?.applyPenColor?.())}
            >
              <IconFontColorA />
            </button>
            <button
              className={`ctx-mini-btn${editor.isActive('docListItem', { kind: 'bullet' }) ? ' active' : ''}`}
              disabled={!canEdit || !ribbon?.toggleList}
              title="Bullets"
              aria-label="Bullets"
              onClick={run(() => ribbon?.toggleList?.('bullet'))}
            >
              <IconBullets />
            </button>
            <button
              className={`ctx-mini-btn${editor.isActive('docListItem', { kind: 'ordered' }) ? ' active' : ''}`}
              disabled={!canEdit || !ribbon?.toggleList}
              title="Numbering"
              aria-label="Numbering"
              onClick={run(() => ribbon?.toggleList?.('ordered'))}
            >
              <IconNumbered />
            </button>
            <button
              className="ctx-mini-btn"
              disabled={!onStyles}
              title="Styles"
              aria-label="Styles"
              onClick={run(() => onStyles?.())}
            >
              <IconStylesPane />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Wrap options from Word's image context menu (inline/square/top-bottom/behind text/in front of text); shared with the Picture Format tab */
export const WRAP_OPTIONS: Array<{ labelKey: StringKey; value: string | null }> = [
  { labelKey: 'appWrapInline', value: null },
  { labelKey: 'appWrapSquareLeft', value: 'square-left' },
  { labelKey: 'appWrapSquareRight', value: 'square-right' },
  { labelKey: 'appWrapTopBottom', value: 'topBottom' },
  { labelKey: 'appWrapBehind', value: 'behind' },
  { labelKey: 'appWrapFront', value: 'front' },
]

export { ParagraphDialog } from './ParagraphDialog'
