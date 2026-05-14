// =============================================================================
// 145 PSG Expense System — Toast notifications (from QStore IMS v2, unchanged)
// =============================================================================

let _container = null;

function _ensureContainer() {
  if (_container && document.contains(_container)) return _container;
  _container = document.createElement('div');
  _container.className = 'toast-container';
  _container.setAttribute('aria-live', 'polite');
  _container.setAttribute('aria-atomic', 'false');
  document.body.appendChild(_container);
  return _container;
}

export function showToast(message, type = 'info', duration = 4500) {
  const container = _ensureContainer();

  const el = document.createElement('div');
  el.className = `toast toast--${type}`;
  el.textContent = message;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  container.appendChild(el);

  requestAnimationFrame(() => el.classList.add('toast--visible'));

  const dismiss = () => {
    if (!el.parentNode) return;
    el.classList.remove('toast--visible');
    el.addEventListener('transitionend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  };

  const timer = setTimeout(dismiss, duration);
  el.addEventListener('click', () => { clearTimeout(timer); dismiss(); });
  return dismiss;
}
