// =============================================================================
// 145 PSG Expense System — Sync orchestrator
// =============================================================================
// Adapted from QStore IMS v2 sync.js.
// Debounces uploads to OneDrive. Downloads are always explicit user actions.
// =============================================================================

import * as Storage from './storage.js';
import { getProvider } from './cloud.js';

const SYNC_DEBOUNCE_MS = 6000;

let _debounceTimer  = null;
let _pendingPromise = null;
const _listeners    = new Set();
let _lastError      = null;
let _busy           = false;

export async function init() {
  _lastError = null;
  await getProvider().init();
  _emitStatus();
}

export async function notifyChanged() {
  if (!await _shouldAutoSync()) return;
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(() => {
    _debounceTimer = null;
    _push().catch((err) => console.warn('Auto-sync failed:', err));
  }, SYNC_DEBOUNCE_MS);
  _emitStatus();
}

export async function syncNow() {
  if (_debounceTimer) { clearTimeout(_debounceTimer); _debounceTimer = null; }
  return _push();
}

export async function loadFromCloud() {
  const provider = getProvider();
  if (!provider.isSignedIn()) {
    return { ok: false, error: new Error('Not signed in to OneDrive.') };
  }
  _busy = true;
  _lastError = null;
  _emitStatus();
  try {
    const snapshot = await provider.read();
    if (!snapshot) return { ok: true, imported: false };
    if (typeof snapshot !== 'object' || !snapshot.schemaVersion) {
      throw new Error('Cloud blob is not a valid PSG Expense snapshot.');
    }
    await Storage.importAll(snapshot);
    await Storage.audit.append({
      action: 'data_imported',
      user:   'cloud-sync',
      desc:   `Loaded snapshot from cloud (${snapshot.exportedAt || 'unknown date'}).`,
    });
    return { ok: true, imported: true };
  } catch (err) {
    _lastError = err.message || String(err);
    return { ok: false, error: err };
  } finally {
    _busy = false;
    _emitStatus();
  }
}

export function addStatusListener(fn) {
  _listeners.add(fn);
  Promise.resolve().then(() => {
    if (_listeners.has(fn)) {
      try { fn(getStatus()); } catch (e) { console.error('sync listener error:', e); }
    }
  });
}

export function removeStatusListener(fn) {
  _listeners.delete(fn);
}

export function getStatus() {
  const provider = getProvider();
  const info     = provider.getStatusInfo();
  return {
    ...info,
    busy:      _busy || info.state === 'busy',
    pending:   Boolean(_debounceTimer),
    lastError: _lastError || info.lastError,
  };
}

async function _shouldAutoSync() {
  const s = await Storage.settings.getAll();
  if (s['cloud.disabled'] === true) return false;
  const provider = getProvider();
  if (!provider.isSignedIn()) return false;
  return s['cloud.autoSync'] !== false;
}

async function _push() {
  if (_pendingPromise) return _pendingPromise;
  _pendingPromise = (async () => {
    _busy = true;
    _lastError = null;
    _emitStatus();
    try {
      const provider = getProvider();
      if (!provider.isSignedIn()) throw new Error('Not signed in to OneDrive.');
      const snapshot = await Storage.exportAll();
      snapshot.cloudSync = {
        pushedAt: new Date().toISOString(),
        pushedBy: provider.getAccount()?.username || 'unknown',
      };
      await provider.write(snapshot);
    } catch (err) {
      _lastError = err.message || String(err);
      throw err;
    } finally {
      _busy = false;
      _pendingPromise = null;
      _emitStatus();
    }
  })();
  return _pendingPromise;
}

function _emitStatus() {
  const status = getStatus();
  for (const fn of _listeners) {
    try { fn(status); } catch (e) { console.error('sync listener error:', e); }
  }
}
