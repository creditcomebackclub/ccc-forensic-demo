import { Link } from 'react-router-dom';
import { ArrowRight, Package } from 'lucide-react';
import { useFieldwork } from '../state';

export default function Campaigns() {
  const { campaigns, letters, startNewCampaign } = useFieldwork();
  const latestLetters = campaigns[0]?.letters || letters;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Campaigns</p>
          <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">Mail history</h1>
          <p className="mt-3 max-w-xl text-lg text-[var(--fw-muted)]">
            Each wave is a campaign with its own Lob tracking and 30-day response clocks.
          </p>
        </div>
        <Link
          to="/app/campaign/new"
          onClick={startNewCampaign}
          className="fw-btn-ink"
        >
          New campaign <ArrowRight size={16} />
        </Link>
      </div>

      {campaigns.length === 0 ? (
        <div className="mt-12 rounded-lg border border-dashed border-[var(--fw-line)] bg-white px-6 py-16 text-center">
          <p className="fw-display text-2xl font-bold">No campaigns yet</p>
          <p className="mt-2 text-[var(--fw-muted)]">Run an audit and mail your first furnisher letters.</p>
          <Link to="/app/campaign/new" className="fw-btn-ink mt-6 inline-flex">
            Start first campaign
          </Link>
        </div>
      ) : (
        <div className="mt-10 space-y-4">
          {campaigns.map((camp) => (
            <article key={camp.id} className="rounded-lg border border-[var(--fw-line)] bg-white p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="fw-display text-2xl font-bold">{camp.name}</h2>
                  <p className="mt-1 text-sm text-[var(--fw-muted)]">
                    {new Date(camp.createdAt).toLocaleString()} · {camp.letterCount} letters
                    {camp.auditSummary
                      ? ` · ${camp.auditSummary.actionableAccounts} targets from audit`
                      : ''}
                  </p>
                </div>
                <span className="rounded border border-[rgba(22,158,111,0.3)] bg-[rgba(46,230,166,0.12)] px-2.5 py-1 text-xs font-semibold text-[var(--fw-signal-dim)]">
                  {camp.status}
                </span>
              </div>

              <div className="mt-5 space-y-2">
                {(camp.letters || []).map((letter) => (
                  <div
                    key={letter.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded bg-[var(--fw-paper)] px-3 py-2.5 text-sm"
                  >
                    <div>
                      <div className="font-semibold">{letter.furnisher}</div>
                      <div className="fw-mono text-[11px] text-[var(--fw-muted)]">{letter.trackingNumber}</div>
                    </div>
                    <div className="flex items-center gap-2 text-[var(--fw-muted)]">
                      <Package size={14} />
                      {letter.status}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      {latestLetters.length > 0 && (
        <p className="mt-8 text-sm text-[var(--fw-muted)]">
          Tip: when a furnisher answers, open Responses to analyze the reply — Pro auto-drafts the follow-up letter.
        </p>
      )}
    </div>
  );
}
