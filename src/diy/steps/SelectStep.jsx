import { ArrowRight } from 'lucide-react';

export default function SelectStep({ audit, selectedIds, setSelectedIds, onContinue }) {
  const toggle = (id) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectRecommended = () => {
    setSelectedIds(audit.accounts.filter((a) => a.priority === 'high' || a.priority === 'medium').map((a) => a.id));
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Step 03 · Select</p>
          <h1 className="fw-display mt-2 text-4xl font-bold md:text-5xl">Pick your disputes</h1>
          <p className="mt-3 max-w-2xl text-lg text-[var(--fw-muted)]">
            You’re in control. We recommend high-signal furnisher targets first — expand if you want a wider wave.
          </p>
        </div>
        <button type="button" onClick={selectRecommended} className="text-sm font-semibold text-[var(--fw-sea)] hover:underline">
          Select recommended
        </button>
      </div>

      <div className="mt-8 space-y-3">
        {audit.accounts.map((account) => {
          const checked = selectedIds.includes(account.id);
          return (
            <label
              key={account.id}
              className={`flex cursor-pointer gap-4 rounded-lg border bg-white p-4 transition md:p-5 ${
                checked ? 'border-[var(--fw-ink)] shadow-[0_0_0_1px_var(--fw-ink)]' : 'border-[var(--fw-line)]'
              }`}
            >
              <input
                type="checkbox"
                className="fw-check mt-1"
                checked={checked}
                onChange={() => toggle(account.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="fw-display text-xl font-bold">{account.furnisher}</div>
                  <span className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-muted)]">
                    {account.priority} priority · {account.violations.length} issue{account.violations.length === 1 ? '' : 's'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-[var(--fw-muted)]">
                  {account.violations.map((v) => v.title).join(' · ')}
                </p>
              </div>
            </label>
          );
        })}
      </div>

      <div className="sticky bottom-4 mt-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[var(--fw-line)] bg-white/95 p-4 shadow-lg backdrop-blur">
        <div className="text-sm">
          <span className="font-bold">{selectedIds.length}</span> account{selectedIds.length === 1 ? '' : 's'} selected
          <span className="text-[var(--fw-muted)]"> · ~${(selectedIds.length * 8.9).toFixed(2)} est. certified postage</span>
        </div>
        <button
          type="button"
          disabled={selectedIds.length === 0}
          onClick={onContinue}
          className="fw-btn-ink"
        >
          Compose letters <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );
}
