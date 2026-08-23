import React, { useEffect, useState } from 'react';
import { Upload, FileText, X, ChevronDown, ChevronUp, Info } from 'lucide-react';
import ClientPicker from './ClientPicker';
import {
  BUREAU_PARSE_KEYS,
  bureauDisplayName,
  listBureauParsesForClient,
  summarizeBureauParses,
} from '../utils/auditBureauParses';
import { ADMIN_BRAND } from '../utils/adminBrand.js';

// Brand tokens — matches the dashboard / clients card system
const T = {
  primary: ADMIN_BRAND.ink,
  accent: ADMIN_BRAND.accent,
  accentStrong: ADMIN_BRAND.accentStrong,
  accentSoft: ADMIN_BRAND.accentSoft,
  border: ADMIN_BRAND.border,
  ink: ADMIN_BRAND.ink,
  muted: ADMIN_BRAND.muted,
  faint: ADMIN_BRAND.faint,
  cardShadow: ADMIN_BRAND.shadow,
};

const MODES = [
  { id: 'combined', label: '3-Bureau Combined', desc: 'Single file containing all three bureaus — ScoreFusion, IdentityIQ, MyScoreIQ', badge: 'Fastest' },
  { id: 'individual', label: '3 Individual Reports', desc: 'One file per bureau — parsed independently for maximum accuracy', badge: 'Most Accurate' },
  { id: 'single', label: 'Single Bureau Audit + Stage', desc: 'Create an incomplete one-bureau audit now, then merge an exact same-date 3B cohort later', badge: 'Large PDFs' },
];

function DropZone({ label, file, onFile, onClear }) {
  const [dragging, setDragging] = useState(false);

  if (file) {
    return (
      <div className="flex items-center justify-between px-4 py-3"
        style={{ border: '1px solid #BBF7D0', borderRadius: 10, background: '#F0FDF4' }}>
        <div className="flex items-center gap-3 min-w-0">
          <div className="shrink-0 flex items-center justify-center" style={{ width: 34, height: 34, borderRadius: 8, background: '#DCFCE7' }}>
            <FileText size={15} strokeWidth={1.75} className="text-green-700" />
          </div>
          <div className="min-w-0">
            <div className="text-[12px] font-medium truncate" style={{ color: T.ink }}>{label}</div>
            <div className="text-[11px] truncate" style={{ color: T.muted }}>{file.name}</div>
          </div>
        </div>
        <button onClick={onClear} title="Remove file" className="text-ink-faint hover:text-red-600 shrink-0 ml-2">
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    );
  }

  return (
    <label
      className="flex flex-col items-center justify-center gap-1.5 cursor-pointer transition-colors text-center"
      style={{
        border: '2px dashed ' + (dragging ? T.accent : T.border),
        borderRadius: 10, padding: '20px 16px',
        background: dragging ? T.accentSoft : '#fff',
      }}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
    >
      <Upload size={16} strokeWidth={1.5} style={{ color: T.faint }} />
      <span className="text-[12px] font-medium" style={{ color: T.ink }}>{label}</span>
      <span className="text-[10px]" style={{ color: T.faint }}>PDF, HTML, or text · drop or click to browse</span>
      <input type="file" accept=".pdf,.html,.htm,.txt" className="hidden" onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]); }} />
    </label>
  );
}

export default function UploadZone({ onAuditStart }) {
  const [mode, setMode] = useState('combined');
  const [selectedBureau, setSelectedBureau] = useState('Equifax');
  const [files, setFiles] = useState({});
  const [showInfo, setShowInfo] = useState(false);
  const [clientSelection, setClientSelection] = useState(null);
  const [parseSummary, setParseSummary] = useState(null);
  const [parseLoadError, setParseLoadError] = useState(null);

  const setFile = (key, file) => setFiles((p) => ({ ...p, [key]: file }));
  const clearFile = (key) => setFiles((p) => { const n = { ...p }; delete n[key]; return n; });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (mode !== 'single' || clientSelection?.type !== 'existing') {
        setParseSummary(null);
        setParseLoadError(null);
        return;
      }
      try {
        const rows = await listBureauParsesForClient(clientSelection);
        if (!cancelled) {
          setParseSummary(summarizeBureauParses(rows));
          setParseLoadError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setParseSummary(null);
          setParseLoadError(e.message || 'Could not load staged bureau parses');
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [mode, clientSelection]);

  const canSubmit = () => {
    if (clientSelection?.type !== 'existing' || !clientSelection.id) return false;
    if (mode === 'combined') return !!files.combined;
    if (mode === 'individual') return !!(files.Equifax && files.Experian && files.TransUnion);
    if (mode === 'single') return !!files[selectedBureau];
    return false;
  };

  const handleSubmit = () => {
    if (!canSubmit()) return;
    if (mode === 'combined') onAuditStart({ mode: 'combined', file: files.combined, clientSelection });
    else if (mode === 'individual') onAuditStart({ mode: 'individual', files: { equifax: files.Equifax, experian: files.Experian, transunion: files.TransUnion }, clientSelection });
    else if (mode === 'single') onAuditStart({ mode: 'single', file: files[selectedBureau], bureau: selectedBureau, clientSelection });
  };

  const handleMerge = () => {
    if (clientSelection?.type !== 'existing' || !parseSummary?.canMerge || !parseSummary?.mergeSelection) return;
    onAuditStart({ mode: 'merge', clientSelection, mergeSelection: parseSummary.mergeSelection });
  };

  return (
    <div className="max-w-3xl mx-auto" style={{ padding: '20px 0 32px' }}>
      {/* Branded page header */}
      <div className="flex items-center gap-3 mb-6">
        <span style={{ width: 4, height: 30, borderRadius: 2, background: T.accent, display: 'inline-block' }} />
        <div>
          <h1 className="ccc-display text-[22px] font-medium leading-tight" style={{ color: T.ink }}>New Forensic Audit</h1>
          <p className="text-[11px]" style={{ color: T.muted }}>Upload a report → extract 3B facts → receive exact R1 start instructions</p>
        </div>
      </div>

      <ClientPicker value={clientSelection} onChange={setClientSelection} />

      <div className="space-y-2 mb-6">
        {MODES.map((m) => {
          const on = mode === m.id;
          return (
            <div key={m.id} onClick={() => setMode(m.id)}
              className="cursor-pointer transition-all"
              style={{
                border: '1px solid ' + (on ? T.accent : T.border),
                borderRadius: 12, padding: 16,
                background: on ? T.accentSoft : '#fff',
                boxShadow: on ? 'none' : T.cardShadow,
              }}>
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                  style={{ border: '2px solid ' + (on ? T.accentStrong : '#D1D5DB') }}>
                  {on && <div className="w-2 h-2 rounded-full" style={{ background: T.accent }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold" style={{ color: T.ink }}>{m.label}</span>
                    {m.badge && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold"
                        style={{ background: on ? T.primary : '#F1F5F9', color: on ? '#fff' : T.muted }}>
                        {m.badge}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: T.muted }}>{m.desc}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <button type="button" onClick={() => setShowInfo((v) => !v)}
        className="flex items-center gap-1.5 text-[11px] mb-4" style={{ color: T.muted }}>
        <Info size={12} /> Cost &amp; timing notes {showInfo ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {showInfo && (
        <div className="mb-5 rounded-xl p-4 text-[12px] leading-relaxed" style={{ background: '#F8FAFC', border: '1px solid ' + T.border, color: T.muted }}>
          <p style={{ color: T.faint }}>Estimates vary with report size. Extraction instructions are cached between calls, and deterministic rules run locally without model tokens. Audits run server-side in source-bound checkpoints — once started, you can close this tab and the finished audit lands in the client&apos;s record.</p>
          <p className="mt-2" style={{ color: T.faint }}>Large PDFs automatically resume from the last completed page range after a provider delay, deploy, or worker interruption. Do not create a duplicate retry; reopen the same job and CCC continues it safely.</p>
        </div>
      )}

      {mode === 'single' && parseSummary?.ambiguousVersionCount > 0 && (
        <div className="mb-5 rounded-xl p-4 text-[12px] leading-relaxed" style={{ background: '#FFF7ED', border: '1px solid #FED7AA', color: '#9A3412' }}>
          Multiple same-date versions exist for this staged cohort, so automatic merge is disabled to prevent mixing report cycles. Run one Combined or 3 Individual Reports audit for the corrected set.
        </div>
      )}

      <div className="space-y-3 mb-6">
        {mode === 'combined' && (
          <DropZone label="Three-Bureau Report" file={files.combined} onFile={(f) => setFile('combined', f)} onClear={() => clearFile('combined')} />
        )}
        {mode === 'individual' && (
          <>
            <DropZone label="Equifax Report" file={files.Equifax} onFile={(f) => setFile('Equifax', f)} onClear={() => clearFile('Equifax')} />
            <DropZone label="Experian Report" file={files.Experian} onFile={(f) => setFile('Experian', f)} onClear={() => clearFile('Experian')} />
            <DropZone label="TransUnion Report" file={files.TransUnion} onFile={(f) => setFile('TransUnion', f)} onClear={() => clearFile('TransUnion')} />
          </>
        )}
        {mode === 'single' && (
          <>
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[11px] mr-1" style={{ color: T.muted }}>Bureau:</span>
              {['Equifax', 'Experian', 'TransUnion'].map((b) => {
                const on = selectedBureau === b;
                return (
                  <button key={b} onClick={() => { setSelectedBureau(b); clearFile(b); }}
                    className="rounded-full px-3 py-1 text-[11px] transition-colors"
                    style={{
                      background: on ? T.primary : '#fff',
                      color: on ? '#fff' : T.muted,
                      border: '1px solid ' + (on ? T.primary : T.border),
                      fontWeight: on ? 600 : 400,
                    }}>
                    {b}
                  </button>
                );
              })}
            </div>
            <DropZone label={selectedBureau + ' Report'} file={files[selectedBureau]} onFile={(f) => setFile(selectedBureau, f)} onClear={() => clearFile(selectedBureau)} />

            {clientSelection?.type === 'existing' && (
              <div className="rounded-xl p-4" style={{ border: '1px solid ' + T.border, background: '#fff', boxShadow: T.cardShadow }}>
                <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: T.faint }}>
                  Staged parses for this client
                </div>
                {parseSummary?.reportDate && (
                  <div className="text-[12px] mb-2" style={{ color: T.ink }}>
                    Newest report cohort: <strong>{parseSummary.reportDate}</strong>
                  </div>
                )}
                {parseLoadError ? (
                  <p className="text-[12px] text-amber-700">
                    {parseLoadError.includes('audit_bureau_parses') || parseLoadError.includes('does not exist') || parseLoadError.includes('schema cache')
                      ? 'Run the audit_bureau_parses SQL migration in Supabase, then refresh.'
                      : parseLoadError}
                  </p>
                ) : (
                  <div className="space-y-1.5 mb-3">
                    {BUREAU_PARSE_KEYS.map((key) => {
                      const row = parseSummary?.byBureau?.[key];
                      return (
                        <div key={key} className="flex items-center justify-between text-[12px]">
                          <span style={{ color: T.ink }}>{bureauDisplayName(key)}</span>
                          <span style={{ color: row ? '#15803d' : T.faint }}>
                            {row ? `saved${row.page_count ? ` · ${row.page_count}p` : ''}` : 'missing'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
                {parseSummary?.canMerge && (
                  <button
                    type="button"
                    onClick={handleMerge}
                    className="w-full py-2.5 text-[12px] uppercase tracking-wider rounded-lg font-medium"
                    style={{ backgroundColor: T.primary, color: '#fff' }}
                  >
                    Merge 3 bureau parses into unified audit
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <button onClick={handleSubmit} disabled={!canSubmit()}
        className="w-full py-3 text-[13px] uppercase tracking-wider rounded-lg transition-colors font-medium"
        style={{ backgroundColor: canSubmit() ? T.primary : '#B5BBC9', color: '#FFFFFF', boxShadow: canSubmit() ? '0 8px 20px rgba(7,17,31,.14)' : 'none' }}>
        {!clientSelection
          ? 'Select a client to continue'
          : <>
              {mode === 'combined' && 'Run Forensic Audit'}
              {mode === 'individual' && (canSubmit() ? 'Run 3-Bureau Forensic Audit (~2–4 min)' : 'Upload all 3 bureau reports to continue')}
              {mode === 'single' && `Run ${selectedBureau} audit + stage exact source`}
            </>}
      </button>
    </div>
  );
}
