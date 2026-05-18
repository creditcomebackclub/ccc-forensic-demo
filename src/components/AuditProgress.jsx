import React, { useState, useEffect } from 'react';
import { Loader2, CheckCircle2 } from 'lucide-react';

const STEPS = [
  'Parsing 3-bureau credit report',
  'Extracting tradelines + status codes',
  'Cross-bureau reconciliation',
  'Metro 2 field violation scan',
  'FCRA §1681s-2 compliance check',
  'Account classification (Type A / B / C)',
  'Violation severity matrix',
  'Phase 1 letter strategy assembly',
];

export default function AuditProgress({ fileName }) {
  const [currentStep, setCurrentStep] = useState(0);

  // Animate through steps while we wait for the API response
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const progress = ((currentStep + 1) / STEPS.length) * 100;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="bg-white border border-border rounded p-8">
        <div className="flex items-center gap-3 mb-1">
          <Loader2 size={18} className="animate-spin text-gold" />
          <h2 className="ccc-display text-xl text-ink font-medium">
            Running forensic audit
          </h2>
        </div>
        <p className="text-[12px] text-ink-muted">{fileName}</p>

        <div className="mt-6 h-1 rounded-full overflow-hidden bg-gray-100">
          <div
            className="h-full bg-gold transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between text-[10px] uppercase tracking-wider mt-1.5 text-ink-faint">
          <span>Working...</span>
          <span className="ccc-mono">
            {currentStep + 1} / {STEPS.length}
          </span>
        </div>

        <div className="mt-6 space-y-2">
          {STEPS.map((s, i) => (
            <div
              key={i}
              className="flex items-center gap-3 text-[12px] transition-opacity"
              style={{ opacity: i <= currentStep ? 1 : 0.3 }}
            >
              <div
                className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                style={{
                  backgroundColor: i < currentStep ? '#1B2A4A' : i === currentStep ? '#C9A84C' : 'transparent',
                  border: i > currentStep ? '1px solid #E8E6DF' : 'none',
                }}
              >
                {i < currentStep && <CheckCircle2 size={10} color="#FFF" strokeWidth={3} />}
                {i === currentStep && (
                  <Loader2 size={10} className="animate-spin" color="#FFF" strokeWidth={2.5} />
                )}
              </div>
              <span style={{ color: i <= currentStep ? '#1A1A1A' : '#9B9B95' }}>{s}</span>
            </div>
          ))}
        </div>

        <p className="text-[10px] text-ink-faint mt-6 italic">
          Claude is reading your report. This typically takes 30–60 seconds.
        </p>
      </div>
    </div>
  );
}
