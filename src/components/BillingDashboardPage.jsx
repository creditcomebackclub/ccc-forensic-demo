import React, { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, TrendingDown, AlertCircle, Clock, CheckCircle, ChevronRight, Activity, Users, Layers, Repeat, UserMinus, Percent, CalendarClock, Timer, Landmark } from 'lucide-react';
import { adminListClients } from '../utils/storage';
import { supabase } from '../utils/supabase';
import { computeClientCommission, commissionRate } from '../utils/affiliateCommission';
import { DEFAULT_TIER_PRICING } from '../utils/pricing';

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
  slate: '#64748B',
};

// Shared with the LPOA/Settings pricing (utils/pricing.js) so this MRR
// forecast can't silently drift from the real advertised tier prices.
// Reads only the hardcoded defaults, not Settings' live per-tier overrides
// — if those are ever changed, update here too or wire this page to fetch
// settings.json the same way ClientSetupFlow does.
const TIER_PRICE = { VIP: DEFAULT_TIER_PRICING.VIP.monthlyFee, Standard: DEFAULT_TIER_PRICING.Standard.monthlyFee };

const money = (n) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money0 = (n) => `$${Math.round(Number(n || 0)).toLocaleString()}`;
const ym = (dateStr) => (dateStr ? String(dateStr).slice(0, 7) : '');
const daysBetween = (a, b) => Math.floor((a - b) / 86400000);

// Unified revenue recognition: a Payment row, OR an Invoice flipped to Paid.
// This matches ClientBillingPanel's totalPaid so global and per-client agree.
const recognizedAmount = (tx) => {
  if (tx.type === 'Payment') return parseFloat(tx.amount || 0);
  if (tx.type === 'Invoice' && tx.status === 'Paid') return parseFloat(tx.amount || 0);
  return 0;
};
// Date revenue is recognized on: payment date, or an invoice's paid_at (fallback to its date).
const recognitionDate = (tx) => (tx.type === 'Invoice' ? (tx.paid_at || tx.date) : tx.date);
const isFwf = (tx) => /first\s*work|fwf|setup\s*fee|initial\s*fee/i.test(tx.description || '');

function MetricCard({ title, value, icon: Icon, subtitle, highlight = false, alert = false, tone }) {
  const accent = tone === 'good' ? T.green : tone === 'warn' ? T.amber : null;
  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border flex flex-col relative overflow-hidden" style={{ borderColor: highlight ? T.gold : alert ? '#FECACA' : T.border }}>
      {highlight && <div className="absolute top-0 left-0 w-full h-1" style={{ backgroundColor: T.gold }} />}
      {alert && <div className="absolute top-0 left-0 w-full h-1 bg-red-500" />}
      {accent && !highlight && !alert && <div className="absolute top-0 left-0 w-full h-1" style={{ backgroundColor: accent }} />}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted">{title}</h3>
        <div className={`p-2 rounded-lg ${highlight ? 'bg-amber-50 text-gold' : alert ? 'bg-red-50 text-red-500' : 'bg-slate-50 text-navy'}`}>
          <Icon size={18} />
        </div>
      </div>
      <div className="text-3xl font-bold tracking-tight" style={{ color: alert ? '#B91C1C' : T.navy }}>{value}</div>
      {subtitle && <div className="text-[12px] text-faint mt-1 font-medium">{subtitle}</div>}
    </div>
  );
}

function Panel({ title, icon: Icon, iconColor, right, children, className = '' }) {
  return (
    <div className={`bg-white border rounded-xl shadow-sm overflow-hidden flex flex-col ${className}`} style={{ borderColor: T.border }}>
      <div className="px-5 py-4 border-b bg-slate-50 flex items-center justify-between" style={{ borderColor: T.grid }}>
        <h2 className="text-[13px] font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: T.navy }}>
          {Icon && <Icon size={16} style={{ color: iconColor || T.navy }} />}
          {title}
        </h2>
        {right}
      </div>
      {children}
    </div>
  );
}

// Single-series monthly revenue bars — magnitude over time, one hue, native tooltips.
function RevenueTrend({ months }) {
  const max = Math.max(1, ...months.map(m => m.value));
  const H = 150;
  return (
    <div className="p-5">
      <div className="flex items-end gap-2" style={{ height: H }}>
        {months.map((m, i) => {
          const h = Math.max(2, (m.value / max) * (H - 24));
          const isCurrent = i === months.length - 1;
          return (
            <div key={m.ym} className="flex-1 flex flex-col items-center justify-end gap-1 group" title={`${m.label} ${m.year}: ${money(m.value)}`}>
              <span className="text-[9px] font-semibold text-faint opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">{money0(m.value)}</span>
              <div className="w-full rounded-t-[4px] transition-colors" style={{ height: h, backgroundColor: isCurrent ? T.gold : T.navy, opacity: isCurrent ? 1 : 0.85 }} />
              <span className="text-[10px] font-medium" style={{ color: isCurrent ? T.navy : T.faint }}>{m.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Ordered-severity aging bars (green→red) with amounts. Labels carry identity, not color alone.
function AgingBars({ buckets, total }) {
  const rows = [
    { key: '0-30', label: 'Current (0–30d)', color: T.green },
    { key: '31-60', label: '31–60 days', color: T.amber },
    { key: '61-90', label: '61–90 days', color: '#EA580C' },
    { key: '90+', label: '90+ days', color: T.red },
  ];
  return (
    <div className="p-5 flex flex-col gap-3">
      {rows.map(r => {
        const b = buckets[r.key];
        const pct = total > 0 ? (b.amount / total) * 100 : 0;
        return (
          <div key={r.key}>
            <div className="flex items-center justify-between text-[12px] mb-1">
              <span className="font-medium" style={{ color: T.ink }}>{r.label}</span>
              <span className="font-bold" style={{ color: r.color }}>{money(b.amount)} <span className="text-faint font-medium">· {b.count}</span></span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: T.grid }}>
              <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: r.color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatLine({ label, value, tone, sub }) {
  const color = tone === 'good' ? T.green : tone === 'warn' ? T.amber : tone === 'bad' ? T.red : T.ink;
  return (
    <div className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: T.grid }}>
      <span className="text-[12px] font-medium" style={{ color: T.muted }}>{label}</span>
      <span className="text-[14px] font-bold text-right" style={{ color }}>{value}{sub && <span className="text-[11px] font-medium text-faint ml-1">{sub}</span>}</span>
    </div>
  );
}

export default function BillingDashboardPage({ onNavigate, isAdmin }) {
  const [clients, setClients] = useState([]);
  const [affiliates, setAffiliates] = useState({});
  const [commissionPayouts, setCommissionPayouts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminListClients().then(data => {
      setClients(data);
      setLoading(false);
    });
    // Raw rows keyed by id — affiliateCommission.js reads .commission_rate
    // directly, and .name/.company are used for display where needed.
    supabase.from('affiliates').select('id, name, company, commission_rate').then(({ data }) => {
      if (data) {
        const map = {};
        data.forEach(a => { map[a.id] = a; });
        setAffiliates(map);
      }
    });
    supabase.from('commission_payouts').select('client_id, covered_tx_ids, amount').then(({ data }) => {
      if (data) setCommissionPayouts(data);
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
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted">Aggregating Financials...</div>
        </div>
      </div>
    );
  }

  const now = new Date();
  const thisMonth = ym(now.toISOString());
  const thirtyDaysAgo = new Date(); thirtyDaysAgo.setDate(now.getDate() - 30);

  // 12-month revenue buckets
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ ym: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, label: d.toLocaleString('default', { month: 'short' }), year: d.getFullYear(), value: 0 });
  }
  const monthIdx = Object.fromEntries(months.map((m, i) => [m.ym, i]));

  // Accumulators
  let totalOutstanding = 0, collected30Days = 0, mrr = 0, lifetimeRevenue = 0;
  let activeClientsCount = 0, pausedCount = 0, graduatedCount = 0, inactiveCount = 0;
  let newMrr = 0, pausedMrr = 0, lostMrr = 0;
  let commissionEarned = 0, commissionPaidOut = 0;
  let fwfCollected = 0, fwfOutstanding = 0;
  let payToDays = 0, payToCount = 0; // days-to-pay accumulation (needs paid_at)
  let tenureMonthsSum = 0, tenureCount = 0; // active clients — in-progress, not a real lifespan measurement
  let completedTenureMonthsSum = 0, completedTenureCount = 0; // graduated + inactive — observed full lifespan
  let inactiveExitsInWindow90 = 0; // rolling 90-day churn numerator

  const tierMix = { Standard: 0, VIP: 0, 'Paid In Full': 0 };
  const aging = { '0-30': { amount: 0, count: 0 }, '31-60': { amount: 0, count: 0 }, '61-90': { amount: 0, count: 0 }, '90+': { amount: 0, count: 0 } };
  const dunning = { current: { amount: 0, count: 0 }, reminder: { amount: 0, count: 0 }, final: { amount: 0, count: 0 }, autopause: { amount: 0, count: 0 } };

  const allTransactions = [];
  const overdueAccounts = [];
  const commissionPayables = [];

  const payoutsByClient = new Map();
  for (const p of commissionPayouts) {
    if (!payoutsByClient.has(p.client_id)) payoutsByClient.set(p.client_id, []);
    payoutsByClient.get(p.client_id).push(p);
  }

  clients.forEach(c => {
    const recurringTierValue = c.billingType === 'Automated Recurring' ? (TIER_PRICE[c.billingTier] || 0) : 0;

    if (c.billingStatus === 'Active') {
      activeClientsCount++;
      mrr += recurringTierValue;
      if (recurringTierValue > 0 && ym(c.billingStartDate) === thisMonth) newMrr += recurringTierValue;
      if (c.billingTier && tierMix[c.billingTier] !== undefined) tierMix[c.billingTier]++;
      if (c.billingStartDate) {
        const months = Math.max(0, (now - new Date(c.billingStartDate)) / (86400000 * 30.44));
        tenureMonthsSum += months; tenureCount++;
      }
    } else if (c.billingStatus === 'Paused') {
      // Recoverable, not churn — kept separate from Lost MRR (see Retention & Health panel).
      pausedCount++;
      pausedMrr += recurringTierValue;
    } else if (c.billingStatus === 'Graduated') {
      // Completed the arc successfully — not churn. Contributes to observed
      // full lifespan (completed tenure) same as Inactive does below.
      graduatedCount++;
      if (c.billingStartDate && c.statusChangedAt) {
        const months = Math.max(0, daysBetween(new Date(c.statusChangedAt), new Date(c.billingStartDate)) / 30.44);
        completedTenureMonthsSum += months; completedTenureCount++;
      }
    } else if (c.billingStatus === 'Inactive') {
      inactiveCount++;
      lostMrr += recurringTierValue;
      if (c.billingStartDate && c.statusChangedAt) {
        const months = Math.max(0, daysBetween(new Date(c.statusChangedAt), new Date(c.billingStartDate)) / 30.44);
        completedTenureMonthsSum += months; completedTenureCount++;
      }
      // Rolling 90-day churn numerator — relies on Build 3's auto-stamped
      // status_changed_at, which is why this build depends on that one.
      if (c.statusChangedAt) {
        const daysSinceExit = daysBetween(now, new Date(c.statusChangedAt));
        if (daysSinceExit >= 0 && daysSinceExit <= 90) inactiveExitsInWindow90++;
      }
    }

    let clientBalance = 0;
    let hasOverdue30 = false;

    if (Array.isArray(c.ledger)) {
      c.ledger.forEach(tx => {
        allTransactions.push({ ...tx, clientName: c.name, clientId: c.id });
        const rec = recognizedAmount(tx);

        if (rec > 0) {
          lifetimeRevenue += rec;
          const recDate = new Date(recognitionDate(tx));
          if (recDate >= thirtyDaysAgo) collected30Days += rec;
          const idx = monthIdx[ym(recognitionDate(tx))];
          if (idx !== undefined) months[idx].value += rec;
          if (isFwf(tx)) fwfCollected += rec;
          if (tx.type === 'Invoice' && tx.paid_at && tx.date) {
            const d = daysBetween(new Date(tx.paid_at), new Date(tx.date));
            if (d >= 0 && d < 365) { payToDays += d; payToCount++; }
          }
        }

        // Open (unpaid) invoices → outstanding + aging + dunning
        if (tx.type === 'Invoice' && tx.status !== 'Paid') {
          const amt = parseFloat(tx.amount || 0);
          clientBalance += amt;
          totalOutstanding += amt;
          if (isFwf(tx)) fwfOutstanding += amt;
          const age = daysBetween(now, new Date(tx.date));
          if (age > 30) hasOverdue30 = true;
          const bucket = age <= 30 ? '0-30' : age <= 60 ? '31-60' : age <= 90 ? '61-90' : '90+';
          aging[bucket].amount += amt; aging[bucket].count++;
          // Dunning stage: paused accounts with a balance are effectively auto-paused
          if (c.billingStatus === 'Paused') { dunning.autopause.amount += amt; dunning.autopause.count++; }
          else if (age > 60) { dunning.final.amount += amt; dunning.final.count++; }
          else if (age > 30) { dunning.reminder.amount += amt; dunning.reminder.count++; }
          else { dunning.current.amount += amt; dunning.current.count++; }
        }
      });
    }

    if (clientBalance > 0) {
      overdueAccounts.push({ name: c.name, balance: clientBalance, hasOverdue30, status: c.billingStatus });
    }

    // Commission liability — shared module (src/utils/affiliateCommission.js),
    // single source of truth. This dashboard's commission math previously
    // fed straight off a permanent commission_paid boolean recomputed
    // against a client's entire lifetime revenue, so any client who kept
    // paying after their commission was first marked paid had every
    // subsequent month silently counted as already-paid too — the cash
    // forecast below never surfaced that ongoing underpayment.
    if (c.referredBy) {
      const affiliate = affiliates[c.referredBy] || null;
      const payoutsForClient = payoutsByClient.get(c.id) || [];
      const { earned, paid, owed } = computeClientCommission({ referral_fee: c.referralFee, ledger: c.ledger }, affiliate, payoutsForClient);
      commissionEarned += earned;
      commissionPaidOut += paid;
      if (owed > 0.01) {
        const affLabel = affiliate ? (affiliate.name + (affiliate.company ? ' (' + affiliate.company + ')' : '')) : 'Unknown';
        const rate = commissionRate({ referral_fee: c.referralFee }, affiliate);
        commissionPayables.push({ name: c.name, affiliate: affLabel, pending: owed, rate });
      }
    }
  });

  allTransactions.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  overdueAccounts.sort((a, b) => b.balance - a.balance);
  commissionPayables.sort((a, b) => b.pending - a.pending);

  const arpu = activeClientsCount > 0 ? lifetimeRevenue / activeClientsCount : 0;
  const overdue30Count = overdueAccounts.filter(a => a.hasOverdue30).length;
  // New minus LOST (not paused) — paused is recoverable, so it shouldn't
  // drag down the movement figure the way a permanent loss should.
  const netMrrMovement = newMrr - lostMrr;
  const totalBilled = totalOutstanding + lifetimeRevenue;
  const collectionRate = totalBilled > 0 ? (lifetimeRevenue / totalBilled) * 100 : 0;
  const commissionOwed = commissionEarned - commissionPaidOut;
  const avgDaysToPay = payToCount > 0 ? payToDays / payToCount : null;
  const avgTenure = tenureCount > 0 ? tenureMonthsSum / tenureCount : 0;
  const avgCompletedTenure = completedTenureCount > 0 ? completedTenureMonthsSum / completedTenureCount : null;
  const avgLtv = activeClientsCount > 0 ? lifetimeRevenue / activeClientsCount : 0;

  // Rolling 90-day churn — inactive exits in the window over active count.
  // Exclude graduated and paused from the numerator entirely (only Inactive
  // counts as churn). There's no historical daily-snapshot table to compute
  // a true time-series average active count, so the denominator is simply
  // the current active count — the "rolling 90-day" property lives entirely
  // in the numerator's time-window filter. Deliberately NOT a fancier
  // reconstructed average: that would let the displayed rate and the
  // displayed "(N of M)" use different M's and disagree with each other,
  // which is worse for operator trust than a transparent simplification.
  const churnRate90 = activeClientsCount > 0 ? (inactiveExitsInWindow90 / activeClientsCount) * 100 : 0;
  // Below ~20 active clients, a single exit swings the rate by several
  // points — sampling noise, not signal. A permanently red tile at that
  // scale trains the operator to ignore the dashboard, so suppress the
  // danger color (not the number) under that floor.
  const churnSampleTooSmall = activeClientsCount < 20;
  const churnTone = churnSampleTooSmall ? undefined : (churnRate90 > 10 ? 'bad' : 'good');

  const tierTotal = tierMix.Standard + tierMix.VIP + tierMix['Paid In Full'];
  // 30-day forecast: recurring MRR expected to bill + already-open receivables
  const projectedInflow = mrr + totalOutstanding;
  const projectedCommission = commissionOwed + (mrr * (commissionEarned > 0 && lifetimeRevenue > 0 ? commissionEarned / lifetimeRevenue : 0));

  const tierRows = [
    { key: 'VIP', label: 'VIP', color: T.gold, count: tierMix.VIP },
    { key: 'Standard', label: 'Standard', color: T.navy, count: tierMix.Standard },
    { key: 'Paid In Full', label: 'Paid In Full', color: T.slate, count: tierMix['Paid In Full'] },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold ccc-display" style={{ color: T.navy }}>Billing Overview</h1>
          <p className="text-[13px] text-muted mt-1">Real-time aggregation of all client ledgers, revenue, retention, and commission liability.</p>
        </div>
      </div>

      {/* KPI ROW */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <MetricCard title="Outstanding" value={money(totalOutstanding)} icon={AlertCircle} subtitle={`${overdueAccounts.length} with a balance`} alert={totalOutstanding > 0} />
        <MetricCard title="30-Day Collected" value={money(collected30Days)} icon={TrendingUp} subtitle="Recognized last 30 days" highlight />
        <MetricCard title="Est. MRR" value={money(mrr)} icon={Repeat} subtitle="Active recurring tiers" />
        <MetricCard title="Net MRR Movement" value={`${netMrrMovement >= 0 ? '+' : '−'}${money(Math.abs(netMrrMovement))}`} icon={netMrrMovement >= 0 ? TrendingUp : TrendingDown} subtitle="New − churned (this month)" tone={netMrrMovement >= 0 ? 'good' : 'warn'} />
        <MetricCard title="Lifetime Revenue" value={money(lifetimeRevenue)} icon={DollarSign} subtitle={`ARPU: ${money(arpu)}`} />
        <MetricCard title="Commission Owed" value={money(commissionOwed)} icon={Percent} subtitle={`${commissionPayables.length} payouts pending`} alert={commissionOwed > 0} />
      </div>

      {/* TREND + TIER MIX */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel className="lg:col-span-2" title="Revenue — Last 12 Months" icon={TrendingUp} iconColor={T.gold}
          right={<span className="text-[11px] font-bold text-navy">{money0(months.reduce((s, m) => s + m.value, 0))} total</span>}>
          <RevenueTrend months={months} />
        </Panel>
        <Panel title="Service Tier Mix" icon={Layers} iconColor={T.navy}>
          <div className="p-5 flex flex-col gap-3">
            {tierRows.map(r => {
              const pct = tierTotal > 0 ? (r.count / tierTotal) * 100 : 0;
              return (
                <div key={r.key}>
                  <div className="flex items-center justify-between text-[12px] mb-1">
                    <span className="flex items-center gap-2 font-medium" style={{ color: T.ink }}>
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: r.color }} />{r.label}
                    </span>
                    <span className="font-bold" style={{ color: T.navy }}>{r.count} <span className="text-faint font-medium">· {pct.toFixed(0)}%</span></span>
                  </div>
                  <div className="w-full h-2 rounded-full overflow-hidden" style={{ backgroundColor: T.grid }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: r.color }} />
                  </div>
                </div>
              );
            })}
            <div className="mt-1 pt-2 border-t text-[11px] text-faint" style={{ borderColor: T.grid }}>
              {activeClientsCount} active · {pausedCount} paused · {graduatedCount} graduated · {inactiveCount} inactive
            </div>
          </div>
        </Panel>
      </div>

      {/* AGING + DUNNING + RETENTION */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel title="AR Aging" icon={Clock} iconColor={T.red}
          right={<span className="text-[11px] font-bold" style={{ color: collectionRate >= 90 ? T.green : T.amber }}>{collectionRate.toFixed(1)}% collected</span>}>
          <AgingBars buckets={aging} total={totalOutstanding} />
        </Panel>

        <Panel title="Dunning Funnel" icon={AlertCircle} iconColor={T.amber}>
          <div className="p-5">
            <StatLine label="Current (in grace)" value={money(dunning.current.amount)} sub={`· ${dunning.current.count}`} />
            <StatLine label="Reminder (31–60d)" value={money(dunning.reminder.amount)} sub={`· ${dunning.reminder.count}`} tone="warn" />
            <StatLine label="Final notice (61–90d)" value={money(dunning.final.amount)} sub={`· ${dunning.final.count}`} tone="warn" />
            <StatLine label="Auto-paused w/ balance" value={money(dunning.autopause.amount)} sub={`· ${dunning.autopause.count}`} tone="bad" />
          </div>
        </Panel>

        <Panel title="Retention & Health" icon={UserMinus} iconColor={T.slate}>
          <div className="p-5">
            <StatLine
              label="Churn rate (rolling 90d)"
              value={`${churnRate90.toFixed(1)}%`}
              sub={`(${inactiveExitsInWindow90} of ${activeClientsCount})`}
              tone={churnTone}
            />
            <StatLine label="Paused MRR (recoverable)" value={money(pausedMrr)} tone="warn" />
            <StatLine label="Lost MRR (inactive)" value={money(lostMrr)} tone="bad" />
            <StatLine
              label="Net MRR change"
              value={`${netMrrMovement >= 0 ? '+' : '−'}${money(Math.abs(netMrrMovement))}`}
              sub="new − lost"
              tone={netMrrMovement >= 0 ? 'good' : 'bad'}
            />
            <StatLine label="Avg. tenure (active)" value={`${avgTenure.toFixed(1)} mo`} sub="in progress" />
            <StatLine
              label="Avg. completed tenure"
              value={avgCompletedTenure === null ? '—' : `${avgCompletedTenure.toFixed(1)} mo`}
              sub="graduated + inactive"
            />
            <StatLine label="Avg. lifetime value" value={money(avgLtv)} />
            <StatLine label="Avg. days to pay" value={avgDaysToPay === null ? 'Building…' : `${avgDaysToPay.toFixed(0)} days`} />
          </div>
        </Panel>
      </div>

      {/* COMMISSION + FWF + FORECAST */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel className="lg:col-span-1 h-[360px]" title="Commission Payables" icon={Percent} iconColor={T.gold}
          right={<span className="text-[11px] font-bold text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">{money0(commissionOwed)} owed</span>}>
          <div className="flex-1 overflow-y-auto p-2">
            {commissionPayables.length === 0 ? (
              <div className="text-center p-8 text-[12px] text-faint italic">No pending commissions.</div>
            ) : (
              <div className="flex flex-col gap-1">
                {commissionPayables.map((p, i) => (
                  <button key={i} onClick={() => onNavigate('clients', { jumpTo: p.name })}
                    className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-lg text-left transition-colors border border-transparent hover:border-gray-100 group">
                    <div>
                      <div className="text-[13px] font-semibold text-ink group-hover:text-blue-600">{p.name}</div>
                      <div className="text-[10px] uppercase tracking-wider text-faint mt-0.5">{p.affiliate} · {(p.rate * 100).toFixed(0)}%</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-[14px] font-bold text-amber-600">{money(p.pending)}</div>
                      <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-500" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel title="First Work Fees" icon={Landmark} iconColor={T.navy}>
          <div className="p-5">
            <StatLine label="FWF collected" value={money(fwfCollected)} tone="good" />
            <StatLine label="FWF outstanding" value={money(fwfOutstanding)} tone={fwfOutstanding > 0 ? 'warn' : undefined} />
            <StatLine label="FWF collection rate" value={`${(fwfCollected + fwfOutstanding) > 0 ? ((fwfCollected / (fwfCollected + fwfOutstanding)) * 100).toFixed(0) : 0}%`} />
            <div className="mt-3 text-[11px] text-faint">Matched from ledger descriptions (first work / setup / initial fee).</div>
          </div>
        </Panel>

        <Panel title="30-Day Forecast" icon={CalendarClock} iconColor={T.gold}>
          <div className="p-5">
            <StatLine label="Projected inflow" value={money(projectedInflow)} tone="good" />
            <div className="pl-3 text-[11px] text-faint py-1">MRR {money(mrr)} + open receivables {money(totalOutstanding)}</div>
            <StatLine label="Projected commission out" value={money(projectedCommission)} tone="warn" />
            <StatLine label="Est. net" value={money(projectedInflow - projectedCommission)} tone={(projectedInflow - projectedCommission) >= 0 ? 'good' : 'bad'} />
            <div className="mt-3 text-[11px] text-faint">Estimate — assumes open receivables collect and recurring tiers bill on schedule.</div>
          </div>
        </Panel>
      </div>

      {/* OVERDUE + GLOBAL FEED (retained) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel className="lg:col-span-1 h-[500px]" title="Action Required" icon={Clock} iconColor={T.red}
          right={<span className="text-[11px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">{overdue30Count} accounts 30+ days</span>}>
          <div className="flex-1 overflow-y-auto p-2">
            {overdueAccounts.length === 0 ? (
              <div className="text-center p-8 text-[12px] text-faint italic">No overdue accounts.</div>
            ) : (
              <div className="flex flex-col gap-1">
                {overdueAccounts.map((account, i) => (
                  <button key={i} onClick={() => onNavigate('clients', { jumpTo: account.name })}
                    className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-lg text-left transition-colors border border-transparent hover:border-gray-100 group">
                    <div>
                      <div className="text-[13px] font-semibold text-ink group-hover:text-blue-600">{account.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] uppercase tracking-wider font-medium ${account.status === 'Active' ? 'text-green-600' : 'text-amber-600'}`}>{account.status || '—'}</span>
                        {account.hasOverdue30 && <span className="text-[10px] uppercase tracking-wider font-bold text-red-600 flex items-center gap-0.5"><AlertCircle size={10} /> 30+ Days</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-[14px] font-bold text-red-600">{money(account.balance)}</div>
                      <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-500" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </Panel>

        <Panel className="lg:col-span-2 h-[500px]" title="Global Ledger Feed" icon={TrendingUp} iconColor={T.gold}>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-white sticky top-0 border-b z-10" style={{ borderColor: T.grid }}>
                <tr>
                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider text-muted font-bold bg-white">Date</th>
                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider text-muted font-bold bg-white">Client</th>
                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider text-muted font-bold bg-white">Transaction</th>
                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider text-muted font-bold text-right bg-white">Amount</th>
                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider text-muted font-bold text-center bg-white">Status</th>
                </tr>
              </thead>
              <tbody>
                {allTransactions.slice(0, 50).map((tx, i) => (
                  <tr key={tx.id || i} className="border-b last:border-0 hover:bg-slate-50" style={{ borderColor: T.grid }}>
                    <td className="px-5 py-3 text-[12px] text-muted whitespace-nowrap">{tx.date}</td>
                    <td className="px-5 py-3 text-[13px] font-medium text-navy cursor-pointer hover:text-blue-600 hover:underline" onClick={() => onNavigate('clients', { jumpTo: tx.clientName })}>
                      {tx.clientName}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${tx.type === 'Payment' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>{tx.type}</span>
                        <span className="text-[12px] text-ink">{tx.description}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[13px] text-ink text-right font-bold">
                      {tx.type === 'Payment' ? <span className="text-green-600">-{money(tx.amount)}</span> : <span>{money(tx.amount)}</span>}
                    </td>
                    <td className="px-5 py-3 text-center whitespace-nowrap">
                      {tx.type === 'Invoice' ? (
                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${tx.status === 'Paid' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>{tx.status}</span>
                      ) : (
                        <span className="text-[10px] text-faint uppercase flex justify-center"><CheckCircle size={14} className="text-green-500" /></span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </div>
  );
}
