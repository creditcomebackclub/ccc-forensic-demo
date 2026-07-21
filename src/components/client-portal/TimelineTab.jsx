import React from 'react';
import TimelineEvent from './TimelineEvent';

// Ordered steps in the dispute lifecycle
const PHASE_STEPS = ['Prepared', 'Mailed', 'In Transit', 'Delivered', 'Awaiting Response', 'Resolved'];

function letterPhaseStep(l) {
  if (l.response_outcome === 'deleted' || l.response_outcome === 'received' || l.response_outcome === 'no_response') return 5; // Resolved
  if (l.tracking_status === 'Delivered') return 3; // Delivered → Awaiting Response
  if (l.tracking_status === 'Out for Delivery') return 2;
  if (l.tracking_status === 'In Transit') return 2;
  if (l.mailed_date) return 1; // Mailed
  return 0; // Prepared
}

function PhaseProgressBar({ letters }) {
  if (!letters || letters.length === 0) return null;

  // Group active (non-resolved) letters by phase
  const active = letters.filter(l => !l.response_outcome || l.response_outcome === '');
  const groups = {};
  letters.forEach(l => {
    const phase = l.phase || 'Unknown Phase';
    if (!groups[phase]) groups[phase] = [];
    groups[phase].push(l);
  });

  return (
    <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-5 shadow-sm mb-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-slate-900 mb-4">📊 Campaign Progress by Phase</div>
      <div className="space-y-5">
        {Object.entries(groups).map(([phase, phaseLetters]) => {
          // Use the furthest-along letter to represent the phase
          const maxStep = Math.max(...phaseLetters.map(letterPhaseStep));
          const currentLabel = PHASE_STEPS[maxStep] === 'Delivered' ? 'Awaiting Response' : PHASE_STEPS[maxStep];
          const resolved = phaseLetters.every(l => l.response_outcome);
          const deletions = phaseLetters.filter(l => l.response_outcome === 'deleted').length;

          return (
            <div key={phase}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-slate-800">{phase}</span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border
                  ${resolved && deletions > 0 ? 'bg-green-50 text-green-700 border-green-200'
                  : resolved ? 'bg-gray-50 text-gray-500 border-gray-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200'}`}>
                  {resolved && deletions > 0 ? `✓ ${deletions} Deleted` : resolved ? 'Complete' : currentLabel}
                </span>
              </div>
              {/* Step dots */}
              <div className="flex items-center gap-0">
                {PHASE_STEPS.map((step, idx) => {
                  const done = idx <= maxStep;
                  const active = idx === maxStep && !resolved;
                  return (
                    <React.Fragment key={step}>
                      <div className={`relative flex flex-col items-center`}>
                        <div className={`w-3 h-3 rounded-full border-2 transition-all
                          ${done && resolved ? 'bg-green-500 border-green-500'
                          : done && !active ? 'bg-slate-900 border-slate-900'
                          : active ? 'bg-amber-400 border-amber-500 ring-2 ring-amber-200'
                          : 'bg-white border-gray-300'}`}
                        />
                      </div>
                      {idx < PHASE_STEPS.length - 1 && (
                        <div className={`flex-1 h-0.5 mx-0.5 transition-all ${idx < maxStep ? (resolved ? 'bg-green-400' : 'bg-slate-900') : 'bg-gray-200'}`} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
              {/* Step labels */}
              <div className="flex justify-between mt-1">
                {PHASE_STEPS.map((step, idx) => (
                  <span key={step} className={`text-[9px] uppercase tracking-wide ${idx === maxStep ? 'text-slate-900 font-bold' : 'text-gray-400'}`}
                    style={{ width: idx === 0 ? 'auto' : idx === PHASE_STEPS.length - 1 ? 'auto' : undefined }}>
                    {step}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function TimelineTab({ timeline, letters, accessToken }) {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Dispute Journal</h2>
        <p className="text-sm text-gray-500 mt-1">A chronological record of every action in your campaign.</p>
      </div>

      {/* Phase Progress */}
      {letters && letters.length > 0 && (
        <PhaseProgressBar letters={letters} />
      )}

      {timeline.length === 0 ? (
        <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-10 text-center shadow-sm">
          <p className="text-sm text-gray-400">Your timeline will populate as your campaign progresses.</p>
        </div>
      ) : (
        <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-6 shadow-sm overflow-hidden">
          {timeline.map((event, i) => (
            <TimelineEvent key={i} {...event} accessToken={accessToken} />
          ))}
        </div>
      )}
    </div>
  );
}
