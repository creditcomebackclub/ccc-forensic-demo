import React from 'react';
import {
  ArrowRight, CalendarDays, CheckCircle2, Clock3, FileCheck2, FileSearch,
  Flag, MailCheck, MapPin, Send, ShieldCheck, Sparkles, Target, TrendingUp,
  Upload, AlertCircle,
} from 'lucide-react';
import ScoreMeter from './ScoreMeter';
import { buildActionQueue, buildAccountResults, buildScoreGap, derivePortalStage } from '../../utils/portalPlan.js';

function scoreAverage(values) {
  const usable = values.filter((score) => Number.isFinite(Number(score)) && Number(score) > 0).map(Number);
  return usable.length ? Math.round(usable.reduce((sum, score) => sum + score, 0) / usable.length) : null;
}

function formatDate(value) {
  if (!value) return null;
  try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return null; }
}

function campaignState({ onboardingStage, mailed, delivered, responded, deletions, hasBlueprint, stageId }) {
  if (deletions.length > 0) {
    return {
      eyebrow: 'Results in motion', title: 'Your campaign is producing results.',
      body: `${deletions.length} account${deletions.length === 1 ? '' : 's'} ha${deletions.length === 1 ? 's' : 've'} been confirmed removed. We continue tracking the remaining items.`,
      next: 'Your next report comparison will show the newest changes.', icon: Sparkles, tone: 'gold',
    };
  }
  if (responded.length > 0) {
    return {
      eyebrow: 'Response received', title: 'We’re reviewing the latest response.',
      body: 'A response has arrived and your file is moving through its next decision point.',
      next: 'Account-level results appear below as your specialist logs each item.', icon: FileSearch, tone: 'blue',
    };
  }
  if (delivered.length > 0) {
    return {
      eyebrow: 'Response window active', title: 'Your dispute is officially in motion.',
      body: `${delivered.length} certified letter${delivered.length === 1 ? ' has' : 's have'} been confirmed delivered. The response clock is now running.`,
      next: 'If a bureau letter arrives at your home, upload it under Disputes.', icon: Clock3, tone: 'amber',
    };
  }
  if (mailed.length > 0) {
    return {
      eyebrow: 'Certified mail in transit', title: 'Your dispute package is on its way.',
      body: `${mailed.length} certified letter${mailed.length === 1 ? ' is' : 's are'} moving through USPS tracking.`,
      next: 'Confirmed delivery will start the response window.', icon: MapPin, tone: 'blue',
    };
  }
  if (hasBlueprint) {
    return {
      eyebrow: 'Plan ready', title: 'Your Recovery Blueprint is on file.',
      body: 'We already know the opening move and the first wave of work. Certified mail activity will appear here as soon as it is sent.',
      next: 'Open your Blueprint anytime from this page or the Recovery Plan tab.', icon: FileCheck2, tone: 'gold',
    };
  }
  if (onboardingStage <= 1) {
    return {
      eyebrow: 'Forensic audit', title: 'We’re building your strongest opening move.',
      body: 'Your report, documentation, and dispute strategy are being prepared for the first campaign.',
      next: 'Your Recovery Blueprint and first mailing will appear here when ready.', icon: FileSearch, tone: 'blue',
    };
  }
  return {
    eyebrow: 'Campaign preparation', title: 'Your file is moving into its next stage.',
    body: 'We’re preparing the next evidence-backed action for your credit restoration campaign.',
    next: 'This command center will update as the next milestone is recorded.', icon: Target, tone: 'blue',
  };
}

function StageRail({ steps }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_35px_rgba(15,23,42,0.05)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Where you are</div>
          <div className="mt-1 text-sm font-bold text-slate-900">Plan → mail → responses → results → next wave</div>
        </div>
        <div className="hidden rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 sm:block">Live case status</div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5 sm:gap-0">
        {steps.map((step, index) => {
          const stateClass = step.current
            ? 'border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-900/15'
            : step.done
              ? 'border-amber-200 bg-amber-50 text-slate-900'
              : 'border-slate-100 bg-slate-50 text-slate-400';
          return (
            <div className="relative flex items-center gap-3 sm:block" key={step.id}>
              {index > 0 && <div className={`absolute left-[-9px] top-1/2 hidden h-px w-[18px] -translate-y-1/2 sm:block ${step.done || step.current ? 'bg-amber-300' : 'bg-slate-100'}`} />}
              <div className={`relative z-10 flex min-h-[72px] flex-1 flex-col justify-center gap-1 rounded-xl border p-3 sm:min-h-[112px] ${stateClass}`}>
                <div className="flex items-center gap-2">
                  <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${step.current ? 'bg-amber-400 text-slate-900' : step.done ? 'bg-amber-400/20 text-amber-700' : 'bg-white text-slate-300'}`}>
                    {step.done && !step.current ? <CheckCircle2 size={14} strokeWidth={2.4} /> : <span className="text-[10px] font-bold">{index + 1}</span>}
                  </div>
                  <div className={`text-[11px] font-bold leading-tight ${step.current ? 'text-white' : ''}`}>{step.label}</div>
                </div>
                <div className={`text-[10px] leading-snug ${step.current ? 'text-slate-300' : step.done ? 'text-slate-500' : 'text-slate-400'}`}>{step.detail}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SignalCard({ label, value, helper, icon: Icon, tone = 'slate' }) {
  const styles = {
    slate: 'border-slate-200 bg-white text-slate-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
  };
  const iconStyles = { slate: 'bg-slate-100 text-slate-700', amber: 'bg-amber-200/70 text-amber-800', green: 'bg-emerald-200/70 text-emerald-800', blue: 'bg-blue-200/70 text-blue-800' };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${styles[tone]}`}>
      <div className="mb-4 flex items-center justify-between">
        <div className="text-[10px] font-bold uppercase tracking-[0.1em] opacity-60">{label}</div>
        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${iconStyles[tone]}`}><Icon size={15} strokeWidth={2.2} /></div>
      </div>
      <div className="text-3xl font-extrabold tracking-tight">{value}</div>
      <div className="mt-1 text-[11px] leading-relaxed opacity-65">{helper}</div>
    </div>
  );
}

function BlueprintCard({ blueprint, onOpenPlan }) {
  if (!blueprint) return null;
  return (
    <section className="rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-[0_14px_35px_rgba(15,23,42,0.12)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-400 text-slate-900">
          <FileCheck2 size={22} strokeWidth={1.8} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300">Your Recovery Blueprint</div>
          <div className="mt-1 text-base font-bold text-white">The plan we’re executing on your file</div>
          <div className="mt-1 text-[12px] text-slate-400">
            Report {blueprint.report_date || 'on file'}
            {blueprint.version != null ? ` · Version ${blueprint.version}` : ''}
            {blueprint.sent_at ? ` · Delivered ${formatDate(blueprint.sent_at)}` : blueprint.approved_at ? ` · Approved ${formatDate(blueprint.approved_at)}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={onOpenPlan}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-slate-900 hover:bg-amber-300"
        >
          View Blueprint
          <ArrowRight size={14} />
        </button>
      </div>
    </section>
  );
}

function ActionQueue({ actions, onNavigate }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Needs from you</div>
          <div className="mt-1 text-sm font-bold text-slate-900">Only the items that require your attention</div>
        </div>
      </div>
      <div className="space-y-2">
        {actions.map((action) => {
          const tone = action.tone === 'green'
            ? 'border-emerald-100 bg-emerald-50/70'
            : action.tone === 'blue'
              ? 'border-blue-100 bg-blue-50/70'
              : 'border-amber-100 bg-amber-50/70';
          const Icon = action.tone === 'green' ? CheckCircle2 : action.tone === 'blue' ? Upload : AlertCircle;
          return (
            <div key={action.id} className={`flex items-start gap-3 rounded-xl border p-3.5 ${tone}`}>
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/80 text-slate-700">
                <Icon size={15} strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold text-slate-900">{action.title}</div>
                <div className="mt-0.5 text-[12px] leading-relaxed text-slate-600">{action.body}</div>
              </div>
              {action.tab && (
                <button
                  type="button"
                  onClick={() => onNavigate?.(action.tab)}
                  className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-700 hover:bg-slate-50"
                >
                  Open
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ResultsSummary({ accountResults, onNavigate }) {
  if (!accountResults?.hasResults) return null;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Account results</div>
          <div className="mt-1 text-sm font-bold text-slate-900">
            {accountResults.wins} removed · {accountResults.working} still working
          </div>
        </div>
        <button
          type="button"
          onClick={() => onNavigate?.('disputes')}
          className="text-[11px] font-bold uppercase tracking-wider text-amber-700 hover:text-amber-800"
        >
          View disputes →
        </button>
      </div>
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-100">
        {accountResults.rows.slice(0, 6).map((row) => (
          <div key={row.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{row.name}</div>
              {row.bureau && <div className="text-[11px] text-slate-400">{row.bureau}</div>}
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
              row.positive
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-slate-50 text-slate-600 border border-slate-200'
            }`}>
              {row.outcomeLabel}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

export default function OverviewTab({
  profile, clientMeta, firstName, mailed, delivered, responded, deletions,
  totalDisputes, fileUpdateCount = 0, latestScores, auditHistory, onboardingStage, onboardingDates,
  recoveryBlueprints = [],
  rounds = [],
  campaigns = [],
  packetCoverage = [],
  letters = [],
  clientDocs = { id: null, address: null },
  stagedFiles = {},
  uploadSuccess = null,
  onNavigate,
}) {
  const hasBlueprint = (recoveryBlueprints || []).length > 0;
  const latestBlueprint = recoveryBlueprints?.[0] || null;
  const docsComplete = !!(clientDocs?.id && clientDocs?.address);
  const stage = derivePortalStage({
    blueprints: recoveryBlueprints,
    mailed,
    delivered,
    responded,
    deletions,
    rounds,
    campaigns,
    docsComplete,
  });
  const state = campaignState({
    onboardingStage,
    mailed,
    delivered,
    responded,
    deletions,
    hasBlueprint,
    stageId: stage.currentId,
  });
  const StateIcon = state.icon;
  const startScores = [clientMeta?.score_eq_start, clientMeta?.score_exp_start, clientMeta?.score_tu_start];
  const currentScores = [latestScores?.equifax || clientMeta?.score_eq_start, latestScores?.experian || clientMeta?.score_exp_start, latestScores?.transunion || clientMeta?.score_tu_start];
  const startingAverage = scoreAverage(startScores);
  const currentAverage = scoreAverage(currentScores);
  const scoreDelta = startingAverage && currentAverage ? currentAverage - startingAverage : null;
  const scoreGap = buildScoreGap(latestScores, clientMeta);
  const auditUpdated = auditHistory?.[0]?.saved_at ? formatDate(auditHistory[0].saved_at) : null;
  const disputeCount = totalDisputes || 0;
  const updateCount = fileUpdateCount || 0;
  const totalChallenges = disputeCount + updateCount || mailed.length;
  const challengeHelper = (() => {
    const parts = [];
    if (disputeCount > 0) parts.push(`${disputeCount} account dispute${disputeCount === 1 ? '' : 's'}`);
    if (updateCount > 0) parts.push(`${updateCount} file update${updateCount === 1 ? '' : 's'}`);
    if (parts.length === 0) return 'items in your campaign';
    return parts.join(' · ');
  })();

  const actions = buildActionQueue({
    clientDocs,
    profile,
    letters,
    stagedFiles,
    uploadSuccess,
  });
  const accountResults = buildAccountResults({ packetCoverage, letters });

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <section className="relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 p-6 shadow-[0_24px_55px_rgba(15,23,42,0.24)] sm:p-8">
        <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-amber-400/20 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-40 w-80 rounded-full bg-blue-500/15 blur-3xl" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300">Credit recovery command center</span>
              {auditUpdated && <span className="text-[11px] text-slate-400">Report reviewed {auditUpdated}</span>}
            </div>
            <h1 className="ccc-display max-w-xl text-3xl font-medium leading-[1.05] text-white sm:text-4xl">Welcome back, {firstName}.<br /><span className="text-amber-300">Your case is moving with purpose.</span></h1>
            <p className="mt-4 max-w-2xl text-sm leading-relaxed text-slate-300">This is your live view of the evidence-backed work happening on your credit restoration campaign.</p>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:min-w-[300px]">
            <div className="rounded-2xl border border-white/10 bg-white/[0.06] p-4 backdrop-blur-sm">
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400">Active challenges</div>
              <div className="mt-2 text-3xl font-bold text-white">{totalChallenges}</div>
              <div className="mt-1 text-[11px] text-slate-400">{challengeHelper}</div>
            </div>
            <div className="rounded-2xl border border-amber-300/20 bg-amber-400/10 p-4 backdrop-blur-sm">
              <div className="text-[10px] font-bold uppercase tracking-[0.1em] text-amber-200/70">Accounts removed</div>
              <div className="mt-2 text-3xl font-bold text-amber-300">{deletions.length}</div>
              <div className="mt-1 text-[11px] text-amber-100/60">confirmed results</div>
            </div>
          </div>
        </div>
      </section>

      <BlueprintCard
        blueprint={latestBlueprint}
        onOpenPlan={() => onNavigate?.('recovery-plan')}
      />

      <ActionQueue actions={actions} onNavigate={onNavigate} />

      <section className={`relative overflow-hidden rounded-2xl border p-5 shadow-sm ${state.tone === 'gold' ? 'border-amber-200 bg-amber-50' : state.tone === 'amber' ? 'border-amber-200 bg-amber-50/60' : 'border-blue-200 bg-blue-50/60'}`}>
        <div className="absolute right-4 top-4 opacity-10"><StateIcon size={96} /></div>
        <div className="relative flex items-start gap-4">
          <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${state.tone === 'gold' ? 'bg-amber-400 text-slate-900' : state.tone === 'amber' ? 'bg-amber-200 text-amber-900' : 'bg-blue-200 text-blue-900'}`}><StateIcon size={21} strokeWidth={2.2} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{state.eyebrow}</div>
            <h2 className="mt-1 text-lg font-bold text-slate-900">{state.title}</h2>
            <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-slate-600">{state.body}</p>
            <div className="mt-3 flex items-center gap-2 text-[11px] font-semibold text-slate-700"><ArrowRight size={14} className="text-amber-700" /> What happens next: {state.next}</div>
          </div>
        </div>
      </section>

      <StageRail steps={stage.steps} />

      <ResultsSummary accountResults={accountResults} onNavigate={onNavigate} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SignalCard label="Certified letters" value={mailed.length} helper={mailed.length ? 'Evidence-backed packages sent' : 'Preparing your first campaign'} icon={Send} tone="slate" />
        <SignalCard label="Confirmed delivery" value={delivered.length} helper={delivered.length ? 'Response clock started' : 'Tracking will appear here'} icon={MailCheck} tone="blue" />
        <SignalCard label="Responses logged" value={responded.length} helper={responded.length ? 'Being evaluated for next action' : 'We’re monitoring for replies'} icon={FileSearch} tone="amber" />
        <SignalCard label="Verified removals" value={deletions.length} helper={deletions.length ? 'Confirmed in your report history' : 'Results will be reflected here'} icon={Flag} tone="green" />
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_14px_35px_rgba(15,23,42,0.05)]">
        <div className="flex flex-col justify-between gap-4 border-b border-slate-100 bg-gradient-to-r from-slate-950 to-slate-800 px-5 py-5 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400 text-slate-900"><TrendingUp size={19} strokeWidth={2.4} /></div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-amber-300">Score trajectory</div>
              <div className="mt-0.5 text-base font-bold text-white">Your three-bureau progress</div>
            </div>
          </div>
          {currentAverage && <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2">
            <div><div className="text-[10px] uppercase tracking-wider text-slate-400">Current average</div><div className="text-xl font-bold text-white">{currentAverage}</div></div>
            {scoreDelta !== null && <div className={`rounded-lg px-2 py-1 text-[11px] font-bold ${scoreDelta > 0 ? 'bg-emerald-400/15 text-emerald-300' : scoreDelta < 0 ? 'bg-red-400/15 text-red-200' : 'bg-white/10 text-slate-300'}`}>{scoreDelta > 0 ? '▲ +' : scoreDelta < 0 ? '▼ ' : ''}{scoreDelta} pts</div>}
          </div>}
        </div>
        <div className="p-5 sm:p-6">
          {scoreGap?.narrative && (
            <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50/80 px-3.5 py-3 text-[12px] leading-relaxed text-slate-700">
              <span className="font-bold text-amber-800">Score gap: </span>
              {scoreGap.narrative}
            </div>
          )}
          {startScores.some(Boolean) ? (
            <>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5 text-[11px] text-slate-500">
                <span className="flex items-center gap-1.5"><CalendarDays size={13} className="text-slate-400" /> Starting average: <strong className="text-slate-700">{startingAverage || '—'}</strong></span>
                <span className="flex items-center gap-1.5"><ShieldCheck size={13} className="text-emerald-600" /> Scores update when a new report is reviewed.</span>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <ScoreMeter label="Equifax" start={clientMeta.score_eq_start} current={latestScores?.equifax || clientMeta.score_eq_start} />
                <ScoreMeter label="Experian" start={clientMeta.score_exp_start} current={latestScores?.experian || clientMeta.score_exp_start} />
                <ScoreMeter label="TransUnion" start={clientMeta.score_tu_start} current={latestScores?.transunion || clientMeta.score_tu_start} />
              </div>
            </>
          ) : (
            <div className="py-10 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400"><TrendingUp size={22} /></div>
              <p className="text-sm font-semibold text-slate-700">Score tracking is being prepared.</p>
              <p className="mx-auto mt-1 max-w-sm text-[12px] leading-relaxed text-slate-400">Your starting scores and three-bureau trajectory will appear after your audit is complete.</p>
            </div>
          )}
        </div>
      </section>

      <section className="flex items-center gap-4 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5 shadow-sm">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700"><ShieldCheck size={19} strokeWidth={2.2} /></div>
        <div className="min-w-0 flex-1"><div className="text-sm font-bold text-slate-900">Your authorization is active</div><div className="mt-0.5 text-[12px] leading-relaxed text-slate-600">Credit Comeback Club is authorized to act on your behalf{profile?.agreement_signed_at ? ` since ${new Date(profile.agreement_signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}.</div></div>
        <span className="hidden shrink-0 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 sm:block">Protected</span>
      </section>
    </div>
  );
}
