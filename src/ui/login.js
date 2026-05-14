// =============================================================================
// 145 PSG Expense System — Login page
// =============================================================================
// Shows a Microsoft sign-in button. After MSAL login, the user's role is
// resolved and the shell is notified via onLoggedIn.
// If Azure AD is not yet configured, shows a setup message.
// =============================================================================

import * as AUTH    from '../auth.js';
import * as Storage from '../storage.js';
import { esc, $, render } from './util.js';

let _root       = null;
let _onLoggedIn = null;
let _busy       = false;

export async function mount(rootEl, { onLoggedIn } = {}) {
  _root       = rootEl;
  _onLoggedIn = onLoggedIn || (() => {});
  _busy       = false;
  await _render();
  return () => { _root = null; _onLoggedIn = null; };
}

async function _render() {
  const s = await Storage.settings.getAll();
  const unitName  = s.unitName  || '145 ACU PSG';
  const unitCode  = s.unitCode  || '';
  const configured = AUTH.isMsalConfigured();

  render(_root, `
    <div class="login">
      <div class="login__card">
        <header class="login__header">
          <div class="login__crest" aria-hidden="true">
            <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="32" cy="32" r="30" stroke="#c8962a" stroke-width="3" fill="#0e1a35"/>
              <text x="32" y="40" text-anchor="middle" fill="#c8962a" font-size="22" font-family="serif" font-weight="bold">⚓</text>
            </svg>
          </div>
          <h1 class="login__title">${esc(unitName)}</h1>
          ${unitCode ? `<div class="login__subtitle">${esc(unitCode)}</div>` : ''}
          <div class="login__app-name">PSG Expense System</div>
        </header>

        <div class="login__body">
          ${configured ? `
            <p class="login__desc">
              Sign in with your Microsoft account to submit or manage expense claims.
            </p>
            <div class="login__error" role="alert" aria-live="assertive"></div>
            <button type="button" class="btn btn--ms-signin" data-action="signin" ${_busy ? 'disabled' : ''}>
              <svg width="20" height="20" viewBox="0 0 21 21" fill="none" aria-hidden="true">
                <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
                <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
                <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
                <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
              </svg>
              ${_busy ? 'Signing in…' : 'Sign in with Microsoft'}
            </button>
          ` : `
            <div class="login__setup-notice">
              <h2>First-time Setup</h2>
              <p>
                Enter your Azure App Registration <strong>Client ID</strong> to enable
                Microsoft sign-in. You can find this in Azure Portal under
                <em>App registrations → your app → Overview</em>.
              </p>
              <form class="form" data-form="setup-form" novalidate>
                <label class="form__field">
                  <span class="form__label">Client ID (Application ID)</span>
                  <input type="text" name="clientId" class="form__input"
                         placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                         spellcheck="false" autocomplete="off" required>
                </label>
                <label class="form__field">
                  <span class="form__label">Tenant ID <small>(leave blank for any Microsoft account)</small></span>
                  <input type="text" name="tenantId" class="form__input"
                         placeholder="common" value="common"
                         spellcheck="false" autocomplete="off">
                </label>
                <div class="form__hint">
                  The redirect URI for this page is: <code>${esc(window.location.href.replace(/\/+$/, '').split('?')[0])}</code><br>
                  Register this under <em>Authentication → Single-page application</em> in Azure Portal.
                </div>
                <div class="form__error" role="alert"></div>
                <div class="form__actions">
                  <button type="submit" class="btn btn--primary">Save &amp; Enable Sign-in</button>
                </div>
              </form>
            </div>
          `}
        </div>

        <footer class="login__footer">
          <p>145 ACU PSG &mdash; Expense Management System</p>
          <p class="login__footer-small">Data stored locally and synced to OneDrive. Authorised personnel only.</p>
        </footer>
      </div>
    </div>
  `);

  if (configured) {
    _root.addEventListener('click', _onClick);
  } else {
    const setupForm = _root.querySelector('[data-form="setup-form"]');
    if (setupForm) {
      setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd       = new FormData(setupForm);
        const clientId = (fd.get('clientId') || '').trim();
        const tenantId = (fd.get('tenantId') || 'common').trim() || 'common';
        const errEl    = setupForm.querySelector('.form__error');
        if (!clientId) {
          if (errEl) errEl.textContent = 'Client ID is required.';
          return;
        }
        if (!/^[0-9a-f-]{36}$/i.test(clientId)) {
          if (errEl) errEl.textContent = 'Client ID should be a GUID (e.g. xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).';
          return;
        }
        await Storage.settings.setMany({ 'azure.clientId': clientId, 'azure.tenantId': tenantId });
        if (errEl) errEl.textContent = '';
        setupForm.querySelector('button[type="submit"]').textContent = 'Saved — reloading…';
        setTimeout(() => window.location.reload(), 800);
      });
    }
  }
}

async function _onClick(e) {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action !== 'signin' || _busy) return;
  _busy = true;

  const btn    = $('[data-action="signin"]', _root);
  const errEl  = $('.login__error', _root);
  if (btn)   { btn.disabled = true; btn.textContent = 'Signing in…'; }
  if (errEl) errEl.textContent = '';

  try {
    const session = await AUTH.signIn();
    if (session) {
      // If role is null, user is not registered
      if (session.pending) {
        _showPendingMessage(session);
      } else {
        _onLoggedIn(session);
      }
    }
    // null means redirect flow started — page will reload
  } catch (err) {
    const msg = err.message || String(err);
    if (errEl) errEl.textContent = msg;
    _busy = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Sign in with Microsoft'; }
  }
}

function _showPendingMessage(session) {
  render(_root, `
    <div class="login">
      <div class="login__card">
        <header class="login__header">
          <h1 class="login__title">Access Pending</h1>
        </header>
        <div class="login__body">
          <p>
            You signed in as <strong>${esc(session.email)}</strong>, but your account
            has not been approved yet.
          </p>
          <p>Contact a PSG Admin or OC to have your access granted.</p>
          <button type="button" class="btn btn--ghost" data-action="back">
            Back to sign-in
          </button>
        </div>
      </div>
    </div>
  `);
  _root.addEventListener('click', async (e) => {
    if (e.target.closest('[data-action="back"]')) {
      await AUTH.signOut();
      await _render();
      _root.addEventListener('click', _onClick);
    }
  }, { once: true });
}
