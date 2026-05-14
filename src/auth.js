// =============================================================================
// 145 PSG Expense System — Auth module
// =============================================================================
// Authentication via Microsoft MSAL (Azure AD / Microsoft Entra ID).
// After sign-in, the user's email is looked up in the members store to
// determine their role. First-time visitors who are not in the members
// store see a "pending approval" screen unless no members exist at all
// (bootstrap case — they become the first admin/CO).
//
// ROLES
//   member  — submit own claims, view own status
//   admin   — PSG Admin: approve/reject/pay all claims, view bank details
//   co      — OC/CO: full admin + user management, settings, ATO reports
//
// COMMAND PIN
//   CO can optionally set a 6-digit command PIN for high-privilege actions
//   (data export, wipe, role management). Stored as argon2id hash on the
//   member record. Non-CO members never see command PIN prompts.
//
// SESSION
//   Stored in sessionStorage keyed to the member email. Cleared on signOut.
// =============================================================================

import * as msal    from '@azure/msal-browser';
import * as Storage from './storage.js';

export const ROLES = Object.freeze({
  member: { label: 'Member',    short: 'MBR' },
  admin:  { label: 'PSG Admin', short: 'ADM' },
  co:     { label: 'OC / CO',   short: 'CO'  },
});

export const PERMS = Object.freeze({
  member: ['submitExpense', 'viewOwn'],
  admin:  ['submitExpense', 'viewOwn', 'viewAll', 'approve', 'reject', 'pay',
           'viewBankDetails', 'exportReports', 'manageExpenses'],
  co:     ['submitExpense', 'viewOwn', 'viewAll', 'approve', 'reject', 'pay',
           'viewBankDetails', 'exportReports', 'manageExpenses',
           'manageMembers', 'settings', 'audit', 'atoReports', 'commandActions'],
});

const SESSION_KEY = 'psg_expense_session';

// MSAL scopes needed
const SCOPES = ['User.Read', 'Files.ReadWrite'];

let _msalInstance = null;
let _session      = null;
const _listeners  = new Set();

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

/**
 * Initialise MSAL and attempt to restore a cached session.
 * Must be called after Storage.init(). Returns the restored session or null.
 */
export async function init() {
  const s = await Storage.settings.getAll();
  const clientId   = s['azure.clientId'] || '';
  const tenantId   = s['azure.tenantId'] || 'common';

  if (clientId) {
    try {
      _msalInstance = new msal.PublicClientApplication({
        auth: {
          clientId,
          authority:             `https://login.microsoftonline.com/${tenantId}`,
          redirectUri:           _getRedirectUri(),
          postLogoutRedirectUri: _getRedirectUri(),
        },
        cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false },
      });

      // CRITICAL — must call on every load to complete any pending redirect flow
      const response = await _msalInstance.handleRedirectPromise();
      if (response?.account) {
        _msalInstance.setActiveAccount(response.account);
        return _resolveSession(response.account);
      }

      // Check for cached account
      const accounts = _msalInstance.getAllAccounts();
      if (accounts.length > 0) {
        _msalInstance.setActiveAccount(accounts[0]);
        return _resolveSession(accounts[0]);
      }
    } catch (err) {
      console.error('MSAL init error:', err);
      _msalInstance = null;
    }
  }

  // Try to restore from sessionStorage (works if MSAL already configured)
  return _restoreSession();
}

/**
 * Trigger interactive Microsoft sign-in.
 * On mobile/touch: redirect flow (page navigates away).
 * On desktop: popup with redirect fallback.
 */
export async function signIn() {
  if (!_msalInstance) {
    throw new Error('Azure AD not configured. An administrator must add the Client ID in Settings first.');
  }
  const request = { scopes: SCOPES, redirectUri: _getRedirectUri(), prompt: 'select_account' };

  if (_isMobile()) {
    await _msalInstance.loginRedirect(request);
    return null;
  }

  try {
    const resp = await _msalInstance.loginPopup(request);
    _msalInstance.setActiveAccount(resp.account);
    return _resolveSession(resp.account);
  } catch (err) {
    const msg = err.message || String(err);
    if (msg.includes('popup_window_error') || msg.includes('user_cancelled')) {
      await _msalInstance.loginRedirect(request);
      return null;
    }
    if (msg.includes('interaction_in_progress')) {
      throw new Error('A sign-in is already in progress. Refresh and try again.');
    }
    throw err;
  }
}

export async function signOut() {
  _session = null;
  sessionStorage.removeItem(SESSION_KEY);
  _notify();

  if (_msalInstance) {
    const account = _msalInstance.getActiveAccount();
    if (account) {
      try {
        if (_isMobile()) {
          await _msalInstance.logoutRedirect({ account, postLogoutRedirectUri: _getRedirectUri() });
          return;
        }
        await _msalInstance.logoutPopup({ account });
      } catch (err) {
        console.warn('MSAL signOut warning:', err);
        try { await _msalInstance.clearCache(); } catch (_) {}
      }
    }
  }
}

export function getSession() {
  return _session ? { ..._session } : null;
}

export function isAuthenticated() {
  return _session !== null;
}

export function getMsalInstance() {
  return _msalInstance;
}

export function isMsalConfigured() {
  return Boolean(_msalInstance);
}

// -----------------------------------------------------------------------------
// Token acquisition (for Graph API calls in cloud.js)
// -----------------------------------------------------------------------------

export async function getAccessToken(scopes = SCOPES) {
  if (!_msalInstance) throw new Error('MSAL not initialised.');
  const account = _msalInstance.getActiveAccount();
  if (!account) throw new Error('Not signed in.');

  try {
    const resp = await _msalInstance.acquireTokenSilent({ scopes, account });
    return resp.accessToken;
  } catch {
    if (_isMobile()) {
      sessionStorage.setItem('psg_token_refresh', '1');
      await _msalInstance.acquireTokenRedirect({ scopes, account, redirectUri: _getRedirectUri() });
      throw new Error('Redirecting for token refresh…');
    }
    try {
      const resp = await _msalInstance.acquireTokenPopup({ scopes, account });
      return resp.accessToken;
    } catch {
      sessionStorage.setItem('psg_token_refresh', '1');
      await _msalInstance.acquireTokenRedirect({ scopes, account, redirectUri: _getRedirectUri() });
      throw new Error('Redirecting for token refresh…');
    }
  }
}

// -----------------------------------------------------------------------------
// Permissions
// -----------------------------------------------------------------------------

export function can(perm) {
  if (!_session) return false;
  const perms = PERMS[_session.role] || [];
  return perms.includes(perm);
}

export function isAdmin() {
  return _session !== null && (_session.role === 'admin' || _session.role === 'co');
}

export function isCO() {
  return _session !== null && _session.role === 'co';
}

export function requirePermission(perm) {
  if (!can(perm)) {
    const role = _session?.role || 'unauthenticated';
    throw new Error(`Permission denied: '${perm}' (role: ${role})`);
  }
}

// -----------------------------------------------------------------------------
// Member management helpers
// -----------------------------------------------------------------------------

/**
 * Ensure a member record exists for the signed-in account.
 * If no members exist at all, this account becomes the first CO (bootstrap).
 */
export async function ensureFirstMember(account) {
  const count = await Storage.members.count();
  if (count > 0) return false;

  await Storage.members.put({
    email:     account.username,
    name:      account.name || account.username,
    role:      'co',
    active:    true,
    addedBy:   'system',
    addedAt:   new Date().toISOString(),
    lastLogin: new Date().toISOString(),
    notes:     'First user — auto-promoted to CO during system initialisation.',
  });
  await Storage.audit.append({
    action: 'member_add',
    user:   account.username,
    desc:   `First member ${account.username} auto-created as CO during bootstrap.`,
  });
  return true;
}

// -----------------------------------------------------------------------------
// Session change listeners
// -----------------------------------------------------------------------------

export function onSessionChange(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function _notify() {
  const snap = _session ? { ..._session } : null;
  for (const fn of _listeners) {
    try { fn(snap); } catch (e) { console.error('AUTH listener error:', e); }
  }
}

// -----------------------------------------------------------------------------
// Internal
// -----------------------------------------------------------------------------

async function _resolveSession(account) {
  const email = account.username?.toLowerCase() || '';

  // Bootstrap: if no members exist at all, make this user the first CO.
  await ensureFirstMember(account);

  const member = await Storage.members.get(email);
  if (!member || member.active === false) {
    // Not registered or deactivated — return a limited pending session
    _session = {
      email,
      name:    account.name || email,
      role:    null,
      pending: true,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(_session));
    _notify();
    return { ..._session };
  }

  // Update last-login
  member.lastLogin = new Date().toISOString();
  await Storage.members.put(member);

  _session = {
    email:     member.email,
    name:      member.name,
    role:      member.role,
    pending:   false,
  };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(_session));

  await Storage.audit.append({
    action: 'login',
    user:   member.name,
    desc:   `Login: ${member.name} (${ROLES[member.role]?.label || member.role})`,
  });

  _notify();
  return { ..._session };
}

function _restoreSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.email) { sessionStorage.removeItem(SESSION_KEY); return null; }
    _session = parsed;
    _notify();
    return { ..._session };
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

function _getRedirectUri() {
  const uri = window.location.origin + window.location.pathname;
  return uri.endsWith('/') ? uri.slice(0, -1) : uri;
}

function _isMobile() {
  return ('ontouchstart' in window) || (navigator.maxTouchPoints > 0)
      || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
}
