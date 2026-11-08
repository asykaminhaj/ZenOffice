import { useRef, useEffect, useState, useCallback } from 'react'
import { ZenScrollPill } from './ZenScrollPill'
import { ZenScrollPillH } from './ZenScrollPillH'

/**
 * Interactive Vertical Scrollbar for the right side of the editor.
 * Features:
 * - Long-press-to-drag for touchscreen (prevents accidental interference with editing)
 * - Visual feedback when thumb is active/dragging
 * - Short touches don't interfere with normal scrolling/editing
 * - Keyboard accessible
 */
function LegacyVerticalScrollbar({
  scrollContainerRef,
  trackColor = 'var(--scrollbar-track, transparent)',
  thumbColor = 'var(--scrollbar-thumb, #888)',
  thumbHoverColor = 'var(--scrollbar-thumb-hover, #555)',
  thumbActiveColor = 'var(--scrollbar-thumb-active, #333)',
  thumbWidth = 8,
  trackWidth = 12,
  borderRadius = 4,
  minThumbHeight = 40,
  longPressDelay = 400, // ms to wait before activating drag
  visible = true,
}: {
  scrollContainerRef: React.RefObject<HTMLElement | null>
  trackColor?: string
  thumbColor?: string
  thumbHoverColor?: string
  thumbActiveColor?: string
  thumbWidth?: number
  trackWidth?: number
  borderRadius?: number
  minThumbHeight?: number
  longPressDelay?: number
  visible?: boolean
}) {
  const scrollbarRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const [thumbStyle, setThumbStyle] = useState<React.CSSProperties>({})
  const [trackStyle, setTrackStyle] = useState<React.CSSProperties>({})
  const [isDragging, setIsDragging] = useState(false)
  const [isHovering, setIsHovering] = useState(false)
  const [isLongPressing, setIsLongPressing] = useState(false)
  const [showScrollbar, setShowScrollbar] = useState(false)

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dragStartRef = useRef<{ y: number; scrollTop: number } | null>(null)
  const containerHeightRef = useRef(0)
  const scrollHeightRef = useRef(0)

  // Calculate thumb size and position
  const updateThumb = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return

    containerHeightRef.current = container.clientHeight
    scrollHeightRef.current = container.scrollHeight

    const scrollRatio = containerHeightRef.current / scrollHeightRef.current

    if (scrollRatio >= 1) {
      // No scrolling needed
      setShowScrollbar(false)
      return
    }

    setShowScrollbar(true)

    const thumbHeight = Math.max(minThumbHeight, containerHeightRef.current * scrollRatio)
    const maxScrollTop = scrollHeightRef.current - containerHeightRef.current
    const maxThumbTop = containerHeightRef.current - thumbHeight
    const thumbTop = maxScrollTop > 0 ? (container.scrollTop / maxScrollTop) * maxThumbTop : 0

    // Only update styles if thumb element exists (it won't on first render)
    const thumb = thumbRef.current
    if (thumb) {
      setThumbStyle({
        height: `${thumbHeight}px`,
        top: `${thumbTop}px`,
        width: `${thumbWidth}px`,
        backgroundColor: isDragging ? thumbActiveColor : isHovering || isLongPressing ? thumbHoverColor : thumbColor,
        borderRadius: `${borderRadius}px`,
        opacity: isDragging || isHovering || isLongPressing ? 1 : 0.6,
        transition: isDragging ? 'none' : 'opacity 0.2s ease, background-color 0.2s ease',
      })
    }

    setTrackStyle({
      height: '100%',
      width: `${trackWidth}px`,
      backgroundColor: trackColor,
      borderRadius: `${borderRadius}px`,
    })
  }, [
    scrollContainerRef,
    trackColor,
    thumbColor,
    thumbHoverColor,
    thumbActiveColor,
    thumbWidth,
    trackWidth,
    borderRadius,
    minThumbHeight,
    isDragging,
    isHovering,
    isLongPressing,
  ])

  // Update on scroll
  const handleScroll = useCallback(() => {
    if (!isDragging) {
      updateThumb()
    }
  }, [isDragging, updateThumb])

  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    container.addEventListener('scroll', handleScroll, { passive: true })
    // Initial calculation
    updateThumb()

    // Also update on resize
    const resizeObserver = new ResizeObserver(updateThumb)
    resizeObserver.observe(container)

    return () => {
      container.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
    }
  }, [scrollContainerRef, handleScroll, updateThumb])

  // Show scrollbar on hover/focus of container
  const handleContainerEnter = useCallback(() => {
    updateThumb()
    setShowScrollbar(true)
  }, [updateThumb])

  const handleContainerLeave = useCallback(() => {
    if (!isDragging) {
      setShowScrollbar(false)
    }
  }, [isDragging])

  // Touch handlers for long-press-to-drag
  const handleTouchStart = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (!scrollContainerRef.current) return

      const touch = e.touches[0]
      const thumbRect = thumbRef.current?.getBoundingClientRect()
      const trackRect = trackRef.current?.getBoundingClientRect()

      // Check if touch is on thumb or track
      const isOnThumb =
        thumbRect &&
        touch.clientX >= thumbRect.left &&
        touch.clientX <= thumbRect.right &&
        touch.clientY >= thumbRect.top &&
        touch.clientY <= thumbRect.bottom

      const isOnTrack =
        trackRect &&
        touch.clientX >= trackRect.left &&
        touch.clientX <= trackRect.right &&
        touch.clientY >= trackRect.top &&
        touch.clientY <= trackRect.bottom

      if (!isOnThumb && !isOnTrack) return

      e.preventDefault()
      e.stopPropagation()

      // Start long press timer
      longPressTimerRef.current = setTimeout(() => {
        setIsLongPressing(true)
        setIsDragging(true)
        dragStartRef.current = {
          y: touch.clientY,
          scrollTop: scrollContainerRef.current!.scrollTop,
        }
        // Provide haptic feedback if available
        if ('vibrate' in navigator) {
          navigator.vibrate(10)
        }
      }, longPressDelay)
    },
    [scrollContainerRef, longPressDelay]
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent<HTMLDivElement>) => {
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current)
        longPressTimerRef.current = null
      }

      if (!isDragging || !dragStartRef.current || !scrollContainerRef.current) {
        setIsLongPressing(false)
        return
      }

      e.preventDefault()
      e.stopPropagation()

      const touch = e.touches[0]
      const deltaY = touch.clientY - dragStartRef.current.y

      const container = scrollContainerRef.current
      const containerHeight = containerHeightRef.current
      const scrollHeight = scrollHeightRef.current

      const thumb = thumbRef.current
      const thumbHeight = thumb?.offsetHeight || minThumbHeight
      const maxThumbTop = containerHeight - thumbHeight
      const maxScrollTop = scrollHeight - containerHeight

      if (maxScrollTop <= 0 || maxThumbTop <= 0) return

      const scrollRatio = maxScrollTop / maxThumbTop
      const newScrollTop = Math.max(
        0,
        Math.min(maxScrollTop, dragStartRef.current.scrollTop + deltaY * scrollRatio)
      )

      container.scrollTop = newScrollTop
      // updateThumb will be called by the scroll event listener
    },
    [isDragging, minThumbHeight, scrollContainerRef]
  )

  const handleTouchEnd = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current)
      longPressTimerRef.current = null
    }

    if (isDragging) {
      setIsDragging(false)
      setIsLongPressing(false)
      dragStartRef.current = null
      // Provide haptic feedback
      if ('vibrate' in navigator) {
        navigator.vibrate(5)
      }
    } else {
      // Short touch - just show scrollbar briefly
      setIsLongPressing(false)
      setShowScrollbar(true)
      setTimeout(() => setShowScrollbar(false), 1500)
    }
  }, [isDragging])

  // Mouse handlers for desktop
  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!scrollContainerRef.current) return

      const thumbRect = thumbRef.current?.getBoundingClientRect()
      const trackRect = trackRef.current?.getBoundingClientRect()

      const isOnThumb =
        thumbRect &&
        e.clientX >= thumbRect.left &&
        e.clientX <= thumbRect.right &&
        e.clientY >= thumbRect.top &&
        e.clientY <= thumbRect.bottom

      const isOnTrack =
        trackRect &&
        e.clientX >= trackRect.left &&
        e.clientX <= trackRect.right &&
        e.clientY >= trackRect.top &&
        e.clientY <= trackRect.bottom

      if (!isOnThumb && !isOnTrack) return

      e.preventDefault()
      e.stopPropagation()

      setIsDragging(true)
      dragStartRef.current = {
        y: e.clientY,
        scrollTop: scrollContainerRef.current.scrollTop,
      }

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragStartRef.current || !scrollContainerRef.current) return

        const deltaY = ev.clientY - dragStartRef.current.y

        const container = scrollContainerRef.current
        const containerHeight = containerHeightRef.current
        const scrollHeight = scrollHeightRef.current

        const thumb = thumbRef.current
        const thumbHeight = thumb?.offsetHeight || minThumbHeight
        const maxThumbTop = containerHeight - thumbHeight
        const maxScrollTop = scrollHeight - containerHeight

        if (maxScrollTop <= 0 || maxThumbTop <= 0) return

        const scrollRatio = maxScrollTop / maxThumbTop
        const newScrollTop = Math.max(
          0,
          Math.min(maxScrollTop, dragStartRef.current.scrollTop + deltaY * scrollRatio)
        )

        container.scrollTop = newScrollTop
      }

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
        setIsDragging(false)
        dragStartRef.current = null
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [scrollContainerRef, minThumbHeight]
  )

  const handleMouseEnter = useCallback(() => {
    setIsHovering(true)
    setShowScrollbar(true)
  }, [])

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false)
    if (!isDragging) setShowScrollbar(false)
  }, [isDragging])

  // Keyboard support
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!scrollContainerRef.current) return

      const container = scrollContainerRef.current
      const step = container.clientHeight * 0.9 // Page up/down

      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault()
          container.scrollTop = Math.max(0, container.scrollTop - 40)
          break
        case 'ArrowDown':
          e.preventDefault()
          container.scrollTop = Math.min(
            container.scrollHeight - container.clientHeight,
            container.scrollTop + 40
          )
          break
        case 'PageUp':
          e.preventDefault()
          container.scrollTop = Math.max(0, container.scrollTop - step)
          break
        case 'PageDown':
          e.preventDefault()
          container.scrollTop = Math.min(
            container.scrollHeight - container.clientHeight,
            container.scrollTop + step
          )
          break
        case 'Home':
          e.preventDefault()
          container.scrollTop = 0
          break
        case 'End':
          e.preventDefault()
          container.scrollTop = container.scrollHeight - container.clientHeight
          break
      }
    },
    [scrollContainerRef]
  )

  if (!visible || !showScrollbar) return null

  return (
    <div
      ref={scrollbarRef}
      className="vertical-scrollbar"
      role="scrollbar"
      aria-orientation="vertical"
      aria-valuemin={0}
      aria-valuemax={scrollHeightRef.current - containerHeightRef.current}
      aria-valuenow={scrollContainerRef.current?.scrollTop || 0}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: trackWidth,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        pointerEvents: 'auto',
        zIndex: 50,
        opacity: isDragging || isHovering || isLongPressing ? 1 : 0.4,
        transition: 'opacity 0.2s ease',
      }}
    >
      <div
        ref={trackRef}
        className="vertical-scrollbar-track"
        style={trackStyle}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
      >
        <div
          ref={thumbRef}
          className="vertical-scrollbar-thumb"
          style={thumbStyle}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
        />
      </div>
    </div>
  )
}

/** Android: pill tahan-lalu-geser seperti PDF. Desktop: komponen lama tetap dipakai. */
export function VerticalScrollbar(props: React.ComponentProps<typeof LegacyVerticalScrollbar>) {
  const android = (window as { __genofficeAndroidShim?: boolean }).__genofficeAndroidShim === true
  if (!android) return <LegacyVerticalScrollbar {...props} />
  if (props.visible === false) return null
  return (
    <>
      <ZenScrollPill scrollContainerRef={props.scrollContainerRef} />
      <ZenScrollPillH scrollContainerRef={props.scrollContainerRef} />
    </>
  )
}
