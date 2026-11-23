/**
 * js/loader.js — lifts the loading screen (css/loader.css) once the page is ready.
 *
 * Ready means the page has said so in one of the ways it already does:
 *   html[data-ready="1"]        the shelf, once the room is built
 *   #stage.is-ready             About, once the figure is on screen
 *   html.live                   the front page, once the knot is drawn
 *   html.static / html.no-webgl / html.fallback
 *                               the plain page, which has nothing to build
 * and the web fonts are in (or have had 1.2 seconds). Whatever happens, it
 * never stays up longer than twelve seconds.
 *
 * A classic script, deferred, so it runs before the page's modules and works
 * whether or not they ever load.
 */
(function () {
  var html = document.documentElement;
  var el = document.getElementById('loader');
  if (!el) return;

  var done = false, fonts = false;
  function finish() {
    if (done) return;
    done = true;
    el.classList.add('is-done');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1200);
  }

  // Through the portal from About, the curtain is already doing this job.
  if (html.classList.contains('arriving')) { finish(); return; }

  function ready() {
    var stage = document.getElementById('stage');
    return html.getAttribute('data-ready') === '1'
      || html.classList.contains('static')
      || html.classList.contains('no-webgl')
      || html.classList.contains('live')
      || html.classList.contains('fallback')
      || !!(stage && stage.classList.contains('is-ready'));
  }
  function check() { if (!done && fonts && ready()) finish(); }

  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { fonts = true; check(); });
  else fonts = true;
  setTimeout(function () { fonts = true; check(); }, 1200);
  setTimeout(finish, 12000);

  if ('MutationObserver' in window) {
    var mo = new MutationObserver(check);
    mo.observe(html, { attributes: true, attributeFilter: ['class', 'data-ready', 'data-mode'] });
    var stage = document.getElementById('stage');
    if (stage) mo.observe(stage, { attributes: true, attributeFilter: ['class'] });
  } else {
    var poll = setInterval(function () { check(); if (done) clearInterval(poll); }, 150);
  }

  // Back to a page that was kept whole in memory: it is ready already.
  addEventListener('pageshow', function (e) { if (e.persisted) finish(); });
  check();
})();
