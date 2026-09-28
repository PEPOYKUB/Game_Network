export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny element builder: el('div', { class: 'x', onclick }, 'text', child) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

let toastTimer;
export function toast(text, bad = false) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}

export function openModal(id) {
  $(`#${id}`).classList.remove('hidden');
}

export function closeModal(id) {
  $(`#${id}`).classList.add('hidden');
}

export function confirmBox(title, text, yesLabel = 'ตกลง') {
  return new Promise((resolve) => {
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-yes').textContent = yesLabel;
    openModal('modal-confirm');
    const done = (answer) => {
      closeModal('modal-confirm');
      $('#confirm-yes').onclick = null;
      $('#confirm-no').onclick = null;
      resolve(answer);
    };
    $('#confirm-yes').onclick = () => done(true);
    $('#confirm-no').onclick = () => done(false);
  });
}

export function fmtTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function storage(kind = 'local') {
  const store = kind === 'session' ? window.sessionStorage : window.localStorage;
  return {
    get(key, fallback = null) {
      try {
        const v = store.getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        store.setItem(key, JSON.stringify(value));
      } catch {
        /* storage unavailable (private mode): settings just won't persist */
      }
    },
    remove(key) {
      try {
        store.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

/** replaceChildren() that skips null/false (so `cond && node` is safe). */
export function fill(node, ...children) {
  node.replaceChildren(...children.flat().filter((c) => c != null && c !== false));
}
