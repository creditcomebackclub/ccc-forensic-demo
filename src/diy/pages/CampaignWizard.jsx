import { useNavigate } from 'react-router-dom';
import {
  FileSearch,
  ListChecks,
  Mail,
  Upload,
  Waypoints,
} from 'lucide-react';
import UploadStep from '../steps/UploadStep';
import AuditStep from '../steps/AuditStep';
import SelectStep from '../steps/SelectStep';
import MailStep from '../steps/MailStep';
import TrackStep from '../steps/TrackStep';
import { useFieldwork } from '../state';

const NAV = [
  { id: 'upload', label: 'Upload', icon: Upload },
  { id: 'audit', label: 'Audit', icon: FileSearch },
  { id: 'select', label: 'Select', icon: ListChecks },
  { id: 'mail', label: 'Mail', icon: Mail },
  { id: 'track', label: 'Track', icon: Waypoints },
];

export default function CampaignWizard() {
  const navigate = useNavigate();
  const {
    user,
    audit,
    wizardStep,
    setWizardStep,
    selectedIds,
    setSelectedIds,
    letters,
    mailCredits,
    mailPhaseId,
    setMailPhaseId,
    letterOverrides,
    setLetterOverrides,
    completeUpload,
    completeMail,
  } = useFieldwork();

  const stepIndex = NAV.findIndex((n) => n.id === wizardStep);

  const canVisit = (id) => {
    if (id === 'upload') return true;
    if (!audit) return false;
    if (id === 'audit' || id === 'select') return true;
    if (id === 'mail') return selectedIds.length > 0;
    if (id === 'track') return letters.length > 0;
    return false;
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8">
        <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Campaign wizard</p>
        <h1 className="fw-display mt-2 text-3xl font-bold md:text-4xl">Dispute at the source</h1>
        <p className="mt-2 text-[var(--fw-muted)]">
          {mailCredits} mail credit{mailCredits === 1 ? '' : 's'} available · ~$12–15 Lob per Phase 1 or Phase 2 packet
        </p>
      </div>

      <nav className="mb-8 flex gap-1 overflow-x-auto pb-1">
        {NAV.map((item, idx) => {
          const Icon = item.icon;
          const active = item.id === wizardStep;
          const unlocked = canVisit(item.id);
          return (
            <button
              key={item.id}
              type="button"
              disabled={!unlocked}
              onClick={() => unlocked && setWizardStep(item.id)}
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

      <div className="mb-8 h-0.5 w-full bg-black/5">
        <div
          className="h-full bg-[var(--fw-signal-dim)] transition-all duration-500"
          style={{ width: `${((stepIndex + 1) / NAV.length) * 100}%` }}
        />
      </div>

      {wizardStep === 'upload' && <UploadStep onComplete={completeUpload} />}
      {wizardStep === 'audit' && audit && (
        <AuditStep audit={audit} onContinue={() => setWizardStep('select')} />
      )}
      {wizardStep === 'select' && audit && (
        <SelectStep
          audit={audit}
          selectedIds={selectedIds}
          setSelectedIds={setSelectedIds}
          onContinue={() => setWizardStep('mail')}
        />
      )}
      {wizardStep === 'mail' && audit && (
        <MailStep
          user={user}
          audit={audit}
          selectedIds={selectedIds}
          mailCredits={mailCredits}
          initialPhaseId={mailPhaseId}
          letterOverrides={letterOverrides}
          onPhaseChange={setMailPhaseId}
          onComplete={(newLetters) => {
            completeMail(newLetters);
            setLetterOverrides({});
            setMailPhaseId('phase1');
          }}
        />
      )}
      {wizardStep === 'track' && (
        <TrackStep
          user={user}
          mailed={letters}
          onBackHome={() => navigate('/app/campaigns')}
        />
      )}
    </div>
  );
}
