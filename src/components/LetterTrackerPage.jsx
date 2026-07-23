import React, { useEffect, useState } from 'react';
import { Clock, ChevronRight, AlertTriangle, Mail } from 'lucide-react';
import { adminListClients } from '../utils/storage';
import { inFlightLettersForClient } from '../utils/inFlightLetters';

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  grid: '#EEF0F4',
  green: '#15803D',
  amber: '#D97706',
  red: '#DC2626',
};

const STATUS_STYLE = {
  overdue: { label: 'Overdue', bg: '#FEF2F2', text: T.red, border: '#FECACA' },
  due_soon: { label: 'Due soon', bg: '#FFFBEB', text: T.amber, border: '#FDE68A' },
  awaiting: { label: 'Awaiting', bg: '#F8FAFC', text: T.muted, border: T.border },
  in_transit: { label: 'In transit', bg: '#F8FAFC', text: T.faint, border: T.border },
};

function fmt(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function daysLabel(row) {
  if (row.daysRemaining === null) return 'In transit';
  if (row.daysRemaining <= 0) return Math.abs(row.daysRemaining) + 'd overdue';
  return row.daysRemaining + 'd left';
}

export default function LetterTrackerPage({ onNavigate, isAdmin }) {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [counts, setCounts] = useState({ overdue: 0, dueSoon: 0, awaiting: 0, inTransit: 0 });

  useEffect(() => {
    adminListClients().then((clients) => {
      const rows = [];
      for (const c of clients) {
        const latestAccounts = (c.audits && c.audits[0] && c.audits[0].audit && c.audits[0].audit.accounts) || [];
        rows.push(...inFlightLettersForClient(c.name, c.letters, latestAccounts));
      }

      const byClient = new Map();
      for (const r of rows) {
        if (!byClient.has(r.clientName)) byClient.set(r.clientName, []);
        byClient.get(r.clientName).push(r);
      }

      const sortAsc = (a, b) => {
        if (a.daysRemaining === null && b.daysRemaining === null) return 0;
        if (a.daysRemaining === null) return 1;
        if (b.daysRemaining === null) return -1;
        return a.daysRemaining - b.daysRemaining;
      };

      const groupList = [...byClient.entries()].map(([clientName, letters]) => {
        const sorted = [...letters].sort(sortAsc);
        return { clientName, letters: sorted, soonest: sorted[0] };
      });
      // Group by client, ordered by that client's soonest deadline.
      groupList.sort((a, b) => sortAsc(a.soonest, b.soonest));

      setGroups(groupList);
      setCounts({
        overdue: rows.filter((r) => r.status === 'overdue').length,
        dueSoon: rows.filter((r) => r.status === 'due_soon').length,
        awaiting: rows.filter((r) => r.status === 'awaiting').length,
        inTransit: rows.filter((r) => r.status === 'in_transit').length,
      });
      setLoading(false);
    });
  }, []);

  if (!isAdmin) {
    return <div className="p-8 text-center text-muted">Access Denied. Admins only.</div>;
  }

  if (loading) {
    return (
      <div className="w-full h-64 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-navy border-t-gold rounded-full animate-spin"></div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted">Loading letter tracker...</div>
        </div>
      </div>
    );
  }

  const totalInFlight = counts.overdue + counts.dueSoon + counts.awaiting + counts.inTransit;

  return (
    <div className="max-w-5xl mx-auto space-y-6" style={{ padding: '20px 32px 32px' }}>
      <div>
        <h1 className="text-2xl font-bold ccc-display" style={{ color: T.navy }}>Letter Tracker</h1>
        <p className="text-[13px] mt-1" style={{ color: T.muted }}>
          All mailed, unresolved letters across every client — {totalInFlight} in flight. Display only; nothing here triggers analysis.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border" style={{ borderColor: counts.overdue > 0 ? '#FECACA' : T.border }}>
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: T.muted }}>Overdue</div>
          <div className="text-2xl font-bold mt-1" style={{ color: counts.overdue > 0 ? T.red : T.ink }}>{counts.overdue}</div>
          <div className="text-[11px]" style={{ color: T.faint }}>§1681s-2(b) non-response — Phase 3 eligible</div>
        </div>
        <div className="bg-white p-4 rounded-xl border" style={{ borderColor: T.border }}>
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: T.muted }}>Due soon</div>
          <div className="text-2xl font-bold mt-1" style={{ color: counts.dueSoon > 0 ? T.amber : T.ink }}>{counts.dueSoon}</div>
          <div className="text-[11px]" style={{ color: T.faint }}>≤5 days remaining</div>
        </div>
        <div className="bg-white p-4 rounded-xl border" style={{ borderColor: T.border }}>
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: T.muted }}>Awaiting</div>
          <div className="text-2xl font-bold mt-1" style={{ color: T.ink }}>{counts.awaiting}</div>
          <div className="text-[11px]" style={{ color: T.faint }}>Window still open</div>
        </div>
        <div className="bg-white p-4 rounded-xl border" style={{ borderColor: T.border }}>
          <div className="text-[11px] font-bold uppercase tracking-wider" style={{ color: T.muted }}>In transit</div>
          <div className="text-2xl font-bold mt-1" style={{ color: T.ink }}>{counts.inTransit}</div>
          <div className="text-[11px]" style={{ color: T.faint }}>Not yet delivered — no deadline yet</div>
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-12 bg-white rounded-xl border" style={{ borderColor: T.border }}>
          <Mail size={28} className="mx-auto mb-3" style={{ color: T.faint }} strokeWidth={1.5} />
          <p className="text-[13px]" style={{ color: T.muted }}>Nothing in flight — every mailed letter has a logged response.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <div key={g.clientName} className="bg-white rounded-xl border overflow-hidden" style={{ borderColor: T.border }}>
              <button
                onClick={() => onNavigate('clients', { jumpTo: g.clientName })}
                className="w-full flex items-center justify-between px-5 py-3 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
              >
                <span className="text-[13px] font-bold" style={{ color: T.navy }}>{g.clientName}</span>
                <span className="flex items-center gap-2">
                  {g.soonest.status === 'overdue' && <AlertTriangle size={13} style={{ color: T.red }} />}
                  <span className="text-[11px] font-semibold" style={{ color: T.muted }}>{g.letters.length} letter{g.letters.length === 1 ? '' : 's'} · soonest {daysLabel(g.soonest)}</span>
                  <ChevronRight size={14} style={{ color: T.faint }} />
                </span>
              </button>
              <div className="divide-y" style={{ borderColor: T.grid }}>
                {g.letters.map((r) => {
                  const s = STATUS_STYLE[r.status];
                  return (
                    <div key={r.letterId} className="flex items-center justify-between gap-4 px-5 py-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate" style={{ color: T.ink }}>
                          {r.furnisher}
                          {r.accountLast4 && <span className="font-normal" style={{ color: T.faint }}> ····{r.accountLast4}</span>}
                        </div>
                        <div className="text-[11px] mt-0.5" style={{ color: T.faint }}>
                          {r.bureau ? r.bureau + ' · ' : ''}{r.phase} · Mailed {fmt(r.mailDate)}
                          {r.deliveryDate && <> · Delivered {fmt(r.deliveryDate)}</>}
                          {r.deadline && <> · Deadline {fmt(r.deadline)}</>}
                        </div>
                      </div>
                      <span
                        className="shrink-0 flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border"
                        style={{ background: s.bg, color: s.text, borderColor: s.border }}
                      >
                        <Clock size={11} />
                        {daysLabel(r)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
