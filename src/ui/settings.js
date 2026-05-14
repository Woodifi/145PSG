// =============================================================================
// 145 PSG Expense System — Settings (CO only)
// =============================================================================

import * as Storage from '../storage.js';
import * as AUTH    from '../auth.js';
import * as Sync    from '../sync.js';
import { esc, $, render, fmtDate } from './util.js';
import { openModal } from './modal.js';
import { showToast  } from './toast.js';

let _root = null;

export async function mount(rootEl) {
  AUTH.requirePermission('settings');
  _root = rootEl;
  render(_root, '<div class="page-loading">Loading settings…</div>');
  await _render();
  return () => { _root = null; };
}

async function _render() {
  const s    = await Storage.settings.getAll();
  const sync = Sync.getStatus();

  render(_root, `
    <section class="settings">
      <h1 class="settings__title">Settings</h1>

      <!-- Unit Logo -->
      <div class="settings__section">
        <h2 class="settings__section-title">Unit Logo</h2>
        <p class="settings__desc">
          Upload a unit crest or logo to replace the default anchor icon in the header and sign-in screen.
          PNG or JPEG, recommended size 128×128 px or larger square image.
        </p>
        <div class="logo-upload">
          <div class="logo-upload__preview">
            ${s.unitLogo
              ? `<img src="${esc(s.unitLogo)}" alt="Current logo" class="logo-upload__img">`
              : `<div class="logo-upload__placeholder">⚓</div>`
            }
          </div>
          <div class="logo-upload__controls">
            <button type="button" class="btn btn--ghost" data-action="upload-logo">
              ${s.unitLogo ? 'Replace Logo' : 'Upload Logo'}
            </button>
            ${s.unitLogo ? `<button type="button" class="btn btn--ghost btn--danger-outline" data-action="remove-logo">Remove</button>` : ''}
            <input type="file" id="logo-file-input" accept="image/png,image/jpeg,image/gif,image/svg+xml" style="display:none" aria-hidden="true">
            <p class="settings__desc" style="margin:8px 0 0">Max 2 MB. Stored locally and synced with your data backup.</p>
          </div>
        </div>
      </div>

      <!-- Unit / Organisation -->
      <div class="settings__section">
        <h2 class="settings__section-title">Unit Information</h2>
        <form class="form" data-form="unit-form">
          <div class="form__row form__row--2col">
            <label class="form__field">
              <span class="form__label">Unit name</span>
              <input type="text" name="unitName" class="form__input"
                     value="${esc(s.unitName || '145 ACU PSG')}" placeholder="145 ACU PSG">
            </label>
            <label class="form__field">
              <span class="form__label">Unit code</span>
              <input type="text" name="unitCode" class="form__input"
                     value="${esc(s.unitCode || '')}" placeholder="145 ACU">
            </label>
          </div>
          <div class="form__row form__row--2col">
            <label class="form__field">
              <span class="form__label">CO name &amp; rank</span>
              <input type="text" name="coName" class="form__input"
                     value="${esc(s.coName || '')}" placeholder="MAJ Jane Smith">
            </label>
            <label class="form__field">
              <span class="form__label">PSG Treasurer email</span>
              <input type="email" name="treasurerEmail" class="form__input"
                     value="${esc(s.treasurerEmail || '')}" placeholder="treasurer@example.com">
            </label>
          </div>
          <div class="form__row form__row--2col">
            <label class="form__field">
              <span class="form__label">ABN (optional)</span>
              <input type="text" name="abn" class="form__input"
                     value="${esc(s.abn || '')}" placeholder="12 345 678 901">
            </label>
            <label class="form__field">
              <span class="form__label">ATO entity type</span>
              <select name="atoEntityType" class="form__select">
                <option value="" ${!s.atoEntityType ? 'selected' : ''}>Not specified</option>
                <option value="non-profit" ${s.atoEntityType === 'non-profit' ? 'selected' : ''}>Non-profit organisation</option>
                <option value="company"    ${s.atoEntityType === 'company'    ? 'selected' : ''}>Company</option>
                <option value="individual" ${s.atoEntityType === 'individual' ? 'selected' : ''}>Individual / Sole trader</option>
              </select>
            </label>
          </div>
          <div class="form__actions">
            <button type="submit" class="btn btn--primary">Save Unit Info</button>
          </div>
        </form>
      </div>

      <!-- Azure AD / MSAL -->
      <div class="settings__section">
        <h2 class="settings__section-title">Microsoft / Azure AD</h2>
        <p class="settings__desc">
          Required for Microsoft sign-in. Create an App Registration in
          <a href="https://portal.azure.com" target="_blank" rel="noopener">Azure Portal</a>
          and register this page's URL as a Single-Page Application redirect URI.
        </p>
        <form class="form" data-form="azure-form">
          <div class="form__row form__row--2col">
            <label class="form__field">
              <span class="form__label">Client ID (Application ID)</span>
              <input type="text" name="clientId" class="form__input"
                     value="${esc(s['azure.clientId'] || '')}"
                     placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" spellcheck="false">
            </label>
            <label class="form__field">
              <span class="form__label">Tenant ID (leave blank for any Microsoft account)</span>
              <input type="text" name="tenantId" class="form__input"
                     value="${esc(s['azure.tenantId'] || 'common')}"
                     placeholder="common" spellcheck="false">
            </label>
          </div>
          <div class="form__hint">
            Current redirect URI: <code>${esc(_getRedirectUri())}</code>
            — add this exact value in Azure Portal → App Registration → Authentication → Single-page application.
          </div>
          <div class="form__actions">
            <button type="submit" class="btn btn--primary">Save &amp; Reload</button>
          </div>
        </form>
      </div>

      <!-- Cloud sync (OneDrive) -->
      <div class="settings__section">
        <h2 class="settings__section-title">Cloud Sync (OneDrive)</h2>
        <div class="settings__sync-status settings__sync-status--${esc(sync.state)}">
          ${_syncStatusHtml(sync)}
        </div>
        <form class="form" data-form="cloud-form">
          <div class="form__row form__row--2col">
            <label class="form__field">
              <span class="form__label">OneDrive folder</span>
              <input type="text" name="folder" class="form__input"
                     value="${esc(s['cloud.folder'] || 'PSG-Expense')}" placeholder="PSG-Expense">
            </label>
            <label class="form__field">
              <span class="form__label">Filename</span>
              <input type="text" name="filename" class="form__input"
                     value="${esc(s['cloud.filename'] || 'psg_expense_data.json')}"
                     placeholder="psg_expense_data.json">
            </label>
          </div>
          <label class="form__check">
            <input type="checkbox" name="autoSync" ${s['cloud.autoSync'] !== false ? 'checked' : ''}>
            Auto-sync after every change (5-second debounce)
          </label>
          <div class="form__actions">
            <button type="submit" class="btn btn--primary">Save Cloud Config</button>
            <button type="button" class="btn btn--ghost" data-action="sync-now">Sync Now</button>
            <button type="button" class="btn btn--ghost btn--danger-outline" data-action="load-from-cloud">
              Restore from Cloud
            </button>
          </div>
        </form>
      </div>

      <!-- Data management -->
      <div class="settings__section">
        <h2 class="settings__section-title">Data Management</h2>
        <div class="settings__data-actions">
          <div class="settings__data-action">
            <div>
              <strong>Export Backup</strong>
              <p class="settings__data-desc">Download a complete backup of all data as JSON.</p>
            </div>
            <button type="button" class="btn btn--ghost" data-action="export-backup">Export</button>
          </div>
          <div class="settings__data-action">
            <div>
              <strong>Import Backup</strong>
              <p class="settings__data-desc">Restore from a previously exported backup file. Overwrites all current data.</p>
            </div>
            <button type="button" class="btn btn--ghost" data-action="import-backup">Import</button>
          </div>
          <div class="settings__data-action settings__data-action--danger">
            <div>
              <strong>Wipe Expense Data</strong>
              <p class="settings__data-desc">Delete all expense claims and audit records. Members are preserved.</p>
            </div>
            <button type="button" class="btn btn--danger" data-action="wipe-data">Wipe Data</button>
          </div>
        </div>
      </div>
    </section>
  `);

  _wireEvents();
}

function _syncStatusHtml(sync) {
  const icons = { 'signed-in': '✓', busy: '⟳', error: '⚠', 'not-signed-in': '○', unconfigured: '○' };
  const icon  = icons[sync.state] || '?';
  const msgs  = {
    'signed-in':     sync.lastSync ? `Last synced ${fmtDate(sync.lastSync)}` : 'Ready — not yet synced',
    busy:            'Syncing…',
    error:           `Sync error: ${sync.lastError || 'unknown'}`,
    'not-signed-in': 'Sign in with Microsoft to enable sync',
    unconfigured:    'Azure AD not configured',
  };
  return `
    <span class="settings__sync-icon">${icon}</span>
    <span>${esc(msgs[sync.state] || sync.state)}</span>
    ${sync.account ? `<span class="settings__sync-account">${esc(sync.account.username)}</span>` : ''}
  `;
}

function _wireEvents() {
  if (!_root) return;

  // Logo upload
  const logoInput = _root.querySelector('#logo-file-input');
  _root.querySelector('[data-action="upload-logo"]')?.addEventListener('click', () => logoInput?.click());
  logoInput?.addEventListener('change', async () => {
    const file = logoInput.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { showToast('Logo must be under 2 MB.', 'warn'); return; }
    const dataUrl = await _fileToDataUrl(file);
    await Storage.settings.set('unitLogo', dataUrl);
    await Storage.audit.append({ action: 'settings_update', user: AUTH.getSession()?.name || '', desc: 'Unit logo updated.' });
    Sync.notifyChanged();
    showToast('Logo saved.', 'success');
    _render();
  });

  _root.querySelector('[data-action="remove-logo"]')?.addEventListener('click', async () => {
    await Storage.settings.delete('unitLogo');
    await Storage.audit.append({ action: 'settings_update', user: AUTH.getSession()?.name || '', desc: 'Unit logo removed.' });
    Sync.notifyChanged();
    showToast('Logo removed.', 'success');
    _render();
  });

  // Unit form
  _root.querySelector('[data-form="unit-form"]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await Storage.settings.setMany({
      unitName:      (fd.get('unitName') || '').trim(),
      unitCode:      (fd.get('unitCode') || '').trim(),
      coName:        (fd.get('coName') || '').trim(),
      treasurerEmail:(fd.get('treasurerEmail') || '').trim(),
      abn:           (fd.get('abn') || '').trim(),
      atoEntityType: fd.get('atoEntityType') || '',
    });
    await Storage.audit.append({ action: 'settings_update', user: AUTH.getSession()?.name || '', desc: 'Unit info updated.' });
    Sync.notifyChanged();
    showToast('Unit info saved.', 'success');
  });

  // Azure form
  _root.querySelector('[data-form="azure-form"]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await Storage.settings.setMany({
      'azure.clientId': (fd.get('clientId') || '').trim(),
      'azure.tenantId': (fd.get('tenantId') || 'common').trim() || 'common',
    });
    showToast('Azure AD settings saved. Reloading…', 'success');
    setTimeout(() => window.location.reload(), 1000);
  });

  // Cloud form
  _root.querySelector('[data-form="cloud-form"]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    await Storage.settings.setMany({
      'cloud.folder':    (fd.get('folder')   || 'PSG-Expense').trim(),
      'cloud.filename':  (fd.get('filename') || 'psg_expense_data.json').trim(),
      'cloud.autoSync':  Boolean(fd.get('autoSync')),
    });
    await Sync.init();
    showToast('Cloud config saved.', 'success');
    _render();
  });

  _root.querySelector('[data-action="sync-now"]')?.addEventListener('click', async () => {
    try { await Sync.syncNow(); showToast('Sync complete.', 'success'); }
    catch (err) { showToast('Sync failed: ' + (err.message || String(err)), 'error'); }
    _render();
  });

  _root.querySelector('[data-action="load-from-cloud"]')?.addEventListener('click', () => {
    openModal({
      titleHtml: 'Restore from Cloud',
      size: 'sm',
      bodyHtml: `
        <p><strong>Warning:</strong> This will overwrite ALL local data with the cloud backup. This cannot be undone.</p>
        <div class="form__actions">
          <button type="button" class="btn btn--ghost" data-action="modal-close">Cancel</button>
          <button type="button" class="btn btn--danger" data-action="confirm-restore">Restore</button>
        </div>
      `,
      onMount(panel, close) {
        panel.querySelector('[data-action="confirm-restore"]')?.addEventListener('click', async () => {
          close();
          const result = await Sync.loadFromCloud();
          if (result.ok) {
            showToast(result.imported ? 'Data restored from cloud.' : 'Cloud backup is empty.', result.imported ? 'success' : 'warn');
          } else {
            showToast('Restore failed: ' + (result.error?.message || 'unknown'), 'error');
          }
        });
      },
    });
  });

  _root.querySelector('[data-action="export-backup"]')?.addEventListener('click', async () => {
    const snapshot = await Storage.exportAll();
    const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `psg-expense-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    await Storage.audit.append({ action: 'data_export', user: AUTH.getSession()?.name || '', desc: 'Backup exported.' });
    showToast('Backup exported.', 'success');
  });

  _root.querySelector('[data-action="import-backup"]')?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type  = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      if (!input.files?.[0]) return;
      try {
        const text     = await input.files[0].text();
        const snapshot = JSON.parse(text);
        await Storage.importAll(snapshot);
        showToast('Backup restored. Reloading…', 'success');
        setTimeout(() => window.location.reload(), 1200);
      } catch (err) {
        showToast('Import failed: ' + (err.message || String(err)), 'error');
      }
    });
    input.click();
  });

  _root.querySelector('[data-action="wipe-data"]')?.addEventListener('click', () => {
    openModal({
      titleHtml: 'Wipe expense data',
      size: 'sm',
      bodyHtml: `
        <p><strong>This deletes all expense claims, receipts, and audit records.</strong>
           Members and settings are preserved. This cannot be undone.</p>
        <p>Type <strong>WIPE</strong> to confirm.</p>
        <input type="text" class="form__input" id="wipe-confirm" placeholder="WIPE" autocomplete="off">
        <div class="form__actions">
          <button type="button" class="btn btn--ghost" data-action="modal-close">Cancel</button>
          <button type="button" class="btn btn--danger" data-action="confirm-wipe">Wipe Data</button>
        </div>
      `,
      onMount(panel, close) {
        panel.querySelector('[data-action="confirm-wipe"]')?.addEventListener('click', async () => {
          const val = panel.querySelector('#wipe-confirm')?.value || '';
          if (val.trim().toUpperCase() !== 'WIPE') {
            showToast('Type WIPE to confirm.', 'warn');
            return;
          }
          await Storage.wipe({ keepMeta: true, keepMembers: true });
          await Storage.audit.append({ action: 'data_wipe', user: AUTH.getSession()?.name || '', desc: 'Expense data wiped by CO.' });
          showToast('Data wiped.', 'warn');
          close();
        });
      },
    });
  });
}

function _getRedirectUri() {
  const uri = window.location.origin + window.location.pathname;
  return uri.endsWith('/') ? uri.slice(0, -1) : uri;
}

function _fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}
