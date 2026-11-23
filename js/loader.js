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

  var done = false, fonts = false, t0 = Date.now();
  function finish() {
    if (done) return;
    done = true;
    // the knot only comes up after 200 ms (or at once on arrival from another page)
    if (Date.now() - t0 < 200 && !html.classList.contains('arrive')) el.classList.add('is-quick');
    el.classList.add('is-done');
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1400);
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

/**
 * Leaving: a link to another page of the site draws a veil up over this one
 * first (css/loader.css, .veil and html.leaving), in the ground of the page it
 * is going to, then goes. The next page sees the flag and brings its loading
 * knot straight up (html.arrive), so the change of page is one movement rather
 * than a cut to black. Not for new tabs, other sites, anchors on the same page,
 * or the portal, which has its own way through.
 */
(function () {
  var html = document.documentElement;
  // the front page has no inline head script of its own for this: catch it here
  try { if (sessionStorage.getItem('aporia:nav') === '1') { sessionStorage.removeItem('aporia:nav'); html.classList.add('arrive'); } } catch (e) {}
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // The ground each page opens on (its loading screen's --loader-bg), so the
  // veil is already the colour of the page it hands over to.
  var GROUND = { 'shelf.html': 'rgb(31, 27, 24)' };
  var NIGHT = '#08080b';
  var going = false, veil = null;

  /** The URL a link leads to, if it is another page of this site we hand over to. */
  function internal(a) {
    if (!a || a.id === 'portal' || a.hasAttribute('download') || (a.target && a.target !== '_self')) return null;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return null; }
    if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return null;
    return url;
  }
  function linkOf(e) { return e.target && e.target.closest ? e.target.closest('a[href]') : null; }

  // Fetch the next page (and the stylesheet it waits on) as soon as a hand is on
  // its way to the link, so it can draw the moment the veil is up.
  var STYLES = { 'about.html': 'css/styles.css', 'shelf.html': 'css/shelf.css', '': 'css/knot.css', 'index.html': 'css/knot.css' };
  var fetched = {};
  function prefetch(href) {
    if (fetched[href]) return;
    fetched[href] = true;
    var l = document.createElement('link');
    l.rel = 'prefetch'; l.href = href;
    document.head.appendChild(l);
  }
  function warm(e) {
    var url = internal(linkOf(e));
    if (!url) return;
    prefetch(url.href);
    var css = STYLES[url.pathname.split('/').pop()];
    if (css) prefetch(new URL(css, location.href).href);
  }
  document.addEventListener('pointerover', warm, { passive: true });
  document.addEventListener('touchstart', warm, { passive: true });
  document.addEventListener('focusin', warm);

  document.addEventListener('click', function (e) {
    if (going || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var url = internal(linkOf(e));
    if (!url) return;
    e.preventDefault();
    going = true;
    try { sessionStorage.setItem('aporia:nav', '1'); } catch (err) {}
    veil = document.createElement('div');
    veil.className = 'veil';
    veil.setAttribute('aria-hidden', 'true');
    veil.style.setProperty('--veil', GROUND[url.pathname.split('/').pop()] || NIGHT);
    document.body.appendChild(veil);
    void veil.offsetHeight;                     // start from below the screen, so the rise is animated
    html.classList.add('leaving');
    // Go while the veil is still finishing (it is over 90 % of its way at 420 ms
    // of 600): the browser keeps showing this page, veil and all, until the next
    // one can draw, so the fetch overlaps the end of the rise instead of
    // following it with a black wait.
    setTimeout(function () { location.href = url.href; }, 420);
  });
  // Back to this page from the back/forward cache: it must not still be covered.
  addEventListener('pageshow', function () {
    going = false;
    html.classList.remove('leaving');
    if (veil && veil.parentNode) veil.parentNode.removeChild(veil);
    veil = null;
  });
})();

