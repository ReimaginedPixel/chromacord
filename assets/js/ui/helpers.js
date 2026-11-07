// Small UI helpers: storage, toasts, menus, clipboard.

const PREFIX = 'chromacord:';

export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch {
      /* private mode or full storage: settings just won't persist */
    }
  },
};

export function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

// ------------------------------------------------------------------ toasts

let toastRoot;

/**
 * Show a short message. Pass `action` and `run` for a button such as Undo.
 * tone: 'info' | 'warn'
 */
export function toast(message, { action, run, tone = 'info', duration } = {}) {
  toastRoot ??= document.getElementById('toasts');
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 180);
  };
  const el = h('div', { class: `toast ${tone}`, role: tone === 'warn' ? 'alert' : 'status' }, h('span', {}, message));
  if (action && run) {
    el.append(
      h('button', {
        class: 'toast-action',
        type: 'button',
        onclick: () => {
          run();
          close();
        },
      }, action),
    );
  }
  while (toastRoot.children.length >= 2) toastRoot.firstElementChild.remove();
  toastRoot.append(el);
  setTimeout(close, duration ?? (action ? 6000 : 3200));
}

// ------------------------------------------------------------------- menus

/**
 * A button that opens a menu of buttons. Arrow keys move, Escape closes,
 * clicking outside closes. Items are rebuilt on every open by `items()`.
 */
export function menu(button, { items, label }) {
  const panel = h('div', { class: 'menu', role: 'menu', 'aria-label': label, hidden: true });
  document.body.append(panel);
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-expanded', 'false');

  const close = (refocus = false) => {
    if (panel.hidden) return;
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('resize', place);
    window.removeEventListener('scroll', place, true);
    if (refocus) button.focus();
  };
  const outside = (e) => {
    if (!panel.contains(e.target) && !button.contains(e.target)) close();
  };
  const place = () => {
    const r = button.getBoundingClientRect();
    const w = panel.offsetWidth;
    const hgt = panel.offsetHeight;
    let left = Math.min(window.innerWidth - w - 8, Math.max(8, r.right - w));
    let top = r.bottom + 6;
    if (top + hgt > window.innerHeight - 8 && r.top - hgt - 6 > 8) top = r.top - hgt - 6;
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };
  const open = () => {
    panel.replaceChildren(
      ...items().map((item) =>
        item.separator
          ? h('div', { class: 'menu-sep', role: 'separator' })
          : h('button', {
              type: 'button',
              role: 'menuitem',
              class: 'menu-item',
              onclick: () => {
                close(true);
                item.run();
              },
            },
            h('span', { class: 'menu-label' }, item.label),
            item.hint ? h('span', { class: 'menu-hint' }, item.hint) : null,
            item.kbd ? h('kbd', {}, item.kbd) : null),
      ),
    );
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
    panel.querySelector('[role=menuitem]')?.focus();
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
  };

  button.addEventListener('click', () => (panel.hidden ? open() : close()));
  panel.addEventListener('keydown', (e) => {
    const list = [...panel.querySelectorAll('[role=menuitem]')];
    const i = list.indexOf(document.activeElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      list[(i + d + list.length) % list.length]?.focus();
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      list[e.key === 'Home' ? 0 : list.length - 1]?.focus();
    } else if (e.key === 'Tab') {
      close();
    }
  });
  return { open, close };
}

// --------------------------------------------------------------- clipboard

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = h('textarea', { readonly: true, style: 'position:fixed;top:0;left:0;opacity:0;pointer-events:none' });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function formatNumber(n) {
  return n.toLocaleString('en-US');
}
