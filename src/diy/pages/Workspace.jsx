import {
  FileSearch,
  Home,
  ListChecks,
  Mail,
  RotateCcw,
  Upload,
  Waypoints,
} from 'lucide-react';
import UploadStep from '../steps/UploadStep';
import AuditStep from '../steps/AuditStep';
import SelectStep from '../steps/SelectStep';
import MailStep from '../steps/MailStep';
import TrackStep from '../steps/TrackStep';

const NAV = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'audit', label: 'Audit', icon: FileSearch },
  { id: 'select', label: 'Select', icon: ListChecks },
  { id: 'mail', label: 'Mail', icon: Mail },
  { id: 'track', label: 'Track', icon: Waypoints },
];

export default function Workspace({
  user,
  audit,
  step,
  setStep,
  selectedIds,
  setSelectedIds,
  mailed,
  onUploadComplete,
  onReviewSelect,
  onCompose,
  onMailed,
  onReset,
  onHome,
}) {
  const stepIndex = NAV.findIndex((n) => n.id === step);

  const canVisit = (id) => {
    if (id === 'upload') return true;
    if (!audit) return false;
    if (id === 'audit') return true;
    if (id === 'select') return true;
    if (id === 'mail') return selectedIds.length > 0;
    if (id === 'track') return mailed.length > 0;
    return false;
  };

  return (
    <div className="min-h-screen bg-[var(--fw-paper)] text-[var(--fw-ink)]">
      <header className="sticky top-0 z-30 border-b border-[var(--fw-line)] bg-[rgba(242,245,247,0.92)] backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-4">
            <button type="button" onClick={onHome} className="fw-display text-xl font-bold">
              Fieldwork<span className="text-[var(--fw-signal-dim)]">.</span>
            </button>
            <div className="hidden text-sm text-[var(--fw-muted)] sm:block">
              {user.name}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onHome}
              className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm text-[var(--fw-muted)] hover:bg-black/5 hover:text-[var(--fw-ink)]"
            >
              <Home size={15} /> Home
            </button>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm text-[var(--fw-muted)] hover:bg-black/5 hover:text-[var(--fw-ink)]"
            >
              <RotateCcw size={15} /> Reset demo
            </button>
          </div>
        </div>

        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 pb-3 md:px-6">
          {NAV.map((item, idx) => {
            const Icon = item.icon;
            const active = item.id === step;
            const unlocked = canVisit(item.id);
            return (
              <button
                key={item.id}
                type="button"
                disabled={!unlocked}
                onClick={() => unlocked && setStep(item.id)}
                className={`inline-flex items-center gap-2 rounded px-3 py-2 text-sm font-semibold transition ${
                  active
                    ? 'bg-[var(--fw-ink)] text-white'
                    : unlocked
                      ? 'text-[var(--fw-ink)] hover:bg-black/5'
                      : 'cursor-not-allowed text-black/25'
                }`}
              >
                <span className={`fw-mono text-[10px] ${active ? 'text-[var(--fw-signal)]' : 'opacity-50'}`}>
                  0{idx + 1}
                </span>
                <Icon size={15} />
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="h-0.5 w-full bg-black/5">
          <div
            className="h-full bg-[var(--fw-signal-dim)] transition-all duration-500"
            style={{ width: `${((stepIndex + 1) / NAV.length) * 100}%` }}
          />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 md:px-6 md:py-10">
        {step === 'upload' && <UploadStep onComplete={onUploadComplete} />}
        {step === 'audit' && audit && (
          <AuditStep audit={audit} onContinue={onReviewSelect} />
        )}
        {step === 'select' && audit && (
          <SelectStep
            audit={audit}
            selectedIds={selectedIds}
            setSelectedIds={setSelectedIds}
            onContinue={onCompose}
          />
        )}
        {step === 'mail' && audit && (
          <MailStep
            user={user}
            audit={audit}
            selectedIds={selectedIds}
            onComplete={onMailed}
          />
        )}
        {step === 'track' && (
          <TrackStep user={user} mailed={mailed} onBackHome={onHome} />
        )}
      </main>
    </div>
  );
}
