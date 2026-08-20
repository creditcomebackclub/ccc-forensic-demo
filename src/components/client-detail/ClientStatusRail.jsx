import React from 'react';
import { MAIL_FILTERS, countMailStatuses } from './clientDetailUtils';

const T = {
  gold: '#C9A84C',
  muted: 'rgba(247,244,237,0.55)',
  chip: 'rgba(255,255,255,0.08)',
  chipOn: 'rgba(201,168,76,0.22)',
};

export default function ClientStatusRail({
  letters = [],
  rounds = [],
  mailFilter,
  onMailFilter,
  onRoundsClick,
}) {
  const counts = countMailStatuses(letters, rounds);
  const mailChips = MAIL_FILTERS.filter((f) => f.key === 'all' || counts[f.key] > 0 || f.key === mailFilter);
  const roundCounts = rounds.reduce((totals, round) => {
    const status = round.status || 'open';
    if (totals[status] != null) totals[status] += 1;
    return totals;
  }, { open: 0, closed: 0, cancelled: 0 });

  return (
    <div className="px-5 sm:px-6 pb-5 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex flex-col gap-3">
        <div>
          <div className="text-[9px] uppercase tracking-[0.16em] font-bold mb-2" style={{ color: T.gold }}>
            Mail status
          </div>
          <div className="flex flex-wrap gap-1.5">
            {mailChips.map((chip) => {
              const on = (mailFilter || 'all') === chip.key;
              const count = counts[chip.key] ?? 0;
              return (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => onMailFilter?.(chip.key)}
                  className="text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full transition-colors"
                  style={{
                    background: on ? T.chipOn : T.chip,
                    color: on ? T.gold : T.muted,
                    border: on ? '1px solid rgba(201,168,76,0.45)' : '1px solid rgba(255,255,255,0.08)',
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  {chip.label}
                  {chip.key !== 'all' && <span className="ml-1 opacity-70">{count}</span>}
                  {chip.key === 'all' && <span className="ml-1 opacity-70">{counts.all}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <div className="text-[9px] uppercase tracking-[0.16em] font-bold mb-2" style={{ color: T.gold }}>
            Dispute rounds
          </div>
          {!rounds.length ? (
            <button
              type="button"
              onClick={() => onRoundsClick?.()}
              className="text-[11px] text-left"
              style={{ color: T.muted }}
            >
              No adaptive rounds yet — legacy history remains available in Letters
            </button>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'open', label: 'Open' },
                { key: 'closed', label: 'Closed' },
                { key: 'cancelled', label: 'Cancelled' },
              ].map(({ key, label }) => {
                const n = roundCounts[key];
                const emphasized = key === 'open' && n > 0;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onRoundsClick?.(key)}
                    disabled={n === 0}
                    className="text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full transition-colors disabled:opacity-35"
                    style={{
                      background: emphasized ? T.chipOn : T.chip,
                      color: emphasized ? T.gold : T.muted,
                      border: emphasized ? '1px solid rgba(201,168,76,0.45)' : '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    {label}
                    <span className="ml-1 opacity-70">{n}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
