import React, { useEffect, useState } from 'react';
import { Users, FileText, Mail, Trash2, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { listClients, deleteClient } from '../utils/storage';

export default function ClientsPage({ onOpenAudit }) {
  const [clients, setClients] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = async () => {
    setClients(null);
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

  const fmt = (iso) => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch (e) { return iso; }
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
                <div className="flex items-center gap-4 text-[11px] text-ink-muted shrink-0">
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
                      <div key={l.id} className="flex items-center justify-between py-1.5">
                        <div className="text-[12px] text-ink">
                          {l.furnisher}
                          <span className="text-ink-muted">{' '}· {l.phase} · {fmt(l.savedAt)}</span>
                        </div>
                        <button
                          onClick={() => openLetter(l)}
                          className="text-[11px] uppercase tracking-wider text-navy hover:text-gold"
                        >
                          View
                        </button>
                      </div>
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
