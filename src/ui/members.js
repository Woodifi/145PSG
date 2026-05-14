// =============================================================================
// 145 PSG Expense System — Member management (CO only)
// =============================================================================
// Add, edit, activate/deactivate, and assign roles to PSG members.
// Members are keyed by their Microsoft email address.
// =============================================================================

import * as Storage from '../storage.js';
import * as AUTH    from '../auth.js';
import * as Sync    from '../sync.js';
import { esc, $, $$, render, fmtDateOnly } from './util.js';
import { openModal } from './modal.js';
import { showToast  } from './toast.js';

let _root   = null;
let _search = '';

const ROLE_ORDER = ['co', 'admin', 'member'];

export async function mount(rootEl) {
  AUTH.requirePermission('manageMembers');
  _root   = rootEl;
  _search = '';
  render(_root, '<div class="page-loading">Loading members…</div>');
  await _render();
  return () => { _root = null; };
}

async function _render() {
  let members = await Storage.members.list();

  if (_search) {
    const q = _search.toLowerCase();
    members = members.filter(m =>
      (m.name  || '').toLowerCase().includes(q) ||
      (m.email || '').toLowerCase().includes(q));
  }

  members.sort((a, b) => {
    const ra = ROLE_ORDER.indexOf(a.role);
    const rb = ROLE_ORDER.indexOf(b.role);
    if (ra !== rb) return (ra === -1 ? 99 : ra) - (rb === -1 ? 99 : rb);
    return (a.name || '').localeCompare(b.name || '');
  });

  render(_root, `
    <section class="members">
      <div class="members__header">
        <h1 class="members__title">Members</h1>
        <button type="button" class="btn btn--primary" data-action="add-member">+ Add Member</button>
      </div>

      <div class="members__filters">
        <input type="search" class="form__input members__search"
               placeholder="Search name or email…"
               value="${esc(_search)}" aria-label="Search members">
      </div>

      <div class="members__count">${members.length} member${members.length !== 1 ? 's' : ''}</div>

      <div class="members__list">
        ${members.length === 0
          ? `<div class="members__empty">No members found. Add members to grant access.</div>`
          : members.map(_memberRowHtml).join('')}
      </div>
    </section>
  `);

  _wireEvents();
}

function _memberRowHtml(m) {
  const roleLabel  = AUTH.ROLES[m.role]?.label || m.role;
  const isInactive = m.active === false;
  const session    = AUTH.getSession();
  const isSelf     = m.email === session?.email;

  return `
    <div class="member-row ${isInactive ? 'member-row--inactive' : ''}" data-email="${esc(m.email)}">
      <div class="member-row__avatar" aria-hidden="true">
        ${(m.name || m.email).charAt(0).toUpperCase()}
      </div>
      <div class="member-row__info">
        <div class="member-row__name">
          ${esc(m.name || m.email)}
          ${isSelf ? '<span class="member-row__you">(you)</span>' : ''}
          ${isInactive ? '<span class="member-row__inactive-tag">Inactive</span>' : ''}
        </div>
        <div class="member-row__email">${esc(m.email)}</div>
        <div class="member-row__meta">
          <span class="role-badge role-badge--${esc(m.role)}">${esc(roleLabel)}</span>
          ${m.lastLogin ? `Last login: ${esc(fmtDateOnly(m.lastLogin))}` : 'Never logged in'}
        </div>
      </div>
      <div class="member-row__actions">
        <button type="button" class="btn btn--ghost btn--xs" data-action="edit" data-email="${esc(m.email)}">
          Edit
        </button>
        ${!isSelf ? `
          <button type="button" class="btn btn--ghost btn--xs ${isInactive ? 'btn--success' : ''}"
                  data-action="${isInactive ? 'activate' : 'deactivate'}"
                  data-email="${esc(m.email)}">
            ${isInactive ? 'Activate' : 'Deactivate'}
          </button>
        ` : ''}
      </div>
    </div>
  `;
}

function _wireEvents() {
  if (!_root) return;

  _root.querySelector('.members__search')?.addEventListener('input', (e) => {
    _search = e.target.value;
    _render();
  });

  _root.querySelector('[data-action="add-member"]')?.addEventListener('click', () => {
    _openMemberModal(null);
  });

  _root.addEventListener('click', (e) => {
    const btn   = e.target.closest('[data-action]');
    if (!btn) return;
    const email = btn.dataset.email;
    const act   = btn.dataset.action;
    if (act === 'edit')       _openEditModal(email);
    if (act === 'deactivate') _doDeactivate(email);
    if (act === 'activate')   _doActivate(email);
  });
}

function _openEditModal(email) {
  Storage.members.get(email).then(m => {
    if (!m) return;
    _openMemberModal(m);
  });
}

function _openMemberModal(member) {
  const isNew = !member;
  openModal({
    titleHtml: isNew ? 'Add Member' : `Edit: ${esc(member.name || member.email)}`,
    size: 'sm',
    bodyHtml: `
      <form class="form" data-form="member-form" novalidate>
        <label class="form__field">
          <span class="form__label">Full name <span class="req">*</span></span>
          <input type="text" name="name" class="form__input" required
                 value="${esc(member?.name || '')}" autocomplete="name">
        </label>
        <label class="form__field">
          <span class="form__label">Microsoft email <span class="req">*</span></span>
          <input type="email" name="email" class="form__input" required
                 value="${esc(member?.email || '')}"
                 ${!isNew ? 'readonly' : ''}
                 autocomplete="email" placeholder="name@example.com">
        </label>
        <label class="form__field">
          <span class="form__label">Role <span class="req">*</span></span>
          <select name="role" class="form__select" required>
            ${Object.entries(AUTH.ROLES).map(([id, r]) => `
              <option value="${esc(id)}" ${member?.role === id ? 'selected' : ''}>${esc(r.label)}</option>
            `).join('')}
          </select>
        </label>
        <label class="form__field">
          <span class="form__label">Notes</span>
          <input type="text" name="notes" class="form__input"
                 value="${esc(member?.notes || '')}" placeholder="Optional notes">
        </label>
        <div class="form__error" role="alert"></div>
        <div class="form__actions">
          <button type="button" class="btn btn--ghost" data-action="modal-close">Cancel</button>
          <button type="submit" class="btn btn--primary">${isNew ? 'Add Member' : 'Save Changes'}</button>
        </div>
      </form>
    `,
    onMount(panel, close) {
      const form  = panel.querySelector('form');
      const errEl = panel.querySelector('.form__error');
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd    = new FormData(form);
        const name  = (fd.get('name')  || '').trim();
        const email = (fd.get('email') || '').trim().toLowerCase();
        const role  = fd.get('role') || 'member';
        const notes = (fd.get('notes') || '').trim();

        if (!name)  { errEl.textContent = 'Name is required.';  return; }
        if (!email) { errEl.textContent = 'Email is required.'; return; }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          errEl.textContent = 'Enter a valid email address.'; return;
        }

        const session = AUTH.getSession();
        const now     = new Date().toISOString();

        if (isNew) {
          const existing = await Storage.members.get(email);
          if (existing) { errEl.textContent = 'A member with that email already exists.'; return; }
        }

        const rec = {
          ...(member || {}),
          email,
          name,
          role,
          notes,
          active:  true,
          addedBy: member?.addedBy || session.name,
          addedAt: member?.addedAt || now,
          updatedBy: session.name,
          updatedAt: now,
        };
        await Storage.members.put(rec);
        await Storage.audit.append({
          action: isNew ? 'member_add' : 'member_update',
          user:   session.name,
          desc:   `${isNew ? 'Added' : 'Updated'} member ${name} (${email}) as ${AUTH.ROLES[role]?.label || role}`,
        });
        Sync.notifyChanged();
        showToast(isNew ? `${name} added.` : `${name} updated.`, 'success');
        close();
        _render();
      });
    },
  });
}

async function _doDeactivate(email) {
  const m = await Storage.members.get(email);
  if (!m) return;
  m.active = false;
  m.updatedAt = new Date().toISOString();
  await Storage.members.put(m);
  await Storage.audit.append({
    action: 'member_deactivate',
    user:   AUTH.getSession()?.name || '',
    desc:   `Member ${m.name} (${email}) deactivated.`,
  });
  Sync.notifyChanged();
  showToast(`${m.name} deactivated.`, 'warn');
  _render();
}

async function _doActivate(email) {
  const m = await Storage.members.get(email);
  if (!m) return;
  m.active = true;
  m.updatedAt = new Date().toISOString();
  await Storage.members.put(m);
  await Storage.audit.append({
    action: 'member_update',
    user:   AUTH.getSession()?.name || '',
    desc:   `Member ${m.name} (${email}) re-activated.`,
  });
  Sync.notifyChanged();
  showToast(`${m.name} re-activated.`, 'success');
  _render();
}
