// =============================================================================
// 145 PSG Expense System — Cloud sync (OneDrive + MSAL)
// =============================================================================
// Adapted from QStore IMS v2 cloud.js.
// Uses the Auth module's getAccessToken() instead of managing its own MSAL
// instance, so token refresh and account handling are shared.
// =============================================================================

import * as AUTH    from './auth.js';
import * as Storage from './storage.js';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export class OneDriveProvider {
  constructor() {
    this._folder   = 'PSG-Expense';
    this._filename = 'psg_expense_data.json';
    this._lastError   = null;
    this._lastSync    = null;
    this._lastDownload = null;
    this._busy        = false;
  }

  async init() {
    const s = await Storage.settings.getAll();
    this._folder   = s['cloud.folder']   || 'PSG-Expense';
    this._filename = s['cloud.filename'] || 'psg_expense_data.json';
    this._lastSync = s['cloud.lastSync'] || null;
  }

  async configure({ folder, filename }) {
    if (folder   !== undefined) await Storage.settings.set('cloud.folder',   String(folder).trim()   || 'PSG-Expense');
    if (filename !== undefined) await Storage.settings.set('cloud.filename', String(filename).trim() || 'psg_expense_data.json');
  }

  isSignedIn() {
    return AUTH.isAuthenticated() && !AUTH.getSession()?.pending;
  }

  getAccount() {
    const s = AUTH.getSession();
    return s ? { username: s.email, name: s.name } : null;
  }

  async read() {
    const token = await AUTH.getAccessToken(['Files.ReadWrite']);
    this._busy = true;
    try {
      const metaResp = await fetch(this._graphUrl(''), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (metaResp.status === 404) { this._lastError = null; return null; }
      if (!metaResp.ok) throw new Error(`Cloud read failed: HTTP ${metaResp.status}`);

      const meta  = await metaResp.json();
      const dlUrl = meta['@microsoft.graph.downloadUrl'];
      if (!dlUrl) throw new Error('Cloud read: no download URL in response.');

      const dlResp = await fetch(dlUrl);
      if (!dlResp.ok) throw new Error(`Cloud download failed: HTTP ${dlResp.status}`);

      const data = await dlResp.json();
      this._lastDownload = new Date().toISOString();
      this._lastError    = null;
      return data;
    } catch (err) {
      this._lastError = err.message || String(err);
      throw err;
    } finally {
      this._busy = false;
    }
  }

  async write(snapshot) {
    const token = await AUTH.getAccessToken(['Files.ReadWrite']);
    this._busy = true;
    try {
      const body = JSON.stringify(snapshot);
      const resp = await fetch(this._graphUrl('/content'), {
        method:  'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body,
      });
      if (resp.status === 401) throw new Error('Cloud write failed: token expired. Sign in again.');
      if (!resp.ok)            throw new Error(`Cloud write failed: HTTP ${resp.status}`);

      const ts = new Date().toISOString();
      this._lastSync = ts;
      await Storage.settings.set('cloud.lastSync', ts);
      this._lastError = null;
    } catch (err) {
      this._lastError = err.message || String(err);
      throw err;
    } finally {
      this._busy = false;
    }
  }

  getStatusInfo() {
    const session = AUTH.getSession();
    let state;
    if (this._busy)          state = 'busy';
    else if (this._lastError) state = 'error';
    else if (!session || session.pending) state = 'not-signed-in';
    else                     state = 'signed-in';

    return {
      state,
      provider:     'onedrive',
      folder:       this._folder,
      filename:     this._filename,
      account:      this.getAccount(),
      lastSync:     this._lastSync,
      lastDownload: this._lastDownload,
      lastError:    this._lastError,
    };
  }

  _graphUrl(suffix) {
    const folder  = (this._folder || '').trim().replace(/^\/+|\/+$/g, '');
    const fname   = (this._filename || 'psg_expense_data.json').trim();
    const path    = folder ? `${folder}/${fname}` : fname;
    const encoded = encodeURIComponent(path).replace(/%2F/g, '/');
    return `${GRAPH_BASE}/me/drive/root:/${encoded}:${suffix}`;
  }
}

let _provider = null;

export function getProvider() {
  if (!_provider) _provider = new OneDriveProvider();
  return _provider;
}

export function _setProvider(p) { _provider = p; }
