import React, { useState } from 'react';
import { X, Upload, FileText, AlertCircle, CheckCircle, Zap } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { runPhase2Job } from '../utils/phase2Jobs';
import { ANALYZABLE_TYPES, CONVERTED_PREFIX, isAnalyzable, slugBase, UNSUPPORTED_TYPE_MESSAGE, validateBatch } from '../utils/responseFiles';
import { uploadResponseEvidence } from '../utils/responseEvidence';
import { getLatestRound, markRoundClosePrompted, reviewRoundLetter } from '../utils/rounds.js';
import { updateResponseEvidenceReview } from '../utils/responseEvidence.js';
import { isCccDisputePhase } from '../utils/cccMailRules.js';
import RoundCloseModal from './RoundCloseModal.jsx';
import PacketAccountResponseReview from './PacketAccountResponseReview.jsx';

const CLASSIFICATION_CONFIG = {
  FORM_LETTER: { label: 'No Demand-Specific Statement Matched', tone: 'red' },
  STATEMENT_COPY: { label: 'Documents Supplied — No Substantive Match Found', tone: 'red' },
  PARTIAL_FIX: { label: 'Some Demands Matched — Others Need Review', tone: 'amber' },
  WRONG_FRAMEWORK: { label: 'Wrong Framework — Treated as e-OSCAR Dispute', tone: 'red' },
  NON_RESPONSE: { label: 'Non-Response — Window Closed', tone: 'red' },
  ADEQUATE: { label: 'All Demands Matched — Verify Claimed Results', tone: 'green' },
  INSUFFICIENT_EVIDENCE: { label: 'Insufficient Evidence — Staff Review Required', tone: 'amber' },
};

const OUTCOME_CONFIG = {
  ADDRESSED: { label: 'Addressed', color: '#15803D' },
  IGNORED: { label: 'Ignored', color: '#DC2626' },
  PARTIALLY_ADDRESSED: { label: 'Partial', color: '#D97706' },
  ADMITTED: { label: 'Admitted', color: '#1B2A4A' },
};

export default function ResponseAnalyzer({ letter, onClose, onSaved }) {
  const isCurrentCccLetter = isCccDisputePhase(letter?.phase);
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
    if (isCurrentCccLetter && letter._preloadedFiles?.length && !analyzing && !analysis) {
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
  const [activeEvidenceId, setActiveEvidenceId] = useState(letter._responseEvidenceId || storedAnalysis?.responseEvidenceId || null);
  const [reviewChoice, setReviewChoice] = useState(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [roundReady, setRoundReady] = useState(null);
  const [showPacketReview, setShowPacketReview] = useState(false);
  const isPacket = Number(letter.packetVersion || letter.packet_version || 1) === 2;

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
  // background.mjs) — the Anthropic key lives only in the server env. New
  // uploads first become a private response-evidence record; the analysis job
  // then receives only the server-validated storage paths.
  const handleAnalyze = async () => {
    if (!isCurrentCccLetter) {
      setError('Historical response evidence is read-only. Nothing was analyzed.');
      return;
    }
    if (!useStoredPaths && !files.length) return;
    if (!useStoredPaths) {
      const unanalyzable = files.find((f) => !isAnalyzable(f.type));
      if (unanalyzable) { setError(UNSUPPORTED_TYPE_MESSAGE); return; }
    }
    setAnalyzing(true);
    setError(null);
    try {
      let analyzeFilePaths = useStoredPaths ? letter._analyzeFilePaths : null;
      let evidenceId = useStoredPaths ? (letter._responseEvidenceId || null) : null;
      if (!useStoredPaths) {
        const evidence = await uploadResponseEvidence(letter.id, files);
        analyzeFilePaths = evidence.storagePaths;
        evidenceId = evidence.id;
        setActiveEvidenceId(evidence.id);
      }

      const basePath = analyzeFilePaths?.[0]
        ? analyzeFilePaths[0].slice(0, analyzeFilePaths[0].lastIndexOf('/'))
        : null;

      // Preserve a page-level image copy for evidence review. This is
      // unrelated to the model call and does not select an enclosure or draft
      // correspondence.
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
        } catch (e) { console.error('Could not convert PDF into page-level evidence:', e); }
      }

      const result = await runPhase2Job(
        { letterId: letter.id, kind: 'response', filePaths: analyzeFilePaths, evidenceId },
        setProgressTokens
      );
      setAnalysis(result);
      if (result?.responseEvidenceId) setActiveEvidenceId(result.responseEvidenceId);
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
    if (!isCurrentCccLetter) {
      setError('Historical response evidence is read-only. Nothing was saved.');
      return;
    }
    if (!analysis || !reviewChoice) return;
    setSaving(true);
    try {
      let evidenceId = activeEvidenceId || analysis.responseEvidenceId || null;
      if (!evidenceId) {
        const { data, error: evidenceError } = await supabase.from('response_evidence')
          .select('id').eq('letter_id', letter.id).eq('analysis_status', 'analyzed')
          .order('analyzed_at', { ascending: false }).limit(1).maybeSingle();
        if (evidenceError) throw evidenceError;
        evidenceId = data?.id || null;
      }
      if (!evidenceId) throw new Error('The analyzed response evidence could not be resolved.');
      const decision = {
        resolved: { reviewStatus: 'resolved', nextAction: 'resolved' },
        next_round: { reviewStatus: 'follow_up', nextAction: 'next_round' },
        needs_documents: { reviewStatus: 'needs_documents', nextAction: 'needs_documents' },
        escalate: { reviewStatus: 'escalated', nextAction: 'escalate' },
      }[reviewChoice];
      if (letter.roundId) {
        await reviewRoundLetter({ letterId: letter.id, responseEvidenceId: evidenceId, ...decision, notes: reviewNotes });
      } else {
        // Legacy evidence can still be reviewed, but it cannot silently create
        // a new structured round until account reconciliation is complete.
        await updateResponseEvidenceReview(evidenceId, { reviewStatus: decision.reviewStatus, reviewNotes });
      }
      setSaved(true);
      if (letter.roundId && letter.clientAccountId) {
        const latest = await getLatestRound(letter.clientAccountId);
        if (latest?.round_id === letter.roundId && latest.ready_to_close && !latest.close_prompted_at) {
          await markRoundClosePrompted(letter.roundId);
          setRoundReady(latest);
        }
        else setTimeout(() => { onSaved?.(); onClose(); }, 700);
      } else {
        setTimeout(() => { onSaved?.(); onClose(); }, 700);
      }
    } catch (e) {
      console.error('Save failed', e);
      setError('Could not save: ' + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  const cfg = analysis ? CLASSIFICATION_CONFIG[analysis.classification] : null;

  if (!isCurrentCccLetter) {
    const historical = analysis || storedAnalysis || letter?.phase2Analysis || null;
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
        <div className="bg-white rounded border border-border w-full max-w-xl p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[15px] font-semibold text-ink">Historical response evidence</div>
              <div className="text-[11px] uppercase tracking-wider text-ink-muted mt-1">{letter?.furnisher} · {letter?.phase}</div>
            </div>
            <button onClick={onClose} className="text-ink-faint hover:text-ink" aria-label="Close"><X size={18} /></button>
          </div>
          <div className="mt-4 rounded border border-slate-200 bg-slate-50 px-4 py-3 text-[12px] leading-relaxed text-slate-700">
            This analysis belongs to a retired correspondence workflow. It remains readable as historical evidence, but this screen cannot upload, re-analyze, change a disposition, or create another letter.
          </div>
          {historical && (
            <div className="mt-4 rounded border border-border p-3">
              <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium">Stored analysis</div>
              {historical.classification && <div className="text-[12px] font-medium text-ink mt-2">{CLASSIFICATION_CONFIG[historical.classification]?.label || historical.classification}</div>}
              {historical.summary && <div className="text-[12px] text-ink-muted mt-1">{historical.summary}</div>}
            </div>
          )}
          <div className="flex justify-end mt-5">
            <button onClick={onClose} className="px-4 py-2 rounded-sm bg-navy text-[11px] uppercase tracking-wider text-white">Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded border border-border w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-navy rounded-t">
          <div>
            <div className="text-white text-[14px] font-medium ccc-display">Round Response Analyzer</div>
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
                <div className="text-[12px] text-ink-muted mt-1">The recorded dates and response window will create a deterministic nonresponse record. Staff review determines the next action.</div>
              </div>
              {letter.mailedDate && (
                <div className="text-[12px] text-ink-muted mb-4">
                  Letter mailed: <span className="text-ink font-medium">{letter.mailedDate}</span> · 30-day window expired
                </div>
              )}
              {error && <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2 mb-4">{error}</div>}
              {analyzing && (
                <div className="text-center py-4">
                  <div className="text-[13px] text-ink-muted mb-1">Analyzing the documented nonresponse…</div>
                  <div className="text-[11px] text-ink-faint">Applying the correct direct-dispute and CRA-notice standards{progressTokens > 0 ? ` · ~${progressTokens.toLocaleString()} tokens` : ''}</div>
                </div>
              )}
            </div>
          )}

          {step === 'upload' && (
            <div>
              <p className="text-[13px] text-ink-muted mb-5 max-w-xl">
                Upload the furnisher response. If it's multiple pages or photos, add them all —
                they&apos;ll be analyzed together as one document and bound to this exact CCC letter.
                AI extracts only the response&apos;s visible statements. Deterministic rules compare them with the original demands. This review does not draft a letter or choose packet enclosures.
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
                  <div className="text-[13px] text-ink-muted mb-1">Extracting response evidence, then applying deterministic demand rules…</div>
                  <div className="text-[11px] text-ink-faint">Applying the response and document-quality standards{progressTokens > 0 ? ` · ~${progressTokens.toLocaleString()} tokens` : ''}</div>
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
                      <div className="col-span-6 text-[12px] text-ink pr-3">
                        <div>{d.demand}</div>
                        {d.ruleId && <div className="ccc-mono text-[9px] text-ink-faint mt-0.5">{d.demandId || 'Demand'} · {d.ruleId}</div>}
                      </div>
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
                <div className="text-[10px] uppercase tracking-wider text-gold font-medium mb-1">Strongest Reviewed-Round Leverage</div>
                <div className="text-[12px] text-white leading-relaxed">{analysis.phase3Leverage}</div>
              </div>

              {!isPacket && <div>
                <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Staff disposition</div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['resolved', 'Resolved', 'The response resolves this letter’s supported issues.'],
                    ['next_round', 'Another round', 'Use this reviewed evidence in a newly targeted round.'],
                    ['needs_documents', 'Need documents', 'Pause for specific missing client evidence.'],
                    ['escalate', 'Escalation ready', 'Explicitly mark this reviewed letter for escalation.'],
                  ].map(([value, label, description]) => <button key={value} onClick={() => setReviewChoice(value)} className={`p-3 rounded border text-left ${reviewChoice === value ? 'border-gold bg-amber-50' : 'border-border'}`}><span className="block text-[11px] font-medium text-ink">{label}</span><span className="block text-[10px] text-ink-muted mt-0.5">{description}</span></button>)}
                </div>
                <textarea value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} maxLength={2000} rows={3} placeholder="Internal review notes (optional)" className="mt-2 w-full border border-border rounded p-2 text-[11px]" />
              </div>}

              {isPacket && <div className="rounded border border-blue-200 bg-blue-50 px-3 py-3 text-[11px] text-blue-900">
                This is the packet-level extraction. Use <strong>Review each account</strong> to confirm a separate disposition and next action for every covered account.
              </div>}

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
                    setError(e.message || 'Analysis failed');
                  } finally {
                    setAnalyzing(false);
                  }
                }}
                disabled={analyzing}
                className="flex items-center gap-2 px-5 py-2 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                style={{ backgroundColor: analyzing ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C' }}
              >
                <Zap size={13} strokeWidth={2} />
                {analyzing ? 'Analyzing…' : 'Analyze Nonresponse'}
              </button>
            )}

            {step === 'upload' && (
              <button onClick={handleAnalyze} disabled={!files.length || analyzing}
                className="flex items-center gap-2 px-5 py-2 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                style={{ backgroundColor: (!files.length || analyzing) ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C' }}>
                <Zap size={13} strokeWidth={2} />
                {analyzing ? 'Analyzing…' : `Run Forensic Analysis${files.length > 1 ? ` (${files.length} pages)` : ''}`}
              </button>
            )}
            {step === 'results' && !saved && (
              <>
                <button onClick={() => { setStep('upload'); setAnalysis(null); }}
                  className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">Re-analyze</button>
                {isPacket ? <button onClick={() => setShowPacketReview(true)}
                  className="px-5 py-2 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                  style={{ backgroundColor: '#1B2A4A', color: '#C9A84C' }}>
                  Review each account
                </button> : <button onClick={handleSave} disabled={saving || !reviewChoice}
                  className="px-5 py-2 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                  style={{ backgroundColor: (saving || !reviewChoice) ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C' }}>
                  {saving ? 'Saving…' : 'Save Review Decision'}
                </button>}
              </>
            )}
            {saved && (
              <div className="flex items-center gap-2 text-[12px] text-green-700">
                <CheckCircle size={14} strokeWidth={1.75} /> Review decision saved
              </div>
            )}
          </div>
        </div>
      </div>
      {showPacketReview && <PacketAccountResponseReview letter={letter} evidence={activeEvidenceId ? { id: activeEvidenceId } : null} onClose={() => setShowPacketReview(false)} onSaved={onSaved} />}
      {roundReady && <RoundCloseModal roundId={roundReady.round_id} roundNumber={roundReady.round_number} onClose={() => setRoundReady(null)} onCompleted={() => { setRoundReady(null); onSaved?.(); onClose(); }} />}
    </div>
  );
}
