import React, { useEffect, useState } from 'react';
import { AlertCircle, TrendingUp, Clock, Zap, Star, Activity, FileText, Mail, ChevronRight, Upload, Send, CheckCircle, X, BarChart2, Award, Target, Timer, Users, Table2 } from 'lucide-react';
import { listClients, adminListClients, updateLetter } from '../utils/storage';
import LobMailer from './LobMailer';

const WINDOW_DAYS = 30;
const VIP_RESPONSE_HOURS = 24;
const STD_RESPONSE_DAYS = 3;
const BACKLOG_WARN_DAYS = 7;
const BACKLOG_LATE_DAYS = 14;

// Brand + chart tokens. Chart mark colors are validated steps of the brand
// hues (navy/gold are chrome colors — too dark / low-contrast for marks).
const T = {
  navy: '#1B2A4A',
  navyDark: '#141F38',
  gold: '#C9A84C',
  chartBlue: '#3D5A9E',
  chartGold: '#96741F',
  funnelRamp: ['#9CAED8', '#6E87BC', '#48669F', '#2A4577'],
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  grid: '#EEF0F4',
  cardShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
};

function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function daysBetween(aIso, bIso) {
  const a = new Date(String(aIso).slice(0, 10) + 'T00:00:00');
  const b = new Date(String(bIso).slice(0, 10) + 'T00:00:00');
  return Math.round((b - a) / 86400000);
}

function hoursSince(iso) {
  return Math.round((Date.now() - new Date(iso)) / 3600000);
}

function fmtTime(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diffH = Math.round((now - d) / 3600000);
    if (diffH < 1) return 'just now';
    if (diffH < 24) return diffH + 'h ago';
    if (diffH < 48) return 'yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch (e) { return iso; }
}

function letterStatus(l) {
  if (l.responseOutcome === 'deleted') return { code: 'deleted', tone: 'green' };
  if (l.responseOutcome === 'received') return { code: 'received', tone: 'green' };
  if (l.responseOutcome === 'no_response') return { code: 'no_response', tone: 'red' };
  if (!l.mailedDate) return { code: 'not_mailed', tone: 'neutral' };
  const clockStart = l.deliveredAt ? l.deliveredAt.slice(0, 10) : l.mailedDate;
  const elapsed = daysBetween(clockStart, todayISO());
  const remaining = WINDOW_DAYS - elapsed;
  if (remaining > 0) return { code: 'awaiting', remaining, tone: 'amber' };
  return { code: 'window_closed', tone: 'red' };
}

function computeDashboard(clients) {
  const actions = [];
  const priorityQueue = [];
  const mailingQueue = [];
  const windowCountdown = [];
  const recentActivity = [];
  const vipClients = clients.filter((c) => c.isVip);
  let awaiting = 0, escalate = 0, phase3 = 0, active = 0;

  // Outcomes — deletions are the product; measure them
  let deletedAll = 0, deletedThisMonth = 0, deletedLastMonth = 0, outcomeCount = 0;
  const deleteDays = [];
  const now = new Date();
  const thisMonth = now.toISOString().slice(0, 7);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 15).toISOString().slice(0, 7);

  // Funnel — where letters are in the pipeline
  const funnel = { generated: 0, mailed: 0, responded: 0, deleted: 0 };

  // Weekly throughput — last 8 weeks, real date labels
  const weeklyData = [0, 1, 2, 3, 4, 5, 6, 7].map((w) => {
    const start = new Date(Date.now() - (w + 1) * 7 * 86400000);
    const end = new Date(Date.now() - w * 7 * 86400000);
    return {
      label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      letters: 0, mailed: 0, start, end, current: w === 0,
    };
  }).reverse();

  // Portal adoption — invited vs actually onboarded
  const portal = { active: 0, pending: [], notInvited: 0 };
  for (const c of clients) {
    if (c.status === 'lead') continue;
    if (c.portalOnboarded === true) portal.active++;
    else if (c.portalOnboarded === false) portal.pending.push({ name: c.name, email: c.email });
    else if (c.email) portal.notInvited++;
  }

  for (const c of clients) {
    const hasActiveLetters = c.letters.some((l) => !l.phase?.startsWith('Phase 3'));
    if (hasActiveLetters) active++;

    for (const l of c.letters) {
      weeklyData.forEach((w) => {
        const saved = new Date(l.savedAt);
        if (saved >= w.start && saved < w.end) w.letters++;
        if (l.mailedDate) {
          const mailed = new Date(l.mailedDate + 'T00:00:00');
          if (mailed >= w.start && mailed < w.end) w.mailed++;
        }
      });

      if (l.responseOutcome) {
        outcomeCount++;
        if (l.responseOutcome === 'deleted') {
          deletedAll++;
          const when = (l.responseDate || l.savedAt || '').slice(0, 7);
          if (when === thisMonth) deletedThisMonth++;
          if (when === lastMonth) deletedLastMonth++;
          if (l.mailedDate && l.responseDate) deleteDays.push(daysBetween(l.mailedDate, l.responseDate));
        }
      }

      if (l.phase?.startsWith('Phase 3')) { phase3++; continue; }

      funnel.generated++;
      if (l.mailedDate) funnel.mailed++;
      if (l.responseOutcome === 'received' || l.responseOutcome === 'deleted') funnel.responded++;
      if (l.responseOutcome === 'deleted') funnel.deleted++;

      const st = letterStatus(l);
      if (st.code === 'deleted') {
        recentActivity.push({ client: c.name, furnisher: l.furnisher, phase: l.phase, savedAt: l.responseDate || l.savedAt, type: 'deletion', auditorName: l.auditorName });
        continue;
      }
      const hasPhase3 = c.letters.some((pl) => pl.phase?.startsWith('Phase 3') && (pl.furnisher === l.furnisher || (pl.coveredFurnishers || []).includes(l.furnisher)));

      if (!l.mailedDate) {
        mailingQueue.push({ letterId: l.id, client: c.name, furnisher: l.furnisher, isVip: c.isVip, savedAt: l.savedAt, ageDays: l.savedAt ? daysBetween(l.savedAt, todayISO()) : 0, letter: l });
      }

      if (st.code === 'awaiting') {
        awaiting++;
        windowCountdown.push({ client: c.name, furnisher: l.furnisher, isVip: c.isVip, remaining: st.remaining, mailedDate: l.mailedDate });
      }

      if (st.code === 'window_closed' && !hasPhase3) {
        escalate++;
        const item = { type: 'escalate', priority: c.isVip ? 0 : 1, client: c.name, furnisher: l.furnisher, isVip: c.isVip, label: 'Window closed — ready to escalate', tone: 'red', savedAt: l.savedAt, filter: 'escalate', letter: l };
        actions.push(item);
        priorityQueue.push({ ...item, urgency: 0, label: 'Escalate now' });
      }

      if (st.code === 'no_response' && !hasPhase3) {
        const item = { type: 'no_response', priority: c.isVip ? 0 : 1, client: c.name, furnisher: l.furnisher, isVip: c.isVip, label: 'No response — generate Phase 3', tone: 'red', savedAt: l.savedAt, filter: 'escalate', letter: l };
        actions.push(item);
        priorityQueue.push({ ...item, urgency: 1, label: 'Generate Phase 3' });
      }

      if (st.code === 'received' && !hasPhase3) {
        const deadline = c.isVip ? VIP_RESPONSE_HOURS : STD_RESPONSE_DAYS * 24;
        const hoursLeft = deadline - hoursSince(l.responseDate || l.savedAt);
        if (hoursLeft < deadline) {
          const label = hoursLeft <= 0 ? 'Phase 3 overdue' : (c.isVip ? Math.max(0, Math.round(hoursLeft)) + 'h to respond (VIP)' : Math.ceil(hoursLeft / 24) + 'd to respond');
          const tone = hoursLeft <= 0 ? 'red' : c.isVip ? 'red' : 'amber';
          const item = { type: 'respond', priority: c.isVip ? 0 : 1, client: c.name, furnisher: l.furnisher, isVip: c.isVip, label, tone, savedAt: l.responseDate || l.savedAt, filter: 'received', letter: l };
          actions.push(item);
          priorityQueue.push({ ...item, urgency: hoursLeft <= 0 ? 0 : 2, hoursLeft });
        }
      }

      recentActivity.push({ client: c.name, furnisher: l.furnisher, phase: l.phase, savedAt: l.savedAt, type: 'letter', auditorName: l.auditorName });
    }

    for (const a of c.audits) {
      recentActivity.push({ client: c.name, accounts: (a.audit && a.audit.accountsTargeted) || 0, violations: (a.audit && a.audit.totalViolations) || 0, savedAt: a.savedAt, type: 'audit', auditorName: a.auditorName });
    }
  }

  actions.sort((a, b) => a.priority - b.priority || (b.savedAt || '').localeCompare(a.savedAt || ''));
  priorityQueue.sort((a, b) => (a.urgency || 0) - (b.urgency || 0) || (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0));
  mailingQueue.sort((a, b) => (b.isVip ? 1 : 0) - (a.isVip ? 1 : 0) || (a.savedAt || '').localeCompare(b.savedAt || ''));
  windowCountdown.sort((a, b) => a.remaining - b.remaining);
  recentActivity.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));

  const winRate = outcomeCount > 0 ? Math.round((deletedAll / outcomeCount) * 100) : null;
  const avgDeleteDays = deleteDays.length > 0 ? Math.round(deleteDays.reduce((s, d) => s + d, 0) / deleteDays.length) : null;

  return {
    actions: actions.slice(0, 6), priorityQueue: priorityQueue.slice(0, 8), mailingQueue: mailingQueue.slice(0, 8),
    windowCountdown: windowCountdown.slice(0, 10), weeklyData, awaiting, escalate, phase3, active,
    recentActivity: recentActivity.slice(0, 10), vipClients,
    funnel, deletedAll, deletedThisMonth, deletedLastMonth, winRate, avgDeleteDays, outcomeCount, portal,
  };
}

function Pill({ label, tone }) {
  const map = { red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-700', green: 'bg-green-50 text-green-700', neutral: 'bg-gray-100 text-gray-500' };
  return <span className={'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm ' + (map[tone] || map.neutral)}>{label}</span>;
}

// Section card — the one surface every widget lives on. Gold tick carries the brand.
function Card({ title, right, children, style }) {
  return (
    <div style={{ background: '#fff', border: '1px solid ' + T.border, borderRadius: 14, padding: 20, boxShadow: T.cardShadow, ...style }}>
      {title && (
        <div className="flex items-center gap-2.5 mb-4">
          <span style={{ width: 3, height: 14, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em', color: T.muted, fontWeight: 600 }}>{title}</div>
          {right && <div className="ml-auto">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

function StatTile({ icon: Icon, label, value, sub, delta, tone, onClick, clickable, goldChip }) {
  const toneColor = tone === 'red' ? '#DC2626' : tone === 'amber' ? '#D97706' : tone === 'green' ? '#15803D' : T.navy;
  const toneBg = tone === 'red' ? '#FEF2F2' : tone === 'amber' ? '#FFFBEB' : tone === 'green' ? '#F0FDF4' : '#EEF1F7';
  return (
    <div onClick={onClick}
      className={'transition-all ' + (clickable ? 'cursor-pointer' : '')}
      style={{ background: '#fff', border: '1px solid ' + T.border, borderRadius: 14, padding: 18, boxShadow: T.cardShadow }}
      onMouseEnter={e => { if (clickable) { e.currentTarget.style.boxShadow = '0 6px 16px rgba(16,24,40,0.10)'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
      onMouseLeave={e => { if (clickable) { e.currentTarget.style.boxShadow = T.cardShadow; e.currentTarget.style.transform = 'translateY(0)'; } }}
    >
      <div className="flex items-center justify-between mb-3">
        <div style={{ fontSize: 12, color: T.muted, fontWeight: 500 }}>{label}</div>
        <div style={{ background: goldChip ? '#FAF5E6' : toneBg, borderRadius: 8, padding: 6, display: 'flex' }}>
          <Icon size={13} strokeWidth={2} style={{ color: goldChip ? '#8F7524' : toneColor }} />
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <div style={{ fontSize: 30, fontWeight: 650, color: T.ink, lineHeight: 1 }}>{value}</div>
        {delta != null && delta !== 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: delta > 0 ? '#15803D' : '#DC2626' }}>
            {delta > 0 ? '▲ +' + delta : '▼ ' + delta}
          </span>
        )}
      </div>
      {sub && <div style={{ fontSize: 11, color: T.faint, marginTop: 5 }}>{sub}</div>}
      {clickable && (
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 8, display: 'flex', alignItems: 'center', gap: 3, color: toneColor, fontWeight: 600 }}>
          View <ChevronRight size={10} strokeWidth={2.5} />
        </div>
      )}
    </div>
  );
}

function HeroHeader({ displayName, dash }) {
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const firstName = (displayName || '').split(' ')[0] || 'there';
  const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const heroStats = [
    { label: 'Active disputes', value: dash.active },
    { label: 'Deletions', value: dash.deletedAll, gold: true },
    { label: 'Win rate', value: dash.winRate != null ? dash.winRate + '%' : '—' },
  ];
  return (
    <div style={{ background: 'linear-gradient(135deg, ' + T.navy + ' 0%, ' + T.navyDark + ' 100%)', borderRadius: 16, padding: '26px 30px', boxShadow: '0 4px 16px rgba(27,42,74,0.25)', borderBottom: '3px solid ' + T.gold }}>
      <div className="flex items-center justify-between gap-6 flex-wrap">
        <div className="flex items-center gap-4">
          <img src="/logo.jpg" alt="Credit Comeback Club" style={{ width: 52, height: 52, borderRadius: 12, objectFit: 'cover', border: '2px solid ' + T.gold }} onError={(e) => e.target.style.display = 'none'} />
          <div>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.2em', color: T.gold, fontWeight: 600, marginBottom: 3 }}>Credit Comeback Club · Forensic Suite</div>
            <h1 className="ccc-display" style={{ fontSize: 24, color: '#fff', fontWeight: 500, lineHeight: 1.15 }}>{greeting}, {firstName}</h1>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 2 }}>{dateStr}</div>
          </div>
        </div>
        <div className="flex items-center">
          {heroStats.map((s, i) => (
            <div key={s.label} className="text-right" style={{ paddingLeft: 24, marginLeft: i === 0 ? 0 : 24, borderLeft: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.14)' }}>
              <div style={{ fontSize: 26, fontWeight: 650, lineHeight: 1, color: s.gold ? T.gold : '#fff' }}>{s.value}</div>
              <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgba(255,255,255,0.5)', marginTop: 5 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Chart/table toggle shared by both charts — every chart ships a table twin
function ViewToggle({ view, setView }) {
  return (
    <div className="flex items-center gap-1">
      {[['chart', BarChart2], ['table', Table2]].map(([v, Icon]) => (
        <button key={v} onClick={() => setView(v)} title={v === 'chart' ? 'Chart view' : 'Table view'}
          style={{ padding: 4, borderRadius: 6, display: 'flex', background: view === v ? '#EEF1F7' : 'transparent', color: view === v ? T.navy : T.faint }}>
          <Icon size={13} strokeWidth={2} />
        </button>
      ))}
    </div>
  );
}

function ChartTooltip({ tip }) {
  if (!tip) return null;
  return (
    <div style={{ position: 'absolute', left: tip.x + 12, top: tip.y - 8, zIndex: 20, pointerEvents: 'none', background: T.navy, color: '#fff', borderRadius: 8, padding: '7px 10px', fontSize: 11, lineHeight: 1.5, boxShadow: '0 4px 12px rgba(0,0,0,0.25)', whiteSpace: 'nowrap' }}>
      {tip.lines.map((l, i) => <div key={i} style={{ opacity: i === 0 ? 1 : 0.8, fontWeight: i === 0 ? 600 : 400 }}>{l}</div>)}
    </div>
  );
}

// Dispute pipeline funnel — Generated → Mailed → Responded → Deleted.
// Ordered stages, so an ordinal single-hue ramp (validated light→dark).
function FunnelChart({ funnel }) {
  const [view, setView] = useState('chart');
  const [tip, setTip] = useState(null);
  const stages = [
    { key: 'Generated', value: funnel.generated, hint: 'Letters prepared' },
    { key: 'Mailed', value: funnel.mailed, hint: 'Sent via certified mail' },
    { key: 'Responded', value: funnel.responded, hint: 'Furnisher replied' },
    { key: 'Deleted', value: funnel.deleted, hint: 'Removed from report' },
  ];
  const max = Math.max(stages[0].value, 1);
  const empty = stages[0].value === 0;

  const showTip = (e, s, i) => {
    const rect = e.currentTarget.closest('[data-chart]').getBoundingClientRect();
    const prev = i > 0 ? stages[i - 1].value : null;
    const lines = [s.key + ' — ' + s.value + ' letter' + (s.value === 1 ? '' : 's'), s.hint];
    if (i > 0) lines.push(prev > 0 ? Math.round((s.value / prev) * 100) + '% of ' + stages[i - 1].key.toLowerCase() : '—');
    setTip({ x: e.clientX - rect.left, y: e.clientY - rect.top, lines });
  };

  return (
    <Card title="Dispute Pipeline" right={<ViewToggle view={view} setView={setView} />}>
      {empty ? (
        <div className="text-center py-6 text-[12px]" style={{ color: T.faint }}>No letters yet — the pipeline fills as you generate letters</div>
      ) : view === 'table' ? (
        <table className="w-full" style={{ fontSize: 12, color: T.ink }}>
          <thead>
            <tr style={{ color: T.faint, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left' }}>
              <th className="pb-2 font-medium">Stage</th>
              <th className="pb-2 font-medium" style={{ textAlign: 'right' }}>Letters</th>
              <th className="pb-2 font-medium" style={{ textAlign: 'right' }}>% of previous</th>
            </tr>
          </thead>
          <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
            {stages.map((s, i) => (
              <tr key={s.key} style={{ borderTop: '1px solid ' + T.grid }}>
                <td className="py-1.5">{s.key}</td>
                <td className="py-1.5" style={{ textAlign: 'right' }}>{s.value}</td>
                <td className="py-1.5" style={{ textAlign: 'right', color: T.muted }}>{i === 0 ? '—' : stages[i - 1].value > 0 ? Math.round((s.value / stages[i - 1].value) * 100) + '%' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div data-chart style={{ position: 'relative' }} onMouseLeave={() => setTip(null)}>
          <ChartTooltip tip={tip} />
          <div className="space-y-2.5">
            {stages.map((s, i) => {
              const pct = Math.max((s.value / max) * 100, 0);
              const convOfPrev = i === 0 ? null : stages[i - 1].value > 0 ? Math.round((s.value / stages[i - 1].value) * 100) : null;
              return (
                <div key={s.key} className="flex items-center gap-3" tabIndex={0}
                  onMouseMove={(e) => showTip(e, s, i)} onFocus={(e) => showTip({ clientX: 90, clientY: 40, currentTarget: e.currentTarget }, s, i)} onBlur={() => setTip(null)}
                  style={{ outline: 'none', borderRadius: 6 }}>
                  <div style={{ width: 78, fontSize: 11, color: T.muted, textAlign: 'right', flexShrink: 0 }}>{s.key}</div>
                  <div className="flex-1 flex items-center gap-2" style={{ minWidth: 0 }}>
                    <div style={{ width: pct + '%', minWidth: 3, height: 18, background: T.funnelRamp[i], borderRadius: '0 4px 4px 0', transition: 'width 0.5s ease' }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: T.ink, flexShrink: 0 }}>{s.value}</span>
                  </div>
                  <div style={{ width: 42, fontSize: 10, color: T.faint, textAlign: 'right', flexShrink: 0 }}>{convOfPrev != null ? convOfPrev + '%' : ''}</div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize: 10, color: T.faint, marginTop: 12 }}>Phase 1–2 letters · % shows conversion from the previous stage</div>
        </div>
      )}
    </Card>
  );
}

// Weekly throughput — generated vs mailed per week, last 8 weeks
function WeeklyChart({ data }) {
  const [view, setView] = useState('chart');
  const [tip, setTip] = useState(null);
  const rawMax = Math.max(...data.flatMap((d) => [d.letters, d.mailed]), 1);
  const top = [2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 50, 60, 80, 100, 120, 160, 200].find((n) => n >= rawMax) || Math.ceil(rawMax / 100) * 100;
  const PLOT_H = 104;
  const empty = data.every((d) => d.letters === 0 && d.mailed === 0);
  const series = [
    { key: 'letters', label: 'Generated', color: T.chartBlue },
    { key: 'mailed', label: 'Mailed', color: T.chartGold },
  ];

  const showTip = (e, w) => {
    const rect = e.currentTarget.closest('[data-chart]').getBoundingClientRect();
    setTip({
      x: e.clientX - rect.left, y: e.clientY - rect.top,
      lines: ['Week of ' + w.label, 'Generated: ' + w.letters, 'Mailed: ' + w.mailed],
    });
  };

  return (
    <Card title="Weekly Throughput"
      right={
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-3" style={{ fontSize: 10, color: T.muted }}>
            {series.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5">
                <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />{s.label}
              </span>
            ))}
          </div>
          <ViewToggle view={view} setView={setView} />
        </div>
      }>
      {empty ? (
        <div className="text-center py-6 text-[12px]" style={{ color: T.faint }}>No activity in the last 8 weeks</div>
      ) : view === 'table' ? (
        <table className="w-full" style={{ fontSize: 12, color: T.ink }}>
          <thead>
            <tr style={{ color: T.faint, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'left' }}>
              <th className="pb-2 font-medium">Week of</th>
              <th className="pb-2 font-medium" style={{ textAlign: 'right' }}>Generated</th>
              <th className="pb-2 font-medium" style={{ textAlign: 'right' }}>Mailed</th>
            </tr>
          </thead>
          <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
            {data.map((w) => (
              <tr key={w.label} style={{ borderTop: '1px solid ' + T.grid }}>
                <td className="py-1.5">{w.label}{w.current ? ' (current)' : ''}</td>
                <td className="py-1.5" style={{ textAlign: 'right' }}>{w.letters}</td>
                <td className="py-1.5" style={{ textAlign: 'right' }}>{w.mailed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div data-chart style={{ position: 'relative' }} onMouseLeave={() => setTip(null)}>
          <ChartTooltip tip={tip} />
          <div style={{ display: 'flex', gap: 8 }}>
            {/* y-axis ticks */}
            <div style={{ width: 20, height: PLOT_H, position: 'relative', flexShrink: 0 }}>
              {[top, top / 2, 0].map((v) => (
                <div key={v} style={{ position: 'absolute', right: 2, top: (1 - v / top) * PLOT_H - 5, fontSize: 9, color: T.faint, fontVariantNumeric: 'tabular-nums' }}>{v}</div>
              ))}
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              {/* hairline gridlines */}
              {[0, 0.5, 1].map((f) => (
                <div key={f} style={{ position: 'absolute', left: 0, right: 0, top: f * PLOT_H, height: 1, background: T.grid }} />
              ))}
              <div style={{ display: 'flex', alignItems: 'flex-end', height: PLOT_H, position: 'relative' }}>
                {data.map((w, i) => (
                  <div key={i} tabIndex={0} onMouseMove={(e) => showTip(e, w)} onFocus={(e) => showTip({ clientX: 40 + i * 30, clientY: 40, currentTarget: e.currentTarget }, w)} onBlur={() => setTip(null)}
                    style={{ flex: 1, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, height: '100%', cursor: 'default', outline: 'none' }}>
                    {series.map((s) => {
                      const v = w[s.key];
                      const h = Math.max((v / top) * PLOT_H, v > 0 ? 3 : 2);
                      return (
                        <div key={s.key} style={{ width: 9, position: 'relative' }}>
                          {w.current && v > 0 && (
                            <div style={{ position: 'absolute', bottom: h + 3, left: '50%', transform: 'translateX(-50%)', fontSize: 9, fontWeight: 600, color: T.muted }}>{v}</div>
                          )}
                          <div style={{ width: 9, height: h, background: v > 0 ? s.color : T.grid, borderRadius: '4px 4px 0 0' }} />
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', marginTop: 6 }}>
                {data.map((w, i) => (
                  <div key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: w.current ? T.ink : T.faint, fontWeight: w.current ? 600 : 400 }}>{w.label}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function AgeBadge({ days }) {
  if (days >= BACKLOG_LATE_DAYS) return <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-red-50 text-red-700 font-medium"><Clock size={9} strokeWidth={2.5} /> {days}d waiting</span>;
  if (days >= BACKLOG_WARN_DAYS) return <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-sm bg-amber-50 text-amber-700 font-medium"><Clock size={9} strokeWidth={2.5} /> {days}d waiting</span>;
  return null;
}

function PortalAdoption({ portal, onNavigate }) {
  const invitedTotal = portal.active + portal.pending.length;
  if (invitedTotal === 0 && portal.notInvited === 0) return null;
  const pct = invitedTotal > 0 ? (portal.active / invitedTotal) * 100 : 0;
  return (
    <Card title="Client Portal Adoption" right={<span style={{ fontSize: 10, color: T.faint }}>{portal.active} of {invitedTotal} invited are active</span>}>
      <div style={{ height: 8, background: '#DDE4F2', borderRadius: 8, overflow: 'hidden', marginBottom: 12 }}>
        <div style={{ width: pct + '%', height: '100%', background: T.chartBlue, borderRadius: 8, transition: 'width 0.5s ease' }} />
      </div>
      {portal.pending.length > 0 && (
        <div className="space-y-0">
          {portal.pending.slice(0, 5).map((p) => (
            <div key={p.name} onClick={() => onNavigate('clients', { jumpTo: p.name })}
              className="flex items-center justify-between py-1.5 border-b last:border-b-0 cursor-pointer hover:bg-gray-50 rounded px-1 transition-colors group"
              style={{ borderColor: T.grid }}>
              <span className="text-[12px] font-medium group-hover:text-navy" style={{ color: T.ink }}>{p.name}</span>
              <span className="flex items-center gap-1 text-[10px]" style={{ color: T.faint }}>invited — not onboarded <ChevronRight size={10} strokeWidth={2} /></span>
            </div>
          ))}
        </div>
      )}
      {portal.notInvited > 0 && (
        <div style={{ fontSize: 11, color: T.faint, marginTop: 8 }}>{portal.notInvited} client{portal.notInvited === 1 ? '' : 's'} with an email haven't been invited yet</div>
      )}
    </Card>
  );
}

function QuickActionPanel({ action, onDone, onCancel }) {
  const [mode, setMode] = useState(null);
  const [dateVal, setDateVal] = useState(todayISO());
  const [saving, setSaving] = useState(false);

  const save = async (patch) => {
    setSaving(true);
    try { await updateLetter(action.letter.id, patch); onDone(); }
    catch (e) { alert('Could not save: ' + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="bg-white border border-navy rounded-sm p-3 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] text-ink font-medium">{action.client} · {action.furnisher}</div>
        <button onClick={onCancel} className="text-ink-faint hover:text-ink"><X size={13} strokeWidth={2} /></button>
      </div>
      {mode === 'mailing' && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-muted">Mail date:</span>
          <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} className="text-[12px] border border-border rounded-sm px-2 py-0.5" />
          <button onClick={() => save({ mailedDate: dateVal })} disabled={saving} className="text-[11px] uppercase tracking-wider text-white bg-navy px-2 py-0.5 rounded-sm">{saving ? '…' : 'Save'}</button>
          <button onClick={() => setMode(null)} className="text-[11px] text-ink-muted">Back</button>
        </div>
      )}
      {mode === 'responding' && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-ink-muted">Response date:</span>
          <input type="date" value={dateVal} onChange={(e) => setDateVal(e.target.value)} className="text-[12px] border border-border rounded-sm px-2 py-0.5" />
          <button onClick={() => save({ responseOutcome: 'received', responseDate: dateVal })} disabled={saving} className="text-[11px] uppercase tracking-wider text-white bg-navy px-2 py-0.5 rounded-sm">{saving ? '…' : 'Save'}</button>
          <button onClick={() => setMode(null)} className="text-[11px] text-ink-muted">Back</button>
        </div>
      )}
      {mode === null && (
        <div className="flex items-center gap-2 flex-wrap">
          {(action.type === 'escalate' || action.type === 'no_response') && (
            <span className="text-[11px] text-ink-muted">Go to Clients → Analyze to generate Phase 3 letters</span>
          )}
          {action.type === 'respond' && action.letter.mailedDate && !action.letter.responseOutcome && (
            <>
              <button onClick={() => { setDateVal(todayISO()); setMode('responding'); }} className="text-[11px] uppercase tracking-wider text-navy hover:text-gold">Log response</button>
              <button onClick={() => save({ responseOutcome: 'no_response' })} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-red-600">Mark no response</button>
            </>
          )}
          {action.type === 'respond' && !action.letter.mailedDate && (
            <button onClick={() => { setDateVal(todayISO()); setMode('mailing'); }} className="text-[11px] uppercase tracking-wider text-navy hover:text-gold">Mark mailed</button>
          )}
        </div>
      )}
    </div>
  );
}

export default function DashboardPage({ isAdmin, onNavigate, onAuditStart, displayName }) {
  const [dash, setDash] = useState(null);
  const [activeAction, setActiveAction] = useState(null);
  const [lobMailerLetter, setLobMailerLetter] = useState(null);

  const load = async () => {
    try {
      const list = isAdmin ? await adminListClients() : await listClients();
      setDash(computeDashboard(list));
    } catch (e) {
      setDash(computeDashboard([]));
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  const handleStatClick = (filter) => onNavigate('clients', { filter });

  if (!dash) return (
    <div className="max-w-6xl mx-auto text-center py-20 text-ink-muted">
      <div className="text-[13px]">Loading dashboard…</div>
    </div>
  );

  return (
    <div className="max-w-6xl mx-auto space-y-5" style={{ padding: '20px 32px 32px' }}>

      <HeroHeader displayName={displayName} dash={dash} />

      {dash.actions.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ background: '#FEF2F2', borderRadius: 6, padding: '4px 4px', display: 'flex' }}><AlertCircle size={13} strokeWidth={2} style={{ color: '#DC2626' }} /></div>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#374151', fontWeight: 600 }}>Action Required</span>
          </div>
          <div className="space-y-1">
            {dash.actions.map((a, i) => (
              <div key={i}>
                <div
                  onClick={() => setActiveAction(activeAction?.letter?.id === a.letter?.id ? null : a)}
                  className="flex items-center justify-between gap-3 cursor-pointer transition-all group" style={{ background: '#fff', border: '1px solid ' + T.border, borderRadius: 10, padding: '12px 16px', boxShadow: T.cardShadow, borderColor: activeAction?.letter?.id === a.letter?.id ? T.navy : (a.tone === 'red' ? '#FECACA' : '#FDE68A') }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {a.isVip && <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium shrink-0" style={{ backgroundColor: T.gold, color: T.navy }}><Star size={9} strokeWidth={2.5} /> VIP</span>}
                    <div className="min-w-0">
                      <div className="text-[12px] text-ink font-medium truncate group-hover:text-navy">{a.client}</div>
                      <div className="text-[11px] text-ink-muted">{a.furnisher}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Pill label={a.label} tone={a.tone} />
                    <ChevronRight size={14} strokeWidth={2} className={'transition-transform ' + (activeAction?.letter?.id === a.letter?.id ? 'rotate-90 text-navy' : 'text-ink-faint group-hover:text-navy')} />
                  </div>
                </div>
                {activeAction?.letter?.id === a.letter?.id && (
                  <QuickActionPanel action={a} onDone={() => { setActiveAction(null); load(); }} onCancel={() => setActiveAction(null)} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pipeline state */}
      <div className="grid grid-cols-4 gap-3">
        <StatTile icon={Activity} label="Active campaigns" value={dash.active} sub="accounts in dispute" tone="navy" clickable={dash.active > 0} onClick={() => handleStatClick('active')} />
        <StatTile icon={Clock} label="Awaiting response" value={dash.awaiting} sub={WINDOW_DAYS + '-day windows open'} tone={dash.awaiting > 0 ? 'amber' : 'navy'} clickable={dash.awaiting > 0} onClick={() => handleStatClick('awaiting')} />
        <StatTile icon={Zap} label="Ready to escalate" value={dash.escalate} sub="windows closed" tone={dash.escalate > 0 ? 'red' : 'navy'} clickable={dash.escalate > 0} onClick={() => handleStatClick('escalate')} />
        <StatTile icon={TrendingUp} label="Phase 3 active" value={dash.phase3} sub="CRA letters sent" tone={dash.phase3 > 0 ? 'green' : 'navy'} clickable={dash.phase3 > 0} onClick={() => handleStatClick('phase3')} />
      </div>

      {/* Results — what clients pay for */}
      <div className="grid grid-cols-4 gap-3">
        <StatTile icon={Award} label="Deletions this month" value={dash.deletedThisMonth} delta={dash.deletedThisMonth - dash.deletedLastMonth} sub={'vs ' + dash.deletedLastMonth + ' last month'} goldChip />
        <StatTile icon={CheckCircle} label="All-time deletions" value={dash.deletedAll} sub="accounts removed" goldChip />
        <StatTile icon={Target} label="Win rate" value={dash.winRate != null ? dash.winRate + '%' : '—'} sub={dash.outcomeCount > 0 ? 'of ' + dash.outcomeCount + ' letters with an outcome' : 'no outcomes recorded yet'} goldChip />
        <StatTile icon={Timer} label="Avg days to deletion" value={dash.avgDeleteDays != null ? dash.avgDeleteDays : '—'} sub="mailed → confirmed deleted" goldChip />
      </div>

      {/* The pipeline story — replaces the old "Pipeline Velocity" chart */}
      <div className="grid grid-cols-2 gap-4">
        <FunnelChart funnel={dash.funnel} />
        <WeeklyChart data={dash.weeklyData} />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-5 space-y-4">
          <Card title="Today's Priority Queue">
            {dash.priorityQueue.length === 0 ? (
              <div className="text-center py-4">
                <CheckCircle size={20} className="text-green-600 mx-auto mb-2" strokeWidth={1.5} />
                <div className="text-[12px] text-ink-muted">All clear — no urgent actions today</div>
              </div>
            ) : (
              <div className="space-y-0">
                {dash.priorityQueue.map((item, i) => (
                  <div key={i} onClick={() => onNavigate('clients', { jumpTo: item.client })}
                    className="flex items-center justify-between py-2 border-b border-border last:border-b-0 cursor-pointer hover:bg-gray-50 rounded px-1 transition-colors group">
                    <div className="flex items-center gap-2 min-w-0">
                      {item.isVip && <Star size={11} strokeWidth={2.5} style={{ color: T.gold, flexShrink: 0 }} />}
                      <div className="min-w-0">
                        <div className="text-[12px] text-ink font-medium truncate group-hover:text-navy">{item.client}</div>
                        <div className="text-[10px] text-ink-muted truncate">{item.furnisher}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Pill label={item.label} tone={item.tone} />
                      <ChevronRight size={11} strokeWidth={2} className="text-ink-faint group-hover:text-navy" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card title="Recent Activity">
            {dash.recentActivity.length === 0 && <div className="text-[12px] text-ink-muted py-2">No activity yet</div>}
            <div className="space-y-0">
              {dash.recentActivity.map((a, i) => (
                <div key={i} onClick={() => onNavigate('clients', { jumpTo: a.client })}
                  className="flex items-start gap-3 py-2 border-b border-border last:border-b-0 cursor-pointer hover:bg-gray-50 rounded transition-colors group">
                  <div className="shrink-0 mt-0.5">
                    {a.type === 'audit' ? <FileText size={13} strokeWidth={1.75} className="text-navy" />
                      : a.type === 'deletion' ? <Award size={13} strokeWidth={1.75} style={{ color: '#15803D' }} />
                      : <Mail size={13} strokeWidth={1.75} className="text-ink-muted" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-ink font-medium truncate group-hover:text-navy">{a.client}</div>
                    <div className="text-[11px] text-ink-muted truncate">
                      {a.type === 'audit' ? `${a.accounts} accounts · ${a.violations} violations`
                        : a.type === 'deletion' ? `DELETED — ${a.furnisher}`
                        : `${a.furnisher} · ${a.phase}`}
                      {isAdmin && a.auditorName && <span className="ml-1 text-gold">· {a.auditorName}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <div className="text-[10px] text-ink-faint">{fmtTime(a.savedAt)}</div>
                    <ChevronRight size={11} strokeWidth={2} className="text-ink-faint group-hover:text-navy" />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="col-span-7 space-y-4">
          {dash.vipClients.length > 0 && (
            <Card title="VIP Clients" style={{ border: '1px solid ' + T.gold }}>
              <div className="space-y-0">
                {dash.vipClients.map((c, i) => {
                  const openLetters = c.letters.filter((l) => !l.phase?.startsWith('Phase 3'));
                  const ripe = openLetters.filter((l) => letterStatus(l).code === 'window_closed').length;
                  const needsPhase3 = openLetters.filter((l) => l.responseOutcome === 'received').length;
                  return (
                    <div key={i} onClick={() => onNavigate('clients', { jumpTo: c.name })}
                      className="flex items-center justify-between py-2 border-b last:border-b-0 cursor-pointer hover:bg-amber-50 rounded px-1 transition-colors group"
                      style={{ borderColor: '#F4F1E8' }}>
                      <div className="flex items-center gap-2">
                        <Star size={11} strokeWidth={2.5} style={{ color: T.gold }} />
                        <div className="text-[12px] text-ink font-medium group-hover:text-navy">{c.name}</div>
                      </div>
                      <div className="flex items-center gap-2">
                        {needsPhase3 > 0 && <Pill label="needs Phase 3" tone="amber" />}
                        {ripe > 0 && <Pill label="escalate" tone="red" />}
                        {!ripe && !needsPhase3 && <Pill label="on track" tone="green" />}
                        <ChevronRight size={11} strokeWidth={2} className="text-ink-faint group-hover:text-navy" />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {dash.windowCountdown.length > 0 && (
            <Card title="30-Day Window Countdown">
              <div className="space-y-2">
                {dash.windowCountdown.map((w, i) => {
                  const pct = Math.max(0, Math.min(100, ((WINDOW_DAYS - w.remaining) / WINDOW_DAYS) * 100));
                  const color = w.remaining <= 3 ? '#DC2626' : w.remaining <= 7 ? '#D97706' : '#15803D';
                  return (
                    <div key={i} onClick={() => onNavigate('clients', { jumpTo: w.client })}
                      className="cursor-pointer hover:bg-gray-50 rounded p-1 transition-colors group">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          {w.isVip && <Star size={10} strokeWidth={2.5} style={{ color: T.gold, flexShrink: 0 }} />}
                          <span className="text-[12px] text-ink font-medium truncate group-hover:text-navy">{w.client}</span>
                          <span className="text-[10px] text-ink-muted truncate">· {w.furnisher}</span>
                        </div>
                        <span className="text-[11px] font-medium shrink-0 ml-2" style={{ color }}>{w.remaining}d left</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full transition-all" style={{ width: pct + '%', backgroundColor: color }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {dash.mailingQueue.length > 0 && (
            <Card title="Ready to Mail" right={<span style={{ fontSize: 10, color: T.faint }}>{dash.mailingQueue.length} letter{dash.mailingQueue.length === 1 ? '' : 's'} waiting</span>}>
              <div className="space-y-0">
                {dash.mailingQueue.map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {item.isVip && <Star size={11} strokeWidth={2.5} style={{ color: T.gold, flexShrink: 0 }} />}
                      <div className="min-w-0">
                        <div className="text-[12px] text-ink font-medium truncate">{item.client}</div>
                        <div className="text-[10px] text-ink-muted">{item.furnisher} · generated {fmtTime(item.savedAt)}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <AgeBadge days={item.ageDays} />
                      <button onClick={() => setLobMailerLetter(item.letter)}
                        className="flex items-center gap-1 text-[11px] uppercase tracking-wider px-2 py-1 rounded-sm shrink-0 transition-colors"
                        style={{ backgroundColor: T.navy, color: T.gold }}>
                        <Send size={11} strokeWidth={2} /> Send
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {isAdmin && <PortalAdoption portal={dash.portal} onNavigate={onNavigate} />}

          <div
            className="rounded p-5 text-center cursor-pointer transition-colors"
            style={{ background: '#fff', border: '2px dashed ' + T.border, borderRadius: 14 }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = T.navy; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = T.border; }}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && onAuditStart) onAuditStart(f); }}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => onNavigate('audit')}
          >
            <Upload size={18} className="mx-auto mb-2 text-ink-faint" strokeWidth={1.5} />
            <div className="text-[12px] text-ink font-medium mb-0.5">Quick Audit</div>
            <div className="text-[11px] text-ink-muted">Drop a report or click to go to the audit page</div>
          </div>
        </div>
      </div>

      {lobMailerLetter && (
        <LobMailer
          letter={lobMailerLetter}
          onClose={() => setLobMailerLetter(null)}
          onSent={async (data) => {
            await updateLetter(lobMailerLetter.id, { mailedDate: data.mailedDate, lobId: data.lobId, trackingNumber: data.trackingNumber });
            setLobMailerLetter(null);
            load();
          }}
        />
      )}
    </div>
  );
}
