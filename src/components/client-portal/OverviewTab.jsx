import React from 'react';
import { TrendingUp, Shield } from 'lucide-react';
import ScoreMeter from './ScoreMeter';
import OnboardingTimeline from './OnboardingTimeline';
import { motion } from 'framer-motion';

function DeletionRing({ deleted, totalDisputed }) {
  const percentage = totalDisputed === 0 ? 0 : Math.round((deleted / totalDisputed) * 100);
  const circumference = 2 * Math.PI * 36;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6 bg-slate-900 rounded-xl p-6 shadow-xl relative overflow-hidden mb-6 border border-slate-800">
      <div className="absolute -top-10 -right-10 w-48 h-48 bg-amber-400/20 blur-[50px] rounded-full pointer-events-none" />
      
      <div className="relative w-24 h-24 flex items-center justify-center shrink-0">
        <svg className="w-24 h-24 transform -rotate-90 drop-shadow-lg">
          <circle cx="48" cy="48" r="36" stroke="rgba(255,255,255,0.05)" strokeWidth="8" fill="none" />
          <motion.circle
            cx="48" cy="48" r="36"
            stroke="#FBBF24" strokeWidth="8" fill="none"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 2, ease: "easeOut", delay: 0.2 }}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold text-amber-400 leading-none">{percentage}%</span>
        </div>
      </div>

      <div className="flex-1 text-center sm:text-left z-10">
        <h3 className="text-lg font-bold text-white mb-1 tracking-wide">Deletion Milestone</h3>
        <p className="text-[13px] text-gray-400 leading-relaxed">
          <strong className="text-white">{deleted}</strong> negative accounts have been successfully removed from your credit reports out of <strong className="text-white">{totalDisputed}</strong> total disputed items.
        </p>
      </div>
    </div>
  );
}

export default function OverviewTab({
  profile,
  clientMeta,
  firstName,
  mailed,
  delivered,
  responded,
  deletions,
  totalDisputes,
  latestScores,
  auditHistory,
  onboardingStage,
  onboardingDates,
}) {
  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 ccc-display">Welcome back, {firstName}.</h1>
        <p className="text-sm text-gray-500 mt-1 mb-6">Here's your credit restoration campaign at a glance.</p>
      </div>

      <OnboardingTimeline stage={onboardingStage} dates={onboardingDates} />

      <DeletionRing deleted={deletions.length} totalDisputed={totalDisputes || mailed.length} />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Letters Sent', value: mailed.length, icon: '✉️' },
          { label: 'Delivered', value: delivered.length, icon: '✅' },
          { label: 'Responses', value: responded.length, icon: '📬' },
          { label: 'Deletions', value: deletions.length, icon: '🏆' },
        ].map(({ label, value, icon }) => (
          <div key={label} className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="text-2xl mb-1">{icon}</div>
            <div className="text-3xl font-bold text-slate-900">{value}</div>
            <div className="text-[10px] uppercase tracking-[0.06em] text-gray-400 mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl overflow-hidden shadow-sm">
        <div className="bg-slate-900 px-5 py-3.5 flex items-center gap-2">
          <TrendingUp size={16} className="text-amber-400" strokeWidth={2} />
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-amber-400">Credit Score Tracker</span>
        </div>
        <div className="p-6">
          {clientMeta && (clientMeta.score_eq_start || clientMeta.score_exp_start || clientMeta.score_tu_start) ? (
            <>
              <div className="flex flex-col sm:flex-row gap-6">
                <ScoreMeter label="Equifax"
                  start={clientMeta.score_eq_start}
                  current={latestScores ? latestScores.equifax : clientMeta.score_eq_start} />
                <ScoreMeter label="Experian"
                  start={clientMeta.score_exp_start}
                  current={latestScores ? latestScores.experian : clientMeta.score_exp_start} />
                <ScoreMeter label="TransUnion"
                  start={clientMeta.score_tu_start}
                  current={latestScores ? latestScores.transunion : clientMeta.score_tu_start} />
              </div>
              {auditHistory.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-50 text-[11px] text-gray-400">
                  Last updated: {new Date(auditHistory[0].saved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {auditHistory.length > 1 && ' · ' + auditHistory.length + ' audits on file'}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <TrendingUp size={32} className="text-gray-200 mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-sm text-gray-400">Score tracking will appear here once your audit is complete.</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-5 flex items-center gap-4 shadow-sm">
        <Shield size={20} className="text-green-700" strokeWidth={1.75} />
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-900">Authorization Active</div>
          <div className="text-xs text-gray-500 mt-0.5">Credit Comeback Club is authorized to dispute on your behalf{profile?.agreement_signed_at ? ' since ' + new Date(profile.agreement_signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}</div>
        </div>
        <span className="text-[10px] px-2 py-1 rounded bg-green-50 text-green-700 border border-green-200 uppercase tracking-[0.06em] font-semibold">Active</span>
      </div>
    </div>
  );
}
