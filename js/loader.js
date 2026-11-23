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
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1000);
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
 * Leaving: a click on a link to another page of the site brings the loading
 * knot up at once, in the middle of this page, and draws a veil up behind it
 * (css/loader.css: .loader--leave, .veil, html.leaving) in the ground of the
 * page it is going to, then goes. The next page finds the time of the click in
 * sessionStorage['aporia:nav'], shows its own knot at once (html.arrive) and
 * turns it on from where this one had got to (--lk-at), so the knot never
 * leaves the screen. Not for new tabs, other sites, anchors on the same page,
 * or the portal, which has its own way through.
 */
(function () {
  var html = document.documentElement;
  // Every page does this in an inline head script, before anything is drawn;
  // this is the fallback for one that does not: arrive, without carrying the
  // turn on (applied after the first paint, the knot would visibly jump)
  try { if (+sessionStorage.getItem('aporia:nav')) { sessionStorage.removeItem('aporia:nav'); html.classList.add('arrive'); } } catch (e) {}
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // The loading screen's own markup, kept for the knot that comes up on leaving
  // (the screen itself is gone from the page once it has lifted).
  var source = document.getElementById('loader');
  var KNOT = source ? source.innerHTML : '';

  // The ground each page opens on (its loading screen's --loader-bg), so the
  // veil is already the colour of the page it hands over to.
  var GROUND = { 'shelf.html': 'rgb(31, 27, 24)' };
  var NIGHT = '#08080b';
  var going = false, veil = null, knot = null;

  /** The URL a link leads to, if it is another page of this site we hand over to. */
  function internal(a) {
    if (!a || a.id === 'portal' || a.hasAttribute('download') || (a.target && a.target !== '_self')) return null;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return null; }
    if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return null;
    return url;
  }
  function linkOf(e) { return e.target && e.target.closest ? e.target.closest('a[href]') : null; }

  document.addEventListener('click', function (e) {
    if (going || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var url = internal(linkOf(e));
    if (!url) return;
    e.preventDefault();
    going = true;
    var ground = GROUND[url.pathname.split('/').pop()] || NIGHT;
    try { sessionStorage.setItem('aporia:nav', String(Date.now())); } catch (err) {}
    veil = document.createElement('div');
    veil.className = 'veil';
    veil.setAttribute('aria-hidden', 'true');
    veil.style.setProperty('--veil', ground);
    document.body.appendChild(veil);
    if (KNOT) {
      knot = document.createElement('div');
      knot.className = 'loader loader--leave';
      knot.setAttribute('aria-hidden', 'true');
      knot.style.setProperty('--loader-bg', ground);   // its outlines in the ground it is about to sit on
      knot.style.setProperty('--lk-at', '0s');         // turning from now, whatever this page arrived with
      knot.innerHTML = KNOT;
      document.body.appendChild(knot);
    }
    void veil.offsetHeight;                     // start from below the screen, so the rise is animated
    html.classList.add('leaving');
    // Go before the veil has quite finished (it is about 90 % of the way at
    // 230 ms of 340): the browser keeps showing this page, knot and veil, until
    // the next one can draw.
    setTimeout(function () { location.href = url.href; }, 230);
  });
  // Back to this page from the back/forward cache: it must not still be covered.
  addEventListener('pageshow', function () {
    going = false;
    html.classList.remove('leaving');
    if (veil && veil.parentNode) veil.parentNode.removeChild(veil);
    if (knot && knot.parentNode) knot.parentNode.removeChild(knot);
    veil = knot = null;
  });
})();

/**
 * Fetching ahead: a page can only draw (even its loading knot) once its
 * stylesheets are in, so fetch the next page and its stylesheet as soon as a
 * pointer, finger or focus reaches its link, and every page this one links to
 * once it has settled (with css/loader.css, which every page waits on).
 * <link rel=prefetch> (Chrome and Firefox; Chrome then uses them without asking
 * the server again for five minutes, where it would otherwise re-check each). The Google Fonts
 * stylesheet needs none of this: every page asks for the very same one, so it
 * is in the cache from the first page on (keep the three URLs identical).
 */
(function () {
  var STYLES = { 'about.html': 'css/styles.css', 'shelf.html': 'css/shelf.css', '': 'css/knot.css', 'index.html': 'css/knot.css' };
  var fetched = {};
  function prefetch(href) {
    if (fetched[href]) return;
    fetched[href] = true;
    var l = document.createElement('link');
    l.rel = 'prefetch'; l.href = href;
    document.head.appendChild(l);
  }
  function warm(a) {
    if (!a || a.hasAttribute('download')) return;
    var url;
    try { url = new URL(a.getAttribute('href'), location.href); } catch (err) { return; }
    if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
    url.hash = '';
    prefetch(url.href);
    var css = STYLES[url.pathname.split('/').pop()];
    if (css) prefetch(new URL(css, location.href).href);
    prefetch(new URL('css/loader.css', location.href).href);   // every page waits on this one too
  }
  function on(e) { warm(e.target && e.target.closest ? e.target.closest('a[href]') : null); }
  document.addEventListener('pointerover', on, { passive: true });
  document.addEventListener('touchstart', on, { passive: true });
  document.addEventListener('focusin', on);
  // the rest of the site, quietly, once this page is up (not on a metered connection)
  if (navigator.connection && navigator.connection.saveData) return;
  addEventListener('load', function () {
    setTimeout(function () {
      var as = document.querySelectorAll('a[href]');
      for (var i = 0; i < as.length; i++) warm(as[i]);
    }, 2500);
  });
})();
