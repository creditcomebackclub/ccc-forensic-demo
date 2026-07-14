import React from 'react';
import { motion } from 'framer-motion';

export default function ScoreMeter({ label, start, current }) {
  const score = current || start || null;
  const diff = (start && current && current !== start) ? current - start : null;
  const pct = score ? Math.min(100, Math.max(0, ((score - 300) / 550) * 100)) : 0;
  const startPct = start ? Math.min(100, Math.max(0, ((start - 300) / 550) * 100)) : 0;

  const getColor = (s) => {
    if (!s) return '#9CA3AF'; // gray-400
    if (s >= 750) return '#15803D'; // green-700
    if (s >= 700) return '#16A34A'; // green-600
    if (s >= 650) return '#D97706'; // amber-600
    if (s >= 600) return '#EA580C'; // orange-600
    return '#DC2626'; // red-600
  };

  const getRating = (s) => {
    if (!s) return '';
    if (s >= 750) return 'Excellent';
    if (s >= 700) return 'Good';
    if (s >= 650) return 'Fair';
    if (s >= 600) return 'Poor';
    return 'Very Poor';
  };

  return (
    <div className="flex-1 min-w-[140px] bg-white p-4 rounded-xl border border-gray-100 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-[0.08em] text-gray-400 font-semibold">{label}</span>
        {diff !== null && (
          <span className={`text-[11px] font-bold px-1.5 py-px rounded ${diff > 0 ? 'text-green-700 bg-green-50' : diff < 0 ? 'text-red-600 bg-red-50' : 'text-gray-500 bg-gray-50'}`}>
            {diff > 0 ? '▲ +' : diff < 0 ? '▼ ' : ''}{diff}
          </span>
        )}
      </div>

      <div className="relative mb-2">
        <div className="h-2 bg-gray-100 rounded-full relative overflow-hidden">
          <div className="absolute inset-0 opacity-15 rounded-full" 
               style={{ background: 'linear-gradient(90deg, #DC2626 0%, #EA580C 20%, #D97706 40%, #16A34A 65%, #15803D 100%)' }} />
          {start && current && current !== start && (
            <div className="absolute top-0 w-[3px] h-full bg-gray-400 rounded-sm -translate-x-1/2 z-10" 
                 style={{ left: startPct + '%' }} title={'Started: ' + start} />
          )}
          <motion.div 
            initial={{ width: 0 }}
            animate={{ width: pct + '%' }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="h-full rounded-full relative" 
            style={{ background: getColor(score) }}
          />
        </div>
        {/* Thumb indicator on top of the bar */}
        <motion.div 
          initial={{ left: 0 }}
          animate={{ left: pct + '%' }}
          transition={{ duration: 1, ease: 'easeOut' }}
          className="absolute top-[4px] -translate-y-1/2 -ml-[7px] w-3.5 h-3.5 rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.2)] z-20" 
          style={{ background: getColor(score) }}
        />
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-gray-300">300</span>
          <span className="text-[9px] text-gray-300">850</span>
        </div>
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-3xl font-extrabold leading-none" style={{ color: getColor(score) }}>{score || '—'}</span>
        <span className="text-[11px] font-semibold" style={{ color: getColor(score) }}>{getRating(score)}</span>
      </div>
      {start && current && current !== start && (
        <div className="text-[10px] text-gray-400 mt-0.5">Started at {start}</div>
      )}
      {start && (!current || current === start) && (
        <div className="text-[10px] text-gray-400 mt-0.5">Enrollment score</div>
      )}
    </div>
  );
}
