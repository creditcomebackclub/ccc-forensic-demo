import React, { useEffect, useState, useRef } from 'react';
import { Users, FileText, Mail, Trash2, ChevronDown, ChevronRight, RefreshCw, Shield, Star, Zap, X, Send } from 'lucide-react';
import { listClients, adminListClients, deleteClient, updateLetter, toggleVip } from '../utils/storage';
import ResponseAnalyzer from './ResponseAnalyzer';
import DocumentManager from './DocumentManager';
import LobMailer from './LobMailer';

const WINDOW_DAYS = 30;
const VIP_RESPONSE_DAYS = 1;
const STD_RESPONSE_DAYS = 3;

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function fmt(iso) {
  if (!iso) return '';
  const s = String(iso).length === 10 ? iso + 'T00:00:00' : iso;
  try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch (e) { return iso; }
}

function fmtTime(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch (e) { return iso; }
}

function daysBetween(aIso, bIso) {
  const a = new Date(String(aIso).slice(0, 10) + 'T00:00:00');
  const b = new Date(String(bIso).slice(0, 10) + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function hoursBetween(aIso, bIso) {
  return Math.round((new Date(bIso) - new Date(aIso)) / 3600000);
}

function letterStatus(l) {
  if (l.responseOutcome === 'received') return { code: 'received', label: 'Response received' + (l.responseDate ? ' · ' + fmt(l.responseDate) : ''), tone: 'green' };
  if (l.responseOutcome === 'no_response') return { code: 'no_response', label: 'No response confirmed', tone: 'red' };
  if (!l.mailedDate) return { code: 'not_mailed', label: 'Not mailed', tone: 'neutral' };
  const elapsed = daysBetween(l.mailedDate, todayISO());
  const remaining = WINDOW_DAYS - elapsed;
  if (remaining > 0) return { code: 'awaiting', label: 'Awaiting · ' + remaining + 'd left', tone: 'amber' };
  return { code: 'window_closed', label: 'Window elapsed · ready to escalate', tone: 'red' };
}

function clientMatchesFilter(c, filter) {
  if (!filter) return true;
  const openLetters = c.letters.filter((l) => !l.phase?.startsWith('Phase 3'));
  switch (filter) {
    case 'active': return openLetters.length > 0;
    case 'awaiting': return openLetters.some((l) => letterStatus(l).code === 'awaiting');
    case 'escalate': return openLetters.some((l) => {
      const st = letterStatus(l);
      const hasPhase3 = c.letters.some((pl) => pl.phase?.startsWith('Phase 3') && pl.furnisher === l.furnisher);
      return (st.code === 'window_closed' || st.code === 'no_response') && !hasPhase3;
    });
    case 'phase3': return c.letters.some((l) => l.phase?.startsWith('Phase 3'));
    case 'received': return openLetters.some((l) => l.responseOutcome === 'received');
    default: return true;
  }
}

const FILTER_LABELS = {
  active: 'Active Campaigns',
  awaiting: 'Awaiting Response',
  escalate: 'Ready to Escalate',
  phase3: 'Phase 3 Active',
  received: 'Response Received',
};

function StatusBadge({ label, tone }) {
  const map = { neutral: 'bg-gray-100 text-gray-600', amber: 'bg-amber-50 text-amber-700', green: 'bg-green-50 text-green-700', red: 'bg-red-50 text-red-700' };
  return <span className={'inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm ' + (map[tone] || map.neutral)}>{label}</span>;
}

function AuditorTag({ name }) {
  if (!name) return null;
  return <span className="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-navy text-gold">{name}</span>;
}

function LetterRow({ l, isAdmin, isVip, onView, onChange, onAnalyze, onLobMail }) {
  const [mode, setMode] = useState(null);
  const [dateVal, setDateVal] = useState(todayISO());
  const status = letterStatus(l);
  const isPhase3 = l.phase && l.phase.startsWith('Phase 3');

  const urgency = (() => {
    if (l.responseOutcome !== 'received' || !l.responseDate) return null;
    const deadline = isVip ? VIP_RESPONSE_DAYS : STD_RESPONSE_DAYS;
    const hoursLeft = (deadline * 24) - hoursBetween(l.responseDate, new Date().toISOString());
    if (hoursLeft <= 0) return { label: 'Response overdue', tone: 'red' };
    if (isVip) return { label: 'VIP · ' + Math.max(0, Math.round(hoursLeft)) + 'h to respond', tone: 'red' };
    const daysLeft = Math.ceil(hoursLeft / 24);
    return { label: daysLeft + 'd to respond', tone: daysLeft <= 1 ? 'red' : 'amber' };
  })();

  const save = async (patch) => {
    try {
      await updateLetter(l.id, patch);
      setMode(null);
      onChange();
    } catch (e) { alert('Could not save: ' + (e.message || e)); }
  };

  return (
    <div className="py-2 border-b border-border last:border-b-0">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-[12px] text-ink min-w-0">
          <span className="font-medium">{l.furnisher}</span>
          <span className="text-ink-muted"> · </span>
          <span className={isPhase3 ? 'font-medium' : 'text-ink-muted'} style={{ color: isPhase3 ? '#C9A84C' : undefined }}>{l.phase}</span>
          <span className="text-ink-muted"> · {fmtTime(l.savedAt)}</span>
          {l.mailedDate && <span className="text-ink-muted"> · mailed {fmt(l.mailedDate)}</span>}
          {l.trackingNumber && (
            <a href={"https://tools.usps.com/go/TrackConfirmAction?tLabels=" + l.trackingNumber} target="_blank" rel="noopener noreferrer" className="text-[10px] uppercase tracking-wider text-navy hover:text-gold ml-2">USPS #{l.trackingNumber.slice(-8)}</a>
          )}
          {l.lobId && !l.trackingNumber && (
            <span className="text-[10px] text-ink-faint ml-2">Lob: {l.lobId.slice(0, 12)}</span>
          )}
          {l.trackingStatus && (
            <span className={'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm ml-1 ' + (l.trackingStatus === 'Delivered' ? 'bg-green-50 text-green-700' : l.trackingStatus.includes('Returned') ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700')}>
              {l.trackingStatus}
            </span>
          )}
          {l.trackingStatus && (
            <span className={'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm ml-1 ' +
              (l.trackingStatus === 'Delivered' ? 'bg-green-50 text-green-700' :
               l.trackingStatus.includes('Returned') ? 'bg-red-50 text-red-700' :
               'bg-blue-50 text-blue-700')}>
              {l.trackingStatus}
            </span>
          )}
            <span className="text-[10px] text-ink-faint ml-2">Lob: {l.lobId.slice(0, 12)}…</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {isAdmin && <AuditorTag name={l.auditorName} />}
          {urgency && <StatusBadge label={urgency.label} tone={urgency.tone} />}
          <StatusBadge label={status.label} tone={status.tone} />
          <button onClick={() => onView(l)} className="text-[11px] uppercase tracking-wider text-navy hover:text-gold">View</button>
          {!isPhase3 && (status.code === 'received' || status.code === 'window_closed' || status.code === 'no_response') && (
            <button onClick={() => onAnalyze(l)}
              className="flex items-center gap-1 text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-sm"
              style={{ backgroundColor: '#1B2A4A', color: '#C9A84C' }}>
              <Zap size={11} strokeWidth={2} /> Analyze
            </button>
          )}
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-3 flex-wrap">
        {mode === 'mailing' && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ink-muted">Mail date:</span>
            <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} className="text-[12px] border border-border rounded-sm px-2 py-0.5" />
            <button onClick={() => save({ mailedDate: dateVal })} className="text-[11px] uppercase tracking-wider text-white bg-navy px-2 py-0.5 rounded-sm">Save</button>
            <button onClick={() => setMode(null)} className="text-[11px] uppercase tracking-wider text-ink-muted">Cancel</button>
          </div>
        )}
        {mode === 'responding' && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-ink-muted">Response date:</span>
            <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} className="text-[12px] border border-border rounded-sm px-2 py-0.5" />
            <button onClick={() => save({ responseOutcome: 'received', responseDate: dateVal })} className="text-[11px] uppercase tracking-wider text-white bg-navy px-2 py-0.5 rounded-sm">Save</button>
            <button onClick={() => setMode(null)} className="text-[11px] uppercase tracking-wider text-ink-muted">Cancel</button>
          </div>
        )}
        {mode === null && (
          <>
            {!l.mailedDate && (
              <div className="flex items-center gap-3 flex-wrap">
                <button onClick={() => { setDateVal(todayISO()); setMode('mailing'); }} className="text-[11px] uppercase tracking-wider text-navy hover:text-gold">Mark mailed</button>
                <button onClick={() => onLobMail(l)}
                  className="flex items-center gap-1 text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-sm border border-navy text-navy hover:bg-navy hover:text-gold transition-colors">
                  <Send size={11} strokeWidth={2} /> Send via Lob
                </button>
              </div>
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

export default function ClientsPage({ onOpenAudit, isAdmin, jumpTo, filter: initialFilter }) {
  const [clients, setClients] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [analyzingLetter, setAnalyzingLetter] = useState(null);
  const [togglingVip, setTogglingVip] = useState(null);
  const [lobMailerLetter, setLobMailerLetter] = useState(null);
  const [activeFilter, setActiveFilter] = useState(initialFilter || null);
  const clientRefs = useRef({});

  const load = async () => {
    try {
      const list = isAdmin ? await adminListClients() : await listClients();
      setClients(list);
    } catch (e) {
      console.error('Failed to load clients', e);
      setClients([]);
    }
  };

  useEffect(() => { load(); }, [isAdmin]);

  useEffect(() => {
    if (!jumpTo || !clients) return;
    setExpanded((prev) => ({ ...prev, [jumpTo]: true }));
    setTimeout(() => {
      const el = clientRefs.current[jumpTo];
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 150);
  }, [jumpTo, clients]);

  useEffect(() => {
    if (initialFilter) setActiveFilter(initialFilter);
  }, [initialFilter]);

  const toggle = (name) => setExpanded((prev) => ({ ...prev, [name]: !prev[name] }));

  const openLetter = (letter) => {
    const w = window.open('', '_blank');
    if (!w) { alert('Popup blocked — allow popups to view letters.'); return; }
    w.document.open();
    w.document.write(letter.html);
    w.document.close();
  };

  const handleDelete = async (name) => {
    await deleteClient(name);
    setConfirmDelete(null);
    load();
  };

  const handleVipToggle = async (clientName, currentVip) => {
    setTogglingVip(clientName);
    try {
      await toggleVip(clientName, !currentVip);
      await load();
    } catch (e) {
      alert('Could not update VIP status: ' + (e.message || e));
    } finally {
      setTogglingVip(null);
    }
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
        <p className="text-[13px] text-ink-muted mt-2">Run an audit and it will be saved here automatically.</p>
      </div>
    );
  }

  const sortedClients = [...clients].sort((a, b) => {
    if (a.isVip && !b.isVip) return -1;
    if (!a.isVip && b.isVip) return 1;
    return (b.lastActivity || '').localeCompare(a.lastActivity || '');
  });

  const filteredClients = activeFilter
    ? sortedClients.filter((c) => clientMatchesFilter(c, activeFilter))
    : sortedClients;

  const totalAudits = clients.reduce((n, c) => n + c.audits.length, 0);
  const totalLetters = clients.reduce((n, c) => n + c.letters.length, 0);
  const totalRipe = clients.reduce((n, c) => n + c.letters.filter((l) => letterStatus(l).code === 'window_closed').length, 0);
  const needsResponse = clients.reduce((n, c) => n + c.letters.filter((l) => l.responseOutcome === 'received' && !l.phase?.startsWith('Phase 3')).length, 0);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          {isAdmin && (
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm bg-navy text-gold">
              <Shield size={11} strokeWidth={2} /> Admin View
            </span>
          )}
          <p className="text-[12px] text-ink-muted">
            {clients.length} client{clients.length === 1 ? '' : 's'} · {totalAudits} audit{totalAudits === 1 ? '' : 's'} · {totalLetters} letter{totalLetters === 1 ? '' : 's'}
            {totalRipe > 0 && <span className="text-red-600 font-medium"> · {totalRipe} ready to escalate</span>}
            {needsResponse > 0 && <span className="text-amber-600 font-medium"> · {needsResponse} need Phase 3</span>}
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">
          <RefreshCw size={13} strokeWidth={1.75} /> Refresh
        </button>
      </div>

      {activeFilter && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-[11px] text-ink-muted">Filtered:</span>
          <span className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider px-2 py-1 rounded-sm bg-navy text-gold">
            {FILTER_LABELS[activeFilter] || activeFilter}
            <button onClick={() => setActiveFilter(null)} className="hover:text-white ml-1">
              <X size={11} strokeWidth={2.5} />
            </button>
          </span>
          <span className="text-[11px] text-ink-muted">{filteredClients.length} of {clients.length} clients</span>
        </div>
      )}

      <div className="space-y-3">
        {filteredClients.map((c) => {
          const isOpen = !!expanded[c.name];
          const ripe = c.letters.filter((l) => letterStatus(l).code === 'window_closed').length;
          const awaiting = c.letters.filter((l) => letterStatus(l).code === 'awaiting').length;
          const needsPhase3 = c.letters.filter((l) => l.responseOutcome === 'received' && !l.phase?.startsWith('Phase 3')).length;
          const auditors = isAdmin ? [...new Set([
            ...c.audits.map((a) => a.auditorName),
            ...c.letters.map((l) => l.auditorName),
          ].filter(Boolean))] : [];

          return (
            <div
              key={c.name}
              ref={(el) => { clientRefs.current[c.name] = el; }}
              className="bg-white rounded overflow-hidden transition-shadow"
              style={{
                border: c.name === jumpTo ? '2px solid #C9A84C' : (c.isVip ? '1px solid #C9A84C' : '1px solid #E5E7EB'),
                boxShadow: c.name === jumpTo ? '0 0 0 3px rgba(201,168,76,0.15)' : 'none',
              }}
            >
              <div className="flex items-center gap-3 px-5 py-4">
                <button onClick={() => toggle(c.name)} className="shrink-0">
                  {isOpen ? <ChevronDown size={16} strokeWidth={1.75} className="text-ink-muted" /> : <ChevronRight size={16} strokeWidth={1.75} className="text-ink-muted" />}
                </button>
                <button onClick={() => toggle(c.name)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <div className="ccc-display text-[15px] text-ink font-medium">{c.name}</div>
                    {c.isVip && (
                      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium" style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}>
                        <Star size={9} strokeWidth={2.5} /> VIP
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mt-0.5">
                    {c.address && <span className="text-[11px] text-ink-muted truncate">{c.address}</span>}
                    {isAdmin && auditors.map((a) => (
                      <span key={a} className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-navy text-gold">{a}</span>
                    ))}
                  </div>
                </button>
                <div className="flex items-center gap-3 text-[11px] text-ink-muted shrink-0 flex-wrap justify-end">
                  {needsPhase3 > 0 && <StatusBadge label={needsPhase3 + ' need Phase 3'} tone="amber" />}
                  {ripe > 0 && <StatusBadge label={ripe + ' to escalate'} tone="red" />}
                  {awaiting > 0 && <StatusBadge label={awaiting + ' awaiting'} tone="amber" />}
                  <span className="flex items-center gap-1"><FileText size={13} strokeWidth={1.75} />{c.audits.length}</span>
                  <span className="flex items-center gap-1"><Mail size={13} strokeWidth={1.75} />{c.letters.length}</span>
                  <button
                    onClick={() => handleVipToggle(c.name, c.isVip)}
                    disabled={togglingVip === c.name}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border transition-colors"
                    style={{ borderColor: c.isVip ? '#C9A84C' : '#E5E7EB', color: c.isVip ? '#C9A84C' : '#9CA3AF' }}
                  >
                    <Star size={10} strokeWidth={2} />
                    {togglingVip === c.name ? '…' : c.isVip ? 'VIP' : 'Set VIP'}
                  </button>
                </div>
              </div>

              {isOpen && (
                <div className="border-t border-border px-5 py-4 space-y-4">
                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Audits</div>
                    {c.audits.length === 0 && <div className="text-[12px] text-ink-muted">None</div>}
                    {c.audits.map((a) => (
                      <div key={a.id} className="flex items-center justify-between py-1.5 flex-wrap gap-2">
                        <div className="text-[12px] text-ink">
                          Report {a.reportDate}
                          <span className="text-ink-muted"> · {(a.audit && a.audit.accountsTargeted) || 0} accounts · {(a.audit && a.audit.totalViolations) || 0} violations</span>
                          {isAdmin && a.auditorName && <span className="ml-2 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm bg-navy text-gold">{a.auditorName}</span>}
                          <span className="text-ink-faint text-[11px] ml-2">{fmtTime(a.savedAt)}</span>
                        </div>
                        <button onClick={() => onOpenAudit(a.audit)} className="text-[11px] uppercase tracking-wider text-navy hover:text-gold">Open</button>
                      </div>
                    ))}
                  </div>

                  <div>
                    <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Letters</div>
                    {c.letters.length === 0 && <div className="text-[12px] text-ink-muted">None</div>}
                    {c.letters.map((l) => (
                      <LetterRow key={l.id} l={l} isAdmin={isAdmin} isVip={c.isVip} onView={openLetter} onChange={load} onAnalyze={setAnalyzingLetter} onLobMail={setLobMailerLetter} />
                    ))}
                  </div>

                  <div>
                    <DocumentManager clientName={c.name} onChanged={load} />
                  </div>

                  <div className="pt-2 border-t border-border">
                    {confirmDelete === c.name ? (
                      <div className="flex items-center gap-3">
                        <span className="text-[12px] text-red-600">Delete all records for {c.name}?</span>
                        <button onClick={() => handleDelete(c.name)} className="text-[11px] uppercase tracking-wider text-white bg-red-600 px-3 py-1 rounded-sm">Confirm Delete</button>
                        <button onClick={() => setConfirmDelete(null)} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">Cancel</button>
                      </div>
                    ) : (
                      <button onClick={() => setConfirmDelete(c.name)} className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-muted hover:text-red-600">
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

      {lobMailerLetter && (
        <LobMailer
          letter={lobMailerLetter}
          onClose={() => setLobMailerLetter(null)}
          onSent={async (data) => {
            await updateLetter(lobMailerLetter.id, {
              mailedDate: data.mailedDate,
              lobId: data.lobId,
              trackingNumber: data.trackingNumber,
            });
            setLobMailerLetter(null);
            load();
          }}
        />
      )}

      {analyzingLetter && (
        <ResponseAnalyzer
          letter={analyzingLetter}
          onClose={() => setAnalyzingLetter(null)}
          onSaved={() => { setAnalyzingLetter(null); load(); }}
        />
      )}
    </div>
  );
}
