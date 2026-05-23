import React, { useEffect, useState } from 'react';
import { Users, FileText, Mail, Trash2, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { listClients, deleteClient, updateLetter } from '../utils/storage';

const WINDOW_DAYS = 30;

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function fmt(iso) {
  if (!iso) return '';
  const s = String(iso).length === 10 ? iso + 'T00:00:00' : iso;
  try {
    return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) { return iso; }
}

function daysBetween(aIso, bIso) {
  const a = new Date(String(aIso).slice(0, 10) + 'T00:00:00');
  const b = new Date(String(bIso).slice(0, 10) + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function letterStatus(l) {
  if (l.responseOutcome === 'received') {
    return { code: 'received', label: 'Response received' + (l.responseDate ? ' · ' + fmt(l.responseDate) : ''), tone: 'green' };
  }
  if (l.responseOutcome === 'no_response') {
    return { code: 'no_response', label: 'No response confirmed', tone: 'red' };
  }
  if (!l.mailedDate) {
    return { code: 'not_mailed', label: 'Not mailed', tone: 'neutral' };
  }
  const elapsed = daysBetween(l.mailedDate, todayISO());
  const remaining = WINDOW_DAYS - elapsed;
  if (remaining > 0) {
    return { code: 'awaiting', label: 'Awaiting · ' + remaining + 'd left', tone: 'amber' };
  }
  return { code: 'window_closed', label: 'Window elapsed · ready to escalate', tone: 'red' };
}

function StatusBadge({ status }) {
  const map = {
    neutral: 'bg-gray-100 text-gray-600',
    amber: 'bg-amber-50 text-amber-700',
    green: 'bg-green-50 text-green-700',
    red: 'bg-red-50 text-red-700',
  };
  return (
    <span className={'inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm ' + (map[status.tone] || map.neutral)}>
      {status.label}
    </span>
  );
}

function LetterRow({ l, onView, onChange }) {
  const [mode, setMode] = useState(null);
  const [dateVal, setDateVal] = useState(todayISO());
  const status = letterStatus(l);

  const save = async (patch) => {
    try {
      await updateLetter(l.id, patch);
      setMode(null);
      onChange();
    } catch (e) {
      console.error('Update letter failed', e);
      alert('Could not save: ' + (e.message || e));
    }
  };

  return (
    <div className="py-2 border-b border-border last:border-b-0">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] text-ink min-w-0">
          <span className="font-medium">{l.furnisher}</span>
          <span className="text-ink-muted">{' '}· {l.phase} · saved {fmt(l.savedAt)}</span>
          {l.mailedDate && <span className="text-ink-muted">{' '}· mailed {fmt(l.mailedDate)}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StatusBadge status={status} />
          <button onClick={() => onView(l)} className="text-[11px] uppercase tracking-wider text-navy hover:text-gold">View</button>
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-3 flex-wrap">
        {mode === 'mailing' && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ink-muted">Mail date:</span>
            <input
              type="date"
              value={dateVal}
              onChange={(e) => setDateVal(e.target.value)}
              className="text-[12px] border border-border rounded-sm px-2 py-0.5"
            />
            <button onClick={() => save({ mailedDate: dateVal })} className="text-[11px] uppercase tracking-wider text-white bg-navy px-2 py-0.5 rounded-sm">Save</button>
            <button onClick={() => setMode(null)} className="text-[11px] uppercase tracking-wider text-ink-muted">Cancel</button>
          </div>
        )}

        {mode === 'responding' && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ink-muted">Response date:</span>
            <input
              type="date"
              value={dateVal}
              onChange={(e) => setDateVal(e.target.value)}
              className="text-[12px] border border-border rounded-sm px-2 py-0.5"
            />
            <button onClick={() => save({ responseOutcome: 'received', responseDate: dateVal })} className="text-[11px] uppercase tracking-wider text-white bg-navy px-2 py-0.5 rounded-sm">Save</button>
            <button onClick={() => setMode(null)} className="text-[11px] uppercase tracking-wider text-ink-muted">Cancel</button>
          </div>
        )}

        {mode === null && (
          <>
            {!l.mailedDate && (
              <button onClick={() => { setDateVal(todayISO()); setMode('mailing'); }} className="text-[11px] uppercase tracking-wider text-navy hover:text-gold">Mark mailed</button>
            )}
            {l.mailedDate && !l.responseOutcome && (
              <>
                <button onClick={() => { setDateVal(todayISO()); setMode('responding'); }} className="text-[11px] uppercase tracking-wider text-navy hover:text-gold">Log response</button>
                <button onClick={() => save({ responseOutcome: 'no_response' })} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-red-600">Mark no response</button>
                <button onClick={() => { setDateVal(l.mailedDate); setMode('mailing'); }} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">Edit mail date</button>
              </>
            )}
            {l.responseOutcome && (
              <button onClick={() => save({ responseOutcome: null, responseDate: null })} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">Reset response</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function ClientsPage({ onOpenAudit }) {
  const [clients, setClients] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = async () => {
    try {
      const list = await listClients();
      setClients(list);
    } catch (e) {
      console.error('Failed to load clients', e);
      setClients([]);
    }
  };

  useEffect(() => { load(); }, []);

  const toggle = (name) => {
    setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));
  };

  const openLetter = (letter) => {
    const w = window.open('', '_blank');
    if (!w) {
      alert('Popup blocked. Allow popups for this site to view letters.');
      return;
    }
    w.document.open();
    w.document.write(letter.html);
    w.document.close();
  };

  const handleDelete = async (name) => {
    await deleteClient(name);
    setConfirmDelete(null);
    load();
  };

  if (clients === null) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20 text-ink-muted">
        <RefreshCw size={20} className="mx-auto mb-3 animate-spin" strokeWidth={1.5} />
        <p className="text-[13px]">Loading client records…</p>
      </div>
    );
  }

  if (clients.length === 0) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <Users size={28} className="mx-auto mb-3 text-ink-faint" strokeWidth={1.5} />
        <h2 className="ccc-display text-xl text-ink font-medium">No saved clients yet</h2>
        <p className="text-[13px] text-ink-muted mt-2">
          Run an audit and it will be saved here automatically, along with every letter you generate.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-5">
        <p className="text-[12px] text-ink-muted">
          {clients.length} client{clients.length === 1 ? '' : 's'} saved on this device
        </p>
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink"
        >
          <RefreshCw size={13} strokeWidth={1.75} /> Refresh
        </button>
      </div>

      <div className="space-y-3">
        {clients.map((c) => {
          const isOpen = !!expanded[c.name];
          const ripe = c.letters.filter((l) => letterStatus(l).code === 'window_closed').length;
          const awaiting = c.letters.filter((l) => letterStatus(l).code === 'awaiting').length;
          return (
            <div key={c.name} className="bg-white border border-border rounded overflow-hidden">
              <button
                onClick={() => toggle(c.name)}
                className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-gray-50"
              >
                {isOpen
                  ? <ChevronDown size={16} strokeWidth={1.75} className="text-ink-muted shrink-0" />
                  : <ChevronRight size={16} strokeWidth={1.75} className="text-ink-muted shrink-0" />}
                <div className="flex-1 min-w-0">
                  <div className="ccc-display text-[15px] text-ink font-medium">{c.name}</div>
                  {c.address && <div className="text-[11px] text-ink-muted truncate">{c.address}</div>}
                </div>
                <div className="flex items-center gap-3 text-[11px] text-ink-muted shrink-0">
                  {ripe > 0 && (
                    <span className="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-red-50 text-red-700">
                      {ripe} to escalate
                    </span>
                  )}
                  {awaiting > 0 && (
                    <span className="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-amber-50 text-amber-700">
                      {awaiting} awaiting
                    </span>
                  )}
                  <span className="flex items-center gap-1"><FileText size={13} strokeWidth={1.75} />{c.audits.length}</span>
                  <span className="flex items-center gap-1"><Mail size={13} strokeWidth={1.75} />{c.letters.length}</span>
                  <span className="hidden sm:block">{fmt(c.lastActivity)}</span>
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border px-5 py-4 space-y-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Audits</div>
                    {c.audits.length === 0 && <div className="text-[12px] text-ink-muted">None</div>}
                    {c.audits.map((a) => (
                      <div key={a.id} className="flex items-center justify-between py-1.5">
                        <div className="text-[12px] text-ink">
                          Report {a.reportDate}
                          <span className="text-ink-muted">
                            {' '}· {(a.audit && a.audit.accountsTargeted) || (a.audit && a.audit.accounts && a.audit.accounts.length) || 0} accounts
                            {' '}· {(a.audit && a.audit.totalViolations) || 0} violations
                          </span>
                        </div>
                        <button
                          onClick={() => onOpenAudit(a.audit)}
                          className="text-[11px] uppercase tracking-wider text-navy hover:text-gold"
                        >
                          Open
                        </button>
                      </div>
                    ))}
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Letters</div>
                    {c.letters.length === 0 && <div className="text-[12px] text-ink-muted">None</div>}
                    {c.letters.map((l) => (
                      <LetterRow key={l.id} l={l} onView={openLetter} onChange={load} />
                    ))}
                  </div>

                  <div className="pt-2 border-t border-border">
                    {confirmDelete === c.name ? (
                      <div className="flex items-center gap-3">
                        <span className="text-[12px] text-red-600">Delete all records for {c.name}?</span>
                        <button
                          onClick={() => handleDelete(c.name)}
                          className="text-[11px] uppercase tracking-wider text-white bg-red-600 px-3 py-1 rounded-sm hover:bg-red-700"
                        >
                          Confirm Delete
                        </button>
                        <button
                          onClick={() => setConfirmDelete(null)}
                          className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmDelete(c.name)}
                        className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-muted hover:text-red-600"
                      >
                        <Trash2 size={13} strokeWidth={1.75} /> Delete client
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
