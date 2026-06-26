import React, { useEffect, useState, useRef } from 'react';
import { Users, FileText, Mail, UserPlus, Trash2, ChevronDown, ChevronRight, RefreshCw, Shield, Star, Zap, X, Send } from 'lucide-react';
import { listClients, adminListClients, deleteClient, updateLetter, deleteLetter, toggleVip, updateClientEmail } from '../utils/storage';
import ResponseAnalyzer from './ResponseAnalyzer';
import DocumentManager from './DocumentManager';
import ClientProfilePanel from './ClientProfilePanel';
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
  const clockStart = l.deliveredAt ? l.deliveredAt.slice(0, 10) : l.mailedDate;
  const elapsed = daysBetween(clockStart, todayISO());
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

  const handleDelete = async () => {
    const confirmMsg = l.mailedDate
      ? 'This letter was already mailed via certified mail on ' + fmt(l.mailedDate) + '. Deleting it only removes it from CCC\'s tracking system \u2014 it does NOT recall the physical mail already sent to ' + l.furnisher + '. This cannot be undone. Continue?'
      : 'Delete this letter draft for ' + l.furnisher + '? This cannot be undone.';
    if (!window.confirm(confirmMsg)) return;
    try {
      await deleteLetter(l.id);
      onChange();
    } catch (e) { alert('Could not delete: ' + (e.message || e)); }
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
            <a href={"https://tools.usps.com/go/TrackConfirmAction?tLabels=" + l.trackingNumber} target="_blank" rel="noopener noreferrer" className="text-[10px] uppercase tracking-wider text-navy hover:text-gold ml-2">USPS #{l.trackingNumber ? l.trackingNumber.slice(-8) : ""}</a>
          )}
          {l.lobId && !l.trackingNumber && (
            <span className="text-[10px] text-ink-faint ml-2">Lob: {l.lobId ? l.lobId.slice(0, 12) : ""}</span>
          )}
          {l.trackingStatus && (
            <span className={'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm ml-1 ' + (l.trackingStatus === 'Delivered' ? 'bg-green-50 text-green-700' : l.trackingStatus.includes('Returned') ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700')}>
              {l.trackingStatus}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap">
          {isAdmin && <AuditorTag name={l.auditorName} />}
          {urgency && <StatusBadge label={urgency.label} tone={urgency.tone} />}
          <StatusBadge label={status.label} tone={status.tone} />
          <button onClick={() => onView(l)} className="text-[11px] uppercase tracking-wider text-navy hover:text-gold">View</button>
          <button onClick={handleDelete} className="text-[11px] uppercase tracking-wider text-ink-faint hover:text-red-600" title="Delete letter">Delete</button>
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
                {!l.lobId && (
                  <button onClick={() => { setDateVal(todayISO()); setMode('mailing'); }} className="text-[11px] uppercase tracking-wider text-navy hover:text-gold">Mark mailed</button>
                )}
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


function parseBureauAddress(phase) {
  const bureauMap = {
    'equifax': { name: 'Equifax Information Services LLC', line1: 'P.O. Box 740256', city: 'Atlanta', state: 'GA', zip: '30374-0256' },
    'experian': { name: 'Experian Information Solutions Inc.', line1: 'P.O. Box 4500', city: 'Allen', state: 'TX', zip: '75013' },
    'transunion': { name: 'TransUnion LLC', line1: 'P.O. Box 2000', city: 'Chester', state: 'PA', zip: '19016' },
  };
  if (!phase) return null;
  const lower = phase.toLowerCase();
  for (const [key, addr] of Object.entries(bureauMap)) {
    if (lower.includes(key)) return addr;
  }
  return null;
}

function parseFurnisherAddress(furnisher) {
  const map = {
    'capital one bank': { name: 'Capital One', line1: 'P.O. Box 30279', city: 'Salt Lake City', state: 'UT', zip: '84130-0279' },
    'capital one auto': { name: 'Capital One Auto Finance', line1: 'P.O. Box 660367', city: 'Dallas', state: 'TX', zip: '75266-0367' },
    'caponeauto': { name: 'Capital One Auto Finance', line1: 'P.O. Box 660367', city: 'Dallas', state: 'TX', zip: '75266-0367' },
    'discover': { name: 'Discover Bank', line1: 'P.O. Box 30943', city: 'Salt Lake City', state: 'UT', zip: '84130' },
    'jpmcb': { name: 'JPMorgan Chase Bank N.A.', line1: 'P.O. Box 15369', city: 'Wilmington', state: 'DE', zip: '19850-5369' },
    'chase': { name: 'JPMorgan Chase Bank N.A.', line1: 'P.O. Box 15369', city: 'Wilmington', state: 'DE', zip: '19850-5369' },
    'verizon': { name: 'Verizon Wireless', line1: 'P.O. Box 660108', city: 'Dallas', state: 'TX', zip: '75266-0108' },
    'american express': { name: 'American Express', line1: 'P.O. Box 981535', city: 'El Paso', state: 'TX', zip: '79998-1535' },
    'amex': { name: 'American Express', line1: 'P.O. Box 981535', city: 'El Paso', state: 'TX', zip: '79998-1535' },
    'wells fargo': { name: 'Wells Fargo Bank N.A.', line1: 'P.O. Box 393', city: 'Minneapolis', state: 'MN', zip: '55480-0393' },
    'synchrony': { name: 'Synchrony Bank', line1: 'P.O. Box 965061', city: 'Orlando', state: 'FL', zip: '32896-5061' },
    'syncb': { name: 'Synchrony Bank', line1: 'P.O. Box 965061', city: 'Orlando', state: 'FL', zip: '32896-5061' },
    'suzuki': { name: 'Synchrony Bank', line1: 'P.O. Box 965061', city: 'Orlando', state: 'FL', zip: '32896-5061' },
    'navy federal': { name: 'Navy Federal Credit Union', line1: 'P.O. Box 3500', city: 'Merrifield', state: 'VA', zip: '22119-3500' },
    'onemain': { name: 'OneMain Financial', line1: 'P.O. Box 1010', city: 'Evansville', state: 'IN', zip: '47706-1010' },
    'ally': { name: 'Ally Financial', line1: 'P.O. Box 380901', city: 'Bloomington', state: 'MN', zip: '55438' },
    'lvnv': { name: 'LVNV Funding LLC', line1: 'P.O. Box 10587', city: 'Greenville', state: 'SC', zip: '29603-0587' },
    'midland': { name: 'Midland Credit Management', line1: 'P.O. Box 939019', city: 'San Diego', state: 'CA', zip: '92193-9019' },
    'portfolio recovery': { name: 'Portfolio Recovery Associates LLC', line1: 'P.O. Box 12914', city: 'Norfolk', state: 'VA', zip: '23541' },
    'jefferson capital': { name: 'Jefferson Capital Systems LLC', line1: 'P.O. Box 7999', city: 'Saint Cloud', state: 'MN', zip: '56302-7999' },
    'hunter warfield': { name: 'Hunter Warfield Inc.', line1: '4620 Woodland Corporate Blvd', city: 'Tampa', state: 'FL', zip: '33614' },
    'merrick bank': { name: 'Merrick Bank Corp', line1: 'P.O. Box 9201', city: 'Old Bethpage', state: 'NY', zip: '11804-9001' },
    'barclays': { name: 'Barclays Bank Delaware', line1: 'P.O. Box 8803', city: 'Wilmington', state: 'DE', zip: '19899-8803' },
    'comenity': { name: 'Comenity Bank', line1: 'P.O. Box 182273', city: 'Columbus', state: 'OH', zip: '43218-2273' },
    'santander': { name: 'Santander Consumer USA', line1: 'P.O. Box 961245', city: 'Fort Worth', state: 'TX', zip: '76161-1245' },
    'hyundai': { name: 'Hyundai Capital America', line1: 'P.O. Box 20829', city: 'Fountain Valley', state: 'CA', zip: '92728' },
    'credit corp': { name: 'Credit Corp Solutions Inc.', line1: 'P.O. Box 57510', city: 'Murray', state: 'UT', zip: '84157' },
    'sequoia': { name: 'Sequoia Concepts Inc.', line1: 'P.O. Box 4386', city: 'Portland', state: 'OR', zip: '97208' },
    'continental finance': { name: 'Continental Finance Company LLC', line1: 'P.O. Box 3220', city: 'Buffalo', state: 'NY', zip: '14240-3220' },
    'aldous': { name: 'Aldous & Associates PLLC', line1: 'P.O. Box 171374', city: 'Holladay', state: 'UT', zip: '84117' },
    'prestige financial': { name: 'Prestige Financial Services Inc.', line1: 'P.O. Box 26707', city: 'Salt Lake City', state: 'UT', zip: '84126' },
    'prestige': { name: 'Prestige Financial Services Inc.', line1: 'P.O. Box 26707', city: 'Salt Lake City', state: 'UT', zip: '84126' },
    'align balance': { name: 'Align Balance LLC', line1: '175 W. Jackson Blvd, Suite 600', city: 'Chicago', state: 'IL', zip: '60604' },
    'alignbalance': { name: 'Align Balance LLC', line1: '175 W. Jackson Blvd, Suite 600', city: 'Chicago', state: 'IL', zip: '60604' },
  };
  const lower = (furnisher || '').toLowerCase();
  for (const [key, addr] of Object.entries(map)) {
    if (lower.includes(key)) return addr;
  }
  return null;
}
export default function ClientsPage({ onOpenAudit, isAdmin, jumpTo, filter: initialFilter }) {
  const [clients, setClients] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [analyzingLetter, setAnalyzingLetter] = useState(null);
  const [togglingVip, setTogglingVip] = useState(null);
  const [lobMailerLetter, setLobMailerLetter] = useState(null);
  const [activeFilter, setActiveFilter] = useState(initialFilter || null);
  const [editingEmail, setEditingEmail] = useState(null);
  const [activeTab, setActiveTab] = useState({});
  const [emailVal, setEmailVal] = useState('');
  const [sendingLpoa, setSendingLpoa] = useState(null);
  const [showCreateClient, setShowCreateClient] = useState(false);
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

  const handleSendLpoa = async (c) => {
    if (!c.email) { alert('Add client email first'); return; }
    setSendingLpoa(c.name);
    try {
      const signingUrl = window.location.origin + '/sign-lpoa.html?client=' + encodeURIComponent(c.name);
      const res = await fetch('/.netlify/functions/send-lpoa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', clientName: c.name, clientEmail: c.email, lpoaUrl: signingUrl }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Send failed');
      alert('LPOA signing link sent to ' + c.email);
    } catch (e) {
      alert('Could not send LPOA: ' + e.message);
    } finally {
      setSendingLpoa(null);
    }
  };

  // Render modal at top level
  const createModal = showCreateClient ? (
    <CreateClientModal
      onClose={() => setShowCreateClient(false)}
      onCreated={() => { setShowCreateClient(false); load(); }}
    />
  ) : null;

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
        <div className="flex items-center gap-3">
          {isAdmin && (
            <button onClick={() => setShowCreateClient(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider rounded-sm transition-colors"
              style={{ backgroundColor: '#1B2A4A', color: '#C9A84C' }}>
              <UserPlus size={12} strokeWidth={2} /> New Client
            </button>
          )}
          <button onClick={load} className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">
            <RefreshCw size={13} strokeWidth={1.75} /> Refresh
          </button>
        </div>
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
                  {editingEmail === c.name ? (
                    <div className="flex items-center gap-2 mt-1" onClick={(e) => e.stopPropagation()}>
                      <input type="email" value={emailVal} onChange={(e) => setEmailVal(e.target.value)}
                        className="text-[11px] border border-border rounded-sm px-2 py-0.5 w-48"
                        placeholder="client@email.com" autoFocus
                        onKeyDown={(e) => { if (e.key === 'Enter') { updateClientEmail(c.name, emailVal).then(load); setEditingEmail(null); } if (e.key === 'Escape') setEditingEmail(null); }} />
                      <button onClick={() => { updateClientEmail(c.name, emailVal).then(load); setEditingEmail(null); }} className="text-[10px] uppercase tracking-wider text-white bg-navy px-2 py-0.5 rounded-sm">Save</button>
                      <button onClick={() => setEditingEmail(null)} className="text-[10px] text-ink-muted">Cancel</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-ink-muted">{c.email || <span className="text-amber-600">No email</span>}</span>
                      <button onClick={(e) => { e.stopPropagation(); setEditingEmail(c.name); setEmailVal(c.email || ''); }} className="text-[10px] text-ink-faint hover:text-navy">✎</button>
                    </div>
                  )}
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
                  {c.lpoaSigned ? (
                    <div className="flex items-center gap-1.5">
                      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-green-50 text-green-700 border border-green-200">
                        ✓ LPOA Signed
                      </span>
                      {c.lpoaSignatureData && c.lpoaSignatureData.lpoaUrl && (
                        <a href={c.lpoaSignatureData.lpoaUrl} target="_blank" rel="noopener noreferrer"
                          className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border border-border text-ink-muted hover:text-navy hover:border-navy transition-colors">
                          View
                        </a>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleSendLpoa(c); }}
                        disabled={!c.email || sendingLpoa === c.name}
                        className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border border-amber-400 text-amber-700 hover:bg-amber-50 transition-colors"
                        title={!c.email ? 'Add email first' : 'Send LPOA for signature'}
                      >
                        {sendingLpoa === c.name ? 'Sending…' : '✉ Send LPOA'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); window.open('/lpoa-sign.html?client=' + encodeURIComponent(c.name), '_blank'); }}
                        className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm border border-border text-ink-muted hover:text-navy hover:border-navy transition-colors"
                        title="Preview LPOA"
                      >
                        Preview
                      </button>
                    </div>
                  )}
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

                  {/* Tab nav */}
                  <div className="flex gap-1 border-b border-border mb-4">
                    {['Letters', 'Profile', 'Documents'].map((tab) => (
                      <button key={tab}
                        onClick={() => setActiveTab((p) => ({ ...p, [c.name]: tab }))}
                        className={'px-3 py-1.5 text-[11px] uppercase tracking-wider transition-colors ' +
                          ((activeTab[c.name] || 'Letters') === tab
                            ? 'border-b-2 border-navy text-navy font-medium'
                            : 'text-ink-muted hover:text-ink')}>
                        {tab}
                      </button>
                    ))}
                  </div>

                  {/* Letters tab */}
                  {(activeTab[c.name] || 'Letters') === 'Letters' && (
                    <div className="space-y-1">
                      {c.letters.length === 0 ? (
                        <p className="text-[12px] text-ink-muted py-4 text-center">No letters yet — run an audit to generate Phase 1 letters.</p>
                      ) : (
                        c.letters.map((l) => (
                          <LetterRow key={l.id} l={l} isAdmin={isAdmin} isVip={c.isVip} onView={openLetter} onChange={load} onAnalyze={setAnalyzingLetter} onLobMail={setLobMailerLetter} />
                        ))
                      )}
                    </div>
                  )}

                  {/* Profile tab */}
                  {(activeTab[c.name] || 'Letters') === 'Profile' && (
                    <ClientProfilePanel client={c} onChanged={load} />
                  )}

                  {/* Documents tab */}
                  {(activeTab[c.name] || 'Letters') === 'Documents' && (
                    <DocumentManager clientName={c.name} letters={c.letters || []} onChanged={load} setAnalyzingLetter={setAnalyzingLetter} />
                  )}

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
          furnisherAddress={lobMailerLetter ? (lobMailerLetter.phase && lobMailerLetter.phase.startsWith('Phase 3') ? parseBureauAddress(lobMailerLetter.phase) : parseFurnisherAddress(lobMailerLetter.furnisher)) : null}
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
      {createModal}
    </div>
  );
}


function CreateClientModal({ onClose, onCreated }) {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [success, setSuccess] = React.useState(false);

  const handleCreate = async () => {
    if (!name.trim() || !email.trim()) { setError('Name and email are required.'); return; }
    setLoading(true);
    setError(null);
    try {
      const { supabase } = await import('../utils/supabase');

      // Create client_profiles row
      const { error: cpError } = await supabase.from('client_profiles').upsert({
        full_name: name.trim(),
        email: email.trim().toLowerCase(),
        onboarding_complete: false,
      }, { onConflict: 'email' });
      if (cpError) throw cpError;

      // Send magic link via Supabase
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          emailRedirectTo: window.location.origin,
          data: { full_name: name.trim() },
        },
      });
      if (authError) throw authError;

      setSuccess(true);
      setTimeout(() => { onCreated(); }, 2000);
    } catch (e) {
      setError(e.message || 'Could not create client');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className="bg-white border border-border rounded w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-[14px] font-medium text-ink">New Client</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink">✕</button>
        </div>
        <div className="p-4 space-y-3">
          {success ? (
            <div className="bg-green-50 border border-green-200 rounded-sm p-3 text-[13px] text-green-700 text-center">
              ✓ Invite sent to {email}
            </div>
          ) : (
            <>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">Full Name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Client full name"
                  className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy"
                  onKeyDown={e => e.key === 'Enter' && handleCreate()} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">Email Address</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="client@email.com"
                  className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy"
                  onKeyDown={e => e.key === 'Enter' && handleCreate()} />
              </div>
              {error && <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>}
              <div className="text-[11px] text-ink-muted">Client will receive a magic link to set up their password and complete enrollment.</div>
              <button onClick={handleCreate} disabled={loading}
                className="w-full py-2.5 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                style={{ backgroundColor: loading ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C' }}>
                {loading ? 'Creating…' : 'Create Client & Send Invite'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}