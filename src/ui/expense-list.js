// =============================================================================
// 145 PSG Expense System — Expense list (admin/member view)
// =============================================================================
// Members see only their own claims. Admins/CO see all with filters.
// =============================================================================

import * as Storage from '../storage.js';
import * as AUTH    from '../auth.js';
import { CATEGORIES, fmtAUD, categoryLabel, financialYear, availableFinancialYears } from '../categories.js';
import { esc, $, $$, render, fmtDate, fmtDateOnly } from './util.js';

let _root        = null;
let _filters     = { status: 'all', category: 'all', fy: financialYear(), search: '' };
let _viewMode    = 'own'; // 'own' | 'all'

export async function mount(rootEl, opts = {}) {
  _root     = rootEl;
  _viewMode = AUTH.isAdmin() ? (opts.viewMode || 'all') : 'own';
  _filters  = { status: 'all', category: 'all', fy: financialYear(), search: '' };
  render(_root, '<div class="page-loading">Loading expenses…</div>');
  await _render();
  return () => { _root = null; };
}

async function _render() {
  const session   = AUTH.getSession();
  const isAdmin   = AUTH.isAdmin();
  const allExp    = await Storage.expenses.list();

  let rows = _viewMode === 'own'
    ? allExp.filter(e => e.submittedBy === session.email)
    : allExp;

  // Apply filters
  if (_filters.status !== 'all') rows = rows.filter(e => e.status === _filters.status);
  if (_filters.category !== 'all') rows = rows.filter(e => e.category === _filters.category);
  if (_filters.fy !== 'all') rows = rows.filter(e => e.fy === _filters.fy);
  if (_filters.search) {
    const q = _filters.search.toLowerCase();
    rows = rows.filter(e =>
      (e.ref          || '').toLowerCase().includes(q) ||
      (e.description  || '').toLowerCase().includes(q) ||
      (e.submitterName|| '').toLowerCase().includes(q) ||
      (e.submittedBy  || '').toLowerCase().includes(q));
  }

  rows.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));

  const totalAmount = rows.reduce((s, e) => s + (e.amountCents || 0), 0);
  const fyYears     = availableFinancialYears();

  const statusCounts = {};
  for (const e of (_viewMode === 'own' ? allExp.filter(x => x.submittedBy === session.email) : allExp)) {
    statusCounts[e.status] = (statusCounts[e.status] || 0) + 1;
  }

  render(_root, `
    <section class="exp-list">
      <div class="exp-list__header">
        <h1 class="exp-list__title">
          ${_viewMode === 'own' ? 'My Claims' : 'All Claims'}
        </h1>
        <div class="exp-list__header-actions">
          ${isAdmin && _viewMode === 'own'
            ? `<button type="button" class="btn btn--ghost btn--sm" data-action="view-all">View All</button>`
            : isAdmin && _viewMode === 'all'
            ? `<button type="button" class="btn btn--ghost btn--sm" data-action="view-own">My Claims</button>`
            : ''}
          <button type="button" class="btn btn--primary btn--sm" data-action="new-expense">+ New Claim</button>
        </div>
      </div>

      <div class="exp-list__filters">
        <input type="search" class="form__input exp-list__search"
               placeholder="Search ref, description, submitter…"
               value="${esc(_filters.search)}" aria-label="Search expenses">

        <select class="form__select" data-filter="status" aria-label="Filter by status">
          <option value="all" ${_filters.status === 'all' ? 'selected' : ''}>All statuses</option>
          <option value="pending"  ${_filters.status === 'pending'  ? 'selected' : ''}>Pending (${statusCounts.pending  || 0})</option>
          <option value="approved" ${_filters.status === 'approved' ? 'selected' : ''}>Approved (${statusCounts.approved || 0})</option>
          <option value="paid"     ${_filters.status === 'paid'     ? 'selected' : ''}>Paid (${statusCounts.paid     || 0})</option>
          <option value="rejected" ${_filters.status === 'rejected' ? 'selected' : ''}>Rejected (${statusCounts.rejected || 0})</option>
        </select>

        <select class="form__select" data-filter="category" aria-label="Filter by category">
          <option value="all" ${_filters.category === 'all' ? 'selected' : ''}>All categories</option>
          ${CATEGORIES.map(c => `
            <option value="${esc(c.id)}" ${_filters.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>
          `).join('')}
        </select>

        <select class="form__select" data-filter="fy" aria-label="Filter by financial year">
          <option value="all" ${_filters.fy === 'all' ? 'selected' : ''}>All years</option>
          ${fyYears.map(fy => `
            <option value="${esc(fy)}" ${_filters.fy === fy ? 'selected' : ''}>FY ${esc(fy)}</option>
          `).join('')}
        </select>
      </div>

      <div class="exp-list__summary">
        <span>${rows.length} claim${rows.length !== 1 ? 's' : ''}</span>
        <span class="exp-list__summary-total">Total: ${esc(fmtAUD(totalAmount))}</span>
      </div>

      ${rows.length === 0
        ? `<div class="exp-list__empty">
            <p>No claims match the current filters.</p>
            <button type="button" class="btn btn--primary" data-action="new-expense">Submit a claim</button>
           </div>`
        : `<div class="exp-list__table-wrap">
            <table class="exp-table">
              <thead>
                <tr>
                  <th>Ref</th>
                  <th>Date</th>
                  ${_viewMode === 'all' ? '<th>Submitter</th>' : ''}
                  <th>Category</th>
                  <th>Description</th>
                  <th class="num">Amount</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${rows.map(e => _rowHtml(e, _viewMode === 'all')).join('')}
              </tbody>
            </table>
           </div>`
      }
    </section>
  `);

  _wireEvents();
}

function _rowHtml(exp, showSubmitter) {
  const statusClass = {
    pending:  'status--pending',
    approved: 'status--approved',
    paid:     'status--paid',
    rejected: 'status--rejected',
  }[exp.status] || '';

  return `
    <tr class="exp-table__row" data-id="${esc(exp.id)}">
      <td class="exp-table__ref">${esc(exp.ref || '—')}</td>
      <td class="exp-table__date">${esc(fmtDateOnly(exp.expenseDate || exp.submittedAt))}</td>
      ${showSubmitter ? `<td class="exp-table__submitter">${esc(exp.submitterName || exp.submittedBy)}</td>` : ''}
      <td class="exp-table__cat">${esc(categoryLabel(exp.category))}</td>
      <td class="exp-table__desc">${esc(exp.description)}</td>
      <td class="exp-table__amount num">${esc(fmtAUD(exp.amountCents))}</td>
      <td><span class="status-badge ${esc(statusClass)}">${esc(exp.status)}</span></td>
      <td><button type="button" class="btn btn--ghost btn--xs" data-action="view" data-id="${esc(exp.id)}">View</button></td>
    </tr>
  `;
}

function _wireEvents() {
  if (!_root) return;

  // Search
  _root.querySelector('.exp-list__search')?.addEventListener('input', (e) => {
    _filters.search = e.target.value;
    _render();
  });

  // Filter selects
  $$('[data-filter]', _root).forEach(sel => {
    sel.addEventListener('change', (e) => {
      _filters[e.target.dataset.filter] = e.target.value;
      _render();
    });
  });

  // Row click
  _root.querySelector('.exp-list__table-wrap')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action="view"]');
    const row = e.target.closest('[data-id]');
    const id  = btn?.dataset.id || row?.dataset.id;
    if (id) {
      _root.dispatchEvent(new CustomEvent('navigate', { bubbles: true, detail: { page: 'expense-detail', id } }));
    }
  });

  _root.querySelector('[data-action="new-expense"]')?.addEventListener('click', () => {
    _root.dispatchEvent(new CustomEvent('navigate', { bubbles: true, detail: { page: 'new-expense' } }));
  });

  _root.querySelector('[data-action="view-all"]')?.addEventListener('click', () => {
    _viewMode = 'all';
    _render();
  });
  _root.querySelector('[data-action="view-own"]')?.addEventListener('click', () => {
    _viewMode = 'own';
    _render();
  });
}
