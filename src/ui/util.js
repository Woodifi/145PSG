// =============================================================================
// 145 PSG Expense System — UI utilities (adapted from QStore IMS v2)
// =============================================================================

export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function $(selector, root = document) {
  return root.querySelector(selector);
}

export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

export function render(target, html, cleanupCallbacks = []) {
  for (const fn of cleanupCallbacks) {
    try { fn(); } catch (e) { console.error('render cleanup error:', e); }
  }
  target.innerHTML = html;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function fmtDateOnly(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function once(target, event, handler) {
  const wrapped = (e) => {
    target.removeEventListener(event, wrapped);
    handler(e);
  };
  target.addEventListener(event, wrapped);
  return () => target.removeEventListener(event, wrapped);
}

export class ObjectURLPool {
  constructor() { this._urls = new Set(); }

  create(blob) {
    const url = URL.createObjectURL(blob);
    this._urls.add(url);
    return url;
  }

  register(url) {
    if (url) this._urls.add(url);
    return url;
  }

  revokeAll() {
    for (const url of this._urls) {
      try { URL.revokeObjectURL(url); } catch (e) { console.warn('revokeObjectURL failed:', e); }
    }
    this._urls.clear();
  }
}

/** Debounce a function. Returns a debounced version and a cancel function. */
export function debounce(fn, ms) {
  let timer = null;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}
