// Desktop-style windows: drag by the title bar, resize from any edge or corner,
// double-click the title bar to put the window back. A window keeps its CSS
// placement until it is first moved or resized; from then on it is fixed to the
// viewport where the player left it (and stays there when reopened).
const windows = new Set();
const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];
// Never start a drag from controls or from the terminal's own text area.
const NO_DRAG = 'button, a, input, select, textarea, label, summary, .rz, .term';
let topZ = 30;
let pinned = null;
let remember = true;

// A pinned window (e.g. the terminal) stays above the others while it is open.
export function front(win) {
  win.style.zIndex = String(++topZ);
  if (pinned && pinned !== win && !pinned.hidden) pinned.style.zIndex = String(++topZ);
}

export function setPinned(win) {
  pinned = win || null;
  if (pinned && !pinned.hidden) front(pinned);
}

// When positions are not remembered, a closed window comes back in its default place.
export function setRemember(on) {
  remember = Boolean(on);
}

export function windowClosed(win) {
  if (!remember) resetWindow(win);
}

function detach(win) {
  if (win.dataset.floating) return;
  const r = win.getBoundingClientRect();
  Object.assign(win.style, {
    position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    right: 'auto', bottom: 'auto', transform: 'none', margin: '0', maxWidth: 'none', maxHeight: 'none', minWidth: '0',
  });
  win.dataset.floating = '1';
  win.classList.add('floating');
}

export function resetWindow(win) {
  for (const k of ['position', 'left', 'top', 'width', 'height', 'right', 'bottom', 'transform', 'margin', 'maxWidth', 'maxHeight', 'minWidth', 'zIndex']) win.style[k] = '';
  delete win.dataset.floating;
  win.classList.remove('floating');
}

export function resetAllWindows() {
  windows.forEach(resetWindow);
}

// Keep at least the title bar reachable after a drag or a browser resize.
function clamp(win) {
  // Hidden windows measure 0x0; leave their saved size alone until they show again.
  if (!win.dataset.floating || !win.offsetWidth) return;
  const w = Math.min(win.offsetWidth, innerWidth);
  const h = Math.min(win.offsetHeight, innerHeight);
  if (w < win.offsetWidth) win.style.width = `${w}px`;
  if (h < win.offsetHeight) win.style.height = `${h}px`;
  const left = Math.min(Math.max(parseFloat(win.style.left) || 0, 80 - w), innerWidth - 80);
  const top = Math.min(Math.max(parseFloat(win.style.top) || 0, 0), innerHeight - 48);
  win.style.left = `${left}px`;
  win.style.top = `${top}px`;
}

// A drag lives only while the button is held. Releases can be missed (button let
// go outside the page, focus switched away, capture lost), so every path ends it,
// and a move without a pressed button ends it too instead of moving the window.
function track(event, target, onMove) {
  event.preventDefault();
  try { target.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
  document.body.classList.add('win-busy');
  let done = false;
  const move = (e) => {
    if (e.pointerId !== event.pointerId) return;
    if (!(e.buttons & 1)) return end();
    onMove(e.clientX - event.clientX, e.clientY - event.clientY);
    return undefined;
  };
  const end = () => {
    if (done) return;
    done = true;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('blur', end);
    target.removeEventListener('lostpointercapture', end);
    try { target.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    document.body.classList.remove('win-busy');
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('blur', end);
  target.addEventListener('lostpointercapture', end);
}

export function makeWindow(win, { handles = [], minW = 320, minH = 220, onReset } = {}) {
  windows.add(win);
  win.classList.add('win');
  win.addEventListener('pointerdown', () => front(win), true);

  for (const handle of handles) {
    handle.classList.add('win-handle');
    handle.title = handle.title || 'ลากเพื่อย้าย · ดับเบิลคลิกเพื่อคืนตำแหน่ง';
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.target.closest(NO_DRAG)) return;
      detach(win);
      const x = parseFloat(win.style.left), y = parseFloat(win.style.top);
      track(event, handle, (dx, dy) => {
        win.style.left = `${x + dx}px`;
        win.style.top = `${y + dy}px`;
        clamp(win);
      });
    });
    handle.addEventListener('dblclick', (event) => {
      if (event.target.closest(NO_DRAG)) return;
      resetWindow(win);
      onReset?.();
    });
  }

  for (const dir of DIRS) {
    const grip = document.createElement('div');
    grip.className = `rz rz-${dir}`;
    grip.setAttribute('aria-hidden', 'true');
    win.append(grip);
    grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      front(win);
      detach(win);
      const s = { l: parseFloat(win.style.left), t: parseFloat(win.style.top), w: win.offsetWidth, h: win.offsetHeight };
      track(event, grip, (dx, dy) => {
        let { l, t, w, h } = s;
        if (dir.includes('e')) w = s.w + dx;
        if (dir.includes('s')) h = s.h + dy;
        if (dir.includes('w')) w = s.w - dx;
        if (dir.includes('n')) h = s.h - dy;
        w = Math.min(Math.max(w, minW), innerWidth);
        h = Math.min(Math.max(h, minH), innerHeight);
        if (dir.includes('w')) l = s.l + s.w - w;
        if (dir.includes('n')) t = s.t + s.h - h;
        Object.assign(win.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${h}px` });
      });
    });
  }
}

addEventListener('resize', () => windows.forEach(clamp));
