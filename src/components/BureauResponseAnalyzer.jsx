import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle, FileText, Upload, X, Zap } from 'lucide-react';
import { runPhase2Job } from '../utils/phase2Jobs';
import { listResponseEvidence, uploadResponseEvidence } from '../utils/responseEvidence';
import { inferMediaType } from '../utils/responseFiles';

const CLASSIFICATION = {
  DELETED_OR_CORRECTED: { label: 'Deleted or corrected', tone: '#15803D' },
  PARTIAL_CORRECTION: { label: 'Partial correction', tone: '#B45309' },
  VERIFIED_WITHOUT_SUBSTANCE: { label: 'Verified without a documented correction', tone: '#B91C1C' },
  PROCEDURAL_OR_STALLED: { label: 'Procedural or stalled', tone: '#1D4ED8' },
  INSUFFICIENT_EVIDENCE: { label: 'Insufficient readable evidence', tone: '#6B7280' },
};

const OUTCOME = {
  ADDRESSED: { label: 'Addressed', tone: '#15803D' },
  IGNORED: { label: 'Ignored', tone: '#B91C1C' },
  PARTIALLY_ADDRESSED: { label: 'Partial', tone: '#B45309' },
  UNCLEAR: { label: 'Unclear', tone: '#6B7280' },
};

function friendlyDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function BureauResponseAnalyzer({ letter, onClose, onSaved, onReview }) {
  const [records, setRecords] = useState([]);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [tokens, setTokens] = useState(0);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const all = await listResponseEvidence({ letterId: letter.id });
      setRecords(all.filter((record) => record.response_kind === 'bureau'));
    } catch (e) {
      setError(e.message || 'Could not load bureau response evidence.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [letter.id]);

  const evidence = useMemo(
    () => records.find((record) => record.upload_status === 'received') || null,
    [records]
  );
  const analysis = evidence?.analysis || null;
  const cfg = analysis ? CLASSIFICATION[analysis.classification] : null;

  const selectFiles = (fileList) => {
    const selected = Array.from(fileList || []);
    if (!selected.length) return;
    if (selected.some((file) => !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(inferMediaType(file.name, file.type)))) {
      setError('Upload a PDF, JPG, PNG, or WEBP bureau response.');
      return;
    }
    if (selected.length > 12) {
      setError('A response can contain at most 12 files.');
      return;
    }
    setFiles(selected);
    setError(null);
  };

  const upload = async () => {
    if (!files.length) return;
    setUploading(true);
    setError(null);
    try {
      await uploadResponseEvidence(letter.id, files);
      setFiles([]);
      await load();
      onSaved?.();
    } catch (e) {
      setError(e.message || 'Could not upload the bureau response.');
    } finally {
      setUploading(false);
    }
  };

  const analyze = async () => {
    if (!evidence) return;
    setAnalyzing(true);
    setError(null);
    try {
      const result = await runPhase2Job({
        letterId: letter.id,
        kind: 'bureau_response',
        evidenceId: evidence.id,
      }, setTokens);
      setRecords((current) => current.map((record) => record.id === evidence.id
        ? { ...record, analysis: result, analysis_status: 'analyzed', analyzed_at: new Date().toISOString() }
        : record));
      onSaved?.();
    } catch (e) {
      setError(e.message || 'Could not analyze the bureau response.');
      await load();
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border bg-white">
        <div className="flex items-start justify-between gap-4 border-b border-border bg-navy px-6 py-4">
          <div>
            <div className="text-[14px] font-medium text-white ccc-display">Bureau Response Analyzer</div>
            <div className="mt-0.5 text-[11px] uppercase tracking-wider text-gold">{letter.furnisher} · {letter.phase}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          <div className="mb-5 flex gap-2 rounded border border-blue-100 bg-blue-50 p-3 text-[12px] text-blue-950">
            <FileText size={15} className="mt-0.5 shrink-0" />
            <span>This compares the bureau’s response with the exact Phase 3 dispute. It records a staff review aid; it does not send a follow-up or file an escalation automatically.</span>
          </div>

          {loading && <div className="py-8 text-center text-[12px] text-ink-muted">Loading response evidence…</div>}

          {!loading && !evidence && (
            <div className="rounded border border-border p-5">
              <div className="mb-1 text-[13px] font-medium text-ink">Upload the bureau response</div>
              <p className="mb-4 text-[12px] text-ink-muted">Add every page. Files are stored privately with this specific Phase 3 letter.</p>
              <label className="block cursor-pointer rounded border-2 border-dashed border-border p-7 text-center hover:border-navy">
                <Upload size={22} className="mx-auto mb-2 text-ink-faint" />
                <div className="text-[12px] font-medium text-ink">Choose bureau response files</div>
                <div className="mt-1 text-[10px] text-ink-muted">PDF · JPG · PNG · WEBP</div>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={(event) => { selectFiles(event.target.files); event.target.value = ''; }} />
              </label>
              {files.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {files.map((file, index) => <div key={index} className="flex items-center gap-2 text-[12px] text-ink"><FileText size={13} />Page {index + 1}: {file.name}</div>)}
                  <button onClick={upload} disabled={uploading} className="mt-2 rounded bg-navy px-3 py-2 text-[11px] uppercase tracking-wider text-gold disabled:opacity-50">
                    {uploading ? 'Uploading…' : 'Save private response evidence'}
                  </button>
                </div>
              )}
            </div>
          )}

          {!loading && evidence && !analysis && (
            <div className="rounded border border-border p-5">
              <div className="flex items-center gap-2 text-[13px] font-medium text-ink"><CheckCircle size={15} className="text-green-700" /> Bureau response received {friendlyDate(evidence.received_at || evidence.created_at)}</div>
              <div className="mt-1 text-[11px] text-ink-muted">{(evidence.file_names || []).length} private file{(evidence.file_names || []).length === 1 ? '' : 's'} attached to this letter.</div>
              <button onClick={analyze} disabled={analyzing} className="mt-4 inline-flex items-center gap-1.5 rounded bg-navy px-3 py-2 text-[11px] uppercase tracking-wider text-gold disabled:opacity-50">
                <Zap size={12} /> {analyzing ? `Analyzing${tokens ? ` · ~${tokens.toLocaleString()} tokens` : '…'}` : 'Analyze bureau response'}
              </button>
            </div>
          )}

          {!loading && analysis && (
            <div className="space-y-5">
              <div className="rounded border p-4" style={{ borderColor: cfg?.tone || '#E7EAF0', background: (cfg?.tone || '#6B7280') + '0D' }}>
                <div className="text-[10px] uppercase tracking-wider" style={{ color: cfg?.tone || '#6B7280' }}>Bureau response classification</div>
                <div className="mt-1 text-[14px] font-medium text-ink">{cfg?.label || analysis.classification}</div>
                <div className="mt-1 text-[12px] leading-relaxed text-ink-muted">{analysis.summary}</div>
              </div>

              {analysis.issueAnalysis?.length > 0 && (
                <div>
                  <div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-ink-faint">Phase 3 issue review</div>
                  <div className="overflow-hidden rounded border border-border">
                    {analysis.issueAnalysis.map((item, index) => {
                      const outcome = OUTCOME[item.outcome] || OUTCOME.UNCLEAR;
                      return <div key={index} className="border-t border-border px-3 py-3 first:border-t-0">
                        <div className="flex items-start justify-between gap-3"><div className="text-[12px] font-medium text-ink">{item.issue}</div><span className="shrink-0 text-[10px] uppercase tracking-wider" style={{ color: outcome.tone }}>{outcome.label}</span></div>
                        <div className="mt-1 text-[11px] text-ink-muted">{item.notes}</div>
                      </div>;
                    })}
                  </div>
                </div>
              )}

              {(analysis.reportedChanges?.length > 0 || analysis.keyFindings?.length > 0) && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>{analysis.reportedChanges?.length > 0 && <><div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-ink-faint">Bureau-reported changes</div><ul className="space-y-1 text-[12px] text-ink-muted">{analysis.reportedChanges.map((item, index) => <li key={index}>• {item}</li>)}</ul></>}</div>
                  <div>{analysis.keyFindings?.length > 0 && <><div className="mb-2 text-[10px] font-medium uppercase tracking-wider text-ink-faint">Verify before deciding</div><ul className="space-y-1 text-[12px] text-ink-muted">{analysis.keyFindings.map((item, index) => <li key={index}>• {item}</li>)}</ul></>}</div>
                </div>
              )}

              {analysis.documentQuality?.enclosureLegible === false && <div className="flex gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900"><AlertCircle size={15} className="shrink-0" />{(analysis.documentQuality.issues || ['The response could not be read reliably.']).join(' ')}</div>}
            </div>
          )}

          {error && <div className="mt-4 flex gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700"><AlertCircle size={14} className="shrink-0" />{error}</div>}
        </div>

        <div className="flex items-center justify-between border-t border-border px-6 py-4">
          <button onClick={onClose} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">Close</button>
          {analysis && <button onClick={() => onReview?.(evidence)} className="rounded bg-navy px-3 py-2 text-[11px] uppercase tracking-wider text-gold">Review next action</button>}
        </div>
      </div>
    </div>
  );
}
