/* zen-tab-anim: isi ribbon beranimasi saat tab berpindah (Slides/Sheets/PDF, Android). */
(function () {
  if (window.__zenTabAnim) return
  window.__zenTabAnim = true
  var ACTIVE = '.ribbon-tabs .ribbon-tab.active, .ribbon-tabs > button.active:not(.qa-btn)'
  var TAB = '.ribbon-tabs .ribbon-tab:not(.ribbon-tab-file), .ribbon-tabs > button:not(.qa-btn):not(.autosave-toggle)'
  function label() {
    var a = document.querySelector(ACTIVE)
    return a ? a.textContent : ''
  }
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest(TAB)
    if (!t) return
    var before = label()
    function go(n) {
      requestAnimationFrame(function () {
        if (label() === before) { if (n > 0) go(n - 1); return }
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
        var body = document.querySelector('[data-ribbon-body], .ribbon-body')
        if (!body || !body.animate) return
        var kids = body.children
        for (var i = 0; i < kids.length; i++) {
          kids[i].animate(
            [{ opacity: 0, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }],
            { duration: 200, easing: 'ease-out' }
          )
        }
      })
    }
    go(2)
  }, true)
})()
