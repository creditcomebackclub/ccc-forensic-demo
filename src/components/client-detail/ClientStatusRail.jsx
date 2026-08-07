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
  campaignSummary,
  mailFilter,
  onMailFilter,
  onCampaignClick,
}) {
  const counts = countMailStatuses(letters);
  const mailChips = MAIL_FILTERS.filter((f) => f.key === 'all' || counts[f.key] > 0 || f.key === mailFilter);

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
            Campaign phases
          </div>
          {(!campaignSummary || campaignSummary.total === 0) ? (
            <button
              type="button"
              onClick={() => onCampaignClick?.()}
              className="text-[11px] text-left"
              style={{ color: T.muted }}
            >
              No compared accounts yet — open Report Comparison after a second audit
            </button>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {[1, 2, 3, 4].map((p) => {
                const n = campaignSummary.byPhase[p] || 0;
                const dominant = campaignSummary.dominant === p;
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => onCampaignClick?.(p)}
                    disabled={n === 0}
                    className="text-[10px] uppercase tracking-wider px-2.5 py-1 rounded-full transition-colors disabled:opacity-35"
                    style={{
                      background: dominant ? T.chipOn : T.chip,
                      color: dominant ? T.gold : T.muted,
                      border: dominant ? '1px solid rgba(201,168,76,0.45)' : '1px solid rgba(255,255,255,0.08)',
                    }}
                  >
                    Phase {p}
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
