import React, { useState } from 'react';
import { X, Upload, FileText, AlertCircle, CheckCircle, Zap } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { runPhase2Job } from '../utils/phase2Jobs';
import { ANALYZABLE_TYPES, CONVERTED_PREFIX, isAnalyzable, slugBase, UNSUPPORTED_TYPE_MESSAGE, uploadResponseBatch, validateBatch } from '../utils/responseFiles';
import { normalizeFurnisher, lastFour } from '../utils/diffEngine';

async function savePhase3Letters(analysis, clientName, furnisher, accountId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const today = new Date().toISOString().slice(0, 10);
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'unknown';

  // Resolve which bureaus this account actually reports on. A CRA can't
  // reinvestigate a tradeline it doesn't carry, so Phase 3 letters must only
  // go to bureaus with real evidence the account is there.
  //
  // AMBIGUITY MUST NOT EXPAND OUTPUT. The old code, on any lookup failure,
  // fell back to generating for ALL THREE bureaus — responding to LESS
  // information with MORE output, the same failure shape as the unparsed-
  // ledger and DOFD-direction bugs. It also keyed on account_id (acct_N),
  // which is POSITIONAL and reassigned every audit run, so a Phase 1
  // letter's stored id resolved to whatever account now occupies that slot —
  // a different account with a wrong bureau set. Now: match on stable
  // identity, and if the account cannot be confidently resolved to a single
  // audit account with a bureau list, BLOCK generation and surface to admin
  // rather than guess.
  //
  // NOTE: furnisher-name matching is a stopgap. Name is unreliable for the
  // exact accounts with the richest violations (cross-bureau entity-name
  // conflicts) and for clients with multiple tradelines from one furnisher.
  // The durable fix is a persistent client_accounts UUID per real tradeline
  // (see the account-identity plan). Until that lands, the block-on-failure
  // behavior here is what keeps a bad/ambiguous match from misrouting.
  let account = null;
  let resolutionError = null;
  try {
    const { data: audits } = await supabase
      .from('audits')
      .select('audit')
      .eq('client_name', clientName)
      .order('saved_at', { ascending: false })
      .limit(1);
    const accounts = (audits && audits.length > 0) ? (audits[0].audit?.accounts || []) : [];
    if (accounts.length === 0) {
      resolutionError = 'no audit on file for this client';
    } else {
      // Never match on a.id (positional). Masked account number first (stable
      // when present), then furnisher name, narrowed by last-4 for
      // multi-tradeline furnishers.
      account = accountId ? accounts.find(a => a.accountNumberMasked && a.accountNumberMasked === accountId) : null;
      if (!account) {
        const byFurnisher = accounts.filter(a => normalizeFurnisher(a.furnisher) === normalizeFurnisher(furnisher));
        if (byFurnisher.length === 1) {
          account = byFurnisher[0];
        } else if (byFurnisher.length > 1) {
          const l4 = lastFour(accountId);
          account = l4 ? (byFurnisher.find(a => lastFour(a.accountNumberMasked) === l4) || null) : null;
          if (!account) resolutionError = `${byFurnisher.length} accounts from "${furnisher}" and none could be disambiguated by account number`;
        } else {
          resolutionError = `no account matching "${furnisher}" in the latest audit (furnisher name may have changed since Phase 1, or the account was sold/rebranded)`;
        }
      }
    }
  } catch (e) {
    resolutionError = 'the account lookup query failed (' + (e.message || e) + ')';
  }

  const bureauMap = { 'EQ': 'equifax', 'EXP': 'experian', 'TU': 'transunion' };
  const activeBureaus = (account && account.bureaus)
    ? account.bureaus.map(b => bureauMap[b]).filter(Boolean)
    : [];

  // BLOCK — do not generate any letter unless we have positive evidence of at
  // least one reporting bureau. No default-to-all-three.
  if (activeBureaus.length === 0) {
    throw new Error(
      `Cannot resolve reporting bureaus for "${furnisher}" — ${resolutionError || 'the matched account has no bureau list'}. ` +
      `Re-link this account to its current audit entry before generating Phase 3 letters. No letters were created.`
    );
  }
  console.log('Phase 3 bureau resolution — furnisher:', furnisher, 'matched:', account?.id, 'bureaus:', activeBureaus);

  // Look up client signature
  let signatureData = null;
  try {
    const { data: cp } = await supabase.from('client_profiles').select('signature_data').eq('full_name', clientName).limit(1);
    if (cp && cp.length > 0 && cp[0].signature_data) {
      signatureData = cp[0].signature_data;
    }
    if (!signatureData) {
      const { data: cm } = await supabase.from('clients').select('lpoa_signature_data').eq('name', clientName).limit(1);
      if (cm && cm.length > 0 && cm[0].lpoa_signature_data?.signatureUrl) {
        signatureData = cm[0].lpoa_signature_data.signatureUrl;
      }
    }
  } catch(e) { console.warn('Could not look up signature:', e); }

  for (const bureau of activeBureaus) {
    let html = analysis.letters[bureau];
    if (!html) continue;
    // Strip any Exhibit C references — only A and B are physically attached
    html = html.replace(/\n?Exhibit C[^\n]*/gi, '').replace(/;?\s*Exhibit C[^;\n]*/gi, '');

    // Inject signature image if available — replace ONLY the ___ underscore
    // run, never the rest of the line. The previous pattern was
    // /_{3,}[^\n]*/ , and when the model emitted the signature block on a
    // single line (which the prompt's own conciseness rule encourages) that
    // [^\n]* swallowed the printed name, "Consumer — All Rights Reserved",
    // the certified-mail notation, the enclosures list, and </body></html>
    // — producing letters that ended mid-signature-block with no closing
    // tags. Six real letters were generated this way and three were mailed.
    // Whether a letter survived depended entirely on where the model
    // happened to place a newline.
    if (signatureData) {
      const sigHtml = '<img src="' + signatureData + '" style="max-height:60px;max-width:220px;display:block;" />';
      html = html.replace(/_{3,}/, sigHtml);
    }

    // If the model output plain text instead of HTML (fallback safety), wrap it
    if (!html.trim().startsWith('<!') && !html.trim().startsWith('<html')) {
      const escaped = html.replace(/</g,'&lt;').replace(/>/g,'&gt;');
      html = '<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;font-size:12px;line-height:1.6;max-width:750px;margin:40px auto;padding:0 40px;color:#1a1a1a;}pre{white-space:pre-wrap;font-family:Arial,sans-serif;}</style></head><body><pre>' + escaped + '</pre></body></html>';
    }

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
      summary: analysis.summary || null,
      mailed_date: null,
      response_outcome: null,
      response_date: null,
    });
    if (error) throw error;
  }
}

const CLASSIFICATION_CONFIG = {
  FORM_LETTER: { label: 'Form Letter — Inadequate Investigation', tone: 'red' },
  STATEMENT_COPY: { label: 'Statement Copies Only — No Source Substantiation', tone: 'red' },
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
  // A previously stored analysis opens straight into results — unless fresh
  // files were explicitly passed in for (re-)analysis
  const storedAnalysis = !letter._preloadedFiles?.length && letter.phase2Analysis ? letter.phase2Analysis : null;
  const [step, setStep] = useState(storedAnalysis ? 'results' : (isNonResponse ? 'nonresponse' : 'upload'));
  // Every page/photo of ONE response — analyzed together as a single
  // document, not one call per page. See src/utils/responseFiles.js. When
  // preloaded from the responses bucket these are lightweight {name} stand-ins
  // (no bytes fetched into the browser) — see DocumentManager.handleAnalyze.
  const [files, setFiles] = useState(letter._preloadedFiles || []);
  // True only for the initial preload from storage — cleared on Re-analyze so
  // a freshly-picked file set doesn't get ignored in favor of stale paths.
  const [useStoredPaths, setUseStoredPaths] = useState(!!(letter._fromStorage && letter._analyzeFilePaths?.length));

  // Auto-analyze if preloaded files were passed in
  React.useEffect(() => {
    if (letter._preloadedFiles?.length && !analyzing && !analysis) {
      handleAnalyze();
    }
  }, []);
  const [analyzing, setAnalyzing] = useState(false);
  const [progressTokens, setProgressTokens] = useState(0);
  const [analysis, setAnalysis] = useState(storedAnalysis);
  const [viewingStored, setViewingStored] = useState(!!storedAnalysis);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  // Accumulates onto the existing selection so a client/admin can add pages
  // across multiple picks (common on mobile, where multi-select galleries
  // aren't always available).
  const handleFiles = (fileList) => {
    const picked = Array.from(fileList || []).filter(Boolean);
    if (!picked.length) return;
    const invalid = picked.find((f) => !ANALYZABLE_TYPES.includes(f.type));
    if (invalid) { setError('Please upload PDFs or images (JPG, PNG, WEBP) only'); return; }
    
    const currentFiles = useStoredPaths ? [] : files;
    if (useStoredPaths) setUseStoredPaths(false);

    const combined = [...currentFiles, ...picked];
    const batchErr = validateBatch(combined);
    if (batchErr) { setError(batchErr); return; }
    setFiles(combined);
    setError(null);
  };

  const handleRemoveFile = (idx) => {
    if (useStoredPaths) {
      setError('To change pages, please upload a new response.');
      return;
    }
    setFiles(files.filter((_, i) => i !== idx));
  };

  const handleDrop = (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); };

  // Analysis itself now runs server-side (netlify/functions/phase2-analyze-
  // background.mjs) — the Anthropic key lives only in the server env, never
  // in the browser. This function's job is just getting the response file(s)
  // into the `responses` bucket (if they aren't already) and handing the
  // resulting storage paths to the job; the server downloads and analyzes
  // them, and persists the result onto the letter row itself.
  const handleAnalyze = async () => {
    if (!useStoredPaths && !files.length) return;
    if (!useStoredPaths) {
      const unanalyzable = files.find((f) => !isAnalyzable(f.type));
      if (unanalyzable) { setError(UNSUPPORTED_TYPE_MESSAGE); return; }
    }
    setAnalyzing(true);
    setError(null);
    try {
      const { data: cp } = await supabase.from('client_profiles').select('user_id').eq('full_name', letter.clientName).limit(1);
      const clientUserId = cp && cp.length > 0 ? cp[0].user_id : null;
      const basePath = clientUserId && letter.id ? clientUserId + '/' + letter.id : null;

      let analyzeFilePaths = useStoredPaths ? letter._analyzeFilePaths : null;
      if (!useStoredPaths) {
        if (!basePath) throw new Error('Could not resolve where to store this response — client profile not found.');
        // Manual upload — not yet in storage. Save as one page-ordered batch
        // (PDFs and images share the same path, single-PDF batches included)
        // so re-analysis overwrites instead of accumulating duplicates.
        analyzeFilePaths = await uploadResponseBatch(supabase, basePath, files);
      }

      // A single-PDF response is also converted to JPEG pages for Lob exhibit
      // embedding — unrelated to the Claude call, still done client-side
      // (pdfjs + canvas, no Node-canvas dependency needed on the server).
      if (basePath && analyzeFilePaths?.length === 1 && /\.pdf$/i.test(analyzeFilePaths[0])) {
        try {
          const arrayBuffer = useStoredPaths
            ? await (async () => {
                const { data } = await supabase.storage.from('responses').createSignedUrl(analyzeFilePaths[0], 3600);
                if (!data?.signedUrl) return null;
                return (await fetch(data.signedUrl)).arrayBuffer();
              })()
            : await files[0].arrayBuffer();
          if (arrayBuffer) {
            const pdfjsLib = await import('pdfjs-dist');
            pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
            const pdfDoc = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            const base = CONVERTED_PREFIX + slugBase(analyzeFilePaths[0].split('/').pop());
            for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
              const page = await pdfDoc.getPage(pageNum);
              const viewport = page.getViewport({ scale: 2.0 });
              const canvas = document.createElement('canvas');
              canvas.width = viewport.width;
              canvas.height = viewport.height;
              await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
              const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));
              // Zero-padded so Lob's alphabetical sort keeps 10+ page
              // responses in order (page10 would otherwise sort before page2)
              const pagePad = String(pageNum).padStart(2, '0');
              await supabase.storage.from('responses').upload(basePath + '/' + base + '_p' + pagePad + '.jpg', blob, { upsert: true, contentType: 'image/jpeg' });
            }
          }
        } catch (e) { console.error('Could not convert PDF for Lob embedding:', e); }
      }

      const result = await runPhase2Job(
        { letterId: letter.id, kind: 'response', filePaths: analyzeFilePaths },
        setProgressTokens
      );
      setAnalysis(result);
      setViewingStored(false);
      setStep('results');
    } catch (e) {
      console.error('Analysis failed', e);
      setError(e.message || 'Analysis failed — try again');
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
                  <div className="text-[11px] text-ink-faint">Citing blown 30-day window · §1681s-2(b) automatic violation{progressTokens > 0 ? ` · ~${progressTokens.toLocaleString()} tokens` : ''}</div>
                </div>
              )}
            </div>
          )}

          {step === 'upload' && (
            <div>
              <p className="text-[13px] text-ink-muted mb-5 max-w-xl">
                Upload the furnisher response. If it's multiple pages or photos, add them all —
                they'll be analyzed together as one document. The original Phase 1 letter is Exhibit A — attached automatically.
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
                  {files.length ? `Add more pages (${files.length} selected)` : 'Drop response here or click to upload'}
                </div>
                <div className="text-[11px] text-ink-muted">PDF · JPG · PNG · WEBP — select multiple for a multi-page response</div>
                <input id="response-file-input" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple className="hidden"
                  onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} />
              </div>
              {files.length > 0 && (
                <div className="mt-4 space-y-1.5">
                  {files.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-[12px] text-ink">
                      <FileText size={14} strokeWidth={1.75} className="text-navy shrink-0" />
                      <span className="font-medium">{files.length > 1 ? `Page ${i + 1}: ` : ''}{f.name}</span>
                      {f.size != null && <span className="text-ink-muted">({(f.size / 1024).toFixed(0)} KB)</span>}
                      <button onClick={() => handleRemoveFile(i)} className="ml-auto text-ink-faint hover:text-red-600" title="Remove">
                        <X size={13} strokeWidth={2} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {error && <div className="mt-4 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>}
              {analyzing && (
                <div className="mt-6 text-center">
                  <div className="text-[13px] text-ink-muted mb-1">Analyzing response against Phase 1 demands…</div>
                  <div className="text-[11px] text-ink-faint">Applying Johnson v. MBNA standard · Generating Phase 3 letters{progressTokens > 0 ? ` · ~${progressTokens.toLocaleString()} tokens` : ''}</div>
                </div>
              )}
            </div>
          )}

          {step === 'results' && analysis && (
            <div className="space-y-5">
              {viewingStored && (
                <div className="text-[11px] text-ink-muted border border-border rounded-sm px-3 py-2" style={{ backgroundColor: '#F9FAFB' }}>
                  Previously analyzed{letter.phase2AnalyzedAt ? ' on ' + new Date(letter.phase2AnalyzedAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''} — showing the stored analysis. Use Re-analyze to run it again.
                </div>
              )}
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
                    const result = await runPhase2Job(
                      { letterId: letter.id, kind: 'non_response', mailedDate: letter.mailedDate },
                      setProgressTokens
                    );
                    setAnalysis(result);
                    setViewingStored(false);
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
              <button onClick={handleAnalyze} disabled={!files.length || analyzing}
                className="flex items-center gap-2 px-5 py-2 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                style={{ backgroundColor: (!files.length || analyzing) ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C' }}>
                <Zap size={13} strokeWidth={2} />
                {analyzing ? 'Analyzing…' : `Run Phase 2 Analysis${files.length > 1 ? ` (${files.length} pages)` : ''}`}
              </button>
            )}
            {step === 'results' && !saved && (
              <>
                <button onClick={() => { setStep('upload'); setAnalysis(null); }}
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
