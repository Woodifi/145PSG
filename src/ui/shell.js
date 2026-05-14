// =============================================================================
// 145 PSG Expense System — App shell
// =============================================================================
// Orchestrates layout, navigation, page mounting, and session state.
// =============================================================================

import * as Storage    from '../storage.js';
import * as AUTH       from '../auth.js';
import * as Sync       from '../sync.js';
import * as Login      from './login.js';
import * as Dashboard  from './dashboard.js';
import * as ExpList    from './expense-list.js';
import * as ExpForm    from './expense-form.js';
import * as ExpDetail  from './expense-detail.js';
import * as ATOReports from './ato-reports.js';
import * as AuditLog   from './audit.js';
import * as Members    from './members.js';
import * as Settings   from './settings.js';
import { esc, $, render } from './util.js';
import { showToast } from './toast.js';

// Page registry: id → { label, icon, perm?, coOnly?, mount, adminOnly? }
const PAGES = {
  dashboard:      { label: 'Dashboard',   icon: '⊞', mount: Dashboard.mount  },
  'new-expense':  { label: 'New Claim',   icon: '+', mount: ExpForm.mount, hidden: true },
  'my-expenses':  { label: 'My Claims',   icon: '📋', mount: (el) => ExpList.mount(el, { viewMode: 'own' }) },
  expenses:       { label: 'All Claims',  icon: '📁', mount: ExpList.mount,   adminOnly: true  },
  'expense-detail':{ label: 'Claim',      icon: '📄', mount: ExpDetail.mount, hidden: true     },
  'ato-reports':  { label: 'ATO Reports', icon: '📊', perm: 'atoReports'  ,   mount: ATOReports.mount },
  audit:          { label: 'Audit Log',   icon: '🔒', perm: 'audit',          mount: AuditLog.mount  },
  members:        { label: 'Members',     icon: '👥', perm: 'manageMembers',  mount: Members.mount   },
  settings:       { label: 'Settings',    icon: '⚙',  perm: 'settings',       mount: Settings.mount  },
};

const DEFAULT_PAGE = 'dashboard';

let _root           = null;
let _session        = null;
let _currentPage    = null;
let _currentDetail  = null;  // e.g. expense ID for expense-detail
let _currentUnmount = null;

// -----------------------------------------------------------------------------
// Boot
// -----------------------------------------------------------------------------

export async function boot(rootEl) {
  _root = rootEl;
  try {
    await Storage.init();
    await Storage.requestPersistence();
    _session = await AUTH.init();
    await Sync.init();

    if (_session && !_session.pending) {
      await _renderShell();
    } else {
      await _mountLogin();
    }
  } catch (err) {
    console.error('Boot failed:', err);
    _renderFatalError(err);
  }
}

// -----------------------------------------------------------------------------
// Login
// -----------------------------------------------------------------------------

async function _mountLogin() {
  _session = null;
  await _teardownCurrentPage();
  await Login.mount(_root, {
    onLoggedIn: async (session) => {
      _session = session;
      await _renderShell();
    },
  });
}

// -----------------------------------------------------------------------------
// Shell layout
// -----------------------------------------------------------------------------

async function _renderShell() {
  const s        = await Storage.settings.getAll();
  const unitName = s.unitName || '145 ACU PSG';
  const unitCode = s.unitCode || '';
  const unitLogo = s.unitLogo || '';

  _currentPage = DEFAULT_PAGE;

  const crestHtml = unitLogo
    ? `<img src="${esc(unitLogo)}" alt="${esc(unitName)} logo" class="shell__brand-logo">`
    : `<svg width="36" height="36" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
         <circle cx="32" cy="32" r="30" stroke="#c8962a" stroke-width="3" fill="#0e1a35"/>
         <text x="32" y="41" text-anchor="middle" fill="#c8962a" font-size="24" font-family="serif">⚓</text>
       </svg>`;

  render(_root, `
    <div class="shell">
      <header class="shell__header">
        <div class="shell__brand">
          <div class="shell__brand-crest" aria-hidden="true">
            ${crestHtml}
          </div>
          <div class="shell__brand-text">
            <div class="shell__brand-name">${esc(unitName)}</div>
            ${unitCode ? `<div class="shell__brand-code">${esc(unitCode)}</div>` : ''}
          </div>
        </div>

        <nav class="shell__nav" aria-label="Main navigation">
          ${_navHtml(DEFAULT_PAGE)}
        </nav>

        <div class="shell__header-right">
          <div class="shell__sync" data-target="sync-indicator" title="Cloud sync status"></div>
          <div class="shell__session">
            <div class="shell__session-name">${esc(_session?.name || '')}</div>
            <div class="shell__session-role">${esc(AUTH.ROLES[_session?.role]?.label || _session?.role || '')}</div>
          </div>
          <button type="button" class="shell__logout" data-action="logout">Sign out</button>
        </div>
      </header>

      <div class="shell__body">
        <aside class="shell__sidebar">
          <nav class="shell__sidenav" aria-label="Section navigation">
            ${_sidenavHtml(DEFAULT_PAGE)}
          </nav>
        </aside>
        <main class="shell__main" data-target="page-content">
          <div class="shell__loading">Loading…</div>
        </main>
      </div>
    </div>
  `);

  // Wire events
  _root.querySelector('.shell__logout')?.addEventListener('click', _onLogout);
  _root.querySelector('.shell__nav')?.addEventListener('click', _onNavClick);
  _root.querySelector('.shell__sidenav')?.addEventListener('click', _onNavClick);
  _root.addEventListener('navigate', _onNavigateEvent);

  // Sync indicator
  Sync.addStatusListener(_onSyncStatus);

  await _mountPage(DEFAULT_PAGE);
}

function _navHtml(activePage) {
  // Top nav: just the quick-action pages
  const quickPages = ['dashboard', 'new-expense', 'my-expenses'];
  return quickPages
    .filter(k => PAGES[k] && _hasAccess(PAGES[k]) && !PAGES[k].hidden)
    .map(k => `
      <button type="button"
              class="shell__nav-link ${k === activePage ? 'is-active' : ''}"
              data-page="${esc(k)}">
        ${esc(PAGES[k].label)}
      </button>
    `).join('');
}

function _sidenavHtml(activePage) {
  return Object.entries(PAGES)
    .filter(([, def]) => _hasAccess(def) && !def.hidden)
    .map(([key, def]) => `
      <button type="button"
              class="shell__sidenav-link ${key === activePage ? 'is-active' : ''}"
              data-page="${esc(key)}">
        <span class="shell__sidenav-icon" aria-hidden="true">${esc(def.icon || '')}</span>
        <span class="shell__sidenav-label">${esc(def.label)}</span>
      </button>
    `).join('');
}

function _hasAccess(pageDef) {
  if (pageDef.coOnly)    return AUTH.isCO();
  if (pageDef.adminOnly) return AUTH.isAdmin();
  if (pageDef.perm)      return AUTH.can(pageDef.perm);
  return true;
}

function _onNavClick(e) {
  const btn = e.target.closest('[data-page]');
  if (!btn) return;
  _navigateTo(btn.dataset.page);
}

function _onNavigateEvent(e) {
  const { page, id } = e.detail || {};
  if (page) _navigateTo(page, { id });
}

async function _navigateTo(page, opts = {}) {
  if (page === _currentPage && !opts.id) return;
  if (!PAGES[page]) return;
  if (!_hasAccess(PAGES[page])) return;

  _currentPage   = page;
  _currentDetail = opts.id || null;

  // Update active states in both navbars
  _root.querySelectorAll('[data-page]').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.page === page);
  });

  await _mountPage(page, opts);
}

async function _mountPage(pageKey, opts = {}) {
  await _teardownCurrentPage();

  const target = _root?.querySelector('[data-target="page-content"]');
  if (!target) return;

  const pageDef = PAGES[pageKey];
  if (!pageDef) {
    target.innerHTML = `<div class="shell__placeholder"><p>Page not found: ${esc(pageKey)}</p></div>`;
    return;
  }

  try {
    _currentUnmount = await pageDef.mount(target, opts);
  } catch (err) {
    console.error(`Mount failed for "${pageKey}":`, err);
    target.innerHTML = `
      <div class="fatal">
        <h1>Page failed to load</h1>
        <pre class="fatal__detail">${esc(err.message || String(err))}</pre>
      </div>
    `;
  }
}

async function _teardownCurrentPage() {
  if (typeof _currentUnmount === 'function') {
    try { _currentUnmount(); } catch (e) { console.error('unmount error:', e); }
  }
  _currentUnmount = null;
}

// -----------------------------------------------------------------------------
// Sync status indicator
// -----------------------------------------------------------------------------

function _onSyncStatus(status) {
  const el = _root?.querySelector('[data-target="sync-indicator"]');
  if (!el) return;
  const icons  = { 'signed-in': '✓', busy: '⟳', error: '⚠', 'not-signed-in': '○', unconfigured: '○' };
  const labels = {
    'signed-in':     status.pending ? 'Sync pending' : 'Synced',
    busy:            'Syncing…',
    error:           'Sync error',
    'not-signed-in': 'Not synced',
    unconfigured:    'Sync off',
  };
  el.className = `shell__sync shell__sync--${esc(status.state)}`;
  el.innerHTML = `
    <span class="shell__sync-icon">${esc(icons[status.state] || '?')}</span>
    <span class="shell__sync-label">${esc(labels[status.state] || status.state)}</span>
  `;
}

// -----------------------------------------------------------------------------
// Logout
// -----------------------------------------------------------------------------

async function _onLogout() {
  await _teardownCurrentPage();
  Sync.removeStatusListener(_onSyncStatus);
  _root?.removeEventListener('navigate', _onNavigateEvent);
  await AUTH.signOut();
  await Storage.audit.append({
    action: 'logout',
    user:   _session?.name || '',
    desc:   `Logout: ${_session?.name || 'unknown'}`,
  });
  await _mountLogin();
}

// -----------------------------------------------------------------------------
// Fatal error
// -----------------------------------------------------------------------------

function _renderFatalError(err) {
  render(_root, `
    <div class="fatal">
      <h1>Something went wrong</h1>
      <p>The application failed to start. Try a hard refresh (Ctrl+Shift+R).</p>
      <pre class="fatal__detail">${esc(err.message || String(err))}</pre>
    </div>
  `);
}
