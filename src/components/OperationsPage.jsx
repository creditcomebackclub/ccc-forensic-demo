import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, Clock3, FileSearch,
  MailWarning, RefreshCw, ShieldCheck, UserRoundCheck, Zap,
} from 'lucide-react';
import {
  getClientProductionReadiness, getOperationsQueue, listCertificationClients,
  operationArea, summarizeOperations,
} from '../utils/operations';

const T = {
  navy: '#1B2A4A',
  navyDark: '#141F38',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  red: '#B42318',
  amber: '#B54708',
  green: '#067647',
};

const AREA_META = {
  All: { icon: Activity },
  Audits: { icon: FileSearch },
  Responses: { icon: Zap },
  Mailing: { icon: MailWarning },
  Blueprints: { icon: MailWarning },
  Onboarding: { icon: UserRoundCheck },
};

function ageLabel(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function StatCard({ label, value, icon: Icon, tone = 'navy', sub }) {
  const color = tone === 'red' ? T.red : tone === 'amber' ? T.amber : tone === 'green' ? T.green : T.navy;
  const bg = tone === 'red' ? '#FEF3F2' : tone === 'amber' ? '#FFFAEB' : tone === 'green' ? '#ECFDF3' : '#EEF1F7';
  return (
    <div className="bg-white border rounded-xl p-4" style={{ borderColor: T.border }}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-[0.08em]" style={{ color: T.muted }}>{label}</span>
        <span className="p-1.5 rounded-lg" style={{ background: bg, color }}><Icon size={14} /></span>
      </div>
      <div className="text-[28px] font-semibold mt-3" style={{ color: T.ink }}>{value}</div>
      <div className="text-[11px] mt-1" style={{ color: T.faint }}>{sub}</div>
    </div>
  );
}

export default function OperationsPage({ onNavigate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [area, setArea] = useState('All');
  const [severity, setSeverity] = useState('all');
  const [lastLoadedAt, setLastLoadedAt] = useState(null);
  const [clients, setClients] = useState([]);
  const [certClientId, setCertClientId] = useState('');
  const [checks, setChecks] = useState([]);
  const [certLoading, setCertLoading] = useState(false);
  const [certError, setCertError] = useState('');

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const next = await getOperationsQueue(300);
      setItems(next);
      setLastLoadedAt(new Date());
      setError('');
    } catch (e) {
      setError(e.message || 'Could not load the production exception queue.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    listCertificationClients().then(setClients).catch((e) => setCertError(e.message || 'Could not load clients.'));
    const timer = setInterval(() => load(true), 60000);
    return () => clearInterval(timer);
  }, [load]);

  const summary = useMemo(() => summarizeOperations(items), [items]);
  const filtered = useMemo(() => items.filter((item) => {
    if (area !== 'All' && operationArea(item.source) !== area) return false;
    if (severity !== 'all' && item.severity !== severity) return false;
    return true;
  }), [items, area, severity]);

  const areas = ['All', 'Audits', 'Responses', 'Mailing', 'Blueprints', 'Onboarding'];
  const passedChecks = checks.filter((check) => check.status === 'passed').length;

  const loadCertification = async (clientId) => {
    setCertClientId(clientId);
    setChecks([]);
    setCertError('');
    if (!clientId) return;
    setCertLoading(true);
    try {
      setChecks(await getClientProductionReadiness(clientId));
    } catch (e) {
      setCertError(e.message || 'Could not load client production evidence.');
    } finally {
      setCertLoading(false);
    }
  };

  const openIssue = (item) => {
    if (!item.destination) return;
    const context = item.destination === 'clients' && item.clientName
      ? { jumpTo: item.clientName }
      : null;
    onNavigate(item.destination, context);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <section className="rounded-2xl px-7 py-6 text-white" style={{ background: `linear-gradient(135deg, ${T.navy} 0%, ${T.navyDark} 100%)`, borderBottom: `3px solid ${T.gold}` }}>
        <div className="flex items-center justify-between gap-6 flex-wrap">
          <div>
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] font-semibold" style={{ color: T.gold }}>
              <ShieldCheck size={14} /> Production control center
            </div>
            <h1 className="ccc-display text-[25px] mt-2">Exceptions before they become client problems</h1>
            <p className="text-[12px] mt-2 max-w-2xl" style={{ color: 'rgba(255,255,255,0.62)' }}>
              Live workflow health for Claude processing, response review, Lob mailing, Blueprint delivery, and portal onboarding.
            </p>
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-[11px] uppercase tracking-wider font-semibold disabled:opacity-50"
            style={{ background: T.gold, color: T.navyDark }}
          >
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Open exceptions" value={summary.total} icon={Activity} sub="Across every production workflow" />
        <StatCard label="Critical" value={summary.critical} icon={AlertTriangle} tone={summary.critical ? 'red' : 'green'} sub="Requires staff attention" />
        <StatCard label="Warnings" value={summary.warning} icon={Clock3} tone={summary.warning ? 'amber' : 'green'} sub="Delayed or incomplete work" />
        <StatCard label="System state" value={summary.total ? 'Review' : 'Clear'} icon={summary.total ? AlertTriangle : CheckCircle2} tone={summary.total ? 'amber' : 'green'} sub={lastLoadedAt ? `Updated ${lastLoadedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Loading current state'} />
      </section>

      <section className="bg-white border rounded-2xl overflow-hidden" style={{ borderColor: T.border }}>
        <div className="px-5 py-4 border-b flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: T.border }}>
          <div>
            <div className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: T.ink }}>
              <ShieldCheck size={15} style={{ color: T.gold }} /> Golden-client certification
            </div>
            <p className="text-[11px] mt-1" style={{ color: T.muted }}>Select one controlled client to verify the entire production lifecycle from stored evidence.</p>
          </div>
          <select
            value={certClientId}
            onChange={(e) => loadCertification(e.target.value)}
            className="border rounded-lg px-3 py-2 text-[12px] bg-white min-w-[260px]"
            style={{ borderColor: T.border, color: T.ink }}
          >
            <option value="">Select certification client…</option>
            {clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.is_vip ? ' · VIP' : ''}</option>)}
          </select>
        </div>
        {certError && <div className="m-5 p-3 rounded-lg text-[12px] bg-red-50 text-red-700">{certError}</div>}
        {certClientId && !certError && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[11px] uppercase tracking-wider" style={{ color: T.muted }}>Production evidence</div>
              <div className="text-[12px] font-semibold" style={{ color: passedChecks === checks.length && checks.length ? T.green : T.navy }}>
                {certLoading ? 'Checking…' : `${passedChecks} of ${checks.length} verified`}
              </div>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden mb-5">
              <div className="h-full transition-all" style={{ width: checks.length ? `${(passedChecks / checks.length) * 100}%` : '0%', background: passedChecks === checks.length && checks.length ? T.green : T.gold }} />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              {checks.map((check) => {
                const passed = check.status === 'passed';
                return (
                  <div key={check.key} className="border rounded-xl p-3 flex items-start gap-3" style={{ borderColor: passed ? '#ABEFC6' : T.border, background: passed ? '#F6FEF9' : '#fff' }}>
                    {passed ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" style={{ color: T.green }} /> : <Clock3 size={16} className="mt-0.5 shrink-0" style={{ color: T.amber }} />}
                    <div>
                      <div className="text-[12px] font-semibold" style={{ color: T.ink }}>{check.sequence}. {check.label}</div>
                      <div className="text-[11px] mt-1 leading-relaxed" style={{ color: T.muted }}>{check.detail}</div>
                      {check.evidenceAt && <div className="text-[10px] mt-1.5" style={{ color: T.faint }}>Evidence {new Date(check.evidenceAt).toLocaleString()}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </section>

      <section className="bg-white border rounded-2xl overflow-hidden" style={{ borderColor: T.border }}>
        <div className="px-5 py-4 border-b flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: T.border }}>
          <div className="flex items-center gap-2 flex-wrap">
            {areas.map((name) => {
              const Icon = AREA_META[name].icon;
              return (
                <button
                  key={name}
                  onClick={() => setArea(name)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors"
                  style={{ background: area === name ? T.navy : '#F8FAFC', color: area === name ? '#fff' : T.muted }}
                >
                  <Icon size={12} /> {name}
                </button>
              );
            })}
          </div>
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-[11px] bg-white"
            style={{ borderColor: T.border, color: T.muted }}
          >
            <option value="all">All severity</option>
            <option value="critical">Critical only</option>
            <option value="warning">Warnings only</option>
          </select>
        </div>

        {error && (
          <div className="m-5 p-4 rounded-lg border text-[12px]" style={{ background: '#FEF3F2', borderColor: '#FECDCA', color: T.red }}>
            {error}. The database migration may still need to be applied before this page can load.
          </div>
        )}

        {loading ? (
          <div className="py-20 text-center text-[12px]" style={{ color: T.muted }}>Loading production workflow health…</div>
        ) : filtered.length === 0 && !error ? (
          <div className="py-20 text-center">
            <CheckCircle2 size={34} className="mx-auto" style={{ color: T.green }} />
            <div className="text-[15px] font-semibold mt-3" style={{ color: T.ink }}>No matching exceptions</div>
            <div className="text-[12px] mt-1" style={{ color: T.muted }}>CCC has no unresolved items in this view.</div>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: T.border }}>
            {filtered.map((item) => {
              const critical = item.severity === 'critical';
              return (
                <article key={item.issueKey} className="px-5 py-4 flex items-start gap-4">
                  <span className="mt-0.5 p-2 rounded-lg shrink-0" style={{ background: critical ? '#FEF3F2' : '#FFFAEB', color: critical ? T.red : T.amber }}>
                    {critical ? <AlertTriangle size={15} /> : <Clock3 size={15} />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-[13px] font-semibold" style={{ color: T.ink }}>{item.title}</h2>
                      <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full" style={{ background: critical ? '#FEF3F2' : '#FFFAEB', color: critical ? T.red : T.amber }}>
                        {item.severity}
                      </span>
                      <span className="text-[9px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-100" style={{ color: T.muted }}>
                        {operationArea(item.source)} · {item.status}
                      </span>
                    </div>
                    <div className="text-[12px] mt-1" style={{ color: T.muted }}>
                      {item.clientName ? <strong style={{ color: T.ink }}>{item.clientName} · </strong> : null}{item.detail}
                    </div>
                    <div className="text-[10px] mt-2 font-mono" style={{ color: T.faint }}>
                      Updated {ageLabel(item.updatedAt)} · {item.sourceId.slice(0, 12)}
                    </div>
                  </div>
                  {item.destination && (
                    <button
                      onClick={() => openIssue(item)}
                      className="shrink-0 px-3 py-2 rounded-lg text-[10px] uppercase tracking-wider font-semibold border hover:bg-slate-50"
                      style={{ borderColor: T.border, color: T.navy }}
                    >
                      Open work item
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
