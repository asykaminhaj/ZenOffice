/*
 * Two-finger pinch → Ctrl+wheel bridge.
 *
 * Android WebView page zoom is disabled in the viewport. The editors already
 * implement desktop trackpad pinch as a ctrlKey wheel event with small,
 * fractional deltas, so translating the touch gesture keeps Docs, Sheets,
 * Slides and PDF on their existing, tested zoom paths.
 */
;(function () {
  'use strict'
  if (window.__genofficeTouchZoom) return
  window.__genofficeTouchZoom = true

  var pinching = false
  var lastDistance = 0
  var lastX = 0
  var lastY = 0
  var moved = 0

  function distance(touches) {
    var a = touches[0]
    var b = touches[1]
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY)
  }

  function midpoint(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2,
    }
  }

  function sendZoom(deltaY, x, y) {
    if (!deltaY) return
    var target = document.elementFromPoint(x, y) || document.body
    try {
      target.dispatchEvent(
        new WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          deltaX: 0,
          deltaY: deltaY,
          deltaMode: 0,
          ctrlKey: true,
          metaKey: false,
          altKey: false,
          shiftKey: false,
        }),
      )
    } catch (e) {
      // Older WebViews: fall back to the legacy constructor.
      try {
        var event = document.createEvent('WheelEvent')
        event.initWheelEvent('wheel', true, true, window, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, null)
        Object.defineProperty(event, 'deltaY', { value: deltaY })
        Object.defineProperty(event, 'clientX', { value: x })
        Object.defineProperty(event, 'clientY', { value: y })
        Object.defineProperty(event, 'ctrlKey', { value: true })
        target.dispatchEvent(event)
      } catch (e2) {
        /* no zoom bridge on this WebView */
      }
    }
  }

  function begin(touches) {
    pinching = touches.length === 2
    if (!pinching) return
    lastDistance = distance(touches)
    var p = midpoint(touches)
    lastX = p.x
    lastY = p.y
    moved = 0
    lastDistance = Math.max(1, lastDistance)
  }

  window.addEventListener(
    'touchstart',
    function (event) {
      if (event.touches && event.touches.length === 2) {
        begin(event.touches)
      } else if (!event.touches || event.touches.length < 2) {
        pinching = false
      }
    },
    { passive: true, capture: true },
  )

  window.addEventListener(
    'touchmove',
    function (event) {
      if (!pinching || !event.touches || event.touches.length !== 2) return
      var dist = Math.max(1, distance(event.touches))
      var p = midpoint(event.touches)
      var ratio = dist / lastDistance
      moved += Math.abs(dist - lastDistance)

      // A tiny change is noise. Once the fingers have moved a few pixels,
      // consume the gesture so the viewport does not pan while zooming.
      if (moved > 4 && event.cancelable) event.preventDefault()

      // Chromium's continuous pinch events are fractional and stay below one
      // wheel notch. Keep the same shape and modest magnitude.
      var delta = -(ratio - 1) * 42
      if (Math.abs(delta) >= 0.35) {
        delta = Math.max(-18, Math.min(18, delta))
        sendZoom(delta, p.x, p.y)
      }

      lastDistance = dist
      lastX = p.x
      lastY = p.y
    },
    { passive: false, capture: true },
  )

  function end(event) {
    if (event.touches && event.touches.length === 2) {
      begin(event.touches)
      return
    }
    pinching = false
    lastDistance = 0
    moved = 0
  }

  window.addEventListener('touchend', end, { passive: true, capture: true })
  window.addEventListener('touchcancel', end, { passive: true, capture: true })

  // Some editors only engage their wheel handler on a focused scroll surface.
  // A tap already focuses the editor itself; no extra handling is necessary.
})()
