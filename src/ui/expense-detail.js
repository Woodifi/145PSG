// =============================================================================
// 145 PSG Expense System — Expense detail / review page
// =============================================================================
// Members: read-only view of their own claim with status history.
// Admins:  approve / reject / mark paid + add notes.
// CO:      all admin actions + delete.
// =============================================================================

import * as Storage from '../storage.js';
import * as AUTH    from '../auth.js';
import * as Sync    from '../sync.js';
import { categoryLabel, fmtAUD, gstAmount } from '../categories.js';
import { esc, $, render, fmtDate, fmtDateOnly } from './util.js';
import { openModal } from './modal.js';
import { showToast  } from './toast.js';

let _root      = null;
let _expenseId = null;
let _urlPool   = [];  // object URLs to revoke on unmount

export async function mount(rootEl, { id } = {}) {
  _root      = rootEl;
  _expenseId = id;
  _urlPool   = [];
  render(_root, '<div class="page-loading">Loading…</div>');
  await _render();
  return () => {
    for (const u of _urlPool) try { URL.revokeObjectURL(u); } catch { /* ignore */ }
    _root = null;
  };
}

async function _render() {
  if (!_expenseId) {
    render(_root, '<div class="fatal"><p>No expense ID specified.</p></div>');
    return;
  }

  const exp     = await Storage.expenses.get(_expenseId);
  if (!exp) {
    render(_root, '<div class="fatal"><p>Expense not found.</p></div>');
    return;
  }

  const session  = AUTH.getSession();
  const isAdmin  = AUTH.isAdmin();
  const isCO     = AUTH.isCO();
  const isOwner  = exp.submittedBy === session.email;

  if (!isOwner && !isAdmin) {
    render(_root, '<div class="fatal"><p>Access denied.</p></div>');
    return;
  }

  const canViewBank = AUTH.can('viewBankDetails');
  const cat         = categoryLabel(exp.category);
  const gst         = exp.gstAmountCents || gstAmount(exp.amountCents, exp.gstIncluded, exp.category);
  const statusClass = {
    pending:  'status--pending',
    approved: 'status--approved',
    paid:     'status--paid',
    rejected: 'status--rejected',
  }[exp.status] || '';

  const payLabels = { eft: 'EFT / Bank Transfer', cash: 'Cash', cheque: 'Cheque', direct: 'Direct Supplier Payment' };

  // Resolve receipt names
  const receiptItems = [];
  for (const rid of (exp.receiptIds || [])) {
    const r = await Storage.receipts.get(rid);
    if (r) receiptItems.push({ id: rid, filename: r.filename, blob: r.blob, contentType: r.contentType });
  }

  // Generate preview URLs
  for (const item of receiptItems) {
    if (item.blob) {
      item.url = URL.createObjectURL(item.blob);
      _urlPool.push(item.url);
    }
  }

  render(_root, `
    <section class="exp-detail">
      <div class="exp-detail__header">
        <button type="button" class="btn btn--ghost btn--sm" data-action="back">← Back</button>
        <div class="exp-detail__title-wrap">
          <h1 class="exp-detail__ref">${esc(exp.ref || '—')}</h1>
          <span class="status-badge ${esc(statusClass)}">${esc(exp.status)}</span>
        </div>
        ${isCO ? `<button type="button" class="btn btn--danger btn--sm" data-action="delete">Delete</button>` : ''}
      </div>

      <div class="exp-detail__body">
        <div class="exp-detail__section">
          <h2 class="exp-detail__section-title">Submitter</h2>
          <dl class="review__dl">
            <dt>Name</dt><dd>${esc(exp.submitterName || exp.submittedBy)}</dd>
            <dt>Email</dt><dd>${esc(exp.submittedBy)}</dd>
            ${exp.submitterPhone ? `<dt>Phone</dt><dd>${esc(exp.submitterPhone)}</dd>` : ''}
            <dt>Submitted</dt><dd>${esc(fmtDate(exp.submittedAt))}</dd>
          </dl>
        </div>

        <div class="exp-detail__section">
          <h2 class="exp-detail__section-title">Expense</h2>
          <dl class="review__dl">
            <dt>Category</dt><dd>${esc(cat)}</dd>
            <dt>Description</dt><dd>${esc(exp.description)}</dd>
            <dt>Date</dt><dd>${esc(fmtDateOnly(exp.expenseDate))}</dd>
            <dt>Amount</dt><dd><strong>${esc(fmtAUD(exp.amountCents))}</strong></dd>
            ${gst > 0 ? `<dt>GST (incl.)</dt><dd>${esc(fmtAUD(gst))}</dd>` : ''}
            ${exp.fbtApplicable ? `<dt>FBT</dt><dd>Applicable</dd>` : ''}
            <dt>Financial year</dt><dd>FY ${esc(exp.fy || '—')}</dd>
            <dt>Quarter</dt><dd>Q${esc(exp.quarter || '—')}</dd>
            ${exp.notes ? `<dt>Notes</dt><dd>${esc(exp.notes)}</dd>` : ''}
          </dl>
        </div>

        <div class="exp-detail__section">
          <h2 class="exp-detail__section-title">Payment</h2>
          <dl class="review__dl">
            <dt>Method</dt><dd>${esc(payLabels[exp.paymentMethod] || exp.paymentMethod || '—')}</dd>
            ${exp.paymentMethod === 'eft' && canViewBank ? `
              <dt>BSB</dt><dd>${esc(exp.bankBSB || '—')}</dd>
              <dt>Account</dt><dd>${esc(exp.bankAccount || '—')}</dd>
              <dt>Account name</dt><dd>${esc(exp.bankAccountName || '—')}</dd>
            ` : exp.paymentMethod === 'eft' ? `
              <dt>Bank details</dt><dd class="text-muted">Visible to treasurer only</dd>
            ` : ''}
            ${exp.paidAt ? `<dt>Paid</dt><dd>${esc(fmtDate(exp.paidAt))}</dd>` : ''}
          </dl>
        </div>

        <div class="exp-detail__section">
          <h2 class="exp-detail__section-title">Receipts (${receiptItems.length})</h2>
          ${receiptItems.length === 0
            ? '<p class="text-muted">No receipts attached.</p>'
            : `<div class="receipt-list">
                ${receiptItems.map(r => `
                  <div class="receipt-item">
                    ${r.url && r.contentType?.startsWith('image/')
                      ? `<a href="${esc(r.url)}" target="_blank" class="receipt-item__thumb-link">
                           <img src="${esc(r.url)}" alt="${esc(r.filename)}" class="receipt-item__thumb">
                         </a>`
                      : `<div class="receipt-item__icon">📄</div>`}
                    <a href="${esc(r.url || '#')}" target="_blank" class="receipt-item__name">${esc(r.filename)}</a>
                  </div>
                `).join('')}
               </div>`
          }
        </div>

        ${exp.reviewedBy ? `
        <div class="exp-detail__section">
          <h2 class="exp-detail__section-title">Review</h2>
          <dl class="review__dl">
            <dt>Reviewed by</dt><dd>${esc(exp.reviewedBy)}</dd>
            <dt>Reviewed at</dt><dd>${esc(fmtDate(exp.reviewedAt))}</dd>
            ${exp.statusNote ? `<dt>Note</dt><dd>${esc(exp.statusNote)}</dd>` : ''}
          </dl>
        </div>
        ` : ''}

        ${isAdmin && (exp.status === 'pending' || exp.status === 'approved') ? `
        <div class="exp-detail__actions">
          ${exp.status === 'pending' ? `
            <button type="button" class="btn btn--success" data-action="approve">Approve</button>
            <button type="button" class="btn btn--danger"  data-action="reject">Reject</button>
          ` : ''}
          ${exp.status === 'approved' ? `
            <button type="button" class="btn btn--primary" data-action="mark-paid">Mark as Paid</button>
            <button type="button" class="btn btn--danger"  data-action="reject">Reject</button>
          ` : ''}
        </div>
        ` : ''}
      </div>
    </section>
  `);

  _wireEvents(exp);
}

function _wireEvents(exp) {
  if (!_root) return;

  _root.querySelector('[data-action="back"]')?.addEventListener('click', () => {
    const page = AUTH.isAdmin() ? 'expenses' : 'my-expenses';
    _root.dispatchEvent(new CustomEvent('navigate', { bubbles: true, detail: { page } }));
  });

  _root.querySelector('[data-action="approve"]')?.addEventListener('click', () => _doAction(exp, 'approved'));
  _root.querySelector('[data-action="reject"]')?.addEventListener('click', () => _doAction(exp, 'rejected'));
  _root.querySelector('[data-action="mark-paid"]')?.addEventListener('click', () => _doAction(exp, 'paid'));
  _root.querySelector('[data-action="delete"]')?.addEventListener('click', () => _doDelete(exp));
}

function _doAction(exp, newStatus) {
  const actionLabel = { approved: 'Approve', rejected: 'Reject', paid: 'Mark Paid' }[newStatus];
  const needsNote   = newStatus === 'rejected';

  openModal({
    titleHtml: `${esc(actionLabel)} — ${esc(exp.ref)}`,
    size: 'sm',
    bodyHtml: `
      <p>You are about to <strong>${esc(actionLabel.toLowerCase())}</strong> this expense claim.</p>
      <form class="form" data-form="action-form" novalidate>
        <label class="form__field">
          <span class="form__label">${needsNote ? 'Reason (required)' : 'Note (optional)'}</span>
          <textarea name="note" class="form__input" rows="3" ${needsNote ? 'required' : ''}
                    placeholder="${needsNote ? 'Reason for rejection…' : 'Optional note…'}"></textarea>
        </label>
        <div class="form__error" role="alert"></div>
        <div class="form__actions">
          <button type="button" class="btn btn--ghost" data-action="modal-close">Cancel</button>
          <button type="submit" class="btn ${newStatus === 'rejected' ? 'btn--danger' : 'btn--primary'}">
            ${esc(actionLabel)}
          </button>
        </div>
      </form>
    `,
    onMount(panel, close) {
      const form  = panel.querySelector('form');
      const errEl = panel.querySelector('.form__error');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const note = (new FormData(form).get('note') || '').trim();
        if (needsNote && !note) {
          if (errEl) errEl.textContent = 'Please provide a reason for rejection.';
          return;
        }
        const session = AUTH.getSession();
        const updated = {
          ...exp,
          status:     newStatus,
          statusNote: note,
          reviewedBy: session.name,
          reviewedAt: new Date().toISOString(),
          ...(newStatus === 'paid' ? { paidAt: new Date().toISOString() } : {}),
        };
        await Storage.expenses.put(updated);
        await Storage.audit.append({
          action: `expense_${newStatus}`,
          user:   session.name,
          desc:   `${exp.ref} ${newStatus} by ${session.name}${note ? ': ' + note : ''}`,
        });
        Sync.notifyChanged();
        showToast(`${exp.ref} ${newStatus}.`, 'success');
        close();
        await _render();
      });
    },
  });
}

function _doDelete(exp) {
  openModal({
    titleHtml: 'Delete expense claim',
    size: 'sm',
    bodyHtml: `
      <p>Delete <strong>${esc(exp.ref)}</strong>? This cannot be undone.</p>
      <div class="form__actions">
        <button type="button" class="btn btn--ghost" data-action="modal-close">Cancel</button>
        <button type="button" class="btn btn--danger" data-action="confirm-delete">Delete</button>
      </div>
    `,
    onMount(panel, close) {
      panel.querySelector('[data-action="confirm-delete"]')?.addEventListener('click', async () => {
        const session = AUTH.getSession();
        await Storage.receipts.deleteMany(exp.receiptIds || []);
        await Storage.expenses.delete(exp.id);
        await Storage.audit.append({
          action: 'expense_delete',
          user:   session.name,
          desc:   `${exp.ref} deleted by ${session.name} (CO action)`,
        });
        Sync.notifyChanged();
        showToast(`${exp.ref} deleted.`, 'warn');
        close();
        _root?.dispatchEvent(new CustomEvent('navigate', { bubbles: true, detail: { page: 'expenses' } }));
      });
    },
  });
}
