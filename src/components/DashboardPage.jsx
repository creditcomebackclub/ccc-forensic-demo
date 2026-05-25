import React, { useEffect, useState } from 'react';
import { AlertCircle, TrendingUp, Clock, Zap, Star, Activity, FileText, Mail, ChevronRight, Upload, Calendar } from 'lucide-react';
import { listClients, adminListClients } from '../utils/storage';
import { supabase } from '../utils/supabase';

const WINDOW_DAYS = 30;
const VIP_RESPONSE_HOURS = 24;
const STD_RESPONSE_DAYS = 3;

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
  if (l.responseOutcome === 'received') return { code: 'received', tone: 'green' };
  if (l.responseOutcome === 'no_response') return { code: 'no_response', tone: 'red' };
  if (!l.mailedDate) return { code: 'not_mailed', tone: 'neutral' };
  const elapsed = daysBetween(l.mailedDate, todayISO());
  const remaining = WINDOW_DAYS - elapsed;
  if (remaining > 0) return { code: 'awaiting', remaining, tone: 'amber' };
  return { code: 'window_closed', tone: 'red' };
}

function computeDashboard(clients) {
  const actions = [];
  let awaiting = 0, escalate = 0, phase3 = 0, active = 0;
  const recentActivity = [];
  const vipClients = clients.filter((c) => c.isVip);

  for (const c of clients) {
    const hasActiveLetters = c.letters.some((l) => !l.phase?.startsWith('Phase 3'));
    if (hasActiveLetters) active++;

    for (const l of c.letters) {
      if (l.phase?.startsWith('Phase 3')) { phase3++; continue; }
      const st = letterStatus(l);

      if (st.code === 'awaiting') awaiting++;
      const hasPhase3 = c.letters.some((pl) => pl.phase?.startsWith('Phase 3') && pl.furnisher === l.furnisher);
      if (st.code === 'window_closed' && !hasPhase3) {
        escalate++;
        actions.push({
          type: 'escalate', priority: c.isVip ? 0 : 1,
          client: c.name, furnisher: l.furnisher, isVip: c.isVip,
          label: 'Window closed — ready to escalate', tone: 'red', savedAt: l.savedAt,
        });
      }
      if (st.code === 'no_response' && !hasPhase3) {
        actions.push({
          type: 'no_response', priority: c.isVip ? 0 : 1,
          client: c.name, furnisher: l.furnisher, isVip: c.isVip,
          label: 'No response logged', tone: 'red', savedAt: l.savedAt,
        });
      }
      if (st.code === 'received') {
        const deadline = c.isVip ? VIP_RESPONSE_HOURS : STD_RESPONSE_DAYS * 24;
        const hoursLeft = deadline - hoursSince(l.responseDate || l.savedAt);
        if (hoursLeft < deadline) {
          actions.push({
            type: 'respond', priority: c.isVip ? 0 : 1,
            client: c.name, furnisher: l.furnisher, isVip: c.isVip,
            label: hoursLeft <= 0 ? 'Phase 3 overdue' : (c.isVip ? Math.max(0, Math.round(hoursLeft)) + 'h to respond (VIP)' : Math.ceil(hoursLeft / 24) + 'd to respond'),
            tone: hoursLeft <= 0 ? 'red' : c.isVip ? 'red' : 'amber',
            savedAt: l.responseDate || l.savedAt,
          });
        }
      }

      recentActivity.push({ client: c.name, furnisher: l.furnisher, phase: l.phase, savedAt: l.savedAt, type: 'letter', auditorName: l.auditorName });
    }

    for (const a of c.audits) {
      recentActivity.push({
        client: c.name,
        accounts: (a.audit && a.audit.accountsTargeted) || 0,
        violations: (a.audit && a.audit.totalViolations) || 0,
        savedAt: a.savedAt, type: 'audit', auditorName: a.auditorName,
      });
    }
  }

  actions.sort((a, b) => a.priority - b.priority || (b.savedAt || '').localeCompare(a.savedAt || ''));
  recentActivity.sort((a, b) => (b.savedAt || '').localeCompare(a.savedAt || ''));

  return { actions: actions.slice(0, 8), awaiting, escalate, phase3, active, recentActivity: recentActivity.slice(0, 12), vipClients };
}

function Pill({ label, tone }) {
  const map = { red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-700', green: 'bg-green-50 text-green-700', neutral: 'bg-gray-100 text-gray-500' };
  return <span className={'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm ' + (map[tone] || map.neutral)}>{label}</span>;
}

function StatCard({ icon: Icon, label, value, sub, tone }) {
  const toneColor = tone === 'red' ? '#DC2626' : tone === 'amber' ? '#D97706' : tone === 'green' ? '#15803D' : '#1B2A4A';
  return (
    <div className="bg-white border border-border rounded p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">{label}</div>
        <Icon size={15} strokeWidth={1.75} style={{ color: toneColor }} />
      </div>
      <div className="text-3xl font-medium ccc-display" style={{ color: toneColor }}>{value}</div>
      {sub && <div className="text-[11px] text-ink-muted mt-1">{sub}</div>}
    </div>
  );
}

async function fetchCalendarEvents() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const providerToken = session?.provider_token;
    if (!providerToken) return null;
    const now = new Date().toISOString();
    const twoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${now}&timeMax=${twoWeeks}&singleEvents=true&orderBy=startTime&maxResults=8`,
      { headers: { Authorization: `Bearer ${providerToken}` } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.items || [];
  } catch (e) { return null; }
}

async function connectGoogleCalendar() {
  await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      scopes: 'https://www.googleapis.com/auth/calendar.readonly',
      redirectTo: window.location.href,
      queryParams: { access_type: 'offline', prompt: 'consent' },
    },
  });
}

function CalendarWidget() {
  const [events, setEvents] = useState(undefined);
  const [connecting, setConnecting] = useState(false);

  useEffect(() => { fetchCalendarEvents().then(setEvents); }, []);

  if (events === undefined) {
    return (
      <div className="bg-white border border-border rounded p-5 flex items-center justify-center h-32">
        <div className="text-[12px] text-ink-muted">Loading calendar…</div>
      </div>
    );
  }

  if (events === null) {
    return (
      <div className="bg-white border border-border rounded p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={14} strokeWidth={1.75} className="text-ink-muted" />
          <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">Calendar</div>
        </div>
        <div className="text-center py-3">
          <div className="text-[12px] text-ink-muted mb-3">Connect Google Calendar to see upcoming events</div>
          <button
            onClick={() => { setConnecting(true); connectGoogleCalendar(); }}
            disabled={connecting}
            className="px-4 py-2 text-[11px] uppercase tracking-wider rounded-sm transition-colors"
            style={{ backgroundColor: connecting ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C' }}
          >
            {connecting ? 'Connecting…' : 'Connect Google Calendar'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white border border-border rounded p-5">
      <div className="flex items-center gap-2 mb-4">
        <Calendar size={14} strokeWidth={1.75} className="text-navy" />
        <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">Upcoming</div>
      </div>
      {events.length === 0 && <div className="text-[12px] text-ink-muted py-2">No upcoming events</div>}
      <div className="space-y-0">
        {events.map((e, i) => {
          const start = e.start?.dateTime || e.start?.date;
          const isAllDay = !e.start?.dateTime;
          return (
            <div key={e.id || i} className="flex items-start gap-3 py-2 border-b border-border last:border-b-0">
              <div className="text-center shrink-0 w-10">
                <div className="text-[10px] uppercase tracking-wider text-ink-faint">
                  {start ? new Date(start).toLocaleDateString('en-US', { month: 'short' }) : ''}
                </div>
                <div className="text-[16px] font-medium text-navy ccc-display leading-tight">
                  {start ? new Date(start).getDate() : ''}
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] text-ink font-medium truncate">{e.summary || 'Untitled'}</div>
                <div className="text-[11px] text-ink-muted">
                  {isAllDay ? 'All day' : start ? new Date(start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''}
                  {e.location && <span className="ml-2">· {e.location.split(',')[0]}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DashboardPage({ isAdmin, onNavigate, onAuditStart }) {
  const [dash, setDash] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const list = isAdmin ? await adminListClients() : await listClients();
        setDash(computeDashboard(list));
      } catch (e) {
        console.error('Dashboard load failed', e);
        setDash({ actions: [], awaiting: 0, escalate: 0, phase3: 0, active: 0, recentActivity: [], vipClients: [] });
      }
    };
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  if (!dash) {
    return (
      <div className="max-w-5xl mx-auto text-center py-20 text-ink-muted">
        <div className="text-[13px]">Loading dashboard…</div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">

      {dash.actions.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle size={14} strokeWidth={2} className="text-red-600" />
            <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">Action Required</div>
          </div>
          <div className="space-y-2">
            {dash.actions.map((a, i) => (
              <div key={i} className="bg-white border rounded px-4 py-3 flex items-center justify-between gap-3"
                style={{ borderColor: a.tone === 'red' ? '#FECACA' : '#FDE68A' }}>
                <div className="flex items-center gap-3 min-w-0">
                  {a.isVip && (
                    <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium shrink-0"
                      style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}>
                      <Star size={9} strokeWidth={2.5} /> VIP
                    </span>
                  )}
                  <div className="min-w-0">
                    <div className="text-[12px] text-ink font-medium truncate">{a.client}</div>
                    <div className="text-[11px] text-ink-muted">{a.furnisher}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Pill label={a.label} tone={a.tone} />
                  <button onClick={() => onNavigate('clients')}
                    className="text-[11px] uppercase tracking-wider text-navy hover:text-gold flex items-center gap-1">
                    View <ChevronRight size={12} strokeWidth={2} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <StatCard icon={Activity} label="Active Campaigns" value={dash.active} sub="accounts in dispute" tone="navy" />
        <StatCard icon={Clock} label="Awaiting Response" value={dash.awaiting} sub={WINDOW_DAYS + '-day windows open'} tone={dash.awaiting > 0 ? 'amber' : 'navy'} />
        <StatCard icon={Zap} label="Ready to Escalate" value={dash.escalate} sub="windows closed" tone={dash.escalate > 0 ? 'red' : 'navy'} />
        <StatCard icon={TrendingUp} label="Phase 3 Active" value={dash.phase3} sub="CRA letters sent" tone={dash.phase3 > 0 ? 'green' : 'navy'} />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-5 bg-white border border-border rounded p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity size={14} strokeWidth={1.75} className="text-navy" />
            <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">Recent Activity</div>
          </div>
          {dash.recentActivity.length === 0 && <div className="text-[12px] text-ink-muted py-2">No activity yet — run your first audit</div>}
          <div className="space-y-0">
            {dash.recentActivity.map((a, i) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-border last:border-b-0">
                <div className="shrink-0 mt-0.5">
                  {a.type === 'audit'
                    ? <FileText size={13} strokeWidth={1.75} className="text-navy" />
                    : <Mail size={13} strokeWidth={1.75} className="text-ink-muted" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] text-ink font-medium truncate">{a.client}</div>
                  <div className="text-[11px] text-ink-muted truncate">
                    {a.type === 'audit'
                      ? `${a.accounts} accounts · ${a.violations} violations`
                      : `${a.furnisher} · ${a.phase}`}
                    {isAdmin && a.auditorName && <span className="ml-1 text-gold">· {a.auditorName}</span>}
                  </div>
                </div>
                <div className="text-[10px] text-ink-faint shrink-0">{fmtTime(a.savedAt)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-7 space-y-4">
          {dash.vipClients.length > 0 && (
            <div className="bg-white rounded p-5" style={{ border: '1px solid #C9A84C' }}>
              <div className="flex items-center gap-2 mb-3">
                <Star size={13} strokeWidth={2} style={{ color: '#C9A84C' }} />
                <div className="text-[10px] uppercase tracking-wider font-medium" style={{ color: '#C9A84C' }}>VIP Clients</div>
              </div>
              <div className="space-y-0">
                {dash.vipClients.map((c, i) => {
                  const openLetters = c.letters.filter((l) => !l.phase?.startsWith('Phase 3'));
                  const ripe = openLetters.filter((l) => letterStatus(l).code === 'window_closed').length;
                  const needsPhase3 = openLetters.filter((l) => l.responseOutcome === 'received').length;
                  return (
                    <div key={i} className="flex items-center justify-between py-2 border-b last:border-b-0" style={{ borderColor: '#F4F1E8' }}>
                      <div className="text-[12px] text-ink font-medium">{c.name}</div>
                      <div className="flex items-center gap-2">
                        {needsPhase3 > 0 && <Pill label="needs Phase 3" tone="amber" />}
                        {ripe > 0 && <Pill label="escalate" tone="red" />}
                        {!ripe && !needsPhase3 && <Pill label="on track" tone="green" />}
                        <button onClick={() => onNavigate('clients')}
                          className="text-[11px] text-navy hover:text-gold uppercase tracking-wider flex items-center gap-0.5">
                          View <ChevronRight size={11} strokeWidth={2} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <CalendarWidget />

          <div
            className="bg-white border-2 border-dashed border-border rounded p-5 text-center cursor-pointer hover:border-navy transition-colors"
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
    </div>
  );
}
