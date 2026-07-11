import React, { useState } from 'react';
import { Upload, FileText, X, ChevronDown, ChevronUp, Info } from 'lucide-react';

// Brand tokens — matches the dashboard / clients card system
const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  cardShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
};

const MODES = [
  { id: 'combined', label: '3-Bureau Combined', desc: 'Single file containing all three bureaus — ScoreFusion, IdentityIQ, MyScoreIQ', badge: 'Fastest' },
  { id: 'individual', label: '3 Individual Reports', desc: 'One file per bureau — parsed independently for maximum accuracy', badge: 'Most Accurate' },
  { id: 'single', label: 'Single Bureau', desc: 'One bureau report only — useful for monitoring a specific bureau mid-campaign' },
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
        border: '2px dashed ' + (dragging ? T.navy : '#D9DEE8'),
        borderRadius: 10, padding: '20px 16px',
        background: dragging ? '#F5F7FB' : '#fff',
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

  const setFile = (key, file) => setFiles((p) => ({ ...p, [key]: file }));
  const clearFile = (key) => setFiles((p) => { const n = { ...p }; delete n[key]; return n; });

  const canSubmit = () => {
    if (mode === 'combined') return !!files.combined;
    if (mode === 'individual') return !!(files.Equifax && files.Experian && files.TransUnion);
    if (mode === 'single') return !!files[selectedBureau];
    return false;
  };

  const handleSubmit = () => {
    if (!canSubmit()) return;
    if (mode === 'combined') onAuditStart({ mode: 'combined', file: files.combined });
    else if (mode === 'individual') onAuditStart({ mode: 'individual', files: { equifax: files.Equifax, experian: files.Experian, transunion: files.TransUnion } });
    else if (mode === 'single') onAuditStart({ mode: 'single', file: files[selectedBureau], bureau: selectedBureau });
  };

  return (
    <div className="max-w-3xl mx-auto" style={{ padding: '20px 0 32px' }}>
      {/* Branded page header */}
      <div className="flex items-center gap-3 mb-6">
        <span style={{ width: 4, height: 30, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
        <div>
          <h1 className="ccc-display text-[22px] font-medium leading-tight" style={{ color: T.ink }}>New Forensic Audit</h1>
          <p className="text-[11px]" style={{ color: T.muted }}>Upload a report → run the Setup &amp; Spike Phase 1 pipeline</p>
        </div>
      </div>

      <div className="space-y-2 mb-6">
        {MODES.map((m) => {
          const on = mode === m.id;
          return (
            <div key={m.id} onClick={() => setMode(m.id)}
              className="cursor-pointer transition-all"
              style={{
                border: '1px solid ' + (on ? T.navy : T.border),
                borderRadius: 12, padding: 16,
                background: on ? '#F5F7FB' : '#fff',
                boxShadow: on ? 'none' : T.cardShadow,
              }}>
              <div className="flex items-center gap-3">
                <div className="w-4 h-4 rounded-full flex items-center justify-center shrink-0"
                  style={{ border: '2px solid ' + (on ? T.navy : '#D1D5DB') }}>
                  {on && <div className="w-2 h-2 rounded-full" style={{ background: T.gold }} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-medium" style={{ color: T.ink }}>{m.label}</div>
                  <div className="text-[11px]" style={{ color: T.muted }}>{m.desc}</div>
                </div>
                {m.badge && (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
                    style={{ background: '#FAF3DF', color: '#8F7524', fontWeight: 600 }}>{m.badge}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mb-4">
        <button onClick={() => setShowInfo(!showInfo)} className="flex items-center gap-1.5 text-[11px] hover:text-ink" style={{ color: T.muted }}>
          <Info size={13} strokeWidth={1.75} />
          {showInfo ? 'Hide' : 'Show'} cost &amp; timing info
          {showInfo ? <ChevronUp size={12} strokeWidth={2} /> : <ChevronDown size={12} strokeWidth={2} />}
        </button>
        {showInfo && (
          <div className="mt-2 text-[11px] space-y-1" style={{ border: '1px solid ' + T.border, borderRadius: 10, padding: 12, background: '#FAFBFC', color: T.muted }}>
            <p><strong style={{ color: T.ink }}>3-Bureau Combined:</strong> 1 API call · typically ~1–2 min · roughly $0.10–0.25 depending on report size.</p>
            <p><strong style={{ color: T.ink }}>3 Individual Reports:</strong> 4 API calls · typically ~2–4 min · roughly $0.30–0.60. Most accurate — each bureau parsed independently, then cross-checked.</p>
            <p><strong style={{ color: T.ink }}>Single Bureau:</strong> 1 API call · typically ~1–2 min · roughly $0.10–0.20. No cross-bureau analysis.</p>
            <p style={{ color: T.faint }}>Estimates vary with report size. The shared audit doctrine is cached between calls, so multi-call runs cost less than 4× a single call. Audits run server-side — once started, you can close this tab and the finished audit lands in the client&apos;s record.</p>
          </div>
        )}
      </div>

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
                      background: on ? T.navy : '#fff',
                      color: on ? T.gold : T.muted,
                      border: '1px solid ' + (on ? T.navy : T.border),
                      fontWeight: on ? 600 : 400,
                    }}>
                    {b}
                  </button>
                );
              })}
            </div>
            <DropZone label={selectedBureau + ' Report'} file={files[selectedBureau]} onFile={(f) => setFile(selectedBureau, f)} onClear={() => clearFile(selectedBureau)} />
          </>
        )}
      </div>

      <button onClick={handleSubmit} disabled={!canSubmit()}
        className="w-full py-3 text-[13px] uppercase tracking-wider rounded-lg transition-colors font-medium"
        style={{ backgroundColor: canSubmit() ? T.navy : '#B5BBC9', color: canSubmit() ? T.gold : '#FFFFFF' }}>
        {mode === 'combined' && 'Run Forensic Audit'}
        {mode === 'individual' && (canSubmit() ? 'Run 3-Bureau Forensic Audit (~2–4 min)' : 'Upload all 3 bureau reports to continue')}
        {mode === 'single' && 'Run Single Bureau Audit'}
      </button>
    </div>
  );
}
