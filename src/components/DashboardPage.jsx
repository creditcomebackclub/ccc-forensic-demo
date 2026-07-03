import React, { useEffect, useState } from 'react';
import { AlertCircle, TrendingUp, Clock, Zap, Star, Activity, FileText, Mail, ChevronRight, Upload, Send, CheckCircle, X, BarChart2 } from 'lucide-react';
import { listClients, adminListClients, updateLetter } from '../utils/storage';
import LobMailer from './LobMailer';

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

function fmt(iso) {
  if (!iso) return '';
  const s = String(iso).length === 10 ? iso + 'T00:00:00' : iso;
  try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch (e) { return iso; }
}

function letterStatus(l) {
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

  const weeklyData = [0, 1, 2, 3].map((w) => {
    const start = new Date(Date.now() - (w + 1) * 7 * 86400000);
    const end = new Date(Date.now() - w * 7 * 86400000);
    return { label: 'Wk -' + (w + 1), letters: 0, mailed: 0, start, end };
  }).reverse();

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

      if (l.phase?.startsWith('Phase 3')) { phase3++; continue; }
      const st = letterStatus(l);
      const hasPhase3 = c.letters.some((pl) => pl.phase?.startsWith('Phase 3') && (pl.furnisher === l.furnisher || (pl.coveredFurnishers || []).includes(l.furnisher)));

      if (!l.mailedDate) {
        mailingQueue.push({ letterId: l.id, client: c.name, furnisher: l.furnisher, isVip: c.isVip, savedAt: l.savedAt, letter: l });
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

  return { actions: actions.slice(0, 6), priorityQueue: priorityQueue.slice(0, 8), mailingQueue: mailingQueue.slice(0, 8), windowCountdown: windowCountdown.slice(0, 10), weeklyData, awaiting, escalate, phase3, active, recentActivity: recentActivity.slice(0, 10), vipClients };
}

function Pill({ label, tone }) {
  const map = { red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-700', green: 'bg-green-50 text-green-700', neutral: 'bg-gray-100 text-gray-500' };
  return <span className={'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm ' + (map[tone] || map.neutral)}>{label}</span>;
}

function StatCard({ icon: Icon, label, value, sub, tone, onClick, clickable }) {
  const toneColor = tone === 'red' ? '#DC2626' : tone === 'amber' ? '#D97706' : tone === 'green' ? '#15803D' : '#1B2A4A';
  const toneBg = tone === 'red' ? '#FEF2F2' : tone === 'amber' ? '#FFFBEB' : tone === 'green' ? '#F0FDF4' : '#EEF1F7';
  return (
    <div onClick={onClick}
      className={'transition-all ' + (clickable ? 'cursor-pointer' : '')}
      style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 10, padding: 20, boxShadow: '0 1px 3px rgba(0,0,0,0.05)', ...(clickable ? {} : {}) }}
      onMouseEnter={e => { if (clickable) { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; e.currentTarget.style.borderColor = '#D1D5DB'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
      onMouseLeave={e => { if (clickable) { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.05)'; e.currentTarget.style.borderColor = '#E5E7EB'; e.currentTarget.style.transform = 'translateY(0)'; } }}
    >
      <div className="flex items-center justify-between mb-3">
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9CA3AF', fontWeight: 600 }}>{label}</div>
        <div style={{ background: toneBg, borderRadius: 6, padding: '5px 5px', display: 'flex' }}>
          <Icon size={13} strokeWidth={2} style={{ color: toneColor }} />
        </div>
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color: '#111827', lineHeight: 1, marginBottom: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{sub}</div>}
      {clickable && value > 0 && (
        <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 8, display: 'flex', alignItems: 'center', gap: 3, color: toneColor, fontWeight: 600 }}>
          View <ChevronRight size={10} strokeWidth={2.5} />
        </div>
      )}
    </div>
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

function VelocityChart({ data }) {
  const max = Math.max(...data.flatMap((d) => [d.letters, d.mailed]), 1);
  return (
    <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
      <div className="flex items-center gap-2 mb-4">
        <BarChart2 size={14} strokeWidth={1.75} className="text-navy" />
        <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">Pipeline Velocity</div>
        <div className="ml-auto flex items-center gap-3 text-[10px] text-ink-faint">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: '#1B2A4A' }} /> Generated</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: '#C9A84C' }} /> Mailed</span>
        </div>
      </div>
      <div className="flex items-end gap-2 h-20">
        {data.map((w, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="w-full flex items-end gap-0.5" style={{ height: '60px' }}>
              <div className="flex-1 rounded-sm transition-all" style={{ height: max > 0 ? (w.letters / max * 60) + 'px' : '2px', backgroundColor: '#1B2A4A', minHeight: '2px' }} />
              <div className="flex-1 rounded-sm transition-all" style={{ height: max > 0 ? (w.mailed / max * 60) + 'px' : '2px', backgroundColor: '#C9A84C', minHeight: '2px' }} />
            </div>
            <div className="text-[9px] text-ink-faint">{w.label}</div>
          </div>
        ))}
      </div>
      {data.every((d) => d.letters === 0 && d.mailed === 0) && (
        <div className="text-center text-[11px] text-ink-faint mt-2">No activity in the last 4 weeks</div>
      )}
    </div>
  );
}


async function checkAndSendNotifications(clients) {
  const today = new Date();
  for (const client of clients) {
    // Get client email from client_profiles
    let clientEmail = null;
    try {
      const { supabase } = await import('../utils/supabase');
      const { data: cp } = await supabase.from('client_profiles').select('email').eq('full_name', client.name).limit(1);
      if (!cp || cp.length === 0) continue;
      clientEmail = cp[0].email;
      if (!clientEmail) continue;

      for (const letter of (client.letters || [])) {
        if (!letter.mailedDate) continue;
        const clockStart = letter.deliveredAt ? letter.deliveredAt.slice(0, 10) : letter.mailedDate;
        const daysElapsed = Math.round((today - new Date(clockStart + 'T00:00:00')) / 86400000);
        const sent = letter.notificationsSent || [];

        // Day 7 check-in
        if (daysElapsed >= 7 && daysElapsed < 8 && !sent.includes('day7')) {
          await fetch('/.netlify/functions/send-lpoa', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'send_campaign_update', clientName: client.name, clientEmail, updateType: 'day7_checkin', furnisher: letter.furnisher, daysElapsed }),
          }).catch(() => {});
          await supabase.from('letters').update({ notifications_sent: [...sent, 'day7'] }).eq('id', letter.id);
        }

        // Day 28-30 approaching
        if (daysElapsed >= 28 && daysElapsed < 30 && !sent.includes('day30')) {
          await fetch('/.netlify/functions/send-lpoa', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'send_campaign_update', clientName: client.name, clientEmail, updateType: 'day30_approaching', furnisher: letter.furnisher, daysElapsed }),
          }).catch(() => {});
          await supabase.from('letters').update({ notifications_sent: [...sent, 'day30'] }).eq('id', letter.id);
        }

        // Educational email series (based on enrollment date, not letter date)
        const enrollmentDate = client.enrollmentDate || clockStart;
        const daysSinceEnrollment = Math.round((today - new Date(enrollmentDate + 'T00:00:00')) / 86400000);

        if (daysSinceEnrollment >= 1 && daysSinceEnrollment < 3 && !sent.includes('edu1')) {
          await fetch('/.netlify/functions/send-lpoa', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'send_educational', clientName: client.name, clientEmail, emailNumber: 1 }),
          }).catch(() => {});
          await supabase.from('letters').update({ notifications_sent: [...sent, 'edu1'] }).eq('id', letter.id);
        }
        if (daysSinceEnrollment >= 7 && daysSinceEnrollment < 9 && !sent.includes('edu2')) {
          await fetch('/.netlify/functions/send-lpoa', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'send_educational', clientName: client.name, clientEmail, emailNumber: 2 }),
          }).catch(() => {});
          await supabase.from('letters').update({ notifications_sent: [...sent, 'edu2'] }).eq('id', letter.id);
        }
        if (daysSinceEnrollment >= 14 && daysSinceEnrollment < 16 && !sent.includes('edu3')) {
          await fetch('/.netlify/functions/send-lpoa', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'send_educational', clientName: client.name, clientEmail, emailNumber: 3 }),
          }).catch(() => {});
          await supabase.from('letters').update({ notifications_sent: [...sent, 'edu3'] }).eq('id', letter.id);
        }
        if (daysSinceEnrollment >= 30 && daysSinceEnrollment < 32 && !sent.includes('edu4')) {
          await fetch('/.netlify/functions/send-lpoa', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'send_educational', clientName: client.name, clientEmail, emailNumber: 4 }),
          }).catch(() => {});
          await supabase.from('letters').update({ notifications_sent: [...sent, 'edu4'] }).eq('id', letter.id);
        }
        if (daysSinceEnrollment >= 45 && daysSinceEnrollment < 47 && !sent.includes('edu5')) {
          await fetch('/.netlify/functions/send-lpoa', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'send_educational', clientName: client.name, clientEmail, emailNumber: 5 }),
          }).catch(() => {});
          await supabase.from('letters').update({ notifications_sent: [...sent, 'edu5'] }).eq('id', letter.id);
        }

        // Day 35+ no response escalation
        if (daysElapsed >= 35 && letter.responseOutcome === 'no_response' && !sent.includes('day35')) {
          await fetch('/.netlify/functions/send-lpoa', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'send_campaign_update', clientName: client.name, clientEmail, updateType: 'day35_escalation', furnisher: letter.furnisher, daysElapsed }),
          }).catch(() => {});
          await supabase.from('letters').update({ notifications_sent: [...sent, 'day35'] }).eq('id', letter.id);
        }
      }
    } catch(e) { console.warn('Notification check error:', e); }
  }
}

export default function DashboardPage({ isAdmin, onNavigate, onAuditStart }) {
  const [dash, setDash] = useState(null);
  const [activeAction, setActiveAction] = useState(null);
  const [lobMailerLetter, setLobMailerLetter] = useState(null);

  const load = async () => {
    try {
      const list = isAdmin ? await adminListClients() : await listClients();
      setDash(computeDashboard(list));
    } catch (e) {
      setDash({ actions: [], priorityQueue: [], mailingQueue: [], windowCountdown: [], weeklyData: [], awaiting: 0, escalate: 0, phase3: 0, active: 0, recentActivity: [], vipClients: [] });
    }
  };

  useEffect(() => {
    load();
    const interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [isAdmin]);

  const handleStatClick = (filter) => onNavigate('clients', { filter });

  if (!dash) return (
    <div className="max-w-5xl mx-auto text-center py-20 text-ink-muted">
      <div className="text-[13px]">Loading dashboard…</div>
    </div>
  );

  return (
    <div className="max-w-5xl mx-auto space-y-5" style={{ padding: "24px 32px" }}>

      {dash.actions.length > 0 && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div style={{ background: "#FEF2F2", borderRadius: 6, padding: "4px 4px", display: "flex" }}><AlertCircle size={13} strokeWidth={2} style={{ color: "#DC2626" }} /></div>
            <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#374151", fontWeight: 600 }}>Action Required</span>
          </div>
          <div className="space-y-1">
            {dash.actions.map((a, i) => (
              <div key={i}>
                <div
                  onClick={() => setActiveAction(activeAction?.letter?.id === a.letter?.id ? null : a)}
                  className="flex items-center justify-between gap-3 cursor-pointer transition-all group" style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: '12px 16px', boxShadow: '0 1px 2px rgba(0,0,0,0.04)', borderColor: activeAction?.letter?.id === a.letter?.id ? '#1B2A4A' : (a.tone === 'red' ? '#FECACA' : '#FDE68A') }}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {a.isVip && <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium shrink-0" style={{ backgroundColor: '#C9A84C', color: '#1B2A4A' }}><Star size={9} strokeWidth={2.5} /> VIP</span>}
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

      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={Activity} label="Active Campaigns" value={dash.active} sub="accounts in dispute" tone="navy" clickable={dash.active > 0} onClick={() => handleStatClick('active')} />
        <StatCard icon={Clock} label="Awaiting Response" value={dash.awaiting} sub={WINDOW_DAYS + '-day windows open'} tone={dash.awaiting > 0 ? 'amber' : 'navy'} clickable={dash.awaiting > 0} onClick={() => handleStatClick('awaiting')} />
        <StatCard icon={Zap} label="Ready to Escalate" value={dash.escalate} sub="windows closed" tone={dash.escalate > 0 ? 'red' : 'navy'} clickable={dash.escalate > 0} onClick={() => handleStatClick('escalate')} />
        <StatCard icon={TrendingUp} label="Phase 3 Active" value={dash.phase3} sub="CRA letters sent" tone={dash.phase3 > 0 ? 'green' : 'navy'} clickable={dash.phase3 > 0} onClick={() => handleStatClick('phase3')} />
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-5 space-y-4">
          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div className="flex items-center gap-2 mb-4">
              <AlertCircle size={14} strokeWidth={1.75} className="text-red-600" />
              <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">Today's Priority Queue</div>
            </div>
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
                      {item.isVip && <Star size={11} strokeWidth={2.5} style={{ color: '#C9A84C', flexShrink: 0 }} />}
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
          </div>

          <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div className="flex items-center gap-2 mb-4">
              <Activity size={14} strokeWidth={1.75} className="text-navy" />
              <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">Recent Activity</div>
            </div>
            {dash.recentActivity.length === 0 && <div className="text-[12px] text-ink-muted py-2">No activity yet</div>}
            <div className="space-y-0">
              {dash.recentActivity.map((a, i) => (
                <div key={i} onClick={() => onNavigate('clients', { jumpTo: a.client })}
                  className="flex items-start gap-3 py-2 border-b border-border last:border-b-0 cursor-pointer hover:bg-gray-50 rounded transition-colors group">
                  <div className="shrink-0 mt-0.5">
                    {a.type === 'audit' ? <FileText size={13} strokeWidth={1.75} className="text-navy" /> : <Mail size={13} strokeWidth={1.75} className="text-ink-muted" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] text-ink font-medium truncate group-hover:text-navy">{a.client}</div>
                    <div className="text-[11px] text-ink-muted truncate">
                      {a.type === 'audit' ? `${a.accounts} accounts · ${a.violations} violations` : `${a.furnisher} · ${a.phase}`}
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
                    <div key={i} onClick={() => onNavigate('clients', { jumpTo: c.name })}
                      className="flex items-center justify-between py-2 border-b last:border-b-0 cursor-pointer hover:bg-amber-50 rounded px-1 transition-colors group"
                      style={{ borderColor: '#F4F1E8' }}>
                      <div className="text-[12px] text-ink font-medium group-hover:text-navy">{c.name}</div>
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
            </div>
          )}

          {dash.windowCountdown.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <div className="flex items-center gap-2 mb-4">
                <Clock size={14} strokeWidth={1.75} className="text-amber-600" />
                <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">30-Day Window Countdown</div>
              </div>
              <div className="space-y-2">
                {dash.windowCountdown.map((w, i) => {
                  const pct = Math.max(0, Math.min(100, ((WINDOW_DAYS - w.remaining) / WINDOW_DAYS) * 100));
                  const color = w.remaining <= 3 ? '#DC2626' : w.remaining <= 7 ? '#D97706' : '#15803D';
                  return (
                    <div key={i} onClick={() => onNavigate('clients', { jumpTo: w.client })}
                      className="cursor-pointer hover:bg-gray-50 rounded p-1 transition-colors group">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          {w.isVip && <Star size={10} strokeWidth={2.5} style={{ color: '#C9A84C', flexShrink: 0 }} />}
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
            </div>
          )}

          {dash.mailingQueue.length > 0 && (
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 10, padding: 20, boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <div className="flex items-center gap-2 mb-4">
                <Send size={14} strokeWidth={1.75} className="text-navy" />
                <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">Ready to Mail</div>
                <span className="ml-auto text-[10px] text-ink-faint">{dash.mailingQueue.length} letter{dash.mailingQueue.length === 1 ? '' : 's'} waiting</span>
              </div>
              <div className="space-y-0">
                {dash.mailingQueue.map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {item.isVip && <Star size={11} strokeWidth={2.5} style={{ color: '#C9A84C', flexShrink: 0 }} />}
                      <div className="min-w-0">
                        <div className="text-[12px] text-ink font-medium truncate">{item.client}</div>
                        <div className="text-[10px] text-ink-muted">{item.furnisher} · generated {fmtTime(item.savedAt)}</div>
                      </div>
                    </div>
                    <button onClick={() => setLobMailerLetter(item.letter)}
                      className="flex items-center gap-1 text-[11px] uppercase tracking-wider px-2 py-1 rounded-sm shrink-0 transition-colors"
                      style={{ backgroundColor: '#1B2A4A', color: '#C9A84C' }}>
                      <Send size={11} strokeWidth={2} /> Send
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <VelocityChart data={dash.weeklyData} />

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
