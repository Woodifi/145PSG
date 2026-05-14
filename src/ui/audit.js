// =============================================================================
// 145 PSG Expense System — Audit log viewer
// =============================================================================
// Adapted from QStore IMS v2 audit.js — action labels updated for expense system.
// CO and Admin access only.
// =============================================================================

import * as Storage from '../storage.js';
import * as AUTH    from '../auth.js';
import { esc, $, render, fmtDate } from './util.js';

const PAGE_SIZE = 200;

const ACTION_LABELS = Object.freeze({
  expense_submit:   'Claim submitted',
  expense_approved: 'Claim approved',
  expense_rejected: 'Claim rejected',
  expense_paid:     'Claim marked paid',
  expense_delete:   'Claim deleted',
  member_add:       'Member added',
  member_update:    'Member updated',
  member_delete:    'Member deleted',
  member_deactivate:'Member deactivated',
  login:            'Login',
  logout:           'Logout',
  data_export:      'Backup exported',
  data_imported:    'Backup restored',
  settings_update:  'Settings updated',
  cloud_sync:       'Cloud sync',
});

const ACTION_CATEGORY = Object.freeze({
  expense_submit:   'mutation',
  expense_approved: 'success',
  expense_rejected: 'failure',
  expense_paid:     'success',
  expense_delete:   'failure',
  member_add:       'mutation',
  member_update:    'mutation',
  member_delete:    'failure',
  member_deactivate:'failure',
  login:            'auth',
  logout:           'auth',
  data_export:      'mutation',
  data_imported:    'mutation',
  settings_update:  'mutation',
  cloud_sync:       'mutation',
});

let _root        = null;
let _filter      = 'all';
let _search      = '';
let _renderLimit = PAGE_SIZE;
let _verifyState = null;

export async function mount(rootEl) {
  AUTH.requirePermission('audit');
  _root        = rootEl;
  _filter      = 'all';
  _search      = '';
  _renderLimit = PAGE_SIZE;
  _verifyState = null;
  await _render();
  return () => { _root = null; };
}

async function _render() {
  const allRows = await Storage.audit.list({ order: 'desc' });
  const totalCount = allRows.length;

  const distinctActions = [...new Set(allRows.map(r => r.action))]
    .sort((a, b) => (ACTION_LABELS[a] || a).localeCompare(ACTION_LABELS[b] || b));

  let filtered = allRows;
  if (_filter !== 'all') filtered = filtered.filter(r => r.action === _filter);
  if (_search) {
    const q = _search.toLowerCase();
    filtered = filtered.filter(r =>
      (r.desc   || '').toLowerCase().includes(q) ||
      (r.user   || '').toLowerCase().includes(q) ||
      (r.action || '').toLowerCase().includes(q));
  }

  const filteredLen = filtered.length;
  const visible     = filtered.slice(0, _renderLimit);

  render(_root, `
    <section class="aud">
      <h1 class="aud__title">Audit Log</h1>

      <header class="aud__toolbar">
        <div class="aud__filters">
          <input type="search" class="aud__search form__input"
                 placeholder="Search description, user, or action…"
                 aria-label="Search audit log"
                 value="${esc(_search)}">
          <select class="form__select aud__action-filter" aria-label="Filter by action">
            <option value="all" ${_filter === 'all' ? 'selected' : ''}>All actions</option>
            ${distinctActions.map(a => `
              <option value="${esc(a)}" ${a === _filter ? 'selected' : ''}>${esc(ACTION_LABELS[a] || a)}</option>
            `).join('')}
          </select>
        </div>
        <div class="aud__actions">
          <button type="button" class="btn btn--ghost" data-action="verify-chain">
            Verify chain integrity
          </button>
          <button type="button" class="btn btn--ghost btn--sm" data-action="export-audit">
            Export CSV
          </button>
        </div>
      </header>

      ${_verifyBlockHtml(_verifyState)}

      <div class="aud__meta">
        ${filteredLen} ${filteredLen === 1 ? 'entry' : 'entries'} match
        ${(_filter !== 'all' || _search) && totalCount !== filteredLen
          ? `<span class="aud__meta-of"> of ${totalCount} total</span>` : ''}
      </div>

      <div class="aud__table-wrap">
        ${filteredLen === 0
          ? `<div class="aud__empty"><p>No audit entries match the current filters.</p></div>`
          : _tableHtml(visible)}
      </div>

      ${visible.length < filteredLen ? `
        <div class="aud__loadmore">
          <button type="button" class="btn btn--ghost" data-action="load-more">
            Load ${Math.min(PAGE_SIZE, filteredLen - visible.length)} more
            <span class="aud__loadmore-meta">(${visible.length} of ${filteredLen} shown)</span>
          </button>
        </div>
      ` : ''}
    </section>
  `);

  _wireEvents(allRows);
}

function _verifyBlockHtml(state) {
  if (!state) return '';
  if (state.ok) {
    return `
      <div class="aud__verify aud__verify--ok">
        <strong>Chain verified.</strong> All ${state.count} entries are intact.
      </div>`;
  }
  return `
    <div class="aud__verify aud__verify--bad">
      <strong>Chain integrity broken</strong> at sequence #${state.brokenAt} — ${esc(state.reason)}.
    </div>`;
}

function _tableHtml(rows) {
  return `
    <table class="aud__table">
      <thead>
        <tr>
          <th class="aud__col-seq">#</th>
          <th class="aud__col-time">When</th>
          <th class="aud__col-action">Action</th>
          <th class="aud__col-user">User</th>
          <th class="aud__col-desc">Description</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(_rowHtml).join('')}
      </tbody>
    </table>
  `;
}

function _rowHtml(row) {
  const label  = ACTION_LABELS[row.action] || row.action;
  const cat    = ACTION_CATEGORY[row.action] || 'other';
  const broken = _verifyState && !_verifyState.ok && row.seq >= _verifyState.brokenAt;
  return `
    <tr class="aud__row ${broken ? 'aud__row--broken' : ''}">
      <td class="aud__seq">${row.seq}</td>
      <td class="aud__time">${esc(fmtDate(row.ts))}</td>
      <td class="aud__action">
        <span class="aud__badge aud__badge--${esc(cat)}">${esc(label)}</span>
      </td>
      <td class="aud__user">${esc(row.user || '')}</td>
      <td class="aud__desc">${esc(row.desc || '')}</td>
    </tr>
  `;
}

function _wireEvents(allRows) {
  if (!_root) return;

  _root.querySelector('.aud__search')?.addEventListener('input', (e) => {
    _search = e.target.value;
    _renderLimit = PAGE_SIZE;
    _render();
  });

  _root.querySelector('.aud__action-filter')?.addEventListener('change', (e) => {
    _filter = e.target.value;
    _renderLimit = PAGE_SIZE;
    _render();
  });

  _root.querySelector('[data-action="verify-chain"]')?.addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Verifying…';
    try {
      _verifyState = await Storage.audit.verify();
    } catch (err) {
      _verifyState = { ok: false, brokenAt: 0, reason: err.message, count: 0 };
    }
    await _render();
  });

  _root.querySelector('[data-action="load-more"]')?.addEventListener('click', () => {
    _renderLimit += PAGE_SIZE;
    _render();
  });

  _root.querySelector('[data-action="export-audit"]')?.addEventListener('click', () => {
    _exportAuditCSV(allRows);
  });
}

function _exportAuditCSV(rows) {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  const headers = ['#', 'Timestamp', 'Action', 'User', 'Description'];
  const csv = [headers, ...sorted.map(r => [r.seq, r.ts, r.action, r.user, r.desc])]
    .map(row => row.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `psg-audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
