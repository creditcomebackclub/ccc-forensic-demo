import React from 'react';
import { motion } from 'framer-motion';
import { MAIL_FILTERS, letterMatchesMailFilter, countMailStatuses } from './clientDetailUtils';

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  grid: '#EEF0F4',
};

export default function LetterWorkboard({
  letters = [],
  mailFilter = 'all',
  onMailFilter,
  renderLetter,
  onOpenAccount,
}) {
  const counts = countMailStatuses(letters);
  const filtered = letters.filter((l) => letterMatchesMailFilter(l, mailFilter));

  const groups = [];
  const seen = new Map();
  for (const l of filtered) {
    const key = l.furnisher || 'Other';
    if (!seen.has(key)) {
      seen.set(key, []);
      groups.push([key, seen.get(key)]);
    }
    seen.get(key).push(l);
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1.5 mb-4">
        {MAIL_FILTERS.map((chip) => {
          const count = counts[chip.key] ?? 0;
          if (chip.key !== 'all' && count === 0 && mailFilter !== chip.key) return null;
          const on = mailFilter === chip.key;
          return (
            <motion.button
              key={chip.key}
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => onMailFilter?.(chip.key)}
              className="text-[10px] uppercase tracking-wider px-3 py-1.5 rounded-full transition-colors"
              style={{
                background: on ? T.navy : '#fff',
                color: on ? T.gold : T.muted,
                border: '1px solid ' + (on ? T.navy : T.border),
                fontWeight: on ? 600 : 400,
              }}
            >
              {chip.label}
              <span className="ml-1 opacity-70">{chip.key === 'all' ? counts.all : count}</span>
            </motion.button>
          );
        })}
      </div>

      {letters.length === 0 ? (
        <p className="text-[12.5px] text-center py-10 rounded-2xl" style={{ color: T.muted, border: '1px solid ' + T.border, background: '#fff' }}>
          No letters yet — run an audit to generate Phase 1 letters.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-[12.5px] text-center py-10 rounded-2xl" style={{ color: T.muted, border: '1px solid ' + T.border, background: '#fff' }}>
          No letters match this filter.
        </p>
      ) : (
        groups.map(([furnisher, groupLetters]) => (
          <div
            key={furnisher}
            className="mb-3 bg-white overflow-visible"
            style={{ border: '1px solid ' + T.border, borderRadius: 14 }}
          >
            <div
              className="flex items-center justify-between px-4 py-2.5"
              style={{ background: 'linear-gradient(180deg,#FAFBFC,#F5F7FA)', borderBottom: '1px solid ' + T.grid, borderRadius: '14px 14px 0 0' }}
            >
              <button
                type="button"
                onClick={() => onOpenAccount?.(groupLetters[0])}
                className="flex items-center gap-1.5 text-[12.5px] font-medium hover:underline underline-offset-2 decoration-dotted"
                style={{ color: T.ink }}
                title="View account history"
              >
                {furnisher}
                <span className="text-[10px] font-normal" style={{ color: T.faint }}>
                  {groupLetters.length} letter{groupLetters.length === 1 ? '' : 's'}
                </span>
              </button>
              <span className="text-[10px]" style={{ color: T.faint }}>history →</span>
            </div>
            <div className="px-4 py-1">
              {groupLetters.map((l) => renderLetter(l))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
