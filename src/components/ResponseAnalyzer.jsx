import React, { useState } from 'react';
import { X, Upload, FileText, AlertCircle, CheckCircle, Zap } from 'lucide-react';
import { supabase } from '../utils/supabase';

const SYSTEM_PROMPT = `You are a forensic credit compliance analyst for Credit Comeback Club operating under the Setup & Spike methodology. You are performing Phase 2 analysis — measuring a furnisher's response against the original Phase 1 dispute demands.

LEGAL STANDARD: Johnson v. MBNA America Bank, 357 F.3d 426 (4th Cir. 2004) — a reasonable reinvestigation requires more than parroting existing database entries. A data match is NOT an investigation. Seamans v. Temple University — furnisher must flag account as disputed once on notice.

RESPONSE CLASSIFICATION:
- FORM_LETTER: Response does not address specific Metro 2 field violations cited. Uses generic "verified accurate" language without documentation. Classic inadequate investigation.
- PARTIAL_FIX: Furnisher corrected some but not all violations. Remaining violations are still actionable.
- WRONG_FRAMEWORK: Furnisher treated this as a bureau-forwarded e-OSCAR dispute rather than a direct furnisher dispute.
- NON_RESPONSE: No response received within 30-day statutory window.
- ADEQUATE: Furnisher actually investigated and corrected all cited violations with documentation.

ANALYSIS REQUIREMENTS:
1. Read the Phase 1 letter — extract every specific violation alleged, every Metro 2 field cited, every demand made
2. Read the furnisher response — determine what they actually addressed vs. ignored
3. For each original demand: ADDRESSED, IGNORED, PARTIALLY_ADDRESSED, or ADMITTED
4. Classify the overall response
5. Identify any admissions in the response that strengthen Phase 3
6. Generate three bureau-specific Phase 3 CRA letters (Equifax, Experian, TransUnion)

PHASE 3 LETTER REQUIREMENTS:
- Opens by establishing the CRA-triggered reinvestigation duty under 15 U.S.C. 1681s-2(b)
- States that a direct furnisher dispute was sent (Exhibit A) and received an inadequate response (Exhibit B)
- Rebuilds the full violation stack with added weight of furnisher investigative failure
- Cites Johnson v. MBNA for the inadequate investigation standard
- Demands correction or deletion within 30 days
- Cites 15 U.S.C. 1681n for willful noncompliance — $100 to $1,000 per violation plus punitive damages
- Tone: forensic and legal. Demands not requests. No emotional language.
- Signature block: Consumer — All Rights Reserved
- Each letter addressed to the correct bureau

RESPOND IN THIS EXACT JSON FORMAT:
{
  "classification": "FORM_LETTER|PARTIAL_FIX|WRONG_FRAMEWORK|NON_RESPONSE|ADEQUATE",
  "summary": "2-3 sentence plain-language summary of what the furnisher did and why it fails",
  "demandAnalysis": [
    {
      "demand": "original demand from Phase 1 letter",
      "outcome": "ADDRESSED|IGNORED|PARTIALLY_ADDRESSED|ADMITTED",
      "notes": "what the furnisher said or did not say about this"
    }
  ],
  "admissions": ["any statements in the response that help the consumer case"],
  "phase3Leverage": "the single strongest argument for Phase 3 based on this response",
  "letters": {
    "equifax": "full Phase 3 letter text addressed to Equifax",
    "experian": "full Phase 3 letter text addressed to Experian",
    "transunion": "full Phase 3 letter text addressed to TransUnion"
  }
}`;

async function analyzeNonResponse({ phase1Html, clientName, furnisher, accountId, mailedDate }) {
  const apiKey = localStorage.getItem('anthropic_api_key');
  if (!apiKey) throw new Error('API key not set — go to Settings to add your Anthropic API key');

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const mailed = mailedDate ? new Date(mailedDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'unknown date';

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Today: ${today}\nClient: ${clientName}\nFurnisher: ${furnisher}\nAccount: ${accountId}\nLetter mailed: ${mailed}\n\nEXHIBIT A — PHASE 1 DISPUTE LETTER (no response was received within 30 days):\n${phase1Html}\n\nThe furnisher failed to respond within the 30-day statutory window. This is an automatic 15 U.S.C. 1681s-2(b) violation. Classify this as NON_RESPONSE and generate three Phase 3 CRA letters citing the failure to respond. Return only valid JSON matching the specified format.`
        }
      ]
    }
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages,
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Analysis failed');
  }

  const data = await res.json();
  const text = data.content.map((b) => b.text || '').join('');
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function analyzeResponse({ phase1Html, responseBase64, responseType, clientName, furnisher, accountId }) {
  const apiKey = localStorage.getItem('anthropic_api_key');
  if (!apiKey) throw new Error('API key not set — go to Settings to add your Anthropic API key');

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `Today: ${today}\nClient: ${clientName}\nFurnisher: ${furnisher}\nAccount: ${accountId}\n\nEXHIBIT A — PHASE 1 DISPUTE LETTER:\n${phase1Html}\n\nEXHIBIT B — FURNISHER RESPONSE (attached document):`
        },
        {
          type: 'document',
          source: { type: 'base64', media_type: responseType, data: responseBase64 }
        },
        {
          type: 'text',
          text: 'Perform Phase 2 analysis. Return only valid JSON matching the specified format.'
        }
      ]
    }
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages,
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || 'Analysis failed');
  }

  const data = await res.json();
  const text = data.content.map((b) => b.text || '').join('');
  const clean = text.replace(/```json|```/g, '').trim();
  return JSON.parse(clean);
}

async function savePhase3Letters(analysis, clientName, furnisher, accountId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const today = new Date().toISOString().slice(0, 10);
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'unknown';
  const bureaus = ['equifax', 'experian', 'transunion'];

  for (const bureau of bureaus) {
    const letterText = analysis.letters[bureau];
    if (!letterText) continue;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:12px;line-height:1.6;max-width:750px;margin:40px auto;padding:0 40px;color:#1a1a1a;}pre{white-space:pre-wrap;font-family:Arial,sans-serif;}</style></head><body><pre>${letterText.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</pre></body></html>`;
    const id = slug(clientName) + '__' + slug(furnisher) + '__phase3-' + bureau + '__' + today;
    const { error } = await supabase.from('letters').upsert({
      id,
      user_id: user.id,
      created_by: user.id,
      client_name: clientName,
      furnisher,
      account_id: accountId,
      phase: 'Phase 3 — ' + bureau.charAt(0).toUpperCase() + bureau.slice(1),
      type: null,
      saved_at: new Date().toISOString(),
      date: today,
      html,
      mailed_date: null,
      response_outcome: null,
      response_date: null,
    });
    if (error) throw error;
  }
}

const CLASSIFICATION_CONFIG = {
  FORM_LETTER: { label: 'Form Letter — Inadequate Investigation', tone: 'red' },
  PARTIAL_FIX: { label: 'Partial Fix — Remaining Violations Actionable', tone: 'amber' },
  WRONG_FRAMEWORK: { label: 'Wrong Framework — Treated as e-OSCAR Dispute', tone: 'red' },
  NON_RESPONSE: { label: 'Non-Response — Automatic Violation', tone: 'red' },
  ADEQUATE: { label: 'Adequate Response — Violations Corrected', tone: 'green' },
};

const OUTCOME_CONFIG = {
  ADDRESSED: { label: 'Addressed', color: '#15803D' },
  IGNORED: { label: 'Ignored', color: '#DC2626' },
  PARTIALLY_ADDRESSED: { label: 'Partial', color: '#D97706' },
  ADMITTED: { label: 'Admitted', color: '#1B2A4A' },
};

export default function ResponseAnalyzer({ letter, onClose, onSaved }) {
  const isNonResponse = letter.responseOutcome === 'no_response';
  const [step, setStep] = useState(isNonResponse ? 'nonresponse' : 'upload');
  const [file, setFile] = useState(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const handleFile = (f) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(f.type)) { setError('Please upload a PDF or image (JPG, PNG, WEBP)'); return; }
    setFile(f);
    setError(null);
  };

  const handleDrop = (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); };

  const handleAnalyze = async () => {
    if (!file) return;
    setAnalyzing(true);
    setError(null);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const result = await analyzeResponse({
        phase1Html: letter.html,
        responseBase64: base64,
        responseType: file.type,
        clientName: letter.clientName,
        furnisher: letter.furnisher,
        accountId: letter.accountId || '',
      });
      setAnalysis(result);
      setStep('results');
    } catch (e) {
      console.error('Analysis failed', e);
      setError(e.message || 'Analysis failed — check your API key and try again');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleSave = async () => {
    if (!analysis) return;
    setSaving(true);
    try {
      await savePhase3Letters(analysis, letter.clientName, letter.furnisher, letter.accountId || '');
      setSaved(true);
      setTimeout(() => { onSaved(); onClose(); }, 1500);
    } catch (e) {
      console.error('Save failed', e);
      setError('Could not save: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const cfg = analysis ? CLASSIFICATION_CONFIG[analysis.classification] : null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded border border-border w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-navy rounded-t">
          <div>
            <div className="text-white text-[14px] font-medium ccc-display">Phase 2 Response Analyzer</div>
            <div className="text-gold text-[11px] uppercase tracking-wider mt-0.5">{letter.furnisher} · {letter.clientName}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} strokeWidth={1.75} /></button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {step === 'nonresponse' && (
            <div>
              <div className="rounded p-4 border mb-5" style={{ backgroundColor: '#FEF2F2', borderColor: '#FECACA' }}>
                <div className="text-[11px] uppercase tracking-wider font-medium text-red-600 mb-1">Non-Response Confirmed</div>
                <div className="text-[13px] text-ink font-medium">{letter.furnisher} failed to respond within the 30-day statutory window</div>
                <div className="text-[12px] text-ink-muted mt-1">This is an automatic 15 U.S.C. §1681s-2(b) violation. Claude will generate three Phase 3 CRA letters citing the non-response as the primary violation — no document upload needed.</div>
              </div>
              {letter.mailedDate && (
                <div className="text-[12px] text-ink-muted mb-4">
                  Letter mailed: <span className="text-ink font-medium">{letter.mailedDate}</span> · 30-day window expired
                </div>
              )}
              {error && <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2 mb-4">{error}</div>}
              {analyzing && (
                <div className="text-center py-4">
                  <div className="text-[13px] text-ink-muted mb-1">Generating Phase 3 non-response letters…</div>
                  <div className="text-[11px] text-ink-faint">Citing blown 30-day window · §1681s-2(b) automatic violation</div>
                </div>
              )}
            </div>
          )}

          {step === 'upload' && (
            <div>
              <p className="text-[13px] text-ink-muted mb-5 max-w-xl">
                Upload the furnisher response. The original Phase 1 letter is Exhibit A — attached automatically.
                Claude will analyze against Johnson v. MBNA and generate three Phase 3 CRA letters.
              </p>
              <div
                onDrop={handleDrop}
                onDragOver={(e) => e.preventDefault()}
                onClick={() => document.getElementById('response-file-input').click()}
                className="border-2 border-dashed border-border rounded p-10 text-center cursor-pointer hover:border-navy transition-colors"
              >
                <Upload size={24} className="mx-auto mb-3 text-ink-faint" strokeWidth={1.5} />
                <div className="text-[13px] text-ink font-medium mb-1">
                  {file ? file.name : 'Drop response here or click to upload'}
                </div>
                <div className="text-[11px] text-ink-muted">PDF · JPG · PNG · WEBP</div>
                <input id="response-file-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" className="hidden"
                  onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); }} />
              </div>
              {file && (
                <div className="mt-4 flex items-center gap-2 text-[12px] text-ink">
                  <FileText size={14} strokeWidth={1.75} className="text-navy" />
                  <span className="font-medium">{file.name}</span>
                  <span className="text-ink-muted">({(file.size / 1024).toFixed(0)} KB)</span>
                </div>
              )}
              {error && <div className="mt-4 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>}
              {analyzing && (
                <div className="mt-6 text-center">
                  <div className="text-[13px] text-ink-muted mb-1">Analyzing response against Phase 1 demands…</div>
                  <div className="text-[11px] text-ink-faint">Applying Johnson v. MBNA standard · Generating Phase 3 letters</div>
                </div>
              )}
            </div>
          )}

          {step === 'results' && analysis && (
            <div className="space-y-5">
              <div className="rounded p-4 border" style={{
                backgroundColor: cfg?.tone === 'red' ? '#FEF2F2' : cfg?.tone === 'amber' ? '#FFFBEB' : '#F0FDF4',
                borderColor: cfg?.tone === 'red' ? '#FECACA' : cfg?.tone === 'amber' ? '#FDE68A' : '#BBF7D0',
              }}>
                <div className="text-[11px] uppercase tracking-wider font-medium mb-1"
                  style={{ color: cfg?.tone === 'red' ? '#DC2626' : cfg?.tone === 'amber' ? '#D97706' : '#15803D' }}>
                  Response Classification
                </div>
                <div className="text-[14px] font-medium text-ink">{cfg?.label}</div>
                <div className="text-[12px] text-ink-muted mt-1">{analysis.summary}</div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Demand Analysis</div>
                <div className="border border-border rounded overflow-hidden">
                  <div className="grid grid-cols-12 px-4 py-2 bg-navy">
                    <div className="col-span-6 text-[10px] uppercase tracking-wider text-white font-medium">Original Demand</div>
                    <div className="col-span-2 text-[10px] uppercase tracking-wider text-white font-medium">Outcome</div>
                    <div className="col-span-4 text-[10px] uppercase tracking-wider text-white font-medium">Notes</div>
                  </div>
                  {(analysis.demandAnalysis || []).map((d, i) => (
                    <div key={i} className="grid grid-cols-12 px-4 py-2 border-t border-border" style={{ backgroundColor: i % 2 === 0 ? '#FFFFFF' : '#F9FAFB' }}>
                      <div className="col-span-6 text-[12px] text-ink pr-3">{d.demand}</div>
                      <div className="col-span-2">
                        <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-sm font-medium"
                          style={{ backgroundColor: (OUTCOME_CONFIG[d.outcome]?.color || '#666') + '20', color: OUTCOME_CONFIG[d.outcome]?.color || '#666' }}>
                          {OUTCOME_CONFIG[d.outcome]?.label || d.outcome}
                        </span>
                      </div>
                      <div className="col-span-4 text-[11px] text-ink-muted">{d.notes}</div>
                    </div>
                  ))}
                </div>
              </div>

              {analysis.admissions && analysis.admissions.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Admissions in Response</div>
                  <ul className="space-y-1">
                    {analysis.admissions.map((a, i) => (
                      <li key={i} className="text-[12px] text-ink border-l-2 border-gold pl-3 py-0.5">{a}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="bg-navy rounded p-4">
                <div className="text-[10px] uppercase tracking-wider text-gold font-medium mb-1">Phase 3 Primary Argument</div>
                <div className="text-[12px] text-white leading-relaxed">{analysis.phase3Leverage}</div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Phase 3 Letters Generated</div>
                <div className="grid grid-cols-3 gap-3">
                  {['equifax', 'experian', 'transunion'].map((b) => (
                    <div key={b} className="border border-border rounded p-3 text-center">
                      <div className="text-[11px] uppercase tracking-wider text-ink font-medium mb-1">{b.charAt(0).toUpperCase() + b.slice(1)}</div>
                      <div className="text-[10px]" style={{ color: analysis.letters[b] ? '#15803D' : '#9CA3AF' }}>
                        {analysis.letters[b] ? '✓ Ready' : '—'}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {error && <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <button onClick={onClose} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">
            {saved ? 'Close' : 'Cancel'}
          </button>
          <div className="flex items-center gap-3">
            {step === 'nonresponse' && !saved && (
              <button
                onClick={async () => {
                  setAnalyzing(true);
                  setError(null);
                  try {
                    const result = await analyzeNonResponse({
                      phase1Html: letter.html,
                      clientName: letter.clientName,
                      furnisher: letter.furnisher,
                      accountId: letter.accountId || '',
                      mailedDate: letter.mailedDate,
                    });
                    setAnalysis(result);
                    setStep('results');
                  } catch (e) {
                    setError(e.message || 'Generation failed');
                  } finally {
                    setAnalyzing(false);
                  }
                }}
                disabled={analyzing}
                className="flex items-center gap-2 px-5 py-2 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                style={{ backgroundColor: analyzing ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C' }}
              >
                <Zap size={13} strokeWidth={2} />
                {analyzing ? 'Generating…' : 'Generate Phase 3 Letters'}
              </button>
            )}

            {step === 'upload' && (
              <button onClick={handleAnalyze} disabled={!file || analyzing}
                className="flex items-center gap-2 px-5 py-2 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                style={{ backgroundColor: (!file || analyzing) ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C' }}>
                <Zap size={13} strokeWidth={2} />
                {analyzing ? 'Analyzing…' : 'Run Phase 2 Analysis'}
              </button>
            )}
            {step === 'results' && !saved && (
              <>
                <button onClick={() => { setStep('upload'); setAnalysis(null); setFile(null); }}
                  className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">Re-analyze</button>
                <button onClick={handleSave} disabled={saving}
                  className="px-5 py-2 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                  style={{ backgroundColor: saving ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C' }}>
                  {saving ? 'Saving…' : 'Save Phase 3 Letters'}
                </button>
              </>
            )}
            {saved && (
              <div className="flex items-center gap-2 text-[12px] text-green-700">
                <CheckCircle size={14} strokeWidth={1.75} /> Phase 3 letters saved
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
