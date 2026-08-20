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

const BUREAU_LABEL = { equifax: 'Equifax', experian: 'Experian', transunion: 'TransUnion' };

export default function LetterWorkboard({
  letters = [],
  mailFilter = 'all',
  onMailFilter,
  renderLetter,
  onOpenAccount,
  rounds = [],
  onStartRound,
  activeCampaign = null,
}) {
  const client = { letters, rounds };
  const counts = countMailStatuses(letters, rounds);
  const filtered = letters.filter((l) => letterMatchesMailFilter(l, mailFilter, client));

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

  const openRoundCards = rounds
    .filter((round) => round.status === 'open')
    .map((round) => {
      const roundLetters = letters.filter((letter) => letter.roundId === round.round_id);
      const representative = roundLetters.find((letter) => letter.clientAccountId)
        || letters.find((letter) => letter.clientAccountId === round.client_account_id);
      const linkedToCampaign = !!activeCampaign && roundLetters.some((letter) => letter.campaignId === activeCampaign.id);
      const total = Number(round.letter_count || roundLetters.length || 0);
      const generated = Number(round.generated_count || 0);
      const mailed = Number(round.mailed_count || 0);
      const progress = mailed > 0
        ? `${mailed} of ${total} mailed`
        : generated >= total && total > 0 ? `${total} draft${total === 1 ? '' : 's'} ready`
          : `${generated} of ${total} generated`;
      return { round, representative, linkedToCampaign, progress, actionLabel: mailed > 0 ? 'Open round' : 'Open drafts' };
    })
    .filter((item) => item.representative);
  const hasPreCampaignRounds = !!activeCampaign && openRoundCards.some((item) => !item.linkedToCampaign);

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

      {mailFilter === 'all' && openRoundCards.length > 0 && (
        <section className="mb-5">
          <div className="flex items-end justify-between gap-3 mb-2">
            <div>
              <h2 className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: T.navy }}>Active account rounds</h2>
              <p className="text-[10.5px] mt-0.5" style={{ color: T.muted }}>Open, regenerate, review, and mail current drafts here.</p>
            </div>
            <span className="text-[10px] px-2 py-1 rounded-full" style={{ color: T.navy, background: '#F5F7FA', border: '1px solid ' + T.border }}>
              {openRoundCards.length} open
            </span>
          </div>
          {hasPreCampaignRounds && (
            <div className="mb-3 px-3 py-2 rounded-lg text-[10.5px] leading-relaxed" style={{ color: '#7A5C00', background: '#FFFBEB', border: '1px solid #F0D78C' }}>
              <strong>Transition account:</strong> earlier account rounds remain active independently. Client Campaign {activeCampaign.round_number} controls new work; close or complete these pre-campaign rounds from their cards below.
            </div>
          )}
          <div className="grid md:grid-cols-2 gap-2.5">
            {openRoundCards.map(({ round, representative, linkedToCampaign, progress, actionLabel }) => (
              <div key={round.round_id} className="bg-white rounded-xl p-3.5 flex items-center gap-3" style={{ border: '1px solid ' + T.border, boxShadow: '0 3px 12px rgba(16,24,40,.04)' }}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: linkedToCampaign ? T.gold : '#6D4DB1' }}>
                      {linkedToCampaign ? `Client Campaign ${activeCampaign.round_number}` : activeCampaign ? 'Pre-campaign account round' : 'Account round'}
                    </span>
                    <span className="text-[9px]" style={{ color: T.faint }}>· {progress}</span>
                  </div>
                  <div className="text-[12.5px] font-semibold truncate mt-1" style={{ color: T.ink }}>{representative.furnisher}</div>
                  <div className="text-[10.5px] mt-0.5" style={{ color: T.muted }}>
                    Round {round.round_number} · {round.target_type === 'bureau' ? `Credit Bureau${round.target_bureaus?.length ? ` · ${round.target_bureaus.map((bureau) => BUREAU_LABEL[bureau] || bureau).join(', ')}` : ''}` : 'Direct Furnisher'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onStartRound?.(representative)}
                  className="shrink-0 text-[10px] uppercase tracking-wider font-semibold px-3 py-2 rounded-lg transition-colors hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300"
                  style={{ color: T.navy, background: '#FFFBEB', border: '1px solid ' + T.gold }}
                >
                  {actionLabel}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {letters.length > 0 && (
        <div className="mb-2">
          <h2 className="text-[11px] uppercase tracking-[0.14em] font-semibold" style={{ color: T.navy }}>Letter history</h2>
          <p className="text-[10.5px] mt-0.5" style={{ color: T.muted }}>Generated, mailed, and prior correspondence grouped by account.</p>
        </div>
      )}

      {letters.length === 0 ? (
        <p className="text-[12.5px] text-center py-10 rounded-2xl" style={{ color: T.muted, border: '1px solid ' + T.border, background: '#fff' }}>
          No letters yet — run an audit to generate Phase 1 letters.
        </p>
      ) : filtered.length === 0 ? (
        <p className="text-[12.5px] text-center py-10 rounded-2xl" style={{ color: T.muted, border: '1px solid ' + T.border, background: '#fff' }}>
          No letters match this filter.
        </p>
      ) : (
        groups.map(([furnisher, groupLetters]) => {
          const accountIds = new Set(groupLetters.map((letter) => letter.clientAccountId).filter(Boolean));
          const groupRounds = rounds.filter((round) => accountIds.has(round.client_account_id)).sort((a, b) => Number(a.round_number) - Number(b.round_number));
          const latestRound = groupRounds[groupRounds.length - 1];
          const startLetter = latestRound
            ? groupLetters.find((letter) => letter.clientAccountId === latestRound.client_account_id)
            : groupLetters.find((letter) => letter.clientAccountId);
          const mayStart = !!startLetter && (!latestRound || (latestRound.status === 'closed' && latestRound.final_disposition === 'next_round'));
          return (
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
            {!!groupRounds.length && (
              <div className="px-4 py-2.5 flex flex-wrap items-center gap-2" style={{ borderBottom: '1px solid ' + T.grid }}>
                {groupRounds.map((round) => {
                  const isOpenRound = !!startLetter && round.round_id === latestRound?.round_id && round.status === 'open';
                  const label = `Round ${round.round_number} · ${round.target_type === 'bureau' ? 'Credit Bureau' : 'Direct Furnisher'}`;
                  return isOpenRound ? (
                    <button
                      key={round.round_id}
                      type="button"
                      onClick={() => onStartRound?.(startLetter)}
                      aria-label={`Open ${label}`}
                      title="Open this round"
                      className="text-[10px] px-3 py-1.5 rounded-full font-semibold transition-colors hover:bg-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-300"
                      style={{ border: '1px solid ' + T.gold, color: T.navy, background: '#FFFBEB', cursor: 'pointer' }}
                    >
                      Open {label}
                    </button>
                  ) : (
                    <span key={round.round_id} className="text-[10px] px-2 py-1 rounded-full" style={{ border: '1px solid ' + T.border, color: T.muted, background: '#F8FAFC' }}>
                      {label} · {round.status}
                    </span>
                  );
                })}
                {mayStart && <button type="button" onClick={() => onStartRound?.(startLetter)} className="text-[10px] uppercase tracking-wider font-medium ml-auto" style={{ color: T.navy }}>Start next round</button>}
              </div>
            )}
            <div className="px-4 py-1">
              {groupLetters.map((l) => renderLetter(l))}
            </div>
          </div>
          );
        })
      )}
    </div>
  );
}
