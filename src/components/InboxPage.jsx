import React, { useEffect, useState } from 'react';
import { Star, ChevronRight, Send, Clock, Inbox as InboxIcon, FileSignature, FileSearch, MapPinned, Mail as MailIcon, Zap } from 'lucide-react';
import { getLetterForMail, listAllClientSummaries, updateLetter } from '../utils/storage';
import { getUnanalyzedResponseStats } from '../utils/actionItems';
import { normalizeFurnisher } from '../utils/diffEngine';
import LobMailer from './LobMailer';

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

const BACKLOG_WARN_DAYS = 7;
const BACKLOG_LATE_DAYS = 14;

function todayISO() {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function daysBetween(aIso, bIso) {
  const a = new Date(String(aIso).slice(0, 10) + 'T00:00:00');
  const b = new Date(String(bIso).slice(0, 10) + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}
function fmtTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const diffH = Math.round((Date.now() - d) / 3600000);
    if (diffH < 1) return 'just now';
    if (diffH < 24) return diffH + 'h ago';
    if (diffH < 48) return 'yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) { return iso; }
}

// One card per client for the first three stages (a client sits in exactly
// one of these — lead, or missing LPOA, or audited-with-no-letters-yet —
// never more than one, so the board reads as a real pipeline instead of the
// same name showing up three times). The last three are per-item: a single
// client can have an account awaiting address confirmation AND a different
// letter ready to mail AND an unanalyzed response, all at once — that's
// real and each needs its own card.
function computeInboxColumns(clients, unanalyzedNames, unanalyzedClientIds) {
  const newLeads = [];
  const needsLpoa = [];
  const auditComplete = [];
  const addressConfirm = [];
  const readyToMail = [];
  const phase2Inbox = [];

  for (const c of clients) {
    if (c.status === 'lead') {
      newLeads.push({ clientId: c.id, name: c.name, isVip: c.isVip, createdAt: c.leadCreatedAt, source: c.leadSource });
      continue;
    }

    if (!c.lpoaSigned) {
      needsLpoa.push({ clientId: c.id, name: c.name, isVip: c.isVip, hasAudit: c.audits.length > 0, enrollmentDate: c.enrollmentDate });
    } else if (c.audits.length > 0 && c.letters.length === 0) {
      const latest = c.audits[0] && c.audits[0].audit;
      auditComplete.push({ clientId: c.audits[0].clientId || c.id, name: c.name, isVip: c.isVip, accountsTargeted: (latest && latest.accountsTargeted) || 0, savedAt: c.audits[0].savedAt });
    }

    const latestAccounts = (c.audits[0] && c.audits[0].audit && c.audits[0].audit.accounts) || [];
    for (const acct of latestAccounts) {
      // CONFIRM (matched masterPrompt.js's static list, pre-filled but not
      // yet human-approved) belongs here too, not just PENDING (no match at
      // all) — same two statuses the audit-run-background.mjs backfill
      // resolves. CONFIRM ones are a single approve-click, not a lookup, so
      // status rides along for the UI to distinguish.
      if (acct.addressStatus === 'PENDING' || acct.addressStatus === 'CONFIRM') {
        addressConfirm.push({ clientId: c.id, client: c.name, isVip: c.isVip, furnisher: acct.furnisher, accountId: acct.id, status: acct.addressStatus });
      }
    }

    for (const l of c.letters) {
      if (l.phase?.startsWith('Phase 3')) continue;
      if (!l.mailedDate) {
        readyToMail.push({ clientId: l.clientId || c.id, client: l.clientName || c.name, isVip: c.isVip, furnisher: l.furnisher, savedAt: l.savedAt, ageDays: l.savedAt ? daysBetween(l.savedAt, todayISO()) : 0, letter: l });
      }
    }

    if (unanalyzedClientIds?.has(c.id) || unanalyzedNames.has(c.name)) {
      phase2Inbox.push({ clientId: c.id, name: c.name, isVip: c.isVip });
    }
  }

  newLeads.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  needsLpoa.sort((a, b) => (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0));
  auditComplete.sort((a, b) => (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0) || (b.savedAt || '').localeCompare(a.savedAt || ''));
  addressConfirm.sort((a, b) => (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0));
  readyToMail.sort((a, b) => (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0) || (a.savedAt || '').localeCompare(b.savedAt || ''));
  phase2Inbox.sort((a, b) => (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0));

  return { newLeads, needsLpoa, auditComplete, addressConfirm, readyToMail, phase2Inbox };
}

// Same furnisher shows up once per affected client (each is a distinct
// account needing its own confirm click), but the actual research burden —
// finding the real address — only needs doing once per furnisher. Groups by
// the same normalizeFurnisher() key furnisher_addresses itself keys on, so
// "Capital One Bank, N.A." and "CAPITAL ONE BANK NA" land in one group
// instead of looking like two furnishers to look up separately. Biggest
// groups first — confirming a furnisher that's blocking 5 clients clears
// more of the column at once than one blocking a single client.
function groupAddressConfirmByFurnisher(items) {
  const groups = new Map();
  for (const item of items) {
    const key = normalizeFurnisher(item.furnisher) || item.furnisher || 'unknown';
    if (!groups.has(key)) groups.set(key, { key, furnisher: item.furnisher, items: [] });
    groups.get(key).items.push(item);
  }
  return [...groups.values()].sort((a, b) =>
    b.items.length - a.items.length
    || (b.items.some((i) => i.isVip) ? 1 : 0) - (a.items.some((i) => i.isVip) ? 1 : 0)
  );
}

function AgeBadge({ days }) {
  if (days >= BACKLOG_LATE_DAYS) return <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-red-50 text-red-700 font-medium shrink-0"><Clock size={9} strokeWidth={2.5} /> {days}d</span>;
  if (days >= BACKLOG_WARN_DAYS) return <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-amber-50 text-amber-700 font-medium shrink-0"><Clock size={9} strokeWidth={2.5} /> {days}d</span>;
  return null;
}

function Column({ icon: Icon, title, hint, count, children, empty }) {
  return (
    <div className="flex flex-col min-w-0" style={{ minWidth: 260 }}>
      <div className="flex items-center gap-2 mb-2 px-1">
        <Icon size={13} strokeWidth={2} style={{ color: T.navy }} />
        <div className="text-[11px] uppercase tracking-wider font-bold" style={{ color: T.navy }}>{title}</div>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-bold" style={{ background: count > 0 ? '#EEF1F7' : T.grid, color: count > 0 ? T.navy : T.faint }}>{count}</span>
      </div>
      <div className="text-[10px] mb-2 px-1" style={{ color: T.faint }}>{hint}</div>
      <div className="flex-1 space-y-2 rounded-xl p-2" style={{ background: '#FAFBFC', border: '1px solid ' + T.border, minHeight: 120 }}>
        {count === 0 ? (
          <div className="text-[11px] text-center py-6" style={{ color: T.faint }}>{empty}</div>
        ) : children}
      </div>
    </div>
  );
}

function ItemCard({ onClick, isVip, title, subtitle, right }) {
  return (
    <div onClick={onClick}
      className="bg-white rounded-lg px-3 py-2.5 cursor-pointer hover:shadow-sm transition-shadow group"
      style={{ border: '1px solid ' + T.border }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          {isVip && <Star size={10} strokeWidth={2.5} style={{ color: T.gold, flexShrink: 0 }} />}
          <div className="min-w-0">
            <div className="text-[12px] font-medium truncate group-hover:text-navy" style={{ color: T.ink }}>{title}</div>
            {subtitle && <div className="text-[10px] truncate" style={{ color: T.faint }}>{subtitle}</div>}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {right}
          <ChevronRight size={12} strokeWidth={2} className="group-hover:text-navy" style={{ color: T.faint }} />
        </div>
      </div>
    </div>
  );
}

export default function InboxPage({ isAdmin, onNavigate }) {
  const [columns, setColumns] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lobMailerLetter, setLobMailerLetter] = useState(null);
  const [openingLetterId, setOpeningLetterId] = useState(null);
  const [truncated, setTruncated] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [summary, unanalyzed] = await Promise.all([
        listAllClientSummaries(),
        getUnanalyzedResponseStats(),
      ]);
      setColumns(computeInboxColumns(summary.clients, unanalyzed.clientNames, unanalyzed.clientIds));
      setTruncated(summary.truncated);
    } catch (error) {
      console.error('Could not load inbox work items:', error);
      setColumns(computeInboxColumns([], new Set(), new Set()));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]);

  const openMailer = async (letterId) => {
    if (!letterId || openingLetterId) return;
    setOpeningLetterId(letterId);
    try {
      // Summary rows deliberately omit HTML. LobMailer receives this exact
      // row only after a just-in-time, RLS-protected detail fetch.
      setLobMailerLetter(await getLetterForMail(letterId));
    } catch (error) {
      console.error('Could not open letter for mailing:', error);
      window.alert('Could not load this letter for mailing. Please open the client record and try again.');
    } finally {
      setOpeningLetterId(null);
    }
  };

  if (!isAdmin) {
    return <div className="p-8 text-center text-muted">Access Denied. Admins only.</div>;
  }

  if (loading || !columns) {
    return (
      <div className="w-full h-64 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-navy border-t-gold rounded-full animate-spin"></div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted">Loading inbox...</div>
        </div>
      </div>
    );
  }

  const goto = (clientId, fallbackName) => onNavigate('clients', { jumpTo: clientId || fallbackName });

  return (
    <div style={{ padding: '20px 32px 32px' }}>
      <div className="mb-5">
        <h1 className="text-2xl font-bold ccc-display" style={{ color: T.navy }}>Inbox</h1>
        <p className="text-[13px] mt-1" style={{ color: T.muted }}>Every client and letter that needs a decision, in one place — organized by what's blocking it.</p>
        {truncated && <p className="text-[11px] mt-1 text-amber-700">Showing the first 10,000 client summaries. Refine the CRM before adding more operating queues.</p>}
      </div>

      <div className="flex gap-4 overflow-x-auto pb-2">
        <Column icon={InboxIcon} title="New Leads" hint="Not yet converted" count={columns.newLeads.length} empty="No new leads">
          {columns.newLeads.map((l, i) => (
            <ItemCard key={i} onClick={() => goto(l.clientId, l.name)} isVip={l.isVip} title={l.name}
              subtitle={l.source || (l.createdAt ? fmtTime(l.createdAt) : null)} />
          ))}
        </Column>

        <Column icon={FileSignature} title="Needs LPOA" hint="Can't dispute until signed" count={columns.needsLpoa.length} empty="Everyone's signed">
          {columns.needsLpoa.map((c, i) => (
            <ItemCard key={i} onClick={() => goto(c.clientId, c.name)} isVip={c.isVip} title={c.name}
              subtitle={c.hasAudit ? 'Audit on file, awaiting signature' : 'No audit yet'} />
          ))}
        </Column>

        <Column icon={Zap} title="Audit Complete" hint="No letters generated yet" count={columns.auditComplete.length} empty="Nothing waiting">
          {columns.auditComplete.map((c, i) => (
            <ItemCard key={i} onClick={() => goto(c.clientId, c.name)} isVip={c.isVip} title={c.name}
              subtitle={c.accountsTargeted + ' account' + (c.accountsTargeted === 1 ? '' : 's') + ' targeted'} />
          ))}
        </Column>

        <Column icon={MapPinned} title="Address Confirm" hint="Blocking letter generation" count={columns.addressConfirm.length} empty="No addresses pending">
          {groupAddressConfirmByFurnisher(columns.addressConfirm).map((g) => (
            <div key={g.key}>
              <div className="text-[10px] uppercase tracking-wider font-semibold px-1 mb-1 flex items-center justify-between gap-2">
                <span className="truncate" style={{ color: T.muted }}>{g.furnisher}</span>
                <span className="shrink-0" style={{ color: T.faint }}>{g.items.length} {g.items.length === 1 ? 'client' : 'clients'}</span>
              </div>
              <div className="space-y-1.5 mb-2">
                {g.items.map((a, i) => (
                  <ItemCard key={i} onClick={() => goto(a.clientId, a.client)} isVip={a.isVip} title={a.client}
                    subtitle={a.status === 'CONFIRM' ? 'Suggested address — 1 click to approve' : 'No address on file yet'} />
                ))}
              </div>
            </div>
          ))}
        </Column>

        <Column icon={MailIcon} title="Ready to Mail" hint="Generated, not yet sent" count={columns.readyToMail.length} empty="Nothing waiting to mail">
          {columns.readyToMail.map((r, i) => (
            <ItemCard key={i} onClick={() => goto(r.clientId, r.client)} isVip={r.isVip} title={r.client}
              subtitle={r.furnisher + ' · generated ' + fmtTime(r.savedAt)}
              right={
                <>
                  <AgeBadge days={r.ageDays} />
                  <button onClick={(e) => { e.stopPropagation(); openMailer(r.letter.id); }} disabled={openingLetterId === r.letter.id}
                    className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm shrink-0 transition-colors disabled:opacity-60"
                    style={{ backgroundColor: T.navy, color: T.gold }}>
                    <Send size={10} strokeWidth={2} /> {openingLetterId === r.letter.id ? 'Opening…' : 'Send'}
                  </button>
                </>
              }
            />
          ))}
        </Column>

        <Column icon={FileSearch} title="Phase 2 Inbox" hint="Response uploaded, not analyzed" count={columns.phase2Inbox.length} empty="Nothing to triage">
          {columns.phase2Inbox.map((c, i) => (
            <ItemCard key={i} onClick={() => goto(c.clientId, c.name)} isVip={c.isVip} title={c.name} subtitle="Open Documents tab to analyze" />
          ))}
        </Column>
      </div>

      {lobMailerLetter && (
        <LobMailer
          letter={lobMailerLetter}
          onClose={() => setLobMailerLetter(null)}
          onSent={async (data) => {
            // Don't close the modal here — LobMailer shows its own sent/
            // receipt screen (and a warning if this save fails); the user
            // closes it themselves. This save is what actually marks the
            // letter mailed — skipping it would leave Lob thinking it sent
            // while our own data still shows it sitting in this column.
            await updateLetter(lobMailerLetter.id, { mailedDate: data.mailedDate, lobId: data.lobId, trackingNumber: data.trackingNumber });
            load();
          }}
        />
      )}
    </div>
  );
}
