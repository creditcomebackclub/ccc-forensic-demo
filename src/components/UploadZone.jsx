import React, { useState } from 'react';
import { Upload, FileText, X, ChevronDown, ChevronUp, Info } from 'lucide-react';

const MODES = [
  { id: 'combined', label: '3-Bureau Combined', desc: 'Single PDF containing all three bureaus — ScoreFusion, IdentityIQ, MyScoreIQ' },
  { id: 'individual', label: '3 Individual Reports', desc: 'Upload one PDF per bureau — parsed independently for maximum accuracy', badge: 'Most Accurate' },
  { id: 'single', label: 'Single Bureau', desc: 'One bureau report only — useful for monitoring a specific bureau mid-campaign' },
];

function DropZone({ label, file, onFile, onClear }) {
  const [dragging, setDragging] = useState(false);
  return (
    <div onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={'border-2 rounded transition-colors ' + (dragging ? 'border-navy bg-blue-50' : file ? 'border-green-400 bg-green-50' : 'border-dashed border-border bg-gray-50')}>
      {file ? (
        <div className="flex items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={16} strokeWidth={1.75} className="text-green-600 shrink-0" />
            <div className="min-w-0">
              <div className="text-[12px] text-ink font-medium truncate">{label}</div>
              <div className="text-[11px] text-ink-muted truncate">{file.name}</div>
            </div>
          </div>
          <button onClick={onClear} className="text-ink-faint hover:text-red-600 shrink-0 ml-2"><X size={14} strokeWidth={2} /></button>
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center py-6 px-4 cursor-pointer">
          <Upload size={20} className="text-ink-faint mb-2" strokeWidth={1.5} />
          <div className="text-[12px] text-ink font-medium mb-0.5">{label}</div>
          <div className="text-[10px] text-ink-muted">Drop PDF or click to browse</div>
          <input type="file" accept=".pdf,.html,.htm,.txt" className="hidden" onChange={(e) => { if (e.target.files[0]) onFile(e.target.files[0]); }} />
        </label>
      )}
    </div>
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
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h2 className="ccc-display text-xl text-ink font-medium mb-1">Select Report Format</h2>
        <p className="text-[12px] text-ink-muted">Choose how you're uploading the client's credit report.</p>
      </div>
      <div className="space-y-2 mb-6">
        {MODES.map((m) => (
          <div key={m.id} onClick={() => setMode(m.id)}
            className={'border rounded p-4 cursor-pointer transition-all ' + (mode === m.id ? 'border-navy bg-blue-50' : 'border-border bg-white hover:border-navy')}>
            <div className="flex items-center gap-3">
              <div className={'w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ' + (mode === m.id ? 'border-navy' : 'border-gray-300')}>
                {mode === m.id && <div className="w-2 h-2 rounded-full bg-navy" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-ink font-medium">{m.label}</div>
                <div className="text-[11px] text-ink-muted">{m.desc}</div>
              </div>
              {m.badge && <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm bg-amber-50 text-amber-700 shrink-0">{m.badge}</span>}
            </div>
          </div>
        ))}
      </div>
      <div className="mb-4">
        <button onClick={() => setShowInfo(!showInfo)} className="flex items-center gap-1.5 text-[11px] text-ink-muted hover:text-ink">
          <Info size={13} strokeWidth={1.75} />
          {showInfo ? 'Hide' : 'Show'} token usage info
          {showInfo ? <ChevronUp size={12} strokeWidth={2} /> : <ChevronDown size={12} strokeWidth={2} />}
        </button>
        {showInfo && (
          <div className="mt-2 border border-border rounded-sm p.3 bg-gray-50 text-[11px] text-ink-muted space-y-1">
            <p><strong className="text-ink">3-Bureau Combined:</strong> 1 API call (~$0.08-0.15). Fastest.</p>
            <p><strong className="text-ink">3 Individual Reports:</strong> 4 API calls (~$0.25-0.45). Most accurate. Takes 4-5 minutes.</p>
            <p><strong className="text-ink">Single Bureau:</strong> 1 API call (~$0.08-0.15). No cross-bureau analysis.</p>
          </div>
        )}
      </div>
      <div className="space-y-3 mb-6">
        {mode === 'combined' && (
          <DropZone label="Three-Bureau Report (PDF)" file={files.combined} onFile={(f) => setFile('combined', f)} onClear={() => clearFile('combined')} />
        )}
        {mode === 'individual' && (
          <>
            <DropZone label="Equifax Report (PDF)" file={files.Equifax} onFile={(f) => setFile('Equifax', f)} onClear={() => clearFile('Equifax')} />
            <DropZone label="Experian Report (PDF)" file={files.Experian} onFile={(f) => setFile('Experian', f)} onClear={() => clearFile('Experian')} />
            <DropZone label="TransUnion Report (PDF)" file={files.TransUnion} onFile={(f) => setFile('TransUnion', f)} onClear={() => clearFile('TransUnion')} />
          </>
        )}
        {mode === 'single' && (
          <>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] text-ink-muted">Bureau:</span>
              {['Equifax', 'Experian', 'TransUnion'].map((b) => (
                <button key={b} onClick={() => { setSelectedBureau(b); clearFile(b); }}
                  className={'px-3 py-1 text-[11px] uppercase tracking-wider rounded-sm border transition-colors ' + (selectedBureau === b ? 'bg-navy text-gold border-navy' : 'border-border text-ink-muted hover:border-navy')}>
                  {b}
                </button>
              ))}
            </div>
            <DropZone label={selectedBureau + ' Report (PDF)'} file={files[selectedBureau]} onFile={(f) => setFile(selectedBureau, f)} onClear={() => clearFile(selectedBureau)} />
          </>
        )}
      </div>
      <button onClick={handleSubmit} disabled={!canSubmit()}
        className="w-full py-3 text-[13px] uppercase tracking-wider rounded-sm transition-colors font-medium"
        style={{ backgroundColor: canSubmit() ? '#1B2A4A' : '#B5BBC9', color: '#C9A84C' }}>
        {mode === 'combined' && 'Run Forensic Audit'}
        {mode === 'individual' && (canSubmit() ? 'Run 3-Bureau Forensic Audit (4 API calls, ~5 min)' : 'Upload all 3 bureau reports to continue')}
        {mode === 'single' && 'Run Single Bureau Audit'}
      </button>
    </div>
  );
}
