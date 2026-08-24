/**
 * js/shelf/ui.js — the few pieces of DOM around the canvas: the title plate
 * for the centred book, the position markers, the arrows, the inspection
 * panel. No provider chrome, no decoration.
 */

const STATUS_LABEL = { out: 'out now', progress: 'in progress', open: 'undecided · pitch us', unwritten: 'unwritten' };

export function createUI(manifest, { onMarker, onPrev, onNext, onOpen, onClose }) {
  const $ = (sel) => document.querySelector(sel);
  const markers = $('#markers');
  const panel = $('#panel');
  const prev = $('#prev'), next = $('#next'), openBtn = $('#open'), closeBtn = $('#close');
  const hint = $('#hint');

  // markers: one per book, the real issues labelled
  const buttons = manifest.books.map((b, i) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'marker' + (b.status === 'unwritten' ? '' : ' marker--real');
    el.setAttribute('aria-label', `Go to ${b.status === 'unwritten' ? 'unwritten issue' : 'Issue'} ${String(b.number).padStart(2, '0')}`);
    el.innerHTML = `<span class="marker__tick"></span>${b.status === 'unwritten' ? '' : `<span class="marker__label">${String(b.number).padStart(2, '0')}</span>`}`;
    el.addEventListener('click', () => onMarker(i));
    markers.appendChild(el);
    return el;
  });

  prev.addEventListener('click', onPrev);
  next.addEventListener('click', onNext);
  openBtn.addEventListener('click', onOpen);
  closeBtn.addEventListener('click', onClose);

  const live = $('#live');
  function setCurrent(i) {
    const b = manifest.books[i];
    buttons.forEach((el, k) => el.classList.toggle('is-current', k === i));
    prev.disabled = i === 0;
    next.disabled = i === manifest.books.length - 1;
    openBtn.textContent = b.status === 'unwritten' ? `Take down No. ${String(b.number).padStart(2, '0')}` : `Take down Issue ${String(b.number).padStart(2, '0')}`;
    if (live) live.textContent = `Issue ${String(b.number).padStart(2, '0')}, ${b.title}, ${STATUS_LABEL[b.status] || b.status}`;
  }

  function showPanel(i) {
    const b = manifest.books[i];
    $('#panel-no').textContent = `Issue ${String(b.number).padStart(2, '0')}`;
    $('#panel-title').textContent = b.title;
    $('#panel-line').textContent = b.line;
    $('#panel-status').textContent = STATUS_LABEL[b.status] || b.status;
    const link = $('#panel-link');
    if (b.href) {
      link.hidden = false;
      link.href = b.href;
      link.textContent = b.status === 'open' ? 'Pitch a subject' : 'Read it';
      link.classList.toggle('is-placeholder', b.href.startsWith('#TODO'));
      link.querySelector?.('.placeholder-tag')?.remove();
      if (b.href.startsWith('#TODO')) link.insertAdjacentHTML('beforeend', ' <span class="placeholder-tag">link pending</span>');
    } else link.hidden = true;
    document.body.classList.add('is-inspecting');
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('is-open'));
    closeBtn.focus({ preventScroll: true });
  }
  function hidePanel() {
    panel.classList.remove('is-open');
    document.body.classList.remove('is-inspecting');
    setTimeout(() => { panel.hidden = true; }, 400);
  }

  function setHint(text) { hint.textContent = text; }
  function setLoading(on, text) {
    document.body.classList.toggle('is-loading', on);
    const el = $('#loading');
    if (el) { el.hidden = !on; if (text) el.textContent = text; }
  }

  return { setCurrent, showPanel, hidePanel, setHint, setLoading };
}
