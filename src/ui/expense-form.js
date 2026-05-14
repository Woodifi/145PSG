// =============================================================================
// 145 PSG Expense System — Expense submission form (4-step wizard)
// =============================================================================
// Step 1: Details (category, description, date, amount)
// Step 2: Receipts (upload photos/PDFs)
// Step 3: Payment (EFT/cash/cheque/direct, bank details)
// Step 4: Review + Submit
// =============================================================================

import * as Storage  from '../storage.js';
import * as AUTH     from '../auth.js';
import * as Sync     from '../sync.js';
import {
  CATEGORIES, fmtAUD, parseDollars, gstAmount,
  financialYear, atoQuarter, categoryLabel,
} from '../categories.js';
import { esc, $, $$, render, fmtDate } from './util.js';
import { showToast } from './toast.js';

let _root     = null;
let _step     = 1;
let _draft    = null;  // accumulated form data across steps
let _receipts = [];    // [{ file, id, blob }]

export async function mount(rootEl, { expenseId } = {}) {
  _root     = rootEl;
  _step     = 1;
  _receipts = [];
  _draft    = _emptyDraft();

  if (expenseId) {
    // Edit mode — load existing draft
    const exp = await Storage.expenses.get(expenseId);
    if (exp && (exp.status === 'pending' || exp.status === 'draft')) {
      _draft = { ..._draft, ...exp };
    }
  }

  await _renderStep();
  return () => {
    // Revoke any object URLs created for receipt previews
    for (const r of _receipts) {
      if (r.previewUrl) URL.revokeObjectURL(r.previewUrl);
    }
    _root = null;
  };
}

function _emptyDraft() {
  const session = AUTH.getSession();
  return {
    submitterName:    session?.name  || '',
    submitterEmail:   session?.email || '',
    submitterPhone:   '',
    category:         '',
    description:      '',
    expenseDate:      new Date().toISOString().slice(0, 10),
    amountCents:      0,
    gstIncluded:      true,
    fbtApplicable:    false,
    receiptIds:       [],
    paymentMethod:    'eft',
    bankBSB:          '',
    bankAccount:      '',
    bankAccountName:  '',
    notes:            '',
  };
}

// -----------------------------------------------------------------------------
// Step rendering
// -----------------------------------------------------------------------------

async function _renderStep() {
  const steps = [
    { n: 1, label: 'Details'  },
    { n: 2, label: 'Receipts' },
    { n: 3, label: 'Payment'  },
    { n: 4, label: 'Review'   },
  ];
  const stepsHtml = steps.map(s => `
    <div class="wizard__step ${s.n === _step ? 'is-active' : ''} ${s.n < _step ? 'is-done' : ''}">
      <span class="wizard__step-num">${s.n < _step ? '✓' : s.n}</span>
      <span class="wizard__step-label">${s.label}</span>
    </div>
  `).join('');

  const stepContent = await _stepContentHtml();

  render(_root, `
    <section class="wizard">
      <h1 class="wizard__title">Submit Expense Claim</h1>
      <div class="wizard__steps" role="tablist" aria-label="Form steps">
        ${stepsHtml}
      </div>
      <div class="wizard__body">
        ${stepContent}
      </div>
    </section>
  `);

  _wireStep();
}

async function _stepContentHtml() {
  switch (_step) {
    case 1: return _step1Html();
    case 2: return _step2Html();
    case 3: return _step3Html();
    case 4: return await _step4Html();
    default: return '';
  }
}

// Step 1 — Expense details
function _step1Html() {
  const catOptions = CATEGORIES.map(c => `
    <option value="${esc(c.id)}" ${_draft.category === c.id ? 'selected' : ''}>${esc(c.label)}</option>
  `).join('');

  const selCat = CATEGORIES.find(c => c.id === _draft.category);

  return `
    <form class="form" data-form="step1" novalidate>
      <div class="form__row form__row--2col">
        <label class="form__field">
          <span class="form__label">Your name <span class="req">*</span></span>
          <input type="text" name="submitterName" class="form__input" required
                 value="${esc(_draft.submitterName)}" autocomplete="name">
        </label>
        <label class="form__field">
          <span class="form__label">Contact phone</span>
          <input type="tel" name="submitterPhone" class="form__input"
                 value="${esc(_draft.submitterPhone)}" autocomplete="tel">
        </label>
      </div>

      <label class="form__field">
        <span class="form__label">Category <span class="req">*</span></span>
        <select name="category" class="form__select" required>
          <option value="" disabled ${!_draft.category ? 'selected' : ''}>Select a category…</option>
          ${catOptions}
        </select>
      </label>

      ${selCat?.fbt ? `
        <div class="form__info form__info--warn">
          This category may attract Fringe Benefits Tax (FBT). Ensure you have documentation of the business purpose.
        </div>
      ` : ''}
      ${selCat?.gstFree ? `
        <div class="form__info">This category is typically GST-free.</div>
      ` : ''}

      <label class="form__field">
        <span class="form__label">Description <span class="req">*</span></span>
        <textarea name="description" class="form__input" required rows="3"
                  placeholder="Describe the expense and its purpose…">${esc(_draft.description)}</textarea>
      </label>

      <div class="form__row form__row--2col">
        <label class="form__field">
          <span class="form__label">Date of expense <span class="req">*</span></span>
          <input type="date" name="expenseDate" class="form__input" required
                 value="${esc(_draft.expenseDate)}" max="${new Date().toISOString().slice(0, 10)}">
        </label>
        <label class="form__field">
          <span class="form__label">Amount (AUD) <span class="req">*</span></span>
          <input type="number" name="amount" class="form__input" required
                 min="0.01" step="0.01" placeholder="0.00"
                 value="${_draft.amountCents > 0 ? (_draft.amountCents / 100).toFixed(2) : ''}">
        </label>
      </div>

      <div class="form__row form__row--checkbox">
        <label class="form__check">
          <input type="checkbox" name="gstIncluded" ${_draft.gstIncluded ? 'checked' : ''}>
          Amount includes GST (10%)
        </label>
        <label class="form__check">
          <input type="checkbox" name="fbtApplicable" ${_draft.fbtApplicable ? 'checked' : ''}>
          FBT applicable
        </label>
      </div>

      <label class="form__field">
        <span class="form__label">Additional notes</span>
        <textarea name="notes" class="form__input" rows="2"
                  placeholder="Any additional information…">${esc(_draft.notes)}</textarea>
      </label>

      <div class="form__error" role="alert"></div>
      <div class="form__actions">
        <button type="button" class="btn btn--ghost" data-action="cancel">Cancel</button>
        <button type="submit" class="btn btn--primary">Next: Receipts →</button>
      </div>
    </form>
  `;
}

// Step 2 — Receipt uploads
function _step2Html() {
  const previewsHtml = _receipts.map((r, i) => `
    <div class="receipt-preview" data-index="${i}">
      ${r.previewUrl && r.file.type.startsWith('image/')
        ? `<img src="${esc(r.previewUrl)}" alt="${esc(r.file.name)}" class="receipt-preview__img">`
        : `<div class="receipt-preview__icon">📄</div>`
      }
      <div class="receipt-preview__name">${esc(r.file.name)}</div>
      <div class="receipt-preview__size">${_fmtBytes(r.file.size)}</div>
      <button type="button" class="receipt-preview__remove" data-action="remove-receipt" data-index="${i}" aria-label="Remove ${esc(r.file.name)}">×</button>
    </div>
  `).join('');

  return `
    <div class="form" data-form="step2">
      <p class="form__desc">
        Upload photos or scans of receipts for this expense. PDF, JPEG, and PNG accepted.
        At least one receipt is required for most expense categories.
      </p>

      <div class="receipt-drop" id="receipt-drop" role="button" tabindex="0"
           aria-label="Drop receipts here or click to browse">
        <div class="receipt-drop__icon">📎</div>
        <div class="receipt-drop__text">
          Drop files here or <span class="receipt-drop__link">click to browse</span>
        </div>
        <div class="receipt-drop__hint">PDF, JPEG, PNG — max 10 MB each</div>
        <input type="file" id="receipt-input" accept=".pdf,.jpg,.jpeg,.png,image/*"
               multiple class="receipt-drop__input" aria-hidden="true">
      </div>

      ${_receipts.length > 0 ? `
        <div class="receipt-previews">
          ${previewsHtml}
        </div>
      ` : ''}

      <div class="form__error" role="alert"></div>
      <div class="form__actions">
        <button type="button" class="btn btn--ghost" data-action="prev-step">← Back</button>
        <button type="button" class="btn btn--primary" data-action="next-step">Next: Payment →</button>
      </div>
    </div>
  `;
}

// Step 3 — Payment details
function _step3Html() {
  const payMethods = [
    { id: 'eft',    label: 'EFT / Bank Transfer' },
    { id: 'cash',   label: 'Cash' },
    { id: 'cheque', label: 'Cheque' },
    { id: 'direct', label: 'Direct Supplier Payment (no reimbursement)' },
  ];

  return `
    <form class="form" data-form="step3" novalidate>
      <p class="form__desc">
        Select how you would like to receive reimbursement.
        Bank details are visible only to the PSG Treasurer.
      </p>

      <fieldset class="form__fieldset">
        <legend class="form__legend">Payment method <span class="req">*</span></legend>
        ${payMethods.map(m => `
          <label class="form__radio">
            <input type="radio" name="paymentMethod" value="${esc(m.id)}"
                   ${_draft.paymentMethod === m.id ? 'checked' : ''}>
            ${esc(m.label)}
          </label>
        `).join('')}
      </fieldset>

      <div class="eft-fields ${_draft.paymentMethod === 'eft' ? '' : 'is-hidden'}">
        <div class="form__row form__row--2col">
          <label class="form__field">
            <span class="form__label">BSB <span class="req">*</span></span>
            <input type="text" name="bankBSB" class="form__input"
                   pattern="\\d{3}-?\\d{3}" placeholder="000-000" maxlength="7"
                   value="${esc(_draft.bankBSB)}" autocomplete="off">
          </label>
          <label class="form__field">
            <span class="form__label">Account number <span class="req">*</span></span>
            <input type="text" name="bankAccount" class="form__input"
                   placeholder="Account number" maxlength="20"
                   value="${esc(_draft.bankAccount)}" autocomplete="off">
          </label>
        </div>
        <label class="form__field">
          <span class="form__label">Account name <span class="req">*</span></span>
          <input type="text" name="bankAccountName" class="form__input"
                 placeholder="Name on account"
                 value="${esc(_draft.bankAccountName)}" autocomplete="off">
        </label>
        <p class="form__hint">
          Your bank details are visible only to the PSG Treasurer and are stored encrypted.
        </p>
      </div>

      <div class="form__error" role="alert"></div>
      <div class="form__actions">
        <button type="button" class="btn btn--ghost" data-action="prev-step">← Back</button>
        <button type="submit" class="btn btn--primary">Next: Review →</button>
      </div>
    </form>
  `;
}

// Step 4 — Review and submit
async function _step4Html() {
  const cat = CATEGORIES.find(c => c.id === _draft.category);
  const gst = gstAmount(_draft.amountCents, _draft.gstIncluded, _draft.category);

  const payLabels = { eft: 'EFT / Bank Transfer', cash: 'Cash', cheque: 'Cheque', direct: 'Direct Supplier Payment' };

  const s = await Storage.settings.getAll();
  const treasurerEmail = s.treasurerEmail || '';

  return `
    <div class="form" data-form="step4">
      <div class="review">
        <h2 class="review__heading">Review your claim</h2>

        <div class="review__section">
          <h3 class="review__section-title">Submitter</h3>
          <dl class="review__dl">
            <dt>Name</dt><dd>${esc(_draft.submitterName)}</dd>
            <dt>Email</dt><dd>${esc(_draft.submitterEmail)}</dd>
            ${_draft.submitterPhone ? `<dt>Phone</dt><dd>${esc(_draft.submitterPhone)}</dd>` : ''}
          </dl>
        </div>

        <div class="review__section">
          <h3 class="review__section-title">Expense</h3>
          <dl class="review__dl">
            <dt>Category</dt><dd>${esc(cat?.label || _draft.category)}</dd>
            <dt>Description</dt><dd>${esc(_draft.description)}</dd>
            <dt>Date</dt><dd>${esc(_draft.expenseDate)}</dd>
            <dt>Amount</dt><dd><strong>${esc(fmtAUD(_draft.amountCents))}</strong></dd>
            ${gst > 0 ? `<dt>GST (incl.)</dt><dd>${esc(fmtAUD(gst))}</dd>` : ''}
            ${_draft.fbtApplicable ? `<dt>FBT</dt><dd>Applicable</dd>` : ''}
            ${_draft.notes ? `<dt>Notes</dt><dd>${esc(_draft.notes)}</dd>` : ''}
          </dl>
        </div>

        <div class="review__section">
          <h3 class="review__section-title">Receipts</h3>
          ${_receipts.length === 0
            ? `<p class="review__warn">No receipts attached.</p>`
            : `<p>${_receipts.length} receipt${_receipts.length > 1 ? 's' : ''} attached.</p>
               <ul class="review__file-list">
                 ${_receipts.map(r => `<li>${esc(r.file.name)} (${esc(_fmtBytes(r.file.size))})</li>`).join('')}
               </ul>`
          }
        </div>

        <div class="review__section">
          <h3 class="review__section-title">Payment</h3>
          <dl class="review__dl">
            <dt>Method</dt><dd>${esc(payLabels[_draft.paymentMethod] || _draft.paymentMethod)}</dd>
            ${_draft.paymentMethod === 'eft' ? `
              <dt>BSB</dt><dd>${esc(_draft.bankBSB)}</dd>
              <dt>Account</dt><dd>${esc(_draft.bankAccount)}</dd>
              <dt>Account name</dt><dd>${esc(_draft.bankAccountName)}</dd>
            ` : ''}
          </dl>
        </div>

        ${treasurerEmail ? `
          <div class="review__notice">
            Your claim will be sent to the PSG Treasurer (${esc(treasurerEmail)}) for approval.
          </div>
        ` : ''}

        <div class="form__error" role="alert"></div>
        <div class="form__actions">
          <button type="button" class="btn btn--ghost" data-action="prev-step">← Back</button>
          <button type="button" class="btn btn--primary" data-action="submit-expense">
            Submit Claim
          </button>
        </div>
      </div>
    </div>
  `;
}

// -----------------------------------------------------------------------------
// Event wiring
// -----------------------------------------------------------------------------

function _wireStep() {
  if (!_root) return;

  // Cancel
  _root.querySelector('[data-action="cancel"]')?.addEventListener('click', () => {
    _root.dispatchEvent(new CustomEvent('navigate', { bubbles: true, detail: { page: 'dashboard' } }));
  });

  // Prev
  _root.querySelector('[data-action="prev-step"]')?.addEventListener('click', () => {
    _step--;
    _renderStep();
  });

  // Next (non-form button)
  _root.querySelector('[data-action="next-step"]')?.addEventListener('click', () => {
    _step++;
    _renderStep();
  });

  // Submit
  _root.querySelector('[data-action="submit-expense"]')?.addEventListener('click', _onSubmit);

  // Step 1 form
  const form1 = _root.querySelector('[data-form="step1"]');
  if (form1) {
    form1.addEventListener('submit', (e) => { e.preventDefault(); _onStep1Submit(form1); });
    form1.querySelector('[name="category"]')?.addEventListener('change', () => {
      // Re-render to show FBT/GST notice
      _onStep1Submit(form1, true);
    });
  }

  // Step 2 — receipt uploads
  _wireReceiptDropzone();

  // Step 3 form
  const form3 = _root.querySelector('[data-form="step3"]');
  if (form3) {
    form3.addEventListener('submit', (e) => { e.preventDefault(); _onStep3Submit(form3); });
    $$('[name="paymentMethod"]', form3).forEach(radio => {
      radio.addEventListener('change', () => {
        const eftFields = form3.querySelector('.eft-fields');
        if (eftFields) eftFields.classList.toggle('is-hidden', radio.value !== 'eft');
      });
    });
  }
}

function _wireReceiptDropzone() {
  const drop  = _root?.querySelector('#receipt-drop');
  const input = _root?.querySelector('#receipt-input');
  if (!drop || !input) return;

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-dragover'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-dragover');
    _addFiles(Array.from(e.dataTransfer.files));
  });
  input.addEventListener('change', () => {
    _addFiles(Array.from(input.files));
    input.value = '';
  });

  // Remove buttons
  _root.querySelectorAll('[data-action="remove-receipt"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i = parseInt(btn.dataset.index, 10);
      if (_receipts[i]?.previewUrl) URL.revokeObjectURL(_receipts[i].previewUrl);
      _receipts.splice(i, 1);
      _renderStep();
    });
  });
}

function _addFiles(files) {
  const errEl = _root?.querySelector('.form__error');
  const MAX   = 10 * 1024 * 1024; // 10 MB
  for (const f of files) {
    if (f.size > MAX) {
      if (errEl) errEl.textContent = `${f.name} exceeds 10 MB limit.`;
      continue;
    }
    if (!f.type.match(/image\/|application\/pdf/)) {
      if (errEl) errEl.textContent = `${f.name} is not a supported format (PDF, JPEG, PNG).`;
      continue;
    }
    const previewUrl = f.type.startsWith('image/') ? URL.createObjectURL(f) : null;
    _receipts.push({ file: f, id: _uuid(), blob: f, previewUrl });
  }
  _renderStep();
}

// -----------------------------------------------------------------------------
// Step validation and data collection
// -----------------------------------------------------------------------------

function _onStep1Submit(form, noAdvance = false) {
  const errEl = form.querySelector('.form__error');
  if (errEl) errEl.textContent = '';

  const fd = new FormData(form);
  const category    = fd.get('category') || '';
  const description = (fd.get('description') || '').trim();
  const expenseDate = fd.get('expenseDate') || '';
  const amountStr   = fd.get('amount') || '';
  const gstIncluded = Boolean(fd.get('gstIncluded'));
  const fbt         = Boolean(fd.get('fbtApplicable'));

  if (noAdvance) {
    _draft.category    = category;
    _draft.description = description;
    _draft.expenseDate = expenseDate;
    _draft.gstIncluded = gstIncluded;
    _draft.fbtApplicable = fbt;
    _draft.notes       = (fd.get('notes') || '').trim();
    _draft.submitterName  = (fd.get('submitterName') || '').trim();
    _draft.submitterPhone = (fd.get('submitterPhone') || '').trim();
    _renderStep();
    return;
  }

  if (!category)    { if (errEl) errEl.textContent = 'Please select a category.';   return; }
  if (!description) { if (errEl) errEl.textContent = 'Please enter a description.'; return; }
  if (!expenseDate) { if (errEl) errEl.textContent = 'Please enter the expense date.'; return; }

  const amountCents = parseDollars(amountStr);
  if (isNaN(amountCents) || amountCents <= 0) {
    if (errEl) errEl.textContent = 'Please enter a valid amount greater than zero.';
    return;
  }

  Object.assign(_draft, {
    submitterName:  (fd.get('submitterName') || '').trim(),
    submitterPhone: (fd.get('submitterPhone') || '').trim(),
    category, description, expenseDate,
    amountCents, gstIncluded,
    fbtApplicable: fbt,
    notes: (fd.get('notes') || '').trim(),
  });

  _step++;
  _renderStep();
}

function _onStep3Submit(form) {
  const errEl        = form.querySelector('.form__error');
  if (errEl) errEl.textContent = '';

  const fd            = new FormData(form);
  const paymentMethod = fd.get('paymentMethod') || 'eft';
  const bankBSB       = (fd.get('bankBSB')          || '').trim();
  const bankAccount   = (fd.get('bankAccount')       || '').trim();
  const bankName      = (fd.get('bankAccountName')   || '').trim();

  if (paymentMethod === 'eft') {
    if (!bankBSB)     { if (errEl) errEl.textContent = 'Please enter your BSB.';          return; }
    if (!bankAccount) { if (errEl) errEl.textContent = 'Please enter your account number.'; return; }
    if (!bankName)    { if (errEl) errEl.textContent = 'Please enter the account name.';   return; }
  }

  Object.assign(_draft, { paymentMethod, bankBSB, bankAccount, bankAccountName: bankName });
  _step++;
  _renderStep();
}

async function _onSubmit() {
  const errEl = _root?.querySelector('.form__error');
  if (errEl) errEl.textContent = '';

  const submitBtn = _root?.querySelector('[data-action="submit-expense"]');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Submitting…'; }

  try {
    const session = AUTH.getSession();
    const refNum  = await Storage.counters.next('expenseRef', 1001);
    const ref     = `EXP-${String(refNum).padStart(4, '0')}`;
    const id      = _uuid();
    const now     = new Date();

    // Save receipts as blobs
    const receiptIds = [];
    for (const r of _receipts) {
      await Storage.receipts.put(r.id, r.blob, {
        filename:  r.file.name,
        expenseId: id,
      });
      receiptIds.push(r.id);
    }

    const expense = {
      id,
      ref,
      submittedAt:     now.toISOString(),
      submittedBy:     session.email,
      submitterName:   _draft.submitterName,
      submitterPhone:  _draft.submitterPhone,
      category:        _draft.category,
      description:     _draft.description,
      expenseDate:     _draft.expenseDate,
      amountCents:     _draft.amountCents,
      gstIncluded:     _draft.gstIncluded,
      gstAmountCents:  gstAmount(_draft.amountCents, _draft.gstIncluded, _draft.category),
      fbtApplicable:   _draft.fbtApplicable,
      receiptIds,
      paymentMethod:   _draft.paymentMethod,
      bankBSB:         _draft.bankBSB,
      bankAccount:     _draft.bankAccount,
      bankAccountName: _draft.bankAccountName,
      notes:           _draft.notes,
      status:          'pending',
      statusNote:      '',
      reviewedBy:      null,
      reviewedAt:      null,
      paidAt:          null,
      fy:              financialYear(now),
      quarter:         atoQuarter(now),
    };

    await Storage.expenses.put(expense);
    await Storage.audit.append({
      action: 'expense_submit',
      user:   session.name,
      desc:   `Expense ${ref} submitted by ${session.name} — ${categoryLabel(_draft.category)}, ${fmtAUD(_draft.amountCents)}`,
    });

    Sync.notifyChanged();
    showToast(`Claim ${ref} submitted successfully.`, 'success');
    _root?.dispatchEvent(new CustomEvent('navigate', { bubbles: true, detail: { page: 'my-expenses' } }));
  } catch (err) {
    console.error('Submit failed:', err);
    if (errEl) errEl.textContent = 'Submission failed: ' + (err.message || String(err));
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit Claim'; }
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function _uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function _fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
