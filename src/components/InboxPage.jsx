import React, { useEffect, useState } from 'react';
import { Star, ChevronRight, Send, Clock, Inbox as InboxIcon, FileSignature, FileSearch, MapPinned, Mail as MailIcon, Zap } from 'lucide-react';
import { getLetterForMail, updateLetter } from '../utils/storage';
import { supabase } from '../utils/supabase';
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
// Build inbox columns from narrow pre-fetched data — no full client dump needed.
// Each parameter is an array of only the records that have work to do in that column.
function computeInboxColumns({ leads, lpoaClients, auditOnlyClients, pendingAddresses, unmaledLetters, unanalyzedNames, unanalyzedClientIds }) {
  const newLeads = leads.map((r) => ({
    clientId: r.id, name: r.name, isVip: !!r.is_vip,
    createdAt: r.lead_created_at, source: r.lead_source,
  })).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

  const needsLpoa = lpoaClients.map((r) => ({
    clientId: r.id, name: r.name, isVip: !!r.is_vip,
    hasAudit: r.audit_count > 0, enrollmentDate: r.enrollment_date,
  })).sort((a, b) => (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0));

  const auditComplete = auditOnlyClients.map((r) => ({
    clientId: r.id, name: r.name, isVip: !!r.is_vip,
    accountsTargeted: r.accounts_targeted || 0, savedAt: r.latest_audit_at,
  })).sort((a, b) => (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0) || (b.savedAt || '').localeCompare(a.savedAt || ''));

  const addressConfirm = pendingAddresses.map((r) => ({
    clientId: r.client_id, client: r.client_name, isVip: !!r.is_vip,
    furnisher: r.furnisher, accountId: r.account_id, status: r.address_status,
  })).sort((a, b) => (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0));

  const readyToMail = unmaledLetters.map((r) => ({
    clientId: r.client_id, client: r.client_name, isVip: !!r.is_vip,
    furnisher: r.furnisher, savedAt: r.saved_at,
    ageDays: r.saved_at ? daysBetween(r.saved_at, todayISO()) : 0,
    letter: {
      id: r.id, clientId: r.client_id, clientName: r.client_name,
      furnisher: r.furnisher, phase: r.phase, savedAt: r.saved_at,
      mailedDate: r.mailed_date, coveredFurnishers: r.covered_furnishers || [],
      lob_id: r.lob_id, trackingNumber: r.tracking_number,
    },
  })).sort((a, b) => (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0) || (a.savedAt || '').localeCompare(b.savedAt || ''));

  const phase2Inbox = [];
  const allNames = new Set([...leads, ...lpoaClients, ...auditOnlyClients].map((r) => r.name));
  // Phase 2 inbox uses the unanalyzed stats which are already keyed by id/name
  for (const name of (unanalyzedNames || [])) {
    phase2Inbox.push({ clientId: null, name, isVip: false });
  }
  for (const id of (unanalyzedClientIds || [])) {
    if (!phase2Inbox.some((p) => p.clientId === id)) {
      phase2Inbox.push({ clientId: id, name: null, isVip: false });
    }
  }

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
      // Four narrow parallel queries — only fetch records with open work items.
      // Avoids loading every client's full audit JSON and letter HTML just to
      // render pipeline column counts.
      const [leadsRes, lpoaRes, unanalyzed] = await Promise.all([
        // New leads
        supabase.from('clients')
          .select('id,name,is_vip,lead_created_at,lead_source')
          .eq('status', 'lead')
          .order('lead_created_at', { ascending: false })
          .limit(200),
        // Needs LPOA — active clients without a signed LPOA
        supabase.from('clients')
          .select('id,name,is_vip,enrollment_date,audit_count:audits(count)')
          .neq('status', 'lead')
          .eq('lpoa_signed', false)
          .limit(200),
        getUnanalyzedResponseStats(),
      ]);

      // Unmailed letters feed the audit-only subtraction below. Address-
      // confirm rows are derived from the audits JSONB scan that follows —
      // PostgREST cannot filter nested account addressStatus in one query.
      const { data: unmailedLetters, error: unmailedError } = await supabase.from('letters')
        .select('id,client_id,client_name,furnisher,phase,saved_at,mailed_date,covered_furnishers,lob_id,tracking_number')
        .is('mailed_date', null)
        .not('phase', 'ilike', 'Phase 3%')
        .order('saved_at', { ascending: true })
        .limit(300);
      if (unmailedError) throw unmailedError;
      const unmaledLettersRes = { data: unmailedLetters || [] };

      // PostgREST can't filter inside JSONB arrays in a single query.
      // Fetch audit+client data for address-confirm in two steps: get audits
      // with non-null addressStatus accounts, join client VIP flag in JS.
      const { data: allRecentAudits } = await supabase
        .from('audits')
        .select('client_id,client_name,audit')
        .order('saved_at', { ascending: false })
        .limit(500);

      const pendingAddresses = [];
      for (const row of (allRecentAudits || [])) {
        const accounts = row.audit?.accounts || [];
        for (const acct of accounts) {
          if (acct.addressStatus === 'PENDING' || acct.addressStatus === 'CONFIRM') {
            pendingAddresses.push({
              client_id: row.client_id,
              client_name: row.client_name,
              is_vip: false,
              furnisher: acct.furnisher,
              account_id: acct.id,
              address_status: acct.addressStatus,
            });
          }
        }
      }

      // Audit-only clients: clients who have letters=0 and audits>0.
      // Use unmailed letters set to find clients WITH letters, then subtract.
      const clientsWithLetters = new Set((unmaledLettersRes.data || []).map((l) => l.client_id).filter(Boolean));
      const { data: auditRows } = await supabase
        .from('audits')
        .select('client_id,client_name,saved_at,audit')
        .order('saved_at', { ascending: false })
        .limit(500);
      const auditOnlyMap = new Map();
      for (const row of (auditRows || [])) {
        const cid = row.client_id;
        if (!cid || clientsWithLetters.has(cid)) continue;
        if (!auditOnlyMap.has(cid)) {
          auditOnlyMap.set(cid, {
            id: cid, name: row.client_name, is_vip: false,
            accounts_targeted: row.audit?.accountsTargeted || 0,
            latest_audit_at: row.saved_at,
          });
        }
      }

      setColumns(computeInboxColumns({
        leads: leadsRes.data || [],
        lpoaClients: (lpoaRes.data || []).map((r) => ({ ...r, audit_count: r.audit_count?.[0]?.count || 0 })),
        auditOnlyClients: Array.from(auditOnlyMap.values()),
        pendingAddresses,
        unmaledLetters: unmaledLettersRes.data || [],
        unanalyzedNames: unanalyzed.clientNames,
        unanalyzedClientIds: unanalyzed.clientIds,
      }));
      setTruncated(false);
    } catch (error) {
      console.error('Could not load inbox work items:', error);
      setColumns(computeInboxColumns({ leads: [], lpoaClients: [], auditOnlyClients: [], pendingAddresses: [], unmaledLetters: [], unanalyzedNames: new Set(), unanalyzedClientIds: new Set() }));
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
