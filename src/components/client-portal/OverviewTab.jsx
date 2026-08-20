import React from 'react';
import {
  ArrowRight, CalendarDays, CheckCircle2, Clock3, FileSearch,
  Flag, MailCheck, MapPin, Send, ShieldCheck, Sparkles, Target, TrendingUp,
} from 'lucide-react';
import ScoreMeter from './ScoreMeter';
import { motion } from 'framer-motion';

function scoreAverage(values) {
  const usable = values.filter((score) => Number.isFinite(Number(score)) && Number(score) > 0).map(Number);
  return usable.length ? Math.round(usable.reduce((sum, score) => sum + score, 0) / usable.length) : null;
}

function formatDate(value) {
  if (!value) return null;
  try { return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return null; }
}

function campaignState({ onboardingStage, mailed, delivered, responded, deletions }) {
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
      next: 'Our team will record the appropriate next step in your campaign.', icon: FileSearch, tone: 'blue',
    };
  }
  if (delivered.length > 0) {
    return {
      eyebrow: 'Response window active', title: 'Your dispute is officially in motion.',
      body: `${delivered.length} campaign letter${delivered.length === 1 ? ' has' : 's have'} received a delivery scan. The review clock is now running.`,
      next: 'We’re tracking the response window and will act when it closes or a response arrives.', icon: Clock3, tone: 'amber',
    };
  }
  if (mailed.length > 0) {
    return {
      eyebrow: 'Campaign mail in transit', title: 'Your dispute package is on its way.',
      body: `${mailed.length} campaign letter${mailed.length === 1 ? ' is' : 's are'} moving through the USPS mail stream.`,
      next: 'A delivery scan or expected-delivery date will set the team’s review target.', icon: MapPin, tone: 'blue',
    };
  }
  if (onboardingStage <= 1) {
    return {
      eyebrow: 'Forensic audit', title: 'We’re building your strongest opening move.',
      body: 'Your report, documentation, and dispute strategy are being prepared for the first campaign.',
      next: 'Your first campaign mailing will appear here as soon as it is sent.', icon: FileSearch, tone: 'blue',
    };
  }
  return {
    eyebrow: 'Campaign preparation', title: 'Your file is moving into its next stage.',
    body: 'We’re preparing the next evidence-backed action for your credit restoration campaign.',
    next: 'This command center will update as the next milestone is recorded.', icon: Target, tone: 'blue',
  };
}

function CaseJourney({ onboardingStage, mailed, delivered, responded, deletions }) {
  const steps = [
    { label: 'Forensic audit', icon: FileSearch, done: onboardingStage > 1 || mailed.length > 0, current: onboardingStage === 1 && mailed.length === 0 },
    { label: 'Campaign mailed', icon: Send, done: mailed.length > 0, current: mailed.length > 0 && delivered.length === 0 },
    { label: 'Delivery scan', icon: MailCheck, done: delivered.length > 0, current: delivered.length > 0 && responded.length === 0 },
    { label: 'Review & response', icon: FileSearch, done: responded.length > 0, current: responded.length > 0 && deletions.length === 0 },
    { label: 'Results', icon: Flag, done: deletions.length > 0, current: deletions.length > 0 },
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_14px_35px_rgba(15,23,42,0.05)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Your case journey</div>
          <div className="mt-1 text-sm font-bold text-slate-900">Every milestone, in one place.</div>
        </div>
        <div className="hidden rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700 sm:block">Live case status</div>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-5 sm:gap-0">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const stateClass = step.current
            ? 'border-slate-900 bg-slate-900 text-white shadow-lg shadow-slate-900/15'
            : step.done
              ? 'border-amber-200 bg-amber-50 text-slate-900'
              : 'border-slate-100 bg-slate-50 text-slate-400';
          return (
            <div className="relative flex items-center gap-3 sm:block" key={step.label}>
              {index > 0 && <div className={`absolute left-[-9px] top-1/2 hidden h-px w-[18px] -translate-y-1/2 sm:block ${step.done || step.current ? 'bg-amber-300' : 'bg-slate-100'}`} />}
              <div className={`relative z-10 flex min-h-[72px] flex-1 items-center gap-3 rounded-xl border p-3 sm:min-h-[112px] sm:flex-col sm:items-start sm:justify-center ${stateClass}`}>
                <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${step.current ? 'bg-amber-400 text-slate-900' : step.done ? 'bg-amber-400/20 text-amber-700' : 'bg-white text-slate-300'}`}>
                  {step.done && !step.current ? <CheckCircle2 size={16} strokeWidth={2.4} /> : <Icon size={16} strokeWidth={2} />}
                </div>
                <div>
                  <div className={`text-[10px] font-bold uppercase tracking-[0.08em] ${step.current ? 'text-amber-300' : step.done ? 'text-amber-700' : 'text-slate-400'}`}>Step {index + 1}</div>
                  <div className="mt-0.5 text-[12px] font-bold leading-tight">{step.label}</div>
                </div>
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

export default function OverviewTab({
  profile, clientMeta, firstName, mailed, delivered, responded, deletions,
  totalDisputes, fileUpdateCount = 0, latestScores, auditHistory, onboardingStage, onboardingDates,
}) {
  const state = campaignState({ onboardingStage, mailed, delivered, responded, deletions });
  const StateIcon = state.icon;
  const startScores = [clientMeta?.score_eq_start, clientMeta?.score_exp_start, clientMeta?.score_tu_start];
  const currentScores = [latestScores?.equifax || clientMeta?.score_eq_start, latestScores?.experian || clientMeta?.score_exp_start, latestScores?.transunion || clientMeta?.score_tu_start];
  const startingAverage = scoreAverage(startScores);
  const currentAverage = scoreAverage(currentScores);
  const scoreDelta = startingAverage && currentAverage ? currentAverage - startingAverage : null;
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

      <CaseJourney onboardingStage={onboardingStage} mailed={mailed} delivered={delivered} responded={responded} deletions={deletions} />

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SignalCard label="Letters mailed" value={mailed.length} helper={mailed.length ? 'Campaign packages sent' : 'Preparing your first campaign'} icon={Send} tone="slate" />
        <SignalCard label="Delivery scans" value={delivered.length} helper={delivered.length ? 'Review clock started' : 'Mailpiece updates will appear here'} icon={MailCheck} tone="blue" />
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
