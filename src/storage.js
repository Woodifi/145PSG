// =============================================================================
// 145 PSG Expense System — Storage layer
// =============================================================================
// IndexedDB-backed persistence adapted from QStore IMS v2.
//
// Stores:
//   meta       — install ID, audit key, schema version
//   settings   — KV config (unit name, Azure client ID, treasurer email, etc.)
//   counters   — auto-increment for expense ref numbers
//   expenses   — expense claims
//   receipts   — receipt Blob records (keyed to expense + index)
//   members    — PSG member accounts (keyed to Microsoft email)
//   audit      — HMAC-SHA256-chained append-only audit log
//
// AUDIT CHAIN
//   Copied verbatim from QStore — HMAC-chained entries give tamper evidence.
//   Same caveats apply (tamper evidence, not prevention).
// =============================================================================

const DEFAULT_DB_NAME = 'psg-expense';
const DB_VERSION = 1;

let _dbName      = DEFAULT_DB_NAME;
let _db          = null;
let _auditKey    = null;
let _initPromise = null;

export const STORES = Object.freeze({
  META:     'meta',
  SETTINGS: 'settings',
  COUNTERS: 'counters',
  EXPENSES: 'expenses',
  RECEIPTS: 'receipts',
  MEMBERS:  'members',
  AUDIT:    'audit',
});

// -----------------------------------------------------------------------------
// Lifecycle
// -----------------------------------------------------------------------------

export function getDbName() { return _dbName; }

export async function init({ dbName } = {}) {
  if (dbName && dbName !== _dbName) {
    if (_db) { _db.close(); _db = null; }
    _auditKey = null;
    _initPromise = null;
    _dbName = dbName;
  }
  if (_db) return _db;
  if (_initPromise) return _initPromise;
  _initPromise = (async () => {
    _db = await _openDB();
    await _ensureMeta();
    _auditKey = await _loadAuditKey();
    return _db;
  })();
  try {
    return await _initPromise;
  } catch (err) {
    _initPromise = null;
    throw err;
  }
}

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_dbName, DB_VERSION);
    req.onupgradeneeded = (e) => _runSchemaMigrations(req.result, e.oldVersion);
    req.onsuccess       = () => resolve(req.result);
    req.onerror         = () => reject(new Error('IndexedDB open failed: ' + (req.error?.message || 'unknown')));
    req.onblocked       = () => reject(new Error('IndexedDB blocked — close other tabs and reload.'));
  });
}

function _runSchemaMigrations(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore(STORES.META,     { keyPath: 'key' });
    db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
    db.createObjectStore(STORES.COUNTERS, { keyPath: 'key' });

    const expenses = db.createObjectStore(STORES.EXPENSES, { keyPath: 'id' });
    expenses.createIndex('status',      'status',      { unique: false });
    expenses.createIndex('submittedBy', 'submittedBy', { unique: false });
    expenses.createIndex('category',    'category',    { unique: false });
    expenses.createIndex('fy',          'fy',          { unique: false });
    expenses.createIndex('ref',         'ref',         { unique: true  });

    db.createObjectStore(STORES.RECEIPTS, { keyPath: 'id' });

    const members = db.createObjectStore(STORES.MEMBERS, { keyPath: 'email' });
    members.createIndex('role',   'role',   { unique: false });
    members.createIndex('active', 'active', { unique: false });

    const audit = db.createObjectStore(STORES.AUDIT, { keyPath: 'seq', autoIncrement: true });
    audit.createIndex('ts',     'ts',     { unique: false });
    audit.createIndex('action', 'action', { unique: false });
    audit.createIndex('user',   'user',   { unique: false });
  }
}

async function _ensureMeta() {
  const existing = await _kvGet(STORES.META, 'installId');
  if (existing) return;

  const installId     = _uuid();
  const auditKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  const auditKeyB64   = _bytesToB64(auditKeyBytes);

  const tx = _db.transaction(STORES.META, 'readwrite');
  const store = tx.objectStore(STORES.META);
  store.put({ key: 'schemaVersion', value: DB_VERSION });
  store.put({ key: 'installId',     value: installId });
  store.put({ key: 'auditKey',      value: auditKeyB64 });
  store.put({ key: 'createdAt',     value: new Date().toISOString() });
  await _txDone(tx);
}

async function _loadAuditKey() {
  const b64 = await _kvGet(STORES.META, 'auditKey');
  if (!b64) throw new Error('Audit key missing — DB not initialised correctly.');
  const bytes = _b64ToBytes(b64);
  return crypto.subtle.importKey(
    'raw', bytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
}

export async function requestPersistence() {
  if (!navigator.storage?.persist) return false;
  try { return await navigator.storage.persist(); } catch { return false; }
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

function _txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

function _reqDone(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function _kvGet(storeName, key) {
  const tx = _db.transaction(storeName, 'readonly');
  const row = await _reqDone(tx.objectStore(storeName).get(key));
  return row ? row.value : null;
}

async function _kvSet(storeName, key, value) {
  const tx = _db.transaction(storeName, 'readwrite');
  tx.objectStore(storeName).put({ key, value });
  await _txDone(tx);
}

async function _all(storeName) {
  const tx = _db.transaction(storeName, 'readonly');
  return _reqDone(tx.objectStore(storeName).getAll());
}

function _uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function _bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function _b64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function _bytesToHex(bytes) {
  const out = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i].toString(16).padStart(2, '0');
  return out.join('');
}

// -----------------------------------------------------------------------------
// Expenses
// -----------------------------------------------------------------------------

export const expenses = {
  async list({ status, submittedBy, category, fy } = {}) {
    let rows = await _all(STORES.EXPENSES);
    if (status)      rows = rows.filter(e => e.status === status);
    if (submittedBy) rows = rows.filter(e => e.submittedBy === submittedBy);
    if (category)    rows = rows.filter(e => e.category === category);
    if (fy)          rows = rows.filter(e => e.fy === fy);
    return rows;
  },

  async get(id) {
    const tx = _db.transaction(STORES.EXPENSES, 'readonly');
    return (await _reqDone(tx.objectStore(STORES.EXPENSES).get(id))) || null;
  },

  async put(expense) {
    if (!expense?.id) throw new Error('Expense.id required');
    const tx = _db.transaction(STORES.EXPENSES, 'readwrite');
    tx.objectStore(STORES.EXPENSES).put(expense);
    await _txDone(tx);
  },

  async delete(id) {
    const tx = _db.transaction(STORES.EXPENSES, 'readwrite');
    tx.objectStore(STORES.EXPENSES).delete(id);
    await _txDone(tx);
  },

  async count() {
    const tx = _db.transaction(STORES.EXPENSES, 'readonly');
    return _reqDone(tx.objectStore(STORES.EXPENSES).count());
  },
};

// -----------------------------------------------------------------------------
// Receipts (Blob storage keyed by a unique receipt ID)
// -----------------------------------------------------------------------------

export const receipts = {
  async put(receiptId, blob, meta = {}) {
    if (!receiptId) throw new Error('receiptId required');
    if (!(blob instanceof Blob)) throw new Error('blob must be a Blob');
    const tx = _db.transaction(STORES.RECEIPTS, 'readwrite');
    tx.objectStore(STORES.RECEIPTS).put({
      id:          receiptId,
      blob,
      contentType: blob.type || 'application/octet-stream',
      sizeBytes:   blob.size,
      filename:    meta.filename || 'receipt',
      addedAt:     new Date().toISOString(),
      expenseId:   meta.expenseId || null,
    });
    await _txDone(tx);
  },

  async get(receiptId) {
    const tx = _db.transaction(STORES.RECEIPTS, 'readonly');
    return (await _reqDone(tx.objectStore(STORES.RECEIPTS).get(receiptId))) || null;
  },

  async getURL(receiptId) {
    const row = await this.get(receiptId);
    return row ? { url: URL.createObjectURL(row.blob), filename: row.filename, contentType: row.contentType } : null;
  },

  async delete(receiptId) {
    const tx = _db.transaction(STORES.RECEIPTS, 'readwrite');
    tx.objectStore(STORES.RECEIPTS).delete(receiptId);
    await _txDone(tx);
  },

  async deleteMany(receiptIds) {
    if (!receiptIds?.length) return;
    const tx = _db.transaction(STORES.RECEIPTS, 'readwrite');
    const store = tx.objectStore(STORES.RECEIPTS);
    for (const id of receiptIds) store.delete(id);
    await _txDone(tx);
  },

  async has(receiptId) {
    const tx = _db.transaction(STORES.RECEIPTS, 'readonly');
    const c = await _reqDone(tx.objectStore(STORES.RECEIPTS).count(receiptId));
    return c > 0;
  },
};

// -----------------------------------------------------------------------------
// Members (keyed by Microsoft email address)
// -----------------------------------------------------------------------------

export const members = {
  list: () => _all(STORES.MEMBERS),

  async listActive() {
    const all = await _all(STORES.MEMBERS);
    return all.filter(m => m.active !== false);
  },

  async get(email) {
    const tx = _db.transaction(STORES.MEMBERS, 'readonly');
    return (await _reqDone(tx.objectStore(STORES.MEMBERS).get(email))) || null;
  },

  async put(member) {
    if (!member?.email) throw new Error('Member.email required');
    const tx = _db.transaction(STORES.MEMBERS, 'readwrite');
    tx.objectStore(STORES.MEMBERS).put(member);
    await _txDone(tx);
  },

  async delete(email) {
    const tx = _db.transaction(STORES.MEMBERS, 'readwrite');
    tx.objectStore(STORES.MEMBERS).delete(email);
    await _txDone(tx);
  },

  async count() {
    const tx = _db.transaction(STORES.MEMBERS, 'readonly');
    return _reqDone(tx.objectStore(STORES.MEMBERS).count());
  },
};

// -----------------------------------------------------------------------------
// Audit log — HMAC-chained, append-only
// -----------------------------------------------------------------------------

const ZERO_HASH = '0'.repeat(64);
let _auditLock = Promise.resolve();

function _withAuditLock(fn) {
  const next = _auditLock.then(fn, fn);
  _auditLock = next.catch(() => {});
  return next;
}

async function _hmac(prevHash, ts, action, user, desc) {
  const payload = JSON.stringify([prevHash, ts, action, user || '', desc || '']);
  const sig = await crypto.subtle.sign('HMAC', _auditKey, new TextEncoder().encode(payload));
  return _bytesToHex(new Uint8Array(sig));
}

async function _readLastAuditHash() {
  const tx = _db.transaction(STORES.AUDIT, 'readonly');
  return new Promise((resolve, reject) => {
    const req = tx.objectStore(STORES.AUDIT).openCursor(null, 'prev');
    req.onsuccess = () => resolve(req.result ? req.result.value.hash : ZERO_HASH);
    req.onerror   = () => reject(req.error);
  });
}

export const audit = {
  async append({ action, user, desc, ts } = {}) {
    if (!action) throw new Error('audit.action required');
    return _withAuditLock(async () => {
      const prevHash = await _readLastAuditHash();
      const entryTs  = ts || new Date().toISOString();
      const hash     = await _hmac(prevHash, entryTs, action, user, desc);
      const entry = { ts: entryTs, action, user: user || '', desc: desc || '', prevHash, hash };

      const tx  = _db.transaction(STORES.AUDIT, 'readwrite');
      const req = tx.objectStore(STORES.AUDIT).add(entry);
      const seq = await _reqDone(req);
      await _txDone(tx);
      return { ...entry, seq };
    });
  },

  async list({ since, action, search, limit, order = 'desc' } = {}) {
    let rows = await _all(STORES.AUDIT);
    if (action && action !== 'all') rows = rows.filter(r => r.action === action);
    if (since)  rows = rows.filter(r => r.ts >= since);
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter(r =>
        (r.desc   || '').toLowerCase().includes(q)
        || (r.user   || '').toLowerCase().includes(q)
        || (r.action || '').toLowerCase().includes(q));
    }
    rows.sort((a, b) => order === 'asc' ? a.seq - b.seq : b.seq - a.seq);
    if (limit) rows = rows.slice(0, limit);
    return rows;
  },

  async count() {
    const tx = _db.transaction(STORES.AUDIT, 'readonly');
    return _reqDone(tx.objectStore(STORES.AUDIT).count());
  },

  async verify() {
    const all = await _all(STORES.AUDIT);
    all.sort((a, b) => a.seq - b.seq);
    let prev = ZERO_HASH;
    for (const e of all) {
      if (e.prevHash !== prev) {
        return { ok: false, brokenAt: e.seq, reason: 'prevHash mismatch', count: all.length };
      }
      const recomputed = await _hmac(e.prevHash, e.ts, e.action, e.user, e.desc);
      if (recomputed !== e.hash) {
        return { ok: false, brokenAt: e.seq, reason: 'entry hash mismatch', count: all.length };
      }
      prev = e.hash;
    }
    return { ok: true, count: all.length };
  },
};

// -----------------------------------------------------------------------------
// Settings
// -----------------------------------------------------------------------------

export const settings = {
  get:    (key)        => _kvGet(STORES.SETTINGS, key),
  set:    (key, value) => _kvSet(STORES.SETTINGS, key, value),

  async getAll() {
    const rows = await _all(STORES.SETTINGS);
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  },

  async setMany(obj) {
    const tx = _db.transaction(STORES.SETTINGS, 'readwrite');
    const store = tx.objectStore(STORES.SETTINGS);
    for (const [k, v] of Object.entries(obj)) store.put({ key: k, value: v });
    await _txDone(tx);
  },

  async delete(key) {
    const tx = _db.transaction(STORES.SETTINGS, 'readwrite');
    tx.objectStore(STORES.SETTINGS).delete(key);
    await _txDone(tx);
  },
};

// -----------------------------------------------------------------------------
// Counters — atomic increment for expense ref numbers
// -----------------------------------------------------------------------------

export const counters = {
  async next(key, startAt = 1001) {
    const tx = _db.transaction(STORES.COUNTERS, 'readwrite');
    const store = tx.objectStore(STORES.COUNTERS);
    const row = await _reqDone(store.get(key));
    const n = row ? row.value + 1 : startAt;
    store.put({ key, value: n });
    await _txDone(tx);
    return n;
  },
  peek: (key) => _kvGet(STORES.COUNTERS, key),
  set:  (key, value) => _kvSet(STORES.COUNTERS, key, value),
};

// -----------------------------------------------------------------------------
// Meta
// -----------------------------------------------------------------------------

export const meta = {
  get: (key)        => _kvGet(STORES.META, key),
  set: (key, value) => _kvSet(STORES.META, key, value),

  async getAll() {
    const rows = await _all(STORES.META);
    const out = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  },
};

// -----------------------------------------------------------------------------
// Export / Import / Wipe
// -----------------------------------------------------------------------------

export async function exportAll() {
  const out = {
    schemaVersion: DB_VERSION,
    exportedAt:    new Date().toISOString(),
    meta:          await _all(STORES.META),
    settings:      await _all(STORES.SETTINGS),
    counters:      await _all(STORES.COUNTERS),
    expenses:      await _all(STORES.EXPENSES),
    members:       await _all(STORES.MEMBERS),
    audit:         await _all(STORES.AUDIT),
  };

  const receiptRows = await _all(STORES.RECEIPTS);
  out.receipts = await Promise.all(receiptRows.map(async (r) => ({
    id:          r.id,
    contentType: r.contentType,
    sizeBytes:   r.sizeBytes,
    filename:    r.filename,
    addedAt:     r.addedAt,
    expenseId:   r.expenseId,
    base64:      await _blobToB64(r.blob),
  })));
  return out;
}

async function _blobToB64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = () => resolve(String(r.result).split(',', 2)[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function _b64ToBlob(b64, contentType) {
  const bytes = _b64ToBytes(b64);
  return new Blob([bytes], { type: contentType || 'application/octet-stream' });
}

export async function importAll(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== DB_VERSION) {
    throw new Error('Snapshot schema mismatch — expected v' + DB_VERSION
      + ', got v' + (snapshot?.schemaVersion ?? '?'));
  }
  await wipe({ keepMeta: true });

  const stores = [
    STORES.META, STORES.SETTINGS, STORES.COUNTERS, STORES.EXPENSES,
    STORES.MEMBERS, STORES.AUDIT, STORES.RECEIPTS,
  ];
  const tx = _db.transaction(stores, 'readwrite');
  const put = (name, rows) => {
    const s = tx.objectStore(name);
    for (const r of rows || []) s.put(r);
  };

  if (snapshot.meta && Array.isArray(snapshot.meta)) put(STORES.META, snapshot.meta);
  put(STORES.SETTINGS, snapshot.settings);
  put(STORES.COUNTERS, snapshot.counters);
  put(STORES.EXPENSES, snapshot.expenses);
  put(STORES.MEMBERS,  snapshot.members);
  put(STORES.AUDIT,    snapshot.audit);

  const receiptStore = tx.objectStore(STORES.RECEIPTS);
  for (const r of snapshot.receipts || []) {
    try {
      receiptStore.put({
        id:          r.id,
        blob:        _b64ToBlob(r.base64, r.contentType),
        contentType: r.contentType,
        sizeBytes:   r.sizeBytes,
        filename:    r.filename || 'receipt',
        addedAt:     r.addedAt,
        expenseId:   r.expenseId,
      });
    } catch (e) {
      console.warn('Receipt import failed for', r.id, e);
    }
  }
  await _txDone(tx);
  _auditKey = await _loadAuditKey();
}

export async function wipe({ keepMeta = true, keepMembers = true } = {}) {
  const targets = [
    STORES.SETTINGS, STORES.COUNTERS, STORES.EXPENSES, STORES.RECEIPTS, STORES.AUDIT,
  ];
  if (!keepMembers) targets.push(STORES.MEMBERS);
  if (!keepMeta)    targets.push(STORES.META);

  const tx = _db.transaction(targets, 'readwrite');
  for (const name of targets) tx.objectStore(name).clear();
  await _txDone(tx);
}

export async function dropDatabase() {
  if (_db) { _db.close(); _db = null; }
  _auditKey = null;
  _initPromise = null;

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await new Promise((resolve, reject) => {
        const req = indexedDB.deleteDatabase(_dbName);
        req.onsuccess = () => resolve();
        req.onerror   = () => reject(req.error || new Error('deleteDatabase failed'));
        req.onblocked = () => reject(new Error('__blocked__'));
      });
      return;
    } catch (e) {
      if (e.message === '__blocked__' && attempt < 4) {
        await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
        continue;
      }
      if (e.message === '__blocked__') {
        throw new Error('Database delete blocked — close other tabs and retry.');
      }
      throw e;
    }
  }
}
