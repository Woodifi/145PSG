// =============================================================================
// 145 PSG Expense System — Dashboard
// =============================================================================
// Summarises expense claim status. Members see only their own. Admins/CO see all.
// =============================================================================

import * as Storage   from '../storage.js';
import * as AUTH      from '../auth.js';
import { CATEGORIES, fmtAUD, financialYear } from '../categories.js';
import { esc, $, render, fmtDate, fmtDateOnly } from './util.js';

let _root = null;

export async function mount(rootEl) {
  _root = rootEl;
  render(_root, '<div class="page-loading">Loading dashboard…</div>');
  await _render();
  return () => { _root = null; };
}

async function _render() {
  const session  = AUTH.getSession();
  const isAdmin  = AUTH.isAdmin();
  const allExp   = await Storage.expenses.list();

  const myExp    = isAdmin ? allExp : allExp.filter(e => e.submittedBy === session.email);
  const pending  = myExp.filter(e => e.status === 'pending');
  const approved = myExp.filter(e => e.status === 'approved');
  const paid     = myExp.filter(e => e.status === 'paid');
  const rejected = myExp.filter(e => e.status === 'rejected');

  const fy       = financialYear();
  const fyExp    = myExp.filter(e => e.fy === fy);
  const fyTotal  = fyExp.reduce((s, e) => s + (e.amountCents || 0), 0);
  const fyPaid   = fyExp.filter(e => e.status === 'paid').reduce((s, e) => s + (e.amountCents || 0), 0);

  // Admin: overdue = approved but not paid > 14 days
  const now       = Date.now();
  const overdue   = isAdmin
    ? allExp.filter(e => e.status === 'approved' && e.reviewedAt && (now - new Date(e.reviewedAt).getTime()) > 14 * 86400000)
    : [];

  // Recent activity — last 10 across status changes
  const recent = [...myExp]
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
    .slice(0, 10);

  render(_root, `
    <section class="dash">
      <h1 class="dash__title">
        Dashboard
        <span class="dash__fy">FY ${esc(fy)}</span>
      </h1>

      <div class="dash__cards">
        <div class="dash__card dash__card--pending">
          <div class="dash__card-value">${pending.length}</div>
          <div class="dash__card-label">Pending</div>
        </div>
        <div class="dash__card dash__card--approved">
          <div class="dash__card-value">${approved.length}</div>
          <div class="dash__card-label">Approved</div>
        </div>
        <div class="dash__card dash__card--paid">
          <div class="dash__card-value">${paid.length}</div>
          <div class="dash__card-label">Paid</div>
        </div>
        <div class="dash__card dash__card--rejected">
          <div class="dash__card-value">${rejected.length}</div>
          <div class="dash__card-label">Rejected</div>
        </div>
        ${isAdmin && overdue.length > 0 ? `
        <div class="dash__card dash__card--overdue">
          <div class="dash__card-value">${overdue.length}</div>
          <div class="dash__card-label">Overdue (&gt;14 days)</div>
        </div>
        ` : ''}
      </div>

      <div class="dash__totals">
        <div class="dash__total-row">
          <span class="dash__total-label">FY ${esc(fy)} total submitted</span>
          <span class="dash__total-value">${esc(fmtAUD(fyTotal))}</span>
        </div>
        <div class="dash__total-row">
          <span class="dash__total-label">FY ${esc(fy)} total paid</span>
          <span class="dash__total-value dash__total-value--paid">${esc(fmtAUD(fyPaid))}</span>
        </div>
      </div>

      <div class="dash__section">
        <h2 class="dash__section-title">Recent Claims</h2>
        ${recent.length === 0
          ? `<p class="dash__empty">No expense claims yet. <button type="button" class="link-btn" data-page="new-expense">Submit your first claim.</button></p>`
          : `<div class="dash__recent">
              ${recent.map(_recentRowHtml).join('')}
            </div>`
        }
      </div>

      ${isAdmin && pending.length > 0 ? `
      <div class="dash__section">
        <h2 class="dash__section-title">
          Pending Approval
          <span class="dash__badge-count">${pending.length}</span>
        </h2>
        <div class="dash__recent">
          ${pending.map(_recentRowHtml).join('')}
        </div>
      </div>
      ` : ''}
    </section>
  `);

  _root.addEventListener('click', _onClick);
}

function _recentRowHtml(exp) {
  const statusClass = {
    pending:  'status--pending',
    approved: 'status--approved',
    paid:     'status--paid',
    rejected: 'status--rejected',
  }[exp.status] || '';

  return `
    <div class="dash__recent-row" data-action="open-expense" data-id="${esc(exp.id)}">
      <div class="dash__recent-ref">${esc(exp.ref || '—')}</div>
      <div class="dash__recent-info">
        <div class="dash__recent-desc">${esc(exp.description || '—')}</div>
        <div class="dash__recent-meta">${esc(exp.submitterName || exp.submittedBy)} &middot; ${esc(fmtDateOnly(exp.submittedAt))}</div>
      </div>
      <div class="dash__recent-amount">${esc(fmtAUD(exp.amountCents))}</div>
      <div class="status-badge ${esc(statusClass)}">${esc(exp.status)}</div>
    </div>
  `;
}

function _onClick(e) {
  const btn = e.target.closest('[data-page]');
  if (btn) {
    // Emit a custom event for the shell to catch and navigate
    _root.dispatchEvent(new CustomEvent('navigate', { bubbles: true, detail: { page: btn.dataset.page } }));
    return;
  }
  const row = e.target.closest('[data-action="open-expense"]');
  if (row) {
    _root.dispatchEvent(new CustomEvent('navigate', { bubbles: true, detail: { page: 'expense-detail', id: row.dataset.id } }));
  }
}
