import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Android scroll pill horizontal (pasangan ZenScrollPill): tahan pill lalu geser kiri-kanan.
 * Posisi scroll = startScroll + dx * scrollable / travel. Hanya tampil kalau konten lebih lebar.
 */
export function ZenScrollPillH({
  scrollContainerRef,
}: {
  scrollContainerRef: React.RefObject<HTMLElement | null>
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [dragging, setDragging] = useState(false)
  const hideRef = useRef(0)

  const flash = useCallback(() => {
    setVisible(true)
    window.clearTimeout(hideRef.current)
    hideRef.current = window.setTimeout(() => setVisible(false), 1000)
  }, [])

  const update = useCallback(() => {
    const el = scrollContainerRef.current
    const wrap = wrapRef.current
    const thumb = thumbRef.current
    if (!el || !wrap || !thumb) return
    const r = el.getBoundingClientRect()
    // sisakan 44px di kanan untuk pill vertikal supaya tidak bertabrakan di pojok
    const trackW = Math.max(0, r.width - 8 - 44)
    wrap.style.left = `${r.left + 4}px`
    wrap.style.top = `${r.bottom - 44}px`
    wrap.style.width = `${trackW}px`
    const scrollable = el.scrollWidth - el.clientWidth
    if (scrollable <= 1 || trackW <= 0) {
      thumb.style.display = 'none'
      return
    }
    thumb.style.display = ''
    const thumbW = Math.min(trackW, Math.max(72, (trackW * el.clientWidth) / el.scrollWidth))
    const left = (el.scrollLeft / scrollable) * (trackW - thumbW)
    thumb.style.width = `${thumbW}px`
    thumb.style.transform = `translateX(${Math.max(0, left)}px)`
  }, [scrollContainerRef])

  useEffect(() => {
    let bound: HTMLElement | null = null
    let ro: ResizeObserver | null = null
    let raf = 0
    const onScroll = () => {
      if (!raf)
        raf = requestAnimationFrame(() => {
          raf = 0
          update()
        })
      flash()
    }
    const unbind = () => {
      bound?.removeEventListener('scroll', onScroll)
      ro?.disconnect()
      bound = null
      ro = null
    }
    const bind = () => {
      const el = scrollContainerRef.current
      if (el === bound) return
      unbind()
      if (!el) return
      bound = el
      el.addEventListener('scroll', onScroll, { passive: true })
      ro = new ResizeObserver(update)
      ro.observe(el)
      for (const c of Array.from(el.children)) ro.observe(c)
    }
    bind()
    update()
    const iv = window.setInterval(() => {
      bind()
      update()
    }, 500)
    window.addEventListener('resize', update)
    return () => {
      window.clearInterval(iv)
      window.removeEventListener('resize', update)
      if (raf) cancelAnimationFrame(raf)
      window.clearTimeout(hideRef.current)
      unbind()
    }
  }, [scrollContainerRef, update, flash])

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      const el = scrollContainerRef.current
      if (!el) return
      e.preventDefault()
      e.stopPropagation()
      const thumb = e.currentTarget
      const pointerId = e.pointerId
      const startX = e.clientX
      const startScroll = el.scrollLeft
      const HOLD_MS = e.pointerType === 'mouse' ? 120 : 160
      const SLOP = e.pointerType === 'mouse' ? 6 : 12
      let armed = false
      const timer = window.setTimeout(() => {
        armed = true
        setDragging(true)
        try {
          thumb.setPointerCapture(pointerId)
        } catch {
          /* sudah dilepas */
        }
        document.body.style.userSelect = 'none'
        try {
          navigator.vibrate?.(15)
        } catch {
          /* tanpa haptik */
        }
      }, HOLD_MS)
      function finish() {
        window.clearTimeout(timer)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onEnd)
        window.removeEventListener('pointercancel', onEnd)
        try {
          thumb.releasePointerCapture(pointerId)
        } catch {
          /* sudah dilepas */
        }
        document.body.style.userSelect = ''
        setDragging(false)
        flash()
      }
      function onMove(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return
        if (!armed) {
          if (Math.abs(ev.clientX - startX) > SLOP) finish()
          return
        }
        ev.preventDefault()
        const track = thumb.parentElement
        const travel = (track ? track.clientWidth : 0) - thumb.offsetWidth
        const scrollable = el!.scrollWidth - el!.clientWidth
        if (travel <= 0 || scrollable <= 0) return
        el!.scrollLeft = startScroll + ((ev.clientX - startX) * scrollable) / travel
      }
      function onEnd(ev: PointerEvent) {
        if (ev.pointerId !== pointerId) return
        finish()
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onEnd)
      window.addEventListener('pointercancel', onEnd)
    },
    [scrollContainerRef, flash],
  )

  return createPortal(
    <div
      ref={wrapRef}
      className={`zen-docs-pill-h${visible || dragging ? ' zen-docs-pill-visible' : ''}${dragging ? ' zen-docs-pill-dragging' : ''}`}
    >
      <div ref={thumbRef} className="zen-docs-pill-h-thumb" onPointerDown={onPointerDown} />
    </div>,
    document.body,
  )
}
