import React from 'react';
import { FileText, Clock, ArrowUpRight, Trophy } from 'lucide-react';

function fmt(d) {
  if (!d) return null;
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const STAGES = [
  {
    icon: FileText,
    title: 'Audit & Letters',
    copy: 'Your report is analyzed and demands go out certified.',
  },
  {
    icon: Clock,
    title: 'The Waiting Period',
    copy: "Companies have 30 days to respond. Your report won't change during this time. This is normal.",
  },
  {
    icon: ArrowUpRight,
    title: 'Escalation',
    copy: 'Whatever they do — or don’t do — becomes the basis for the next round.',
  },
  {
    icon: Trophy,
    title: 'Results',
    copy: 'Changes begin appearing on your report.',
  },
];

// stage is 1-4. dates = { mailDate, windowCloseDate, firstDeletionDate }
export default function OnboardingTimeline({ stage, dates }) {
  const stageDates = [
    dates?.mailDate ? fmt(dates.mailDate) : null,
    dates?.mailDate ? fmt(dates.mailDate) + ' – ' + fmt(dates.windowCloseDate) : null,
    dates?.windowCloseDate ? 'Closes ' + fmt(dates.windowCloseDate) : null,
    dates?.firstDeletionDate ? fmt(dates.firstDeletionDate) : null,
  ];

  return (
    <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl overflow-hidden shadow-sm mb-6">
      <div className="bg-slate-900 px-5 py-3.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-amber-400">Your Process Timeline</span>
      </div>
      <div className="p-5">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          {STAGES.map((s, i) => {
            const stepNum = i + 1;
            const isCurrent = stepNum === stage;
            const isDone = stepNum < stage;
            const Icon = s.icon;
            return (
              <div key={s.title}
                className={`relative rounded-lg p-4 border transition-colors ${
                  isCurrent
                    ? 'bg-slate-900 border-slate-900 shadow-md'
                    : isDone
                    ? 'bg-amber-50/60 border-amber-100'
                    : 'bg-white border-gray-100'
                }`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                    isCurrent ? 'bg-amber-400 text-slate-900' : isDone ? 'bg-amber-400/80 text-white' : 'bg-gray-100 text-gray-400'
                  }`}>
                    <Icon size={13} strokeWidth={2.5} />
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-[0.06em] ${isCurrent ? 'text-amber-400' : isDone ? 'text-amber-600' : 'text-gray-400'}`}>
                    Step {stepNum}
                  </span>
                </div>
                <div className={`text-[13px] font-bold mb-1 ${isCurrent ? 'text-white' : 'text-slate-900'}`}>{s.title}</div>
                <p className={`text-[12px] leading-relaxed ${isCurrent ? 'text-gray-300' : 'text-gray-500'}`}>{s.copy}</p>
                {stageDates[i] && (
                  <div className={`text-[10px] mt-2 pt-2 border-t ${isCurrent ? 'border-white/10 text-gray-400' : 'border-gray-100 text-gray-400'}`}>
                    {stageDates[i]}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
