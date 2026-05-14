// =============================================================================
// 145 PSG Expense System — ATO Compliance Reports
// =============================================================================
// Financial year breakdown with GST, FBT, and BAS quarterly summaries.
// Exports to CSV for accounting software / BAS preparation.
// CO / Admin access only.
// =============================================================================

import * as Storage from '../storage.js';
import * as AUTH    from '../auth.js';
import {
  CATEGORIES, fmtAUD, categoryLabel,
  financialYear, fyStartYear, quarterLabel, availableFinancialYears,
} from '../categories.js';
import { esc, $, render, fmtDateOnly } from './util.js';
import { showToast } from './toast.js';

let _root = null;
let _fy   = financialYear();

export async function mount(rootEl) {
  AUTH.requirePermission('atoReports');
  _root = rootEl;
  _fy   = financialYear();
  render(_root, '<div class="page-loading">Loading reports…</div>');
  await _render();
  return () => { _root = null; };
}

async function _render() {
  const allExp  = await Storage.expenses.list({ fy: _fy });
  const paid    = allExp.filter(e => e.status === 'paid');
  const fyYears = availableFinancialYears();

  // Aggregate by category
  const byCat = {};
  for (const e of paid) {
    if (!byCat[e.category]) byCat[e.category] = { count: 0, total: 0, gst: 0, fbt: 0 };
    byCat[e.category].count++;
    byCat[e.category].total += e.amountCents || 0;
    byCat[e.category].gst   += e.gstAmountCents || 0;
    if (e.fbtApplicable) byCat[e.category].fbt += e.amountCents || 0;
  }

  // Aggregate by quarter
  const byQuarter = { 1: { total: 0, gst: 0, count: 0 }, 2: { total: 0, gst: 0, count: 0 },
                       3: { total: 0, gst: 0, count: 0 }, 4: { total: 0, gst: 0, count: 0 } };
  for (const e of paid) {
    const q = e.quarter || 1;
    if (byQuarter[q]) {
      byQuarter[q].total += e.amountCents || 0;
      byQuarter[q].gst   += e.gstAmountCents || 0;
      byQuarter[q].count++;
    }
  }

  const totalPaid = paid.reduce((s, e) => s + (e.amountCents || 0), 0);
  const totalGST  = paid.reduce((s, e) => s + (e.gstAmountCents || 0), 0);
  const totalFBT  = paid.filter(e => e.fbtApplicable).reduce((s, e) => s + (e.amountCents || 0), 0);

  const fyStart = fyStartYear(_fy);

  render(_root, `
    <section class="ato">
      <div class="ato__header">
        <h1 class="ato__title">ATO Compliance Reports</h1>
        <div class="ato__controls">
          <label class="form__label" for="fy-select">Financial year:</label>
          <select id="fy-select" class="form__select" data-action="change-fy">
            ${fyYears.map(fy => `
              <option value="${esc(fy)}" ${fy === _fy ? 'selected' : ''}>FY ${esc(fy)}</option>
            `).join('')}
          </select>
          <button type="button" class="btn btn--ghost btn--sm" data-action="export-csv">
            Export CSV
          </button>
        </div>
      </div>

      <div class="ato__summary-cards">
        <div class="ato__card">
          <div class="ato__card-value">${esc(fmtAUD(totalPaid))}</div>
          <div class="ato__card-label">Total Paid</div>
          <div class="ato__card-sub">${paid.length} claims</div>
        </div>
        <div class="ato__card">
          <div class="ato__card-value">${esc(fmtAUD(totalGST))}</div>
          <div class="ato__card-label">Total GST</div>
          <div class="ato__card-sub">Input tax credits</div>
        </div>
        <div class="ato__card ${totalFBT > 0 ? 'ato__card--warn' : ''}">
          <div class="ato__card-value">${esc(fmtAUD(totalFBT))}</div>
          <div class="ato__card-label">FBT-Applicable</div>
          <div class="ato__card-sub">May require FBT return</div>
        </div>
      </div>

      <h2 class="ato__section-title">BAS Quarterly Breakdown — FY ${esc(_fy)}</h2>
      <table class="ato__table">
        <thead>
          <tr>
            <th>Quarter</th>
            <th class="num">Claims</th>
            <th class="num">Total</th>
            <th class="num">GST</th>
            <th class="num">Ex-GST</th>
          </tr>
        </thead>
        <tbody>
          ${[1, 2, 3, 4].map(q => {
            const d = byQuarter[q];
            const exGST = d.total - d.gst;
            return `
              <tr>
                <td>${esc(quarterLabel(q, fyStart))}</td>
                <td class="num">${d.count}</td>
                <td class="num">${esc(fmtAUD(d.total))}</td>
                <td class="num">${esc(fmtAUD(d.gst))}</td>
                <td class="num">${esc(fmtAUD(exGST))}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
        <tfoot>
          <tr class="ato__total-row">
            <td><strong>Total</strong></td>
            <td class="num"><strong>${paid.length}</strong></td>
            <td class="num"><strong>${esc(fmtAUD(totalPaid))}</strong></td>
            <td class="num"><strong>${esc(fmtAUD(totalGST))}</strong></td>
            <td class="num"><strong>${esc(fmtAUD(totalPaid - totalGST))}</strong></td>
          </tr>
        </tfoot>
      </table>

      <h2 class="ato__section-title">Category Breakdown</h2>
      <table class="ato__table">
        <thead>
          <tr>
            <th>Category</th>
            <th>ATO Classification</th>
            <th class="num">Claims</th>
            <th class="num">Total</th>
            <th class="num">GST</th>
            <th>FBT</th>
          </tr>
        </thead>
        <tbody>
          ${CATEGORIES.map(cat => {
            const d = byCat[cat.id];
            if (!d) return '';
            return `
              <tr>
                <td>${esc(cat.label)}</td>
                <td>${esc(cat.atoClass)}</td>
                <td class="num">${d.count}</td>
                <td class="num">${esc(fmtAUD(d.total))}</td>
                <td class="num">${esc(fmtAUD(d.gst))}</td>
                <td>${cat.fbt ? `<span class="ato__fbt-badge">FBT</span>` : '—'}</td>
              </tr>
            `;
          }).join('')}
          ${Object.keys(byCat).length === 0 ? '<tr><td colspan="6" class="text-muted">No paid claims in this period.</td></tr>' : ''}
        </tbody>
      </table>

      <h2 class="ato__section-title">Transaction Register</h2>
      <div class="ato__table-wrap">
        <table class="ato__table ato__table--register">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Date</th>
              <th>Payee</th>
              <th>Category</th>
              <th>ATO Class</th>
              <th>Payment</th>
              <th class="num">Amount</th>
              <th class="num">GST</th>
              <th>FBT</th>
            </tr>
          </thead>
          <tbody>
            ${paid.length === 0
              ? '<tr><td colspan="9" class="text-muted">No paid claims.</td></tr>'
              : paid.sort((a, b) => new Date(a.paidAt || a.submittedAt) - new Date(b.paidAt || b.submittedAt))
                .map(e => {
                  const cat = CATEGORIES.find(c => c.id === e.category);
                  return `
                    <tr>
                      <td>${esc(e.ref)}</td>
                      <td>${esc(fmtDateOnly(e.paidAt || e.reviewedAt))}</td>
                      <td>${esc(e.submitterName || e.submittedBy)}</td>
                      <td>${esc(categoryLabel(e.category))}</td>
                      <td>${esc(cat?.atoClass || '—')}</td>
                      <td>${esc(e.paymentMethod || '—')}</td>
                      <td class="num">${esc(fmtAUD(e.amountCents))}</td>
                      <td class="num">${esc(fmtAUD(e.gstAmountCents || 0))}</td>
                      <td>${e.fbtApplicable ? 'Yes' : '—'}</td>
                    </tr>
                  `;
                }).join('')}
          </tbody>
        </table>
      </div>

      ${totalFBT > 0 ? `
        <div class="ato__fbt-notice">
          <strong>FBT Notice:</strong> This period includes ${esc(fmtAUD(totalFBT))} in FBT-applicable expenses.
          Consult your tax advisor regarding Fringe Benefits Tax obligations.
          The FBT year runs 1 April to 31 March.
        </div>
      ` : ''}
    </section>
  `);

  _wireEvents(paid);
}

function _wireEvents(paid) {
  if (!_root) return;

  _root.querySelector('[data-action="change-fy"]')?.addEventListener('change', (e) => {
    _fy = e.target.value;
    _render();
  });

  _root.querySelector('[data-action="export-csv"]')?.addEventListener('click', () => {
    _exportCSV(paid);
  });
}

function _exportCSV(paid) {
  const headers = ['Ref', 'Date Paid', 'Submitter', 'Category', 'ATO Classification',
                   'Description', 'Amount (AUD)', 'GST Included', 'GST Amount (AUD)',
                   'FBT Applicable', 'Payment Method', 'Financial Year', 'Quarter'];

  const rows = paid.map(e => {
    const cat = CATEGORIES.find(c => c.id === e.category);
    return [
      e.ref,
      fmtDateOnly(e.paidAt || e.reviewedAt),
      e.submitterName || e.submittedBy,
      categoryLabel(e.category),
      cat?.atoClass || '',
      e.description,
      (e.amountCents / 100).toFixed(2),
      e.gstIncluded ? 'Yes' : 'No',
      ((e.gstAmountCents || 0) / 100).toFixed(2),
      e.fbtApplicable ? 'Yes' : 'No',
      e.paymentMethod,
      e.fy,
      `Q${e.quarter}`,
    ];
  });

  const csv = [headers, ...rows]
    .map(r => r.map(v => `"${String(v || '').replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `psg-expense-${_fy}-ato-register.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);

  showToast('CSV exported successfully.', 'success');
}
