// =============================================================================
// 145 PSG Expense System — Modal helper (from QStore IMS v2, unchanged)
// =============================================================================

import { esc, $$ } from './util.js';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const _stack = [];

export function openModal({
  titleHtml = '',
  bodyHtml  = '',
  size      = 'md',
  persistent = false,
  onMount,
  onClose,
} = {}) {
  const previouslyFocused = document.activeElement;

  const root = document.createElement('div');
  root.className = 'modal';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.innerHTML = `
    <div class="modal__backdrop" data-action="modal-close-backdrop"></div>
    <div class="modal__panel modal__panel--${esc(size)}">
      ${titleHtml ? `<h2 class="modal__title">${titleHtml}</h2>` : ''}
      <div class="modal__content">${bodyHtml}</div>
    </div>
  `;
  document.body.appendChild(root);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    if (typeof onClose === 'function') {
      try { onClose(); } catch (e) { console.error('modal onClose error:', e); }
    }
    root.removeEventListener('keydown', _onKeydown);
    root.removeEventListener('click',   _onClick);
    root.remove();
    _stack.pop();
    if (previouslyFocused && document.contains(previouslyFocused)) {
      previouslyFocused.focus();
    }
  };

  function _onClick(e) {
    if (persistent) return;
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'modal-close-backdrop' || action === 'modal-close') close();
  }
  function _onKeydown(e) {
    if (e.key === 'Escape' && !persistent) {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === 'Tab') _trapFocus(root, e);
  }

  root.addEventListener('click', _onClick);
  root.addEventListener('keydown', _onKeydown);

  const panel = root.querySelector('.modal__panel');
  if (typeof onMount === 'function') {
    try { onMount(panel, close); }
    catch (e) { console.error('modal onMount error:', e); close(); throw e; }
  }

  setTimeout(() => {
    const first = $$(FOCUSABLE, panel)[0];
    if (first) first.focus();
    else { panel.setAttribute('tabindex', '-1'); panel.focus(); }
  }, 30);

  _stack.push(close);
  return { close, element: root };
}

export function closeTopModal() {
  const top = _stack[_stack.length - 1];
  if (top) top();
}

function _trapFocus(root, e) {
  const focusable = $$(FOCUSABLE, root).filter((el) => el.offsetParent !== null);
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last  = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    last.focus(); e.preventDefault();
  } else if (!e.shiftKey && document.activeElement === last) {
    first.focus(); e.preventDefault();
  }
}
