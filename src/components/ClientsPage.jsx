import React, { useEffect, useState, useRef } from 'react';
import { Toaster, toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { Users, FileText, Mail, UserPlus, ChevronRight, RefreshCw, Star, Zap, X, Send, MoreHorizontal, Search, Pencil } from 'lucide-react';
import { listClientSummaries, getClientDetails, findClientIdByLegacyReference, deleteClient, updateLetter, deleteLetter, toggleVip, updateClientEmail, createLead, convertLeadToClient, revertClientToLead, deleteLead, runProgressDiff, updateLeadInfo, updateLeadStage, markLeadViewed } from '../utils/storage';
import { getReturnReceiptUrl } from '../utils/api';
import { getSettings } from '../utils/settings';
import { getTierPricing, describeTierFee, resolveClientFeeText, hasCustomServiceAgreement } from '../utils/pricing';
import { autoFixFieldCitations, collectBureauFollowUpProblems, collectPhase3CitationProblems, normalizeFollowUpPresentation } from '../constants/metro2Fields';
import { isPhase3FollowUpLetter } from '../utils/followUpEnclosures';
import { hasInjectedSignature, injectSignatureImage } from '../utils/signatureInjection';
import { supabase } from '../utils/supabase';
import { archiveHistoricalMailpiece, getMailArtifactUrl, listMailArtifacts } from '../utils/mailArtifacts';
import { resolveLpoaViewUrl } from '../utils/storagePaths';
import ResponseAnalyzer from './ResponseAnalyzer';
import BureauResponseReview from './BureauResponseReview';
import BureauResponseAnalyzer from './BureauResponseAnalyzer';
import BureauFollowUpPanel from './BureauFollowUpPanel';
import EscalationPanel from './EscalationPanel';
import DocumentManager from './DocumentManager';
import ClientProfilePanel from './ClientProfilePanel';
import ClientBillingPanel from './ClientBillingPanel';
import LobMailer from './LobMailer';

const WINDOW_DAYS = 30;
// 15 U.S.C. §1681i(a)&(e): a CRA-directed CFPB complaint needs 45 days (or
// a no-longer-pending dispute), not the 30 used for Phase 1 — see
// DashboardPage.jsx's identical constant and the ccc-phase4-cfpb-filing-
// rules memory this is built from.
const CRA_WINDOW_DAYS = 45;
const VIP_RESPONSE_DAYS = 1;
const STD_RESPONSE_DAYS = 3;
const CLIENT_PAGE_SIZE = 50;

// Brand tokens — matches the dashboard card system
const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  grid: '#EEF0F4',
  cardShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
};

const LEAD_STAGES = [
  { key: 'new', label: 'New', bg: '#F3F4F6', text: '#6B7280' },
  { key: 'contacted', label: 'Contacted', bg: '#EFF6FF', text: '#1D4ED8' },
  { key: 'audit', label: 'Audit delivered', bg: '#EEF1F7', text: '#3D5A9E' },
  { key: 'ready', label: 'Ready to convert', bg: '#F0FDF4', text: '#15803D' },
];

function leadStage(c) {
  const tag = (c.tags || []).map(String).find((t) => t.startsWith('lead-stage:'));
  if (tag) return tag.slice('lead-stage:'.length);
  return (c.audits || []).length > 0 ? 'audit' : 'new';
}

function isLeadRecent(c) {
  if (!c.leadCreatedAt) return false;
  return new Date(c.leadCreatedAt) > new Date(Date.now() - 48 * 60 * 60 * 1000);
}

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

function letterStatus(l, windowDays = WINDOW_DAYS) {
  if (l.responseOutcome === 'received') return { code: 'received', label: 'Response received' + (l.responseDate ? ' · ' + fmt(l.responseDate) : ''), tone: 'green' };
  if (l.responseOutcome === 'no_response') return { code: 'no_response', label: 'No response confirmed', tone: 'red' };
  if (!l.mailedDate) return { code: 'not_mailed', label: 'Not mailed', tone: 'neutral' };
  if (!l.deliveredAt) return { code: 'in_transit', label: 'In Transit', tone: 'neutral' };
  const clockStart = l.deliveredAt.slice(0, 10);
  const elapsed = daysBetween(clockStart, todayISO());
  const remaining = windowDays - elapsed;
  if (remaining > 0) return { code: 'awaiting', label: 'Awaiting · ' + remaining + 'd left', tone: 'amber' };
  return { code: 'window_closed', label: 'Window elapsed · ready to escalate', tone: 'red' };
}

function importDueInfo(c) {
  if (!c.audits || c.audits.length === 0) return null;
  // storage.js returns audits sorted descending by savedAt, so c.audits[0] is the latest
  const latestAudit = c.audits[0];
  const latestAuditDate = latestAudit.savedAt || latestAudit.reportDate;
  if (!latestAuditDate) return null;

  const elapsed = daysBetween(latestAuditDate.slice(0, 10), todayISO());
  const remaining = 35 - elapsed;

  if (remaining > 0) return { code: 'pending', label: 'Report due in ' + remaining + 'd', tone: 'neutral' };
  return { code: 'due', label: 'Import due', tone: 'amber' };
}

function clientMatchesFilter(c, filter, unanalyzedNames, unanalyzedClientIds) {
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
    case 'phase4': return c.letters.some((l) => {
      if (!l.phase?.startsWith('Phase 3')) return false;
      const st3 = letterStatus(l, CRA_WINDOW_DAYS);
      const hasBureauDecision = l.bureauReviewStatus && l.bureauReviewStatus !== 'not_reviewed';
      return !hasBureauDecision && (st3.code === 'window_closed' || st3.code === 'no_response');
    });
    case 'received': return openLetters.some((l) => l.responseOutcome === 'received');
    case 'noemail': return !c.email;
    case 'vip': return !!c.isVip;
    case 'unanalyzed': return !!unanalyzedClientIds?.has(c.id) || !!unanalyzedNames?.has(c.name);
    default: return true;
  }
}

const FILTER_LABELS = {
  active: 'Active Campaigns',
  awaiting: 'Awaiting Response',
  escalate: 'Ready to Escalate',
  phase3: 'Phase 3 Active',
  phase4: 'Ready for CFPB/AG',
  received: 'Response Received',
  noemail: 'No Email',
  vip: 'VIP',
  unanalyzed: 'Needs Analysis',
};

function ReturnReceiptButton({ lobId, returnReceiptUrl }) {
  const [loading, setLoading] = useState(false);

  async function handleDownload() {
    if (returnReceiptUrl) {
      window.open(returnReceiptUrl, '_blank');
      return;
    }

    setLoading(true);
    try {
      const url = await getReturnReceiptUrl(lobId);
      if (url) {
        window.open(url, '_blank');
      } else {
        toast('USPS has not uploaded the signed receipt yet. This typically takes 24-48 hours after delivery. Please check back later.', { icon: '📬' });
      }
    } catch (e) {
      toast.error(e.message || 'Failed to fetch return receipt');
    } finally {
      setLoading(false);
    }
  }

  return (
    <button onClick={handleDownload} disabled={loading}
      className="text-[10px] uppercase tracking-wider text-navy hover:text-gold ml-2 disabled:opacity-50 transition-colors">
      {loading ? 'Fetching...' : 'Signed Receipt ↓'}
    </button>
  );
}

function StatusBadge({ label, tone }) {
  const map = { neutral: 'bg-gray-100 text-gray-600', amber: 'bg-amber-50 text-amber-700', green: 'bg-green-50 text-green-700', red: 'bg-red-50 text-red-700' };
  return <span className={'inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm ' + (map[tone] || map.neutral)}>{label}</span>;
}

// One pill per client — only the most urgent state, so rows stay scannable
function primaryClientStatus(c, { ripe, needsPhase3, awaiting, inTransit }) {
  const clientUploaded = c.letters.some(l => l.responseOutcome === 'received' && (l.responseFileUrl || l.hasResponseFile));
  if (clientUploaded) return { label: 'Response Uploaded', tone: 'green' };

  if (ripe > 0) return { label: ripe + ' to escalate', tone: 'red' };
  if (needsPhase3 > 0) return { label: needsPhase3 + ' need Phase 3', tone: 'amber' };
  
  const importDue = importDueInfo(c);
  if (importDue && importDue.code === 'due') return importDue;
  
  if (awaiting > 0) return { label: awaiting + ' awaiting', tone: 'amber' };
  if (inTransit > 0) return { label: inTransit + ' in transit', tone: 'neutral' };
  
  if (importDue) return importDue;
  
  if (c.letters.length === 0) return { label: 'No letters yet', tone: 'neutral' };
  return { label: 'On track', tone: 'green' };
}

function Avatar({ name, isVip, size = 34 }) {
  const initials = (name || '?').split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="shrink-0 flex items-center justify-center rounded-full font-semibold"
      style={{
        width: size, height: size, fontSize: Math.round(size * 0.34),
        background: isVip ? '#FAF3DF' : '#EEF1F7', color: isVip ? '#8F7524' : T.navy,
        border: isVip ? '1.5px solid ' + T.gold : '1px solid #E3E7EF',
      }}>
      {initials}
    </div>
  );
}

function Menu({ items }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen(!open)} title="More actions"
        className="flex items-center justify-center rounded-md transition-colors hover:bg-gray-100"
        style={{ width: 26, height: 26, color: T.faint, background: open ? '#EEF1F7' : 'transparent' }}>
        <MoreHorizontal size={15} strokeWidth={2} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 bg-white py-1"
            style={{ top: 30, minWidth: 180, border: '1px solid ' + T.border, borderRadius: 10, boxShadow: '0 8px 24px rgba(16,24,40,0.14)' }}>
            {items.filter(Boolean).map((item, i) => item === 'divider' ? (
              <div key={i} style={{ height: 1, background: T.grid, margin: '4px 0' }} />
            ) : (
              <button key={i}
                onClick={() => { setOpen(false); item.onClick(); }}
                disabled={item.disabled}
                title={item.title}
                className={'w-full text-left px-3 py-1.5 text-[12px] transition-colors disabled:opacity-40 ' + (item.danger ? 'hover:bg-red-50' : 'hover:bg-gray-50')}
                style={{ color: item.danger ? '#DC2626' : T.ink }}>
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// Where a letter is in its lifecycle: Generated → Mailed → Delivered → Outcome
const LETTER_STAGES = ['Generated', 'Mailed', 'Delivered', 'Outcome logged'];
function letterStageIndex(l) {
  if (l.responseOutcome) return 3;
  if (l.trackingStatus === 'Delivered' || l.deliveredAt) return 2;
  if (l.mailedDate) return 1;
  return 0;
}

function StageTracker({ l }) {
  const idx = letterStageIndex(l);
  return (
    <div className="flex items-center shrink-0" title={'Stage: ' + LETTER_STAGES[idx]}>
      {LETTER_STAGES.map((s, i) => (
        <React.Fragment key={s}>
          {i > 0 && <div style={{ width: 13, height: 2, background: i <= idx ? T.navy : '#E5E9F0' }} />}
          <div title={s}
            style={{ width: 8, height: 8, borderRadius: '50%', background: i <= idx ? T.navy : '#fff', border: i <= idx ? 'none' : '1.5px solid #D6DCE6', boxSizing: 'border-box' }} />
        </React.Fragment>
      ))}
    </div>
  );
}

function MailpieceLink({ artifact }) {
  const [opening, setOpening] = useState(false);
  if (!artifact) return null;
  const open = async () => {
    setOpening(true);
    try {
      const url = await getMailArtifactUrl(artifact);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error('Could not open the archived Lob PDF: ' + (e.message || e));
    } finally { setOpening(false); }
  };
  return <button onClick={open} disabled={opening} className="text-[10px] uppercase tracking-wider text-navy hover:text-gold ml-2 disabled:opacity-50">
    {opening ? 'Opening…' : 'Exact Lob PDF'}
  </button>;
}

function ArchiveMailpieceButton({ letter, onArchived }) {
  const [archiving, setArchiving] = useState(false);
  if (!letter?.lobId || (letter.mailArtifacts || []).some((artifact) => artifact.artifact_type === 'mailpiece_pdf')) return null;
  const archive = async () => {
    setArchiving(true);
    try {
      const result = await archiveHistoricalMailpiece({ letterId: letter.id, lobId: letter.lobId });
      if (result.archived) {
        toast.success('Exact Lob PDF archived');
        onArchived();
      } else toast('Lob has not made the rendered PDF available yet. Try again shortly.');
    } catch (e) {
      toast.error('Could not archive the Lob PDF: ' + (e.message || e));
    } finally { setArchiving(false); }
  };
  return <button onClick={archive} disabled={archiving} className="text-[10px] uppercase tracking-wider text-navy hover:text-gold ml-2 disabled:opacity-50">
    {archiving ? 'Archiving…' : 'Archive Lob PDF'}
  </button>;
}

function LetterRow({ l, isAdmin, isVip, hasPhase3, onView, onChange, onAnalyze, onAnalyzeBureau, onLobMail, onOpenAccount, onEdit, onEscalate, onReviewBureau }) {
  const [mode, setMode] = useState(null);
  const [dateVal, setDateVal] = useState(todayISO());
  const status = letterStatus(l);
  const isPhase3 = l.phase && l.phase.startsWith('Phase 3');
  // Phase 3's own escalation-readiness uses the 45-day CRA clock, not the
  // 30-day one — same reasoning as DashboardPage.jsx's identical gate.
  const status3 = isPhase3 ? letterStatus(l, CRA_WINDOW_DAYS) : null;

  const urgency = (() => {
    if (hasPhase3) return null;
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
    } catch (e) { toast.error('Could not save: ' + (e.message || e)); }
  };

  const handleDelete = async () => {
    const confirmMsg = l.mailedDate
      ? 'This letter was already mailed via certified mail on ' + fmt(l.mailedDate) + '. Deleting it only removes it from CCC\'s tracking system \u2014 it does NOT recall the physical mail already sent to ' + l.furnisher + '. This cannot be undone. Continue?'
      : 'Delete this letter draft for ' + l.furnisher + '? This cannot be undone.';
    if (!window.confirm(confirmMsg)) return;
    try {
      await deleteLetter(l.id);
      onChange();
    } catch (e) { toast.error('Could not delete: ' + (e.message || e)); }
  };

  const canAnalyze = !isPhase3 && (status.code === 'received' || status.code === 'window_closed' || status.code === 'no_response');
  const needsBureauReview = isPhase3 && status3 && (status3.code === 'received' || status3.code === 'window_closed' || status3.code === 'no_response');

  // One visible action per letter; the rest live in the ⋯ menu
  const primaryAction = (() => {
    if (!l.mailedDate) return (
      <button onClick={() => onLobMail(l)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 rounded-md border transition-colors shrink-0"
        style={{ borderColor: T.navy, color: T.navy }}>
        <Send size={10} strokeWidth={2} /> Send
      </button>
    );
    if (canAnalyze) return (
      <button onClick={() => onAnalyze(l)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 rounded-md shrink-0"
        style={{ backgroundColor: T.navy, color: T.gold }}>
        <Zap size={10} strokeWidth={2} /> Analyze
      </button>
    );
    if (needsBureauReview) return (
      <button onClick={() => status3.code === 'received' ? onAnalyzeBureau(l) : onReviewBureau(l)}
        className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 rounded-md shrink-0"
        style={{ backgroundColor: l.bureauReviewStatus === 'escalated' ? '#6B7280' : T.navy, color: '#fff' }}>
        <Zap size={10} strokeWidth={2} /> {status3.code === 'received' ? (l.bureauResponseStatus === 'review_ready' ? 'View analysis' : 'Analyze response') : (l.bureauReviewStatus === 'escalated' ? 'View decision' : 'Review response')}
      </button>
    );
    if (l.mailedDate && !l.responseOutcome) return (
      <button onClick={() => { setDateVal(todayISO()); setMode('responding'); }}
        className="text-[10px] uppercase tracking-wider px-2 py-1 rounded-md border transition-colors shrink-0"
        style={{ borderColor: T.border, color: T.muted }}>
        Log response
      </button>
    );
    return null;
  })();

  const menuItems = [
    { label: 'View letter', onClick: () => onView(l) },
    onEdit && { label: 'Edit letter', onClick: () => onEdit(l) },
    { label: 'Account history', onClick: () => onOpenAccount(l) },
    'divider',
    !l.mailedDate && !l.lobId && { label: 'Mark as mailed…', onClick: () => { setDateVal(todayISO()); setMode('mailing'); } },
    l.mailedDate && !l.lobId && { label: 'Clear mail date', onClick: () => save({ mailedDate: null }) },
    l.mailedDate && l.lobId && {
      label: 'Resend requires reviewed revision',
      title: 'A mailed letter is immutable evidence. Generate or save a reviewed revision before mailing again.',
      onClick: () => toast('This mailing remains immutable evidence. Make a reviewed revision of the letter before sending another copy.', { icon: 'ℹ️' }),
    },
    l.mailedDate && !l.responseOutcome && { label: 'Log response…', onClick: () => { setDateVal(todayISO()); setMode('responding'); } },
    l.mailedDate && !l.responseOutcome && { label: 'Mark no response', onClick: () => save({ responseOutcome: 'no_response' }) },
    isPhase3 && l.responseOutcome === 'received' && { label: 'Analyze bureau response…', onClick: () => onAnalyzeBureau(l) },
    isPhase3 && l.responseOutcome && { label: 'Review bureau response…', onClick: () => onReviewBureau(l) },
    isPhase3 && needsBureauReview && { label: 'Prepare CFPB / State AG escalation…', onClick: () => onEscalate(l) },
    l.mailedDate && { label: 'Edit mail date…', onClick: () => { setDateVal(l.mailedDate); setMode('mailing'); } },
    l.responseOutcome && { label: 'Reset response', onClick: () => save({ responseOutcome: null, responseDate: null }) },
    'divider',
    { label: 'Delete letter…', danger: true, onClick: handleDelete },
  ];

  return (
    <div className="py-2.5 border-b last:border-b-0" style={{ borderColor: T.grid }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[12px] min-w-0" style={{ color: T.ink }}>
          <span className={isPhase3 ? 'font-medium' : ''} style={{ color: isPhase3 ? '#8F7524' : T.ink }}>{l.phase || 'Letter'}</span>
          <span className="text-ink-muted"> · {fmtTime(l.savedAt)}</span>
          {l.mailedDate && <span className="text-ink-muted"> · mailed {fmt(l.mailedDate)}</span>}
          {l.trackingNumber && (
            <a href={"https://tools.usps.com/go/TrackConfirmAction?tLabels=" + l.trackingNumber} target="_blank" rel="noopener noreferrer" className="text-[10px] uppercase tracking-wider text-navy hover:text-gold ml-2">USPS #{l.trackingNumber.slice(-8)}</a>
          )}
          {l.trackingStatus === 'Delivered' && l.lobId && (
            <ReturnReceiptButton lobId={l.lobId} returnReceiptUrl={l.returnReceiptUrl} />
          )}
          <MailpieceLink artifact={(l.mailArtifacts || []).find((artifact) => artifact.artifact_type === 'mailpiece_pdf')} />
          <ArchiveMailpieceButton letter={l} onArchived={onChange} />
          {l.lobId && !l.trackingNumber && (
            <span className="text-[10px] text-ink-faint ml-2">Lob: {l.lobId.slice(0, 12)}</span>
          )}
          {l.responseFileUrl && (
            <a href={l.responseFileUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] uppercase tracking-wider text-green-700 hover:text-green-800 ml-2 font-medium">📄 View Client Upload</a>
          )}
          {l.trackingStatus && (
            <span className={'text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm ml-1 ' + (l.trackingStatus === 'Delivered' ? 'bg-green-50 text-green-700' : l.trackingStatus.includes('Returned') ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700')}>
              {l.trackingStatus}
            </span>
          )}
          {isAdmin && l.auditorName && <span className="text-[10px] text-ink-faint ml-2">· {l.auditorName}</span>}
        </div>
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          <StageTracker l={l} />
          {urgency && <StatusBadge label={urgency.label} tone={urgency.tone} />}
          <StatusBadge label={status.label} tone={status.tone} />
          {primaryAction}
          <Menu items={menuItems} />
        </div>
      </div>

      {mode === 'mailing' && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-ink-muted">Mail date:</span>
          <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} className="text-[12px] border border-border rounded-sm px-2 py-0.5" />
          <button onClick={() => save({ mailedDate: dateVal })} className="text-[11px] uppercase tracking-wider text-white bg-navy px-2 py-0.5 rounded-sm">Save</button>
          <button onClick={() => setMode(null)} className="text-[11px] uppercase tracking-wider text-ink-muted">Cancel</button>
        </div>
      )}
      {mode === 'responding' && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[11px] text-ink-muted">Response date:</span>
          <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} className="text-[12px] border border-border rounded-sm px-2 py-0.5" />
          <button onClick={() => save({ responseOutcome: 'received', responseDate: dateVal })} className="text-[11px] uppercase tracking-wider text-white bg-navy px-2 py-0.5 rounded-sm">Save</button>
          <button onClick={() => setMode(null)} className="text-[11px] uppercase tracking-wider text-ink-muted">Cancel</button>
        </div>
      )}
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
    'aldous & associates': { name: 'Aldous & Associates PLLC', line1: 'P.O. Box 171374', city: 'Holladay', state: 'UT', zip: '84117' },
    'bonneville': { name: 'Bonneville Collections', line1: 'P.O. Box 150621', city: 'Ogden', state: 'UT', zip: '84415' },
    'bonneville collections': { name: 'Bonneville Collections', line1: 'P.O. Box 150621', city: 'Ogden', state: 'UT', zip: '84415' },
    'align balance': { name: 'Align Balance LLC', line1: '175 W. Jackson Blvd, Suite 600', city: 'Chicago', state: 'IL', zip: '60604' },
    'alignbalance': { name: 'Align Balance LLC', line1: '175 W. Jackson Blvd, Suite 600', city: 'Chicago', state: 'IL', zip: '60604' },
    'attorney general': { name: 'Office of the Attorney General, Child Support Division', line1: 'P.O. Box 12017', city: 'Austin', state: 'TX', zip: '78711-2017' },
    'child support division': { name: 'Office of the Attorney General, Child Support Division', line1: 'P.O. Box 12017', city: 'Austin', state: 'TX', zip: '78711-2017' },
    // NOT a confirmed FCRA dispute correspondence address — corporate HQ only.
    // Flagged directly in the name field since this prefills a live Lob mail-send form.
    'self financial': { name: '⚠ PENDING VERIFICATION (HQ address, not confirmed dispute address) — Self Financial, Inc. / Sunrise Banks, N.A.', line1: '93 Red River St, Suite 1000', city: 'Austin', state: 'TX', zip: '78701' },
    'sunrise banks': { name: '⚠ PENDING VERIFICATION (HQ address, not confirmed dispute address) — Self Financial, Inc. / Sunrise Banks, N.A.', line1: '93 Red River St, Suite 1000', city: 'Austin', state: 'TX', zip: '78701' },
    'self credit card': { name: '⚠ PENDING VERIFICATION (HQ address, not confirmed dispute address) — Self Financial, Inc. / Sunrise Banks, N.A.', line1: '93 Red River St, Suite 1000', city: 'Austin', state: 'TX', zip: '78701' },
    'self lender': { name: '⚠ PENDING VERIFICATION (HQ address, not confirmed dispute address) — Self Financial, Inc. / Sunrise Banks, N.A.', line1: '93 Red River St, Suite 1000', city: 'Austin', state: 'TX', zip: '78701' },
    'sbna': { name: '⚠ PENDING VERIFICATION (HQ address, not confirmed dispute address) — Self Financial, Inc. / Sunrise Banks, N.A.', line1: '93 Red River St, Suite 1000', city: 'Austin', state: 'TX', zip: '78701' },
  };
  const lower = (furnisher || '').toLowerCase();
  for (const [key, addr] of Object.entries(map)) {
    if (lower.includes(key)) return addr;
  }
  return null;
}
export default function ClientsPage({ onOpenAudit, isAdmin, jumpTo, filter: initialFilter, forceTab, unanalyzedNames, unanalyzedClientIds, onLeadsChanged }) {
  const [clients, setClients] = useState(null);
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [selectedClientError, setSelectedClientError] = useState(null);
  const [pageInfo, setPageInfo] = useState({ nextCursor: null, totalCount: 0 });
  const [loadingMore, setLoadingMore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [analyzingLetter, setAnalyzingLetter] = useState(null);
  const [analyzingBureauLetter, setAnalyzingBureauLetter] = useState(null); // { letter, client }
  const [reviewingBureauLetter, setReviewingBureauLetter] = useState(null); // { letter, client }
  const [followUpBureauLetter, setFollowUpBureauLetter] = useState(null); // { letter, client, evidence }
  const [escalatingLetter, setEscalatingLetter] = useState(null); // { letter, client }
  const [lobMailerQueue, setLobMailerQueue] = useState([]);
  const [togglingVip, setTogglingVip] = useState(null);
  const [lobMailerLetter, setLobMailerLetter] = useState(null);
  const [accountTimeline, setAccountTimeline] = useState(null); // { accountId, furnisher, letters, accountData }
  const [editingLetterHtml, setEditingLetterHtml] = useState(null);
  const [diffLoading, setDiffLoading] = useState(null);
  const [diffResult, setDiffResult] = useState(null);
  const [activeFilter, setActiveFilter] = useState(initialFilter || null);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);
  const [refreshing, setRefreshing] = useState(false);
  const [editingEmail, setEditingEmail] = useState(null);
  const [activeTab, setActiveTab] = useState({});
  const [emailVal, setEmailVal] = useState('');
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [viewTab, setViewTab] = useState(forceTab || 'clients'); // 'clients' | 'leads'
  // Retention Build 3 — lifecycle status filter. Defaults to the "working
  // view" (Active + Paused); Graduated/Inactive are one click away rather
  // than cluttering the default list. Composes with search/dispute-workflow
  // chips (AND), doesn't replace them.
  const [lifecycleSelected, setLifecycleSelected] = useState(['Active', 'Paused']);
  const [showAddLead, setShowAddLead] = useState(false);
  const [convertingLead, setConvertingLead] = useState(null);
  const clientRefs = useRef({});
  const listRequestRef = useRef(0);
  const detailRequestRef = useRef(0);
  const jumpResolutionRef = useRef(null);

  const load = async ({ append = false, cursor = null, searchTerm = debouncedSearch, throwOnError = false } = {}) => {
    const requestId = ++listRequestRef.current;
    if (!append) setClients(null);
    try {
      const page = await listClientSummaries({
        limit: CLIENT_PAGE_SIZE,
        cursor: append ? (cursor || pageInfo.nextCursor) : null,
        search: searchTerm,
      });
      if (requestId !== listRequestRef.current) return page;
      setClients((current) => {
        if (!append) return page.clients;
        const existing = new Set((current || []).map((client) => client.id));
        return [...(current || []), ...page.clients.filter((client) => !existing.has(client.id))];
      });
      setPageInfo({ nextCursor: page.nextCursor, totalCount: page.totalCount });
      return page;
    } catch (e) {
      if (requestId === listRequestRef.current) {
        console.error('Failed to load client summaries', e);
        setClients([]);
        setPageInfo({ nextCursor: null, totalCount: 0 });
      }
      if (throwOnError) throw e;
      return null;
    }
  };

  const hydrateSelectedClient = async (clientId) => {
    if (!clientId) return null;
    const requestId = ++detailRequestRef.current;
    setSelectedClient(null);
    setSelectedClientError(null);
    try {
      const detail = await getClientDetails(clientId);
      // Exact Lob artifacts only belong on the selected client's detail view;
      // loading them for every list row was an N+1-sized bulk request.
      try {
        const artifacts = await listMailArtifacts(detail.letters.map((letter) => letter.id));
        const byLetter = new Map();
        for (const artifact of artifacts) {
          const current = byLetter.get(artifact.letter_id) || [];
          current.push(artifact);
          byLetter.set(artifact.letter_id, current);
        }
        detail.letters = detail.letters.map((letter) => ({ ...letter, mailArtifacts: byLetter.get(letter.id) || [] }));
      } catch (artifactError) {
        console.warn('Mail artifacts unavailable in this environment:', artifactError.message || artifactError);
      }
      if (requestId === detailRequestRef.current) setSelectedClient(detail);
      return detail;
    } catch (e) {
      if (requestId === detailRequestRef.current) {
        console.error('Failed to load client detail', e);
        setSelectedClientError(e.message || 'Could not load this client.');
      }
      throw e;
    }
  };

  const refreshSelectedClient = async () => {
    const clientId = selectedClientId;
    try {
      await Promise.all([
        load(),
        clientId ? hydrateSelectedClient(clientId) : Promise.resolve(),
      ]);
    } catch (e) {
      toast.error('Could not refresh this client: ' + (e.message || e));
    }
  };

  const loadMore = async () => {
    if (!pageInfo.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      await load({ append: true, throwOnError: true });
    } catch (e) {
      toast.error('Could not load more clients: ' + (e.message || e));
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    load().catch(() => {});
  }, [isAdmin, debouncedSearch]);

  useEffect(() => { if (forceTab) setViewTab(forceTab); }, [forceTab]);

  useEffect(() => {
    if (!selectedClientId) return;
    hydrateSelectedClient(selectedClientId).catch(() => {});
  }, [selectedClientId]);

  useEffect(() => {
    if (!jumpTo || !clients) return;
    if (jumpTo.startsWith('lead:')) return;
    if (jumpResolutionRef.current === jumpTo) return;
    jumpResolutionRef.current = jumpTo;
    let cancelled = false;
    findClientIdByLegacyReference(jumpTo).then(({ id, ambiguous }) => {
      if (cancelled) return;
      if (ambiguous) {
        toast.error('More than one client has that name. Open the correct client from the Clients list.');
      } else if (id) {
        setSelectedClientId(id);
      } else {
        toast.error('That client could not be found.');
      }
    }).catch((e) => {
      if (!cancelled) toast.error('Could not open client: ' + (e.message || e));
    });
    return () => { cancelled = true; };
  }, [jumpTo, clients]);

  useEffect(() => {
    if (initialFilter) setActiveFilter(initialFilter);
  }, [initialFilter]);



  const openLetter = (letter) => {
    if (!letter.html) {
      toast.error('This letter has no HTML content to view.');
      return;
    }
    const blob = new Blob([letter.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const w = window.open(url, '_blank');
    if (!w) { toast.error('Popup blocked — allow popups to view letters.'); return; }
  };

  const openAuditFromSummary = async (clientId, auditId) => {
    try {
      const detail = await getClientDetails(clientId);
      const audit = detail.audits.find((record) => record.id === auditId);
      if (!audit?.audit) throw new Error('The full audit record is unavailable.');
      onOpenAudit(audit.clientId ? { ...audit.audit, client: { ...audit.audit.client, id: audit.clientId } } : audit.audit);
    } catch (e) {
      toast.error('Could not open this audit: ' + (e.message || e));
    }
  };

  const handleDelete = async (name, clientId) => {
    await deleteClient(name, clientId);
    setConfirmDelete(null);
    if (clientId === selectedClientId) {
      detailRequestRef.current += 1;
      setSelectedClientId(null);
      setSelectedClient(null);
    }
    await load();
  };

  const handleVipToggle = async (clientName, currentVip, clientId) => {
    setTogglingVip(clientId || clientName);
    try {
      await toggleVip(clientName, !currentVip, clientId);
      if (clientId === selectedClientId) await refreshSelectedClient();
      else await load();
    } catch (e) {
      toast.error('Could not update VIP status: ' + (e.message || e));
    } finally {
      setTogglingVip(null);
    }
  };

  // For clients with no email/portal account — e.g. Swiftedly referrals,
  // where staff don't run the normal LPOA + portal signup flow — this is
  // the only path to a signature. Every client row has a sign_token
  // (clients migration 20260725), so the link is always ready; nothing to
  // generate on demand. 'inquiry' swaps the Fee Structure section for
  // personal-info/inquiry-only removal clients (flat per-bureau rate, no
  // First Work Fee/monthly service) — see public/sign-lpoa.html.
  const copySignatureLink = async (c, lpoaType = 'standard') => {
    try {
      // Summary rows deliberately omit signing tokens. Fetching one selected
      // record on demand keeps the board payload free of reusable tokens.
      const detail = c.signToken ? c : await getClientDetails(c.id);
      if (!detail.signToken) { toast.error('No signing token on this client yet — refresh and try again.'); return; }

      const settings = await getSettings();
      // Custom service agreement always wins — including over the legacy
      // inquiry menu item — so the signed LPOA matches Billing.
      let feeParam = '';
      let typeParam = '';
      if (hasCustomServiceAgreement(detail)) {
        const feeText = resolveClientFeeText(detail, settings, { lpoaType: 'standard' });
        feeParam = '&feeText=' + encodeURIComponent(feeText);
      } else if (lpoaType === 'inquiry') {
        typeParam = '&type=inquiry';
      } else {
        const tierPricing = getTierPricing(settings);
        const feeText = describeTierFee(detail.billingTier || 'Standard', tierPricing);
        feeParam = '&feeText=' + encodeURIComponent(feeText);
      }

      const url = window.location.origin + '/sign-lpoa.html?client=' + encodeURIComponent(detail.name) + '&token=' + detail.signToken
        + typeParam + feeParam;

      await navigator.clipboard.writeText(url);
      toast.success('Signature link copied');
    } catch (e) {
      toast.error('Could not load the signature link: ' + (e.message || e));
    }
  };

  const viewSignedLpoa = async (c) => {
    try {
      const detail = c.lpoaSignatureData ? c : await getClientDetails(c.id);
      const url = await resolveLpoaViewUrl(supabase, detail.lpoaSignatureData);
      if (!url) { toast.error('No signed LPOA is available for this client.'); return; }
      window.open(url, '_blank');
    } catch (e) {
      toast.error('Could not load the signed LPOA: ' + (e.message || e));
    }
  };

  // Render modal at top level
  const createModal = showCreateClient ? (
    <CreateClientModal
      onClose={() => setShowCreateClient(false)}
      onCreated={() => { setShowCreateClient(false); load(); }}
    />
  ) : null;

  const leadModal = showAddLead ? (
    <AddLeadModal
      onClose={() => setShowAddLead(false)}
      onCreated={() => { setShowAddLead(false); load(); }}
    />
  ) : null;

  if (clients === null && !selectedClientId) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20 text-ink-muted">
        <RefreshCw size={20} className="mx-auto mb-3 animate-spin" strokeWidth={1.5} />
        <p className="text-[13px]">Loading client records…</p>
      </div>
    );
  }

  if (clients && clients.length === 0 && !selectedClientId) {
    return (
      <div className="max-w-3xl mx-auto text-center py-20">
        <Users size={28} className="mx-auto mb-3 text-ink-faint" strokeWidth={1.5} />
        <h2 className="ccc-display text-xl text-ink font-medium">No saved clients yet</h2>
        <p className="text-[13px] text-ink-muted mt-2">Run an audit and it will be saved here automatically.</p>
      </div>
    );
  }

  if (selectedClientId) {
    if (!selectedClient) {
      return (
        <div className="max-w-3xl mx-auto text-center py-20 text-ink-muted">
          <RefreshCw size={20} className="mx-auto mb-3 animate-spin" strokeWidth={1.5} />
          <p className="text-[13px]">Loading client details…</p>
          <button onClick={() => { detailRequestRef.current += 1; setSelectedClientId(null); }} className="mt-4 text-[12px] font-medium hover:underline" style={{ color: T.navy }}>
            ← Back to Clients
          </button>
          {selectedClientError && <p className="mt-3 text-[12px] text-red-600">{selectedClientError}</p>}
        </div>
      );
    }
    const c = selectedClient;
    
    const ripe = c.letters.filter((l) => letterStatus(l).code === 'window_closed').length;
    const awaiting = c.letters.filter((l) => letterStatus(l).code === 'awaiting').length;
    const inTransit = c.letters.filter((l) => letterStatus(l).code === 'in_transit').length;
    const needsPhase3 = c.letters.filter((l) => l.responseOutcome === 'received' && !l.phase?.startsWith('Phase 3') && !c.letters.some((pl) => pl.phase?.startsWith('Phase 3') && (pl.furnisher === l.furnisher || (pl.coveredFurnishers || []).includes(l.furnisher)))).length;
    const auditors = isAdmin ? [...new Set([
      ...c.audits.map((a) => a.auditorName),
      ...c.letters.map((l) => l.auditorName),
    ].filter(Boolean))] : [];
    const primary = primaryClientStatus(c, { ripe, needsPhase3, awaiting, inTransit });
    const hasLpoa = !!(c.lpoaSignatureData && (c.lpoaSignatureData.lpoaPath || c.lpoaSignatureData.lpoaUrl));
    
    const clientMenu = [
      { label: 'Edit email', onClick: () => { setEditingEmail(c.id); setEmailVal(c.email || ''); } },
      'divider',
      { label: 'Copy Signature Link (Standard)', onClick: () => copySignatureLink(c, 'standard') },
      { label: 'Copy Signature Link (Inquiry/Info Only)', onClick: () => copySignatureLink(c, 'inquiry') },
      c.lpoaSigned && hasLpoa && { label: 'View signed LPOA', onClick: () => viewSignedLpoa(c) },
      'divider',
      {
        label: 'Revert to lead…', onClick: async () => {
          if (window.confirm(c.name + ' will move back to the Leads pipeline (existing audits, letters, and documents stay untouched in case they come back). Continue?')) {
            await revertClientToLead(c.name, c.id);
            refreshSelectedClient();
          }
        },
      },
      { label: 'Delete client…', danger: true, onClick: () => setConfirmDelete(c.id) },
    ].filter(Boolean);

    return (
      <div className="max-w-5xl mx-auto" style={{ padding: '20px 32px 32px' }}>
        <button onClick={() => { detailRequestRef.current += 1; setSelectedClientId(null); setSelectedClient(null); }} className="flex items-center gap-1.5 text-[12px] font-medium mb-6 hover:underline underline-offset-2" style={{ color: T.navy }}>
          ← Back to Clients
        </button>
        
        <div className="bg-white p-6 mb-6" style={{ borderRadius: 14, border: '1px solid ' + (c.isVip ? T.gold : T.border), boxShadow: T.cardShadow }}>
          <div className="flex items-center gap-5 flex-wrap">
            <Avatar name={c.name} isVip={c.isVip} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h1 className="ccc-display text-[24px] font-medium leading-tight truncate" style={{ color: T.ink }}>{c.name}</h1>
                {c.isVip && <Star size={16} strokeWidth={2} fill={T.gold} style={{ color: T.gold, flexShrink: 0 }} title="VIP client" />}
                {c.lpoaSigned && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-green-50 text-green-700 shrink-0" title="LPOA signed">✓ LPOA</span>
                )}
                {c.billingStatus === 'Active' && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-blue-50 text-blue-700 shrink-0" title="Billing Active">Active</span>
                )}
                {c.billingStatus === 'Paused' && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-amber-50 text-amber-700 shrink-0" title={'Billing Paused' + (c.exitReason ? ' — ' + c.exitReason : '')}>Paused</span>
                )}
                {c.billingStatus === 'Graduated' && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-green-50 text-green-700 shrink-0" title="Graduated — arc complete">Graduated</span>
                )}
                {c.billingStatus === 'Inactive' && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-red-50 text-red-700 shrink-0" title={'Inactive' + (c.exitReason ? ' — ' + c.exitReason : '')}>Inactive</span>
                )}
              </div>
              <div className="text-[13px] truncate" style={{ color: T.muted }}>
                {c.email || <span className="text-amber-600">No email</span>}
                {c.address && <span> · {c.address}</span>}
                {isAdmin && auditors.length > 0 && <span style={{ color: T.faint }}> · {auditors.join(', ')}</span>}
              </div>
            </div>
            
            <div className="flex flex-col items-end gap-2 shrink-0">
               <div className="flex items-center gap-3">
                <StatusBadge label={primary.label} tone={primary.tone} />
                <span className="flex items-center gap-1.5 text-[12px]" style={{ color: T.faint }} title={c.audits.length + ' audits'}>
                  <FileText size={14} strokeWidth={1.75} />{c.audits.length}
                </span>
                <span className="flex items-center gap-1.5 text-[12px]" style={{ color: T.faint }} title={c.letters.length + ' letters'}>
                  <Mail size={14} strokeWidth={1.75} />{c.letters.length}
                </span>
               </div>
               
               <div className="flex items-center gap-2 mt-2">
                 <button onClick={() => handleVipToggle(c.name, c.isVip, c.id)} disabled={togglingVip === c.id} className="text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-md border transition-colors hover:bg-gray-50 disabled:opacity-50" style={{ borderColor: T.border, color: T.ink }}>
                   {togglingVip === c.id ? 'Updating…' : (c.isVip ? 'Remove VIP' : 'Set as VIP')}
                 </button>
                 <Menu items={clientMenu} />
               </div>
            </div>
          </div>
          
          {editingEmail === c.id && (
            <div className="pt-4 mt-4 flex items-center gap-2" style={{ borderTop: '1px solid ' + T.grid }}>
              <input type="email" value={emailVal} onChange={(e) => setEmailVal(e.target.value)}
                className="text-[11px] border border-border rounded-sm px-2 py-1 w-56"
                placeholder="client@email.com" autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') { updateClientEmail(c.name, emailVal, c.id).then(refreshSelectedClient); setEditingEmail(null); } if (e.key === 'Escape') setEditingEmail(null); }} />
              <button onClick={() => { updateClientEmail(c.name, emailVal, c.id).then(refreshSelectedClient); setEditingEmail(null); }} className="text-[10px] uppercase tracking-wider text-white bg-navy px-2 py-1 rounded-sm">Save</button>
              <button onClick={() => setEditingEmail(null)} className="text-[10px] text-ink-muted">Cancel</button>
            </div>
          )}

          {confirmDelete === c.id && (
            <div className="pt-4 mt-4 flex items-center gap-3" style={{ borderTop: '1px solid ' + T.grid }}>
              <span className="text-[12px] text-red-600">Delete all records for {c.name}?</span>
              <button onClick={() => handleDelete(c.name, c.id)} className="text-[11px] uppercase tracking-wider text-white bg-red-600 px-3 py-1 rounded-sm">Confirm Delete</button>
              <button onClick={() => setConfirmDelete(null)} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">Cancel</button>
            </div>
          )}
        </div>
        
        <div className="px-1 space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span style={{ width: 3, height: 14, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
                <div className="text-[11px] uppercase tracking-wider font-medium" style={{ color: T.muted }}>Audits</div>
              </div>
              {c.audits.length >= 2 && (
                <button onClick={async () => {
                    setDiffLoading(c.id);
                    try {
                      const result = await runProgressDiff(c.name, c.id);
                      setDiffResult({ clientName: c.name, letters: c.letters, ...result });
                    } catch (e) {
                      toast.error('Could not run comparison: ' + e.message);
                    } finally {
                      setDiffLoading(null);
                    }
                  }} disabled={diffLoading === c.id} className="text-[10px] uppercase tracking-wider text-navy hover:text-gold disabled:opacity-50">
                  {diffLoading === c.id ? 'Comparing…' : 'Compare Latest Reports'}
                </button>
              )}
            </div>
            {c.audits.length === 0 && <div className="text-[12px] text-ink-muted">None</div>}
            <div className="bg-white rounded-xl" style={{ border: '1px solid ' + T.border }}>
              {c.audits.map((a, i) => (
                <div key={a.id} className="flex items-center justify-between py-3 px-4 flex-wrap gap-2" style={{ borderBottom: i < c.audits.length - 1 ? '1px solid ' + T.grid : 'none' }}>
                  <div className="text-[12.5px] text-ink">
                    Report {a.reportDate}
                    <span className="text-ink-muted"> · {(a.audit && a.audit.accountsTargeted) || 0} accounts · {(a.audit && a.audit.totalViolations) || 0} violations</span>
                    {isAdmin && a.auditorName && <span className="text-[11px] text-ink-faint ml-2">· {a.auditorName}</span>}
                    <span className="text-ink-faint text-[11px] ml-2">{fmtTime(a.savedAt)}</span>
                  </div>
                  <button onClick={() => onOpenAudit(a.clientId ? { ...a.audit, client: { ...a.audit.client, id: a.clientId } } : a.audit)} className="text-[11px] uppercase tracking-wider text-navy hover:text-gold">Open</button>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex gap-2 mb-4">
              {['Letters', 'Profile', 'Billing', 'Documents'].map((tab) => {
                const isActiveTab = (activeTab[c.id] || 'Letters') === tab;
                return (
                  <button key={tab}
                    onClick={() => setActiveTab((p) => ({ ...p, [c.id]: tab }))}
                    className="rounded-full px-4 py-1.5 text-[11px] uppercase tracking-wider transition-colors"
                    style={{
                      background: isActiveTab ? T.navy : 'transparent',
                      color: isActiveTab ? T.gold : T.muted,
                      border: '1px solid ' + (isActiveTab ? T.navy : T.border),
                      fontWeight: isActiveTab ? 600 : 400,
                    }}>
                    {tab}{tab === 'Letters' ? ' ' + c.letters.length : ''}
                  </button>
                );
              })}
            </div>

            {(activeTab[c.id] || 'Letters') === 'Letters' && (
              <div>
                {c.letters.length === 0 ? (
                  <p className="text-[12.5px] text-ink-muted py-6 text-center bg-white rounded-xl" style={{ border: '1px solid ' + T.border }}>No letters yet — run an audit to generate Phase 1 letters.</p>
                ) : (
                  (() => {
                    const openAccount = (letter) => {
                      const clientLetters = c.letters.filter((pl) => pl.accountId === letter.accountId && pl.furnisher === letter.furnisher);
                      const latestAudit = [...c.audits].sort((a, b) => (b.reportDate || '').localeCompare(a.reportDate || ''))[0];
                      const accountData = latestAudit && latestAudit.audit && latestAudit.audit.accounts
                        ? latestAudit.audit.accounts.find((a) => a.id === letter.accountId)
                        : null;
                      setAccountTimeline({ accountId: letter.accountId, furnisher: letter.furnisher, letters: clientLetters, accountData, clientName: c.name });
                    };
                    const groups = [];
                    const seen = new Map();
                    for (const l of c.letters) {
                      const key = l.furnisher || 'Other';
                      if (!seen.has(key)) { seen.set(key, []); groups.push([key, seen.get(key)]); }
                      seen.get(key).push(l);
                    }
                    return groups.map(([furnisher, letters]) => (
                      <div key={furnisher} className="mb-3 bg-white" style={{ border: '1px solid ' + T.border, borderRadius: 12, overflow: 'visible' }}>
                        <div className="flex items-center justify-between px-4 py-2.5"
                          style={{ background: '#FAFBFC', borderBottom: '1px solid ' + T.grid, borderRadius: '12px 12px 0 0' }}>
                          <button onClick={() => openAccount(letters[0])}
                            className="flex items-center gap-1.5 text-[12.5px] font-medium hover:text-navy hover:underline underline-offset-2 decoration-dotted"
                            style={{ color: T.ink }}
                            title="View account history">
                            {furnisher}
                            <span className="text-[10px] font-normal" style={{ color: T.faint }}>{letters.length} letter{letters.length === 1 ? '' : 's'}</span>
                          </button>
                          <span className="text-[10px]" style={{ color: T.faint }}>history →</span>
                        </div>
                        <div className="px-4 py-1">
                          {letters.map((l) => (
                            <LetterRow key={l.id} l={l} isAdmin={isAdmin} isVip={c.isVip}
                              hasPhase3={c.letters.some((pl) => pl.phase?.startsWith('Phase 3') && (pl.furnisher === l.furnisher || (pl.coveredFurnishers || []).includes(l.furnisher)))}
                              onView={openLetter} onChange={refreshSelectedClient} onAnalyze={setAnalyzingLetter} onLobMail={(l) => setLobMailerQueue([l])}
                              onEdit={(letter) => setEditingLetterHtml(letter)} onOpenAccount={openAccount}
                              onEscalate={(letter) => setEscalatingLetter({ letter, client: c })}
                              onAnalyzeBureau={(letter) => setAnalyzingBureauLetter({ letter, client: c })}
                              onReviewBureau={(letter) => setReviewingBureauLetter({ letter, client: c })} />
                          ))}
                        </div>
                      </div>
                    ));
                  })()
                )}
              </div>
            )}

            {(activeTab[c.id] || 'Letters') === 'Profile' && (
              <ClientProfilePanel client={c} onChanged={refreshSelectedClient} onBatchMail={setLobMailerQueue} />
            )}

            {(activeTab[c.id] || 'Letters') === 'Billing' && (
              <ClientBillingPanel client={c} onChanged={refreshSelectedClient} />
            )}

            {(activeTab[c.id] || 'Letters') === 'Documents' && (
              <DocumentManager clientId={c.id} clientName={c.name} letters={c.letters || []} onChanged={refreshSelectedClient} setAnalyzingLetter={setAnalyzingLetter} />
            )}
          </div>
        </div>

        {lobMailerQueue.length > 0 && (() => {
          const currentLetter = lobMailerQueue[0];
          return (
            <LobMailer
              letter={currentLetter}
              furnisherAddress={currentLetter ? ((currentLetter.phase && currentLetter.phase.startsWith('Phase 3')) ? parseBureauAddress(currentLetter.phase) : (['Personal Info Cleanup', 'Inquiry Removal', 'Personal Info & Inquiries'].includes(currentLetter.phase) ? parseBureauAddress(currentLetter.furnisher) : parseFurnisherAddress(currentLetter.furnisher))) : null}
              batchRemaining={lobMailerQueue.length - 1}
              onNext={() => setLobMailerQueue(prev => prev.slice(1))}
              onClose={() => setLobMailerQueue([])}
              onSent={async (data) => {
                await updateLetter(currentLetter.id, {
                  mailedDate: data.mailedDate,
                  trackingStatus: 'Mailed',
                  trackingNumber: data.trackingNumber || null,
                  deliveredAt: null,
                  lobId: data.lobId,
                });
                refreshSelectedClient();
              }}
            />
          );
        })()}
        {analyzingLetter && (
          <ResponseAnalyzer
            letter={analyzingLetter}
            onClose={() => setAnalyzingLetter(null)}
            onSaved={() => { setAnalyzingLetter(null); refreshSelectedClient(); }}
          />
        )}
        {analyzingBureauLetter && (
          <BureauResponseAnalyzer
            letter={analyzingBureauLetter.letter}
            onClose={() => setAnalyzingBureauLetter(null)}
            onSaved={refreshSelectedClient}
            onReview={(evidence) => {
              const next = analyzingBureauLetter;
              setAnalyzingBureauLetter(null);
              setReviewingBureauLetter({ ...next, evidence });
            }}
          />
        )}
        {reviewingBureauLetter && (
          <BureauResponseReview
            letter={reviewingBureauLetter.letter}
            evidence={reviewingBureauLetter.evidence || null}
            onClose={() => setReviewingBureauLetter(null)}
            onSaved={refreshSelectedClient}
            onEscalate={() => {
              const next = reviewingBureauLetter;
              setReviewingBureauLetter(null);
              setEscalatingLetter(next);
            }}
            onFollowUp={(evidence) => {
              const next = reviewingBureauLetter;
              setReviewingBureauLetter(null);
              setFollowUpBureauLetter({ ...next, evidence: evidence || next.evidence || null });
            }}
          />
        )}
        {followUpBureauLetter && (
          <BureauFollowUpPanel
            letter={followUpBureauLetter.letter}
            client={followUpBureauLetter.client}
            evidence={followUpBureauLetter.evidence || null}
            onClose={() => {
              // Refresh only after closing. Refreshing on save temporarily
              // removes selectedClient, unmounting/remounting this panel and
              // causing its mount effect to launch another paid model job.
              setFollowUpBureauLetter(null);
              refreshSelectedClient();
            }}
          />
        )}
        {escalatingLetter && (
          <EscalationPanel
            letter={escalatingLetter.letter}
            client={escalatingLetter.client}
            onClose={() => setEscalatingLetter(null)}
            onSaved={refreshSelectedClient}
          />
        )}
        <AccountTimelineModal data={accountTimeline} onClose={() => setAccountTimeline(null)} />
        <LetterEditModal letter={editingLetterHtml} onClose={() => setEditingLetterHtml(null)} onSaved={refreshSelectedClient} />
        <DiffResultModal result={diffResult} onClose={() => setDiffResult(null)} onOpenAudit={onOpenAudit} />
      </div>
    );
  }

  const leadClients = clients.filter((c) => c.status === 'lead');
  const nonLeadClients = clients.filter((c) => c.status !== 'lead');
  // Unset billing_status (most existing demo data) counts as 'Active' for
  // filtering — it means "never explicitly changed," not "hidden."
  const lifecycleOf = (c) => c.billingStatus || 'Active';
  const LIFECYCLE_STATUSES = ['Active', 'Paused', 'Graduated', 'Inactive'];
  const lifecycleCounts = Object.fromEntries(LIFECYCLE_STATUSES.map((s) => [s, nonLeadClients.filter((c) => lifecycleOf(c) === s).length]));
  const activeClients = nonLeadClients.filter((c) => lifecycleSelected.includes(lifecycleOf(c)));
  const tabClients = viewTab === 'leads' ? leadClients : activeClients;

  const stageRank = { ready: 3, audit: 2, contacted: 1, new: 0 };
  const sortedClients = [...tabClients].sort((a, b) => {
    if (viewTab === 'leads') {
      const d = (stageRank[leadStage(b)] ?? 0) - (stageRank[leadStage(a)] ?? 0);
      if (d) return d;
      return (b.leadCreatedAt || '').localeCompare(a.leadCreatedAt || '');
    }
    if (a.isVip && !b.isVip) return -1;
    if (!a.isVip && b.isVip) return 1;
    return (b.lastActivity || '').localeCompare(a.lastActivity || '');
  });

  const baseFiltered = activeFilter
    ? sortedClients.filter((c) => viewTab === 'leads'
        ? (activeFilter === 'unviewed' ? !c.leadViewedAt : activeFilter === 'recent' ? isLeadRecent(c) : activeFilter.startsWith('stage:') ? leadStage(c) === activeFilter.slice(6) : true)
        : clientMatchesFilter(c, activeFilter, unanalyzedNames, unanalyzedClientIds))
    : sortedClients;
  const q = debouncedSearch.trim().toLowerCase();
  const filteredClients = q
    ? baseFiltered.filter((c) =>
        c.name.toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.leadSource || '').toLowerCase().includes(q) ||
        c.letters.some((l) => (l.furnisher || '').toLowerCase().includes(q)))
    : baseFiltered;

  const totalAudits = activeClients.reduce((n, c) => n + c.audits.length, 0);
  const totalLetters = activeClients.reduce((n, c) => n + c.letters.length, 0);

  const filterChips = viewTab === 'clients'
    ? [
        { key: null, label: 'All', count: activeClients.length },
        { key: 'ready', label: 'Phase 2 Ready', count: activeClients.filter((c) => clientMatchesFilter(c, 'ready')).length },
        { key: 'awaiting', label: 'Awaiting', count: activeClients.filter((c) => clientMatchesFilter(c, 'awaiting')).length },
        { key: 'escalate', label: 'To escalate', count: activeClients.filter((c) => clientMatchesFilter(c, 'escalate')).length },
        { key: 'received', label: 'Needs Phase 3', count: activeClients.filter((c) => clientMatchesFilter(c, 'received')).length },
        { key: 'unanalyzed', label: 'Action Items', count: activeClients.filter((c) => !!unanalyzedClientIds?.has(c.id) || !!unanalyzedNames?.has(c.name)).length },
        { key: 'attention', label: 'Needs attention', count: activeClients.filter((c) => c.status === 'attention').length },
        { key: 'active', label: 'Active', count: activeClients.filter((c) => c.status === 'active').length },
        { key: 'completed', label: 'Completed', count: activeClients.filter((c) => c.status === 'completed').length },
        { key: 'vip', label: 'VIP / PIF', count: activeClients.filter((c) => c.isVip).length },
      ]
    : [
        { key: null, label: 'All', count: leadClients.length },
        { key: 'unviewed', label: 'Unviewed', count: leadClients.filter((c) => !c.leadViewedAt).length },
        { key: 'recent', label: 'New (48h)', count: leadClients.filter(isLeadRecent).length },
        ...LEAD_STAGES.map((s) => ({ key: 'stage:' + s.key, label: s.label, count: leadClients.filter((c) => leadStage(c) === s.key).length })),
      ];

  return (
    <div className="max-w-5xl mx-auto" style={{ padding: '20px 32px 32px' }}>
      {/* Branded page header */}
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span style={{ width: 4, height: 30, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
          <div>
            <h1 className="ccc-display text-[22px] font-medium leading-tight" style={{ color: T.ink }}>
              {viewTab === 'leads' ? 'Leads' : 'Clients'}
            </h1>
            <p className="text-[11px]" style={{ color: T.muted }}>
              {viewTab === 'leads'
                ? leadClients.length + ' prospect' + (leadClients.length === 1 ? '' : 's') + ' in the pipeline — not yet signed or paid'
                : activeClients.length + ' client' + (activeClients.length === 1 ? '' : 's') + ' · ' + totalAudits + ' audit' + (totalAudits === 1 ? '' : 's') + ' · ' + totalLetters + ' letter' + (totalLetters === 1 ? '' : 's')}
              {pageInfo.nextCursor && <span> · first {clients.length} of {pageInfo.totalCount} loaded</span>}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search size={13} strokeWidth={2} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: T.faint }} />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={viewTab === 'leads' ? 'Search leads…' : 'Search name, email, furnisher…'}
              className="border rounded-lg pl-8 pr-3 py-1.5 text-[12px] text-ink focus:outline-none focus:border-navy bg-white"
              style={{ width: 210, borderColor: T.border }}
            />
          </div>
          {isAdmin && (
            <button onClick={() => viewTab === 'leads' ? setShowAddLead(true) : setShowCreateClient(true)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 text-[11px] uppercase tracking-wider rounded-lg transition-colors"
              style={{ backgroundColor: T.navy, color: T.gold }}>
              <UserPlus size={12} strokeWidth={2} /> {viewTab === 'leads' ? 'Add Lead' : 'New Client'}
            </button>
          )}
          <button onClick={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
            title="Refresh"
            className="flex items-center justify-center rounded-lg border bg-white transition-colors hover:border-navy"
            style={{ width: 30, height: 30, borderColor: T.border, color: T.muted }}>
            <RefreshCw size={13} strokeWidth={1.75} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Lifecycle status filter (Retention Build 3) — multi-select, composes
          with the dispute-workflow chips and search below rather than
          replacing them. Graduated/Inactive start deselected. */}
      {viewTab === 'clients' && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          {LIFECYCLE_STATUSES.map((s) => {
            const isOn = lifecycleSelected.includes(s);
            const tone = { Active: '#1D4ED8', Paused: '#B45309', Graduated: '#15803D', Inactive: '#B91C1C' }[s];
            return (
              <button key={s}
                onClick={() => setLifecycleSelected((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s])}
                className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] transition-colors"
                style={{
                  background: isOn ? tone : '#fff',
                  color: isOn ? '#fff' : T.muted,
                  border: '1px solid ' + (isOn ? tone : T.border),
                  fontWeight: isOn ? 600 : 400,
                }}>
                {s}
                <span style={{ fontSize: 10, opacity: isOn ? 0.85 : 0.7, fontVariantNumeric: 'tabular-nums' }}>{lifecycleCounts[s]}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Quick-filter chips */}
      <div className="flex items-center gap-1.5 mb-4 flex-wrap">
        {filterChips.map((chip) => {
          const isActive = activeFilter === chip.key || (!activeFilter && chip.key === null);
          return (
            <button key={chip.label}
              onClick={() => setActiveFilter(chip.key)}
              disabled={chip.count === 0 && chip.key !== null && !pageInfo.nextCursor}
              title={pageInfo.nextCursor ? 'Counts reflect the currently loaded pages. Load more to expand them.' : undefined}
              className="flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] transition-colors disabled:opacity-40"
              style={{
                background: isActive ? T.navy : '#fff',
                color: isActive ? T.gold : T.muted,
                border: '1px solid ' + (isActive ? T.navy : T.border),
                fontWeight: isActive ? 600 : 400,
              }}>
              {chip.label}
              <span style={{ fontSize: 10, opacity: isActive ? 0.9 : 0.7, fontVariantNumeric: 'tabular-nums' }}>{chip.count}</span>
            </button>
          );
        })}
        {activeFilter && !filterChips.some((ch) => ch.key === activeFilter) && (
          <span className="flex items-center gap-1.5 text-[11px] rounded-full px-3 py-1" style={{ background: T.navy, color: T.gold }}>
            {FILTER_LABELS[activeFilter] || activeFilter}
            <button onClick={() => setActiveFilter(null)}><X size={11} strokeWidth={2.5} /></button>
          </span>
        )}
      </div>

      {filteredClients.length === 0 && (
        <div className="text-center py-12 bg-white rounded-xl" style={{ border: '1px solid ' + T.border }}>
          <p className="text-[13px]" style={{ color: T.muted }}>No {viewTab === 'leads' ? 'leads' : 'clients'} match{q ? ' "' + debouncedSearch.trim() + '"' : ' this filter'}.</p>
        </div>
      )}

      <div className="space-y-3">
        {filteredClients.map((c) => {
          if (c.status === 'lead') {
            return (
              <LeadCard
                key={c.id}
                c={c}
                isAdmin={isAdmin}
                onOpenAudit={onOpenAudit}
                onOpenSummaryAudit={openAuditFromSummary}
                onViewed={async () => {
                  if (c.leadViewedAt) return;
                  try {
                    await markLeadViewed(c.name, c.id);
                    c.leadViewedAt = new Date().toISOString(); // avoid re-firing before the next full reload
                    if (onLeadsChanged) onLeadsChanged();
                  } catch (e) {
                    console.error('Could not mark lead viewed:', e.message);
                  }
                }}
                onConvert={async () => {
                  setConvertingLead(c.id);
                  try {
                    await convertLeadToClient(c.name, c.id);
                    await load();
                  } catch (e) {
                    toast.error('Could not convert lead: ' + e.message);
                  } finally {
                    setConvertingLead(null);
                  }
                }}
                converting={convertingLead === c.id}
                onDelete={async () => {
                  if (!window.confirm('Delete lead ' + c.name + '? This cannot be undone.')) return;
                  try {
                    await deleteLead(c.name, c.id);
                    await load();
                  } catch (e) {
                    toast.error('Could not delete lead: ' + e.message);
                  }
                }}
              />
            );
          }

          const ripe = c.letters.filter((l) => letterStatus(l).code === 'window_closed').length;
          const awaiting = c.letters.filter((l) => letterStatus(l).code === 'awaiting').length;
          const inTransit = c.letters.filter((l) => letterStatus(l).code === 'in_transit').length;
          const needsPhase3 = c.letters.filter((l) => l.responseOutcome === 'received' && !l.phase?.startsWith('Phase 3') && !c.letters.some((pl) => pl.phase?.startsWith('Phase 3') && (pl.furnisher === l.furnisher || (pl.coveredFurnishers || []).includes(l.furnisher)))).length;
          const importDue = importDueInfo(c);
          const auditors = isAdmin ? [...new Set([
            ...c.audits.map((a) => a.auditorName),
            ...c.letters.map((l) => l.auditorName),
          ].filter(Boolean))] : [];

          const primary = primaryClientStatus(c, { ripe, needsPhase3, awaiting, inTransit });
          const clientMenu = [
            { label: togglingVip === c.id ? 'Updating…' : (c.isVip ? 'Remove VIP status' : 'Set as VIP'), onClick: () => handleVipToggle(c.name, c.isVip, c.id), disabled: togglingVip === c.id },
            { label: 'Edit email', onClick: () => { setEditingEmail(c.id); setEmailVal(c.email || ''); } },
            'divider',
            { label: 'Copy Signature Link (Standard)', onClick: () => copySignatureLink(c, 'standard') },
      { label: 'Copy Signature Link (Inquiry/Info Only)', onClick: () => copySignatureLink(c, 'inquiry') },
            c.lpoaSigned && { label: 'View signed LPOA', onClick: () => viewSignedLpoa(c) },
            'divider',
            {
              label: 'Revert to lead…', onClick: async () => {
                if (window.confirm(c.name + ' will move back to the Leads pipeline (existing audits, letters, and documents stay untouched in case they come back). Continue?')) {
                  await revertClientToLead(c.name, c.id);
                  load();
                }
              },
            },
            { label: 'Delete client…', danger: true, onClick: () => setConfirmDelete(c.id) },
          ];

          return (
            <div
              key={c.id}
              ref={(el) => { clientRefs.current[c.id] = el; }}
              className="bg-white overflow-visible transition-shadow"
              style={{
                borderRadius: 14,
                boxShadow: c.id === selectedClientId ? '0 0 0 3px rgba(201,168,76,0.18)' : T.cardShadow,
                border: c.id === selectedClientId ? '2px solid ' + T.gold : (c.isVip ? '1px solid ' + T.gold : '1px solid ' + T.border),
              }}
            >
              {/* Row header — a div, not a button, so inner controls stay valid HTML */}
              <div className="flex items-center gap-3 px-4 py-3.5 cursor-pointer select-none" role="button"
                onClick={() => setSelectedClientId(c.id)}>
                <Avatar name={c.name} isVip={c.isVip} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="ccc-display text-[14px] font-medium truncate" style={{ color: T.ink }}>{c.name}</span>
                    {c.isVip && <Star size={12} strokeWidth={2} fill={T.gold} style={{ color: T.gold, flexShrink: 0 }} title="VIP client" />}
                    {c.lpoaSigned && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded-sm bg-green-50 text-green-700 shrink-0" title="LPOA signed">✓ LPOA</span>
                    )}
                    {c.billingStatus === 'Active' && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded-sm bg-blue-50 text-blue-700 shrink-0" title="Billing Active">Active</span>
                    )}
                    {c.billingStatus === 'Paused' && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded-sm bg-amber-50 text-amber-700 shrink-0" title={'Billing Paused' + (c.exitReason ? ' — ' + c.exitReason : '')}>Paused</span>
                    )}
                    {c.billingStatus === 'Graduated' && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded-sm bg-green-50 text-green-700 shrink-0" title="Graduated — arc complete">Graduated</span>
                    )}
                    {c.billingStatus === 'Inactive' && (
                      <span className="text-[9px] uppercase tracking-wider px-1.5 py-px rounded-sm bg-red-50 text-red-700 shrink-0" title={'Inactive' + (c.exitReason ? ' — ' + c.exitReason : '')}>Inactive</span>
                    )}
                  </div>
                  <div className="text-[11px] truncate" style={{ color: T.muted }}>
                    {c.email || <span className="text-amber-600">No email</span>}
                    {c.address && <span> · {c.address}</span>}
                    {isAdmin && auditors.length > 0 && <span style={{ color: T.faint }}> · {auditors.join(', ')}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <StatusBadge label={primary.label} tone={primary.tone} />
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: T.faint }} title={c.audits.length + ' audits'}>
                    <FileText size={12} strokeWidth={1.75} />{c.audits.length}
                  </span>
                  <span className="flex items-center gap-1 text-[11px]" style={{ color: T.faint }} title={c.letters.length + ' letters'}>
                    <Mail size={12} strokeWidth={1.75} />{c.letters.length}
                  </span>
                  <Menu items={clientMenu} />
                </div>
              </div>

              {editingEmail === c.id && (
                <div className="px-4 pb-3 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <input type="email" value={emailVal} onChange={(e) => setEmailVal(e.target.value)}
                    className="text-[11px] border border-border rounded-sm px-2 py-1 w-56"
                    placeholder="client@email.com" autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter') { updateClientEmail(c.name, emailVal, c.id).then(load); setEditingEmail(null); } if (e.key === 'Escape') setEditingEmail(null); }} />
                  <button onClick={() => { updateClientEmail(c.name, emailVal, c.id).then(load); setEditingEmail(null); }} className="text-[10px] uppercase tracking-wider text-white bg-navy px-2 py-1 rounded-sm">Save</button>
                  <button onClick={() => setEditingEmail(null)} className="text-[10px] text-ink-muted">Cancel</button>
                </div>
              )}

              {confirmDelete === c.id && (
                <div className="px-4 pb-3 flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                  <span className="text-[12px] text-red-600">Delete all records for {c.name}?</span>
                  <button onClick={() => handleDelete(c.name, c.id)} className="text-[11px] uppercase tracking-wider text-white bg-red-600 px-3 py-1 rounded-sm">Confirm Delete</button>
                  <button onClick={() => setConfirmDelete(null)} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">Cancel</button>
                </div>
              )}


            </div>
          );
        })}
      </div>

      {pageInfo.nextCursor && (
        <div className="flex justify-center pt-5">
          <button onClick={loadMore} disabled={loadingMore}
            className="px-4 py-2 rounded-lg border text-[11px] uppercase tracking-wider transition-colors disabled:opacity-50"
            style={{ borderColor: T.border, color: T.navy, background: '#fff' }}>
            {loadingMore ? 'Loading…' : 'Load more ' + (viewTab === 'leads' ? 'records' : 'clients') + ' (' + clients.length + ' of ' + pageInfo.totalCount + ')'}
          </button>
        </div>
      )}

      {lobMailerQueue.length > 0 && (() => {
        const currentLetter = lobMailerQueue[0];
        return (
          <LobMailer
            letter={currentLetter}
            furnisherAddress={currentLetter ? ((currentLetter.phase && currentLetter.phase.startsWith('Phase 3')) ? parseBureauAddress(currentLetter.phase) : (['Personal Info Cleanup', 'Inquiry Removal', 'Personal Info & Inquiries'].includes(currentLetter.phase) ? parseBureauAddress(currentLetter.furnisher) : parseFurnisherAddress(currentLetter.furnisher))) : null}
            batchRemaining={lobMailerQueue.length - 1}
            onNext={() => setLobMailerQueue(prev => prev.slice(1))}
            onClose={() => setLobMailerQueue([])}
            onSent={async (data) => {
              await updateLetter(currentLetter.id, {
                mailedDate: data.mailedDate,
                trackingStatus: 'Mailed',
                trackingNumber: data.trackingNumber || null,
                deliveredAt: null,
                lobId: data.lobId,
              });
              load();
            }}
          />
        );
      })()}

      {analyzingLetter && (
        <ResponseAnalyzer
          letter={analyzingLetter}
          onClose={() => setAnalyzingLetter(null)}
          onSaved={() => { setAnalyzingLetter(null); load(); }}
        />
      )}
      {createModal}
      {leadModal}
      <AccountTimelineModal data={accountTimeline} onClose={() => setAccountTimeline(null)} />
      <LetterEditModal letter={editingLetterHtml} onClose={() => setEditingLetterHtml(null)} onSaved={load} />
      <DiffResultModal result={diffResult} onClose={() => setDiffResult(null)} onOpenAudit={onOpenAudit} />
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
      const normEmail = email.trim().toLowerCase();

      // A portal profile must always point at a real CRM client. Creating
      // this record first gives the invitation service the durable client ID
      // it needs and avoids the old name-only portal association.
      const { data: { user: adminUser } } = await supabase.auth.getUser();
      if (!adminUser) throw new Error('Your admin session has expired. Please sign in again.');
      const { data: sameEmail } = await supabase
        .from('clients')
        .select('id')
        .eq('user_id', adminUser.id)
        .eq('email', normEmail)
        .limit(1);
      let clientId = sameEmail?.[0]?.id || null;
      if (!clientId) {
        const { data: createdClient, error: clientError } = await supabase
          .from('clients')
          .insert({ user_id: adminUser.id, name: name.trim(), email: normEmail, status: 'active' })
          .select('id')
          .single();
        if (clientError) throw new Error(clientError.message || 'Could not create client record');
        clientId = createdClient.id;
      }

      // Provision the auth user + linked client_profiles row server-side
      // (service role) so both exist, with user_id set, before the magic
      // link is sent — first login must never find a half-created account
      const { data: { session: _cpSess } } = await supabase.auth.getSession();
      const _cpTok = _cpSess?.access_token;
      const provRes = await fetch('/.netlify/functions/provision-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(_cpTok ? { Authorization: `Bearer ${_cpTok}` } : {}),
        },
        body: JSON.stringify({ email: normEmail, fullName: name.trim(), kind: 'client', clientId }),
      });
      if (!provRes.ok) {
        const out = await provRes.json().catch(() => ({}));
        throw new Error(out.error || 'Could not provision client account');
      }

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
function AddLeadModal({ onClose, onCreated }) {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [source, setSource] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  const handleCreate = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setLoading(true);
    setError(null);
    try {
      await createLead({ name, email, phone, source, notes });
      onCreated();
    } catch (e) {
      setError(e.message || 'Could not create lead');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className="bg-white border border-border rounded w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border flex items-center justify-between">
          <h2 className="text-[14px] font-medium text-ink">Add Lead</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink">✕</button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">Full Name</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              placeholder="Lead full name"
              className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="lead@email.com"
              className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">Phone</label>
            <input type="text" value={phone} onChange={e => setPhone(e.target.value)}
              placeholder="(555) 555-5555"
              className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">Source</label>
            <select value={source} onChange={e => setSource(e.target.value)}
              className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy bg-white">
              <option value="">Select source…</option>
              <option value="Razu Referral">Razu Referral</option>
              <option value="Swiftedly">Swiftedly</option>
              <option value="Fundhub">Fundhub</option>
              <option value="Facebook">Facebook</option>
              <option value="Website">Website</option>
              <option value="Word of Mouth">Word of Mouth</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Optional notes about this lead"
              rows={2}
              className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy resize-none" />
          </div>
          {error && <div className="bg-red-50 border border-red-200 rounded-sm p-2 text-[12px] text-red-700">{error}</div>}
          <button onClick={handleCreate} disabled={loading}
            className="w-full py-2 text-[12px] uppercase tracking-wider rounded-sm transition-colors disabled:opacity-50"
            style={{ backgroundColor: '#1B2A4A', color: '#C9A84C' }}>
            {loading ? 'Adding…' : 'Add Lead'}
          </button>
        </div>
      </div>
    </div>
  );
}

function LeadCard({ c, isAdmin, onConvert, converting, onDelete, onOpenAudit, onOpenSummaryAudit, onChanged, onViewed }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [emailVal, setEmailVal] = React.useState(c.email || '');
  const [phoneVal, setPhoneVal] = React.useState(c.leadPhone || '');
  const [sourceVal, setSourceVal] = React.useState(c.leadSource || '');
  const [notesVal, setNotesVal] = React.useState(c.leadNotes || '');
  const [saving, setSaving] = React.useState(false);
  const [quickEmail, setQuickEmail] = React.useState('');
  const [savingEmail, setSavingEmail] = React.useState(false);
  const [savingStage, setSavingStage] = React.useState(false);
  const hasAudits = (c.audits || []).length > 0;
  const stage = leadStage(c);
  const stageDef = LEAD_STAGES.find((s) => s.key === stage) || LEAD_STAGES[0];
  const ageDays = c.leadCreatedAt ? daysBetween(c.leadCreatedAt, todayISO()) : null;
  const ageTone = ageDays == null ? null : ageDays >= 14 ? { bg: '#FEF2F2', text: '#B91C1C' } : ageDays >= 7 ? { bg: '#FFFBEB', text: '#B45309' } : { bg: '#F3F4F6', text: '#6B7280' };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateLeadInfo(c.name, { email: emailVal.trim(), phone: phoneVal.trim(), source: sourceVal, notes: notesVal.trim() }, c.id);
      setEditing(false);
      if (onChanged) await onChanged();
    } catch (e) {
      toast.error('Could not save: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleQuickEmail = async () => {
    if (!quickEmail.trim()) return;
    setSavingEmail(true);
    try {
      await updateLeadInfo(c.name, { email: quickEmail.trim().toLowerCase() }, c.id);
      setQuickEmail('');
      if (onChanged) await onChanged();
    } catch (e) {
      toast.error('Could not save email: ' + e.message);
    } finally {
      setSavingEmail(false);
    }
  };

  const handleStageChange = async (next) => {
    setSavingStage(true);
    try {
      await updateLeadStage(c.name, next, c.tags, c.id);
      if (onChanged) await onChanged();
    } catch (e) {
      toast.error('Could not update stage: ' + e.message);
    } finally {
      setSavingStage(false);
    }
  };

  return (
    <div className="bg-white" style={{ borderRadius: 14, border: '1px solid ' + T.border, boxShadow: T.cardShadow }}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        {hasAudits && (
          <button onClick={() => { if (!isOpen && onViewed) onViewed(); setIsOpen(!isOpen); }} className="shrink-0" title={isOpen ? 'Collapse' : 'View audits'}>
            <ChevronRight size={15} strokeWidth={2} className="transition-transform" style={{ color: T.faint, transform: isOpen ? 'rotate(90deg)' : 'none' }} />
          </button>
        )}
        <Avatar name={c.name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="ccc-display text-[14px] text-ink font-medium">{c.name}</div>
            {isLeadRecent(c) && (
              <span className="px-1.5 py-0.5 rounded-[3px] text-[9px] uppercase tracking-wider font-bold bg-red-100 text-red-700">
                NEW
              </span>
            )}
            <select
              value={stage}
              disabled={savingStage || !isAdmin}
              onChange={(e) => handleStageChange(e.target.value)}
              title="Pipeline stage"
              className="text-[10px] uppercase tracking-wider rounded-full px-2 py-0.5 font-medium cursor-pointer focus:outline-none disabled:opacity-60"
              style={{ background: stageDef.bg, color: stageDef.text, border: '1px solid transparent', appearance: 'auto' }}>
              {LEAD_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {c.leadSource && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium bg-gray-100 text-gray-600">
                {c.leadSource}
              </span>
            )}
            {hasAudits && (
              <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium bg-blue-50 text-blue-700">
                {c.audits.length} audit{c.audits.length === 1 ? '' : 's'}
              </span>
            )}
            {ageTone && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-sm font-medium" style={{ background: ageTone.bg, color: ageTone.text }}
                title={c.leadCreatedAt ? 'Added ' + new Date(c.leadCreatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}>
                {ageDays}d in pipeline
              </span>
            )}
          </div>

          {editing ? (
            <div className="mt-2 space-y-2 max-w-md">
              <input type="email" value={emailVal} onChange={e => setEmailVal(e.target.value)} placeholder="Email"
                className="w-full border border-border rounded-sm px-2 py-1.5 text-[12px] focus:outline-none focus:border-navy" />
              <input type="text" value={phoneVal} onChange={e => setPhoneVal(e.target.value)} placeholder="Phone"
                className="w-full border border-border rounded-sm px-2 py-1.5 text-[12px] focus:outline-none focus:border-navy" />
              <select value={sourceVal} onChange={e => setSourceVal(e.target.value)}
                className="w-full border border-border rounded-sm px-2 py-1.5 text-[12px] focus:outline-none focus:border-navy bg-white">
                <option value="">Select source…</option>
                <option value="Razu Referral">Razu Referral</option>
                <option value="Swiftedly">Swiftedly</option>
                <option value="Fundhub">Fundhub</option>
                <option value="Facebook">Facebook</option>
                <option value="Website">Website</option>
                <option value="Word of Mouth">Word of Mouth</option>
                <option value="Other">Other</option>
              </select>
              <textarea value={notesVal} onChange={e => setNotesVal(e.target.value)} placeholder="Notes" rows={2}
                className="w-full border border-border rounded-sm px-2 py-1.5 text-[12px] focus:outline-none focus:border-navy resize-none" />
              <div className="flex items-center gap-2">
                <button onClick={handleSave} disabled={saving}
                  className="text-[11px] uppercase tracking-wider text-white bg-navy px-3 py-1 rounded-sm disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setEditing(false)} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">Cancel</button>
              </div>
            </div>
          ) : (
            <>
              {c.email ? (
                <div className="flex items-center gap-3 flex-wrap mt-1 text-[11px] text-ink-muted">
                  <span>{c.email}</span>
                  {c.leadPhone && <span>{c.leadPhone}</span>}
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap mt-1.5">
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium bg-amber-50 text-amber-700" title="The drip sequence skips leads without an email">
                    No email — drip paused
                  </span>
                  <input
                    type="email"
                    value={quickEmail}
                    onChange={(e) => setQuickEmail(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleQuickEmail()}
                    placeholder="add email…"
                    className="text-[11px] border rounded-sm px-2 py-1 focus:outline-none focus:border-navy"
                    style={{ width: 170, borderColor: T.border }}
                  />
                  <button onClick={handleQuickEmail} disabled={!quickEmail.trim() || savingEmail}
                    className="text-[10px] uppercase tracking-wider text-white bg-navy px-2 py-1 rounded-sm disabled:opacity-40">
                    {savingEmail ? '…' : 'Save'}
                  </button>
                </div>
              )}
              {c.leadNotes && (
                <p className="text-[12px] text-ink-muted mt-1.5">{c.leadNotes}</p>
              )}
            </>
          )}
        </div>
        {isAdmin && !editing && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onConvert}
              disabled={converting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider rounded-lg transition-colors disabled:opacity-50"
              style={{ backgroundColor: T.navy, color: T.gold }}
            >
              <UserPlus size={12} strokeWidth={2} /> {converting ? 'Converting…' : 'Convert to Client'}
            </button>
            <Menu items={[
              { label: 'Edit details', onClick: () => setEditing(true) },
              'divider',
              { label: 'Delete lead…', danger: true, onClick: onDelete },
            ]} />
          </div>
        )}
      </div>

      {isOpen && hasAudits && (
        <div className="px-4 py-3.5" style={{ borderTop: '1px solid ' + T.grid }}>
          <div className="flex items-center gap-2 mb-2">
            <span style={{ width: 3, height: 12, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
            <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: T.muted }}>Audits</div>
          </div>
          {c.audits.map((a) => (
            <div key={a.id} className="flex items-center justify-between py-1.5 flex-wrap gap-2">
              <div className="text-[12px] text-ink">
                Report {a.reportDate}
                {a.audit && <span className="text-ink-muted"> · {a.audit.accountsTargeted || 0} accounts · {a.audit.totalViolations || 0} violations</span>}
                {isAdmin && a.auditorName && <span className="text-[10px] text-ink-faint ml-2">· {a.auditorName}</span>}
              </div>
              <button onClick={() => {
                // a.audit here is NEVER a full audit. list_client_summaries
                // builds a stub for the newest audit only (row_number = 1):
                // accountsTargeted + totalViolations + an accounts array
                // trimmed to PENDING/CONFIRM entries carrying just
                // id/furnisher/addressStatus. It exists for this card's own
                // counts, nothing else. Opening it rendered "Unknown Client"
                // with blank scores, $0 balance and an empty batch table,
                // because the stub has no client object, no scores and no
                // real account rows. Older audits got audit: null and so
                // fell through to the detail fetch and worked — only the
                // newest one was broken, which is why this looked random.
                // Always hydrate through getClientDetails instead.
                if (onOpenSummaryAudit) onOpenSummaryAudit(c.id, a.id);
                else if (a.audit) onOpenAudit(a.clientId ? { ...a.audit, client: { ...a.audit.client, id: a.clientId } } : a.audit);
              }} className="text-[11px] uppercase tracking-wider text-navy hover:text-gold">Open</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function severityColor(sev) {
  if (sev === 'high') return { bg: '#FEF2F2', border: '#FECACA', text: '#B91C1C' };
  if (sev === 'med') return { bg: '#FFFBEB', border: '#FDE68A', text: '#B45309' };
  return { bg: '#F0FDF4', border: '#BBF7D0', text: '#15803D' };
}

function AccountTimelineModal({ data, onClose }) {
  if (!data) return null;
  const { furnisher, accountData, letters, clientName } = data;
  const sortedLetters = [...(letters || [])].sort((a, b) => (a.mailedDate || '').localeCompare(b.mailedDate || ''));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className="bg-white border border-border rounded w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-border sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="ccc-display text-[18px] text-ink font-medium">{furnisher}</h2>
              <p className="text-[12px] text-ink-muted mt-0.5">{clientName}</p>
            </div>
            <button onClick={onClose} className="text-ink-faint hover:text-ink text-lg leading-none">✕</button>
          </div>
          {accountData && (
            <div className="flex items-center gap-2 flex-wrap mt-3">
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-navy text-gold font-medium">Type {accountData.type}</span>
              <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-gray-100 text-gray-600">{accountData.status}</span>
              {accountData.balance != null && (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-gray-100 text-gray-600">${Number(accountData.balance).toLocaleString()} balance</span>
              )}
              {accountData.accountNumberMasked && (
                <span className="text-[10px] text-ink-faint">{accountData.accountNumberMasked}</span>
              )}
            </div>
          )}
        </div>

        <div className="p-5 space-y-6">
          {accountData && accountData.primaryViolation && (
            <div className="bg-navy text-white rounded p-3">
              <div className="text-[10px] uppercase tracking-wider text-gold font-medium mb-1">Primary Violation</div>
              <p className="text-[13px]">{accountData.primaryViolation}</p>
            </div>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Letter Timeline</div>
            {sortedLetters.length === 0 && <div className="text-[12px] text-ink-muted">No letters found for this account.</div>}
            <div className="space-y-2">
              {sortedLetters.map((l) => {
                const st = letterStatus(l);
                const isPhase3 = l.phase && l.phase.startsWith('Phase 3');
                return (
                  <div key={l.id} className="border border-border rounded-sm p-3">
                    <div className="flex items-center justify-between flex-wrap gap-1">
                      <span className={'text-[12px] font-medium'} style={{ color: isPhase3 ? '#C9A84C' : '#1B2A4A' }}>{l.phase}</span>
                      <StatusBadge label={st.label} tone={st.tone} />
                    </div>
                    <div className="text-[11px] text-ink-muted mt-1 flex items-center gap-3 flex-wrap">
                      {l.mailedDate && <span>Mailed {fmt(l.mailedDate)}</span>}
                      {l.deliveredAt && <span>Delivered {fmt(l.deliveredAt.slice(0, 10))}</span>}
                      {l.responseDate && <span>Response {fmt(l.responseDate)}</span>}
                    </div>
                    {l.summary && <p className="text-[12px] text-ink-muted mt-1.5">{l.summary}</p>}
                  </div>
                );
              })}
            </div>
          </div>

          {accountData && accountData.violations && accountData.violations.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Cited Violations ({accountData.violations.length})</div>
              <div className="space-y-2">
                {accountData.violations.map((v, i) => {
                  const c = severityColor(v.severity);
                  return (
                    <div key={i} className="rounded-sm p-3 border" style={{ backgroundColor: c.bg, borderColor: c.border }}>
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] font-medium text-ink">{v.field}</span>
                        <span className="text-[10px] uppercase tracking-wider font-medium" style={{ color: c.text }}>{v.severity}</span>
                      </div>
                      <p className="text-[12px] text-ink-muted mt-1">{v.issue}</p>
                      <p className="text-[11px] text-ink-faint mt-1 italic">{v.statute}</p>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// A violation count going down never proves anything got fixed — Claude's
// extraction isn't perfectly deterministic between audit runs, so "3 → 2"
// could just as easily be the model not re-flagging one this time. This
// shows exactly which violations were resolved vs newly found, so a human
// can judge that instead of trusting a bare number.
function ViolationDetail({ a }) {
  const SEV_COLOR = { high: 'text-red-700', med: 'text-amber-700', low: 'text-ink-muted' };
  const stillPresent = (a.newViolations || []).filter(
    (v) => !(a.violationsNew || []).some((nv) => nv.field === v.field)
  );
  return (
    <div className="mt-2 pt-2 border-t border-black/5 space-y-2">
      {a.violationsResolved && a.violationsResolved.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-ink-faint font-medium mb-1">
            No longer flagged this pull — verify before assuming resolved
          </div>
          {a.violationsResolved.map((v, i) => (
            <div key={i} className="text-[11px] text-ink-muted">
              <span className={SEV_COLOR[v.severity] || ''}>{v.field}</span> — {v.issue}
            </div>
          ))}
        </div>
      )}
      {a.violationsNew && a.violationsNew.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-ink-faint font-medium mb-1">Newly flagged</div>
          {a.violationsNew.map((v, i) => (
            <div key={i} className="text-[11px] text-ink-muted">
              <span className={SEV_COLOR[v.severity] || ''}>{v.field}</span> — {v.issue}
            </div>
          ))}
        </div>
      )}
      {stillPresent.length > 0 && (
        <div>
          <div className="text-[9px] uppercase tracking-wider text-ink-faint font-medium mb-1">Still present</div>
          {stillPresent.map((v, i) => (
            <div key={i} className="text-[11px] text-ink-muted">
              <span className={SEV_COLOR[v.severity] || ''}>{v.field}</span> — {v.issue}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiffResultModal({ result, onClose, onOpenAudit }) {
  const [expandedKey, setExpandedKey] = React.useState(null);
  if (!result) return null;
  const { clientName, fromReportDate, toReportDate, diff, phaseProgress = [], newerAudit, letters } = result;

  // The diff only carries a lightweight summary per account (furnisher,
  // masked number, balance, status) — letter generation needs the full
  // record (violations, batch, strategy, addressStatus...), which lives on
  // newerAudit.accounts. Matched the same way the diff engine itself
  // identifies an account within one report: furnisher + masked number.
  const findFullAccount = (a) => (newerAudit?.accounts || []).find(
    (fa) => fa.furnisher === a.furnisher && fa.accountNumberMasked === a.accountNumberMasked
  ) || null;

  // Safety net for the shortcut below: match by furnisher name only (the
  // one identifier every mailed Phase 1 letter and every diffed account
  // both reliably carry) against any already-mailed, non-Phase-3 letter.
  // Not perfectly precise if a client has two distinct accounts with the
  // same furnisher, but the point is to stop an accidental re-send, not to
  // silently allow one on a technicality.
  const normFurnisher = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const alreadyDisputed = (furnisher) => {
    const target = normFurnisher(furnisher);
    return (letters || []).some((l) => l.mailedDate && !l.phase?.startsWith('Phase 3') && normFurnisher(l.furnisher) === target);
  };

  // Reuses the existing, unmodified letter-generation flow exactly as if
  // the account were opened normally from this audit's own results page —
  // just skips the navigation. Never touches how a letter is generated.
  const disputeAccount = (a) => {
    const full = findFullAccount(a);
    if (!full || !newerAudit || !onOpenAudit) return;
    onOpenAudit(newerAudit, full);
    onClose();
  };

  const DisputeAction = ({ a, tone }) => {
    const full = findFullAccount(a);
    if (!full) return null;
    if (alreadyDisputed(a.furnisher)) {
      return (
        <span className="shrink-0 text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm bg-gray-100 text-ink-faint" title="A letter has already been mailed to this furnisher — check the Letters tab before disputing again">
          Already Disputed
        </span>
      );
    }
    const toneClass = tone === 'amber' ? 'border-amber-300 text-amber-700 hover:bg-amber-100' : 'border-blue-300 text-blue-700 hover:bg-blue-100';
    return (
      <button onClick={() => disputeAccount(a)} className={`shrink-0 text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm border transition-colors ${toneClass}`}>
        Generate Letter
      </button>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className="bg-white border border-border rounded w-full max-w-2xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-border sticky top-0 bg-white z-10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="ccc-display text-[18px] text-ink font-medium">Report Comparison</h2>
              <p className="text-[12px] text-ink-muted mt-0.5">{clientName} · {fromReportDate} → {toReportDate}</p>
            </div>
            <button onClick={onClose} className="text-ink-faint hover:text-ink text-lg leading-none">✕</button>
          </div>
        </div>

        <div className="p-5 space-y-5">
          {phaseProgress.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-navy font-medium mb-2">Campaign status across phases</div>
              <div className="overflow-hidden rounded-sm border border-border bg-white">
                {phaseProgress.map((item) => (
                  <div key={item.accountKey} className="flex items-start justify-between gap-3 px-3 py-2.5 border-t border-border first:border-t-0">
                    <div className="min-w-0">
                      <div className="text-[12px] font-medium text-ink truncate">{item.furnisher} {item.accountNumberMasked && <span className="text-ink-faint font-normal">{item.accountNumberMasked}</span>}</div>
                      <div className="text-[11px] text-ink-muted mt-0.5">{item.reportLabel} · {item.label}</div>
                    </div>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm bg-blue-50 text-navy">Phase {item.phase}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {diff.deleted.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-green-700 font-medium mb-2">Deleted ({diff.deleted.length})</div>
              <div className="space-y-2">
                {diff.deleted.map((a, i) => (
                  <div key={i} className="bg-green-50 border border-green-200 rounded-sm p-3">
                    <div className="text-[12px] font-medium text-ink">{a.furnisher} <span className="text-ink-faint font-normal">{a.accountNumberMasked}</span></div>
                    <div className="text-[11px] text-ink-muted mt-0.5">Was: {a.oldStatus} · ${Number(a.oldBalance || 0).toLocaleString()} past due</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {diff.changed.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-amber-700 font-medium mb-2">Changed ({diff.changed.length})</div>
              <div className="space-y-2">
                {diff.changed.map((a, i) => {
                  const key = 'changed-' + i;
                  const isOpen = expandedKey === key;
                  return (
                    <div key={i} className="bg-amber-50 border border-amber-200 rounded-sm p-3">
                      <div className="flex items-start justify-between gap-3">
                        <button className="text-left flex-1" onClick={() => setExpandedKey(isOpen ? null : key)}>
                          <div className="text-[12px] font-medium text-ink hover:underline">{a.furnisher} <span className="text-ink-faint font-normal">{a.accountNumberMasked}</span></div>
                          <div className="text-[11px] text-ink-muted mt-0.5">
                            {a.oldStatus !== a.newStatus && <span>Status: {a.oldStatus} → {a.newStatus} · </span>}
                            {a.oldBalance !== a.newBalance && <span>Balance: ${Number(a.oldBalance || 0).toLocaleString()} → ${Number(a.newBalance || 0).toLocaleString()} · </span>}
                            Violations: {a.oldViolationCount} → {a.newViolationCount}
                            {(a.oldViolationCount !== a.newViolationCount || (a.violationsResolved || []).length > 0) && <span className="text-navy"> · view detail</span>}
                          </div>
                        </button>
                        <DisputeAction a={a} tone="amber" />
                      </div>
                      {isOpen && <ViolationDetail a={a} />}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {diff.new.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-blue-700 font-medium mb-2">New Accounts ({diff.new.length})</div>
              <div className="space-y-2">
                {diff.new.map((a, i) => {
                  const full = findFullAccount(a);
                  const key = 'new-' + i;
                  const isOpen = expandedKey === key;
                  return (
                    <div key={i} className="bg-blue-50 border border-blue-200 rounded-sm p-3">
                      <div className="flex items-start justify-between gap-3">
                        <button className="text-left flex-1" onClick={() => setExpandedKey(isOpen ? null : key)} disabled={!full?.violations?.length}>
                          <div className="text-[12px] font-medium text-ink hover:underline">{a.furnisher} <span className="text-ink-faint font-normal">{a.accountNumberMasked}</span></div>
                          <div className="text-[11px] text-ink-muted mt-0.5">
                            {a.status} · ${Number(a.balance || 0).toLocaleString()}
                            {full?.violations?.length > 0 && <span className="text-navy"> · view {full.violations.length} violation{full.violations.length === 1 ? '' : 's'}</span>}
                          </div>
                        </button>
                        <DisputeAction a={a} tone="blue" />
                      </div>
                      {isOpen && full?.violations?.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-black/5 space-y-1">
                          {full.violations.map((v, vi) => (
                            <div key={vi} className="text-[11px] text-ink-muted">
                              <span className={v.severity === 'high' ? 'text-red-700' : v.severity === 'med' ? 'text-amber-700' : ''}>{v.field}</span> — {v.issue}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {diff.unchanged.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Unchanged ({diff.unchanged.length})</div>
              <p className="text-[12px] text-ink-muted">{diff.unchanged.map((a) => a.furnisher).join(', ')}</p>
            </div>
          )}

          {diff.deleted.length === 0 && diff.changed.length === 0 && diff.new.length === 0 && (
            <p className="text-[13px] text-ink-muted">No changes detected between these two reports.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function LetterEditModal({ letter, onClose, onSaved }) {
  const [saving, setSaving] = React.useState(false);
  const editorRef = React.useRef(null);

  if (!letter) return null;

  const handleSave = async () => {
    setSaving(true);
    try {
      let html = editorRef.current?.innerHTML || '';
      if (String(letter.phase || '').startsWith('Phase 3')) {
        html = autoFixFieldCitations(html).html;
        if (isPhase3FollowUpLetter(letter)) html = normalizeFollowUpPresentation(html);
        const problems = isPhase3FollowUpLetter(letter)
          ? collectBureauFollowUpProblems(html)
          : collectPhase3CitationProblems(html);
        if (problems.length) {
          throw new Error('Phase 3 safety check failed: ' + problems.join(' '));
        }
      }

      if (isPhase3FollowUpLetter(letter)) {
        if (!letter.clientId) throw new Error('Client identity is missing; signature injection was blocked.');
        const [{ data: profiles, error: profileError }, { data: clients, error: clientError }] = await Promise.all([
          supabase.from('client_profiles').select('signature_data').eq('client_id', letter.clientId).limit(1),
          supabase.from('clients').select('lpoa_signature_data,name').eq('id', letter.clientId).limit(1),
        ]);
        if (profileError) throw profileError;
        if (clientError) throw clientError;
        const signatureUrl = profiles?.[0]?.signature_data || clients?.[0]?.lpoa_signature_data?.signatureUrl;
        const clientName = clients?.[0]?.name || letter.clientName;
        if (!signatureUrl) throw new Error('The client has no stored signature.');
        const signedHtml = injectSignatureImage(html, signatureUrl, clientName);
        if (signedHtml === html && !hasInjectedSignature(html, signatureUrl)) {
          throw new Error('The signature block could not be located.');
        }
        html = signedHtml;
      }
      await updateLetter(letter.id, { html });
      if (onSaved) await onSaved();
      onClose();
    } catch (e) {
      toast.error('Could not save: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6" onClick={onClose}>
      <div className="bg-gray-100 border border-border rounded-lg w-full max-w-4xl h-[90vh] flex flex-col overflow-hidden shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="bg-white p-4 border-b border-border flex items-center justify-between shrink-0 shadow-sm z-10">
          <div>
            <h2 className="text-[15px] font-bold text-ink flex items-center gap-2">
              <Pencil size={14} className="text-gold" /> Letter Editor
            </h2>
            <p className="text-[12px] text-ink-muted mt-0.5">{letter.furnisher} — {letter.phase}</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onClose} className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted hover:text-ink px-3 py-2 transition-colors">Cancel</button>
            <button onClick={handleSave} disabled={saving}
              className="text-[11px] uppercase tracking-wider font-bold text-white bg-navy hover:bg-slate-800 transition-colors px-5 py-2 rounded shadow-sm disabled:opacity-50 flex items-center gap-2">
              {saving ? 'Saving…' : 'Finalize & Save'}
            </button>
          </div>
        </div>
        
        <div className="p-8 flex-1 overflow-y-auto bg-gray-100 flex justify-center">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            dangerouslySetInnerHTML={{ __html: letter.html || '' }}
            className="bg-white w-[8.5in] min-h-[11in] shadow-xl p-[1in] focus:outline-none"
            style={{
              fontFamily: "Arial, sans-serif",
              fontSize: "10pt",
              lineHeight: "1.5",
              color: "#000",
              cursor: "text"
            }}
          />
        </div>
      </div>
    </div>
  );
}
