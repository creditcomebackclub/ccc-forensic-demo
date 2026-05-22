// src/utils/storage.js
// IndexedDB persistence for CCC Forensic Suite.
// Pure client-side — no server, no network. Data lives in this browser.

const DB_NAME = 'ccc_forensic';
const DB_VERSION = 1;
const STORE_AUDITS = 'audits';
const STORE_LETTERS = 'letters';

function slug(s) {
  return String(s || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'unknown';
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_AUDITS)) {
        const s = db.createObjectStore(STORE_AUDITS, { keyPath: 'id' });
        s.createIndex('clientName', 'clientName', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_LETTERS)) {
        const s = db.createObjectStore(STORE_LETTERS, { keyPath: 'id' });
        s.createIndex('clientName', 'clientName', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, store, mode) {
  return db.transaction(store, mode).objectStore(store);
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveAudit(audit) {
  const db = await openDB();
  const clientName = (audit && audit.client && audit.client.name) || 'Unknown Client';
  const clientAddress = (audit && audit.client && audit.client.address) || null;
  const reportDate = (audit && audit.client && audit.client.reportDate) || todayISO();
  const record = {
    id: slug(clientName) + '__' + reportDate,
    clientName,
    clientAddress,
    reportDate,
    savedAt: new Date().toISOString(),
    audit,
  };
  await reqToPromise(tx(db, STORE_AUDITS, 'readwrite').put(record));
  db.close();
  return record.id;
}

export async function saveLetter(account, client, html) {
  const db = await openDB();
  const clientName = (client && client.name) || 'Unknown Client';
  const furnisher = (account && account.furnisher) || 'Unknown Furnisher';
  const accountId = (account && (account.id || account.accountNumberMasked)) || '';
  const date = todayISO();
  const record = {
    id: slug(clientName) + '__' + slug(furnisher) + '__' + date,
    clientName,
    furnisher,
    accountId,
    phase: 'Phase 1',
    type: (account && account.type) || null,
    savedAt: new Date().toISOString(),
    date,
    html,
  };
  await reqToPromise(tx(db, STORE_LETTERS, 'readwrite').put(record));
  db.close();
  return record.id;
}

export async function listClients() {
  const db = await openDB();
  const audits = await reqToPromise(tx(db, STORE_AUDITS, 'readonly').getAll());
  const letters = await reqToPromise(tx(db, STORE_LETTERS, 'readonly').getAll());
  db.close();

  const map = new Map();
  const ensure = (name) => {
    if (!map.has(name)) {
      map.set(name, { name, address: null, audits: [], letters: [], lastActivity: '' });
    }
    return map.get(name);
  };

  for (const a of audits) {
    const c = ensure(a.clientName);
    c.address = c.address || a.clientAddress;
    c.audits.push(a);
    if (a.savedAt > c.lastActivity) c.lastActivity = a.savedAt;
  }
  for (const l of letters) {
    const c = ensure(l.clientName);
    c.letters.push(l);
    if (l.savedAt > c.lastActivity) c.lastActivity = l.savedAt;
  }

  const out = Array.from(map.values());
  out.forEach((c) => {
    c.audits.sort((x, y) => (y.savedAt || '').localeCompare(x.savedAt || ''));
    c.letters.sort((x, y) => (y.savedAt || '').localeCompare(x.savedAt || ''));
  });
  out.sort((x, y) => (y.lastActivity || '').localeCompare(x.lastActivity || ''));
  return out;
}

export async function deleteClient(clientName) {
  const db = await openDB();
  for (const store of [STORE_AUDITS, STORE_LETTERS]) {
    const objStore = tx(db, store, 'readwrite');
    const idx = objStore.index('clientName');
    const keys = await reqToPromise(idx.getAllKeys(clientName));
    for (const k of keys) {
      await reqToPromise(objStore.delete(k));
    }
  }
  db.close();
}
