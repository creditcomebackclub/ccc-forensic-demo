import React from 'react';
import { LETTER_STAGES, letterStageIndex } from './clientDetailUtils';
import {
  hasMailedContentWarning,
  hasMailedDeliveryEvidence,
  letterGenerationState,
  letterSignatureState,
} from '../../utils/letterGeneration.js';

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  faint: '#9CA3AF',
  line: '#E5E9F0',
};

/** Labeled mail lifecycle rail — never mystery dots alone. */
export default function MailStageRail({ letter }) {
  const generation = letterGenerationState(letter);
  const mailedContentWarning = hasMailedContentWarning(letter);
  const signatureState = generation === 'ready' ? letterSignatureState(letter) : null;
  const signatureRequired = signatureState && signatureState !== 'embedded' && !hasMailedDeliveryEvidence(letter);
  if (generation !== 'ready' && !mailedContentWarning) {
    const failed = generation === 'failed';
    return (
      <div
        className="text-[9px] uppercase tracking-wider font-semibold px-2 py-1 rounded-md"
        style={{ color: failed ? '#B91C1C' : '#6B7280', background: failed ? '#FEF2F2' : '#F3F4F6', border: `1px solid ${failed ? '#FECACA' : '#E5E7EB'}` }}
        title={failed ? 'Generation failed — mailing blocked' : 'Claude generation is still running'}
      >
        {failed ? 'Generation failed' : 'Generating'}
      </div>
    );
  }
  if (signatureRequired) {
    return (
      <div
        className="text-[9px] uppercase tracking-wider font-semibold px-2 py-1 rounded-md"
        style={{ color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA' }}
        title="A valid embedded client signature is required before mailing"
      >
        Signature required
      </div>
    );
  }
  const idx = letterStageIndex(letter);
  const current = LETTER_STAGES[idx];
  const historicalSignatureWarning = signatureState && signatureState !== 'embedded' && hasMailedDeliveryEvidence(letter);
  const title = mailedContentWarning
    ? `Mail stage: ${current}. The historical letter has a content warning and cannot be retried or overwritten.`
    : historicalSignatureWarning
      ? `Mail stage: ${current}. The stored HTML preview uses an unavailable historical signature image; the mailed PDF is authoritative.`
    : 'Mail stage: ' + current;

  return (
    <div className="flex flex-col gap-1 shrink-0" title={title}>
      <div className="flex items-center">
        {LETTER_STAGES.map((s, i) => (
          <React.Fragment key={s}>
            {i > 0 && (
              <div style={{ width: 10, height: 2, background: i <= idx ? T.navy : T.line }} />
            )}
            <div
              title={s}
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: i <= idx ? T.navy : '#fff',
                border: i <= idx ? 'none' : '1.5px solid #D6DCE6',
                boxSizing: 'border-box',
                boxShadow: i === idx ? `0 0 0 3px rgba(27,42,74,0.12)` : 'none',
              }}
            />
          </React.Fragment>
        ))}
      </div>
      <div className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: idx >= 2 ? T.navy : T.faint }}>
        {current}
      </div>
    </div>
  );
}
