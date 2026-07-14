import React from 'react';

export default function TimelineEvent({ icon, title, subtitle, date, tone }) {
  const tones = {
    default: 'bg-gray-50 border-gray-200 text-gray-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    gold: 'bg-amber-50 border-amber-200 text-amber-700',
    red: 'bg-red-50 border-red-200 text-red-700',
  };
  const toneClass = tones[tone] || tones.default;

  return (
    <div className="flex gap-3 items-start relative group">
      {/* Connector line for all but last item (would need parent context to hide last, simplified here) */}
      <div className="absolute left-3.5 top-7 bottom-[-24px] w-px bg-gray-100 group-last:hidden" />
      
      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[13px] border relative z-10 ${toneClass}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0 pb-6">
        <div className="text-[13px] font-medium text-gray-900">{title}</div>
        {subtitle && <div className="text-[11px] text-gray-500 mt-0.5">{subtitle}</div>}
        {date && <div className="text-[10px] text-gray-400 mt-1 uppercase tracking-wider">{new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>}
      </div>
    </div>
  );
}
