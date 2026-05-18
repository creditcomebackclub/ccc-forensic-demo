import React, { useState, useRef } from 'react';
import { Upload, FileText, X, Sparkles, Scale, Mail } from 'lucide-react';

export default function UploadZone({ onAuditStart, disabled }) {
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const inputRef = useRef(null);

  const handleFile = (f) => {
    if (!f) return;
    if (f.type !== 'application/pdf') {
      alert('Please upload a PDF credit report.');
      return;
    }
    if (f.size > 30 * 1024 * 1024) {
      alert('File too large. Max 30MB.');
      return;
    }
    setFile(f);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files[0]);
  };

  const handleStart = () => {
    if (file) onAuditStart(file);
  };

  return (
    <div className="max-w-3xl mx-auto">
      {!file ? (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => inputRef.current?.click()}
          className={`border-2 border-dashed rounded p-16 text-center cursor-pointer transition-all ${
            dragOver ? 'bg-navy/5 border-navy' : 'bg-white border-border hover:bg-gray-50'
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            onChange={(e) => handleFile(e.target.files[0])}
            className="hidden"
          />
          <Upload size={36} strokeWidth={1.25} className="mx-auto mb-4 text-navy" />
          <h2 className="ccc-display text-2xl text-ink font-medium">
            Drop 3-bureau credit report
          </h2>
          <p className="text-[13px] mt-2 text-ink-muted">
            MyScoreIQ · PrivacyGuard · Credit Karma 3B PDF
          </p>
          <button className="mt-6 px-5 py-2.5 rounded-sm text-[12px] uppercase tracking-wider font-medium bg-navy text-white hover:bg-navy-dark transition-colors">
            Or browse files
          </button>
          <p className="text-[10px] uppercase tracking-[0.15em] mt-6 text-ink-faint">
            Auto-pipeline · Forensic Audit → Classification → Phase 1 Letters
          </p>
        </div>
      ) : (
        <div className="bg-white border border-border rounded p-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded bg-navy/5 flex items-center justify-center">
              <FileText size={18} className="text-navy" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-medium text-ink truncate">{file.name}</div>
              <div className="text-[11px] text-ink-muted">
                {(file.size / 1024 / 1024).toFixed(2)} MB · Ready to audit
              </div>
            </div>
            <button
              onClick={() => setFile(null)}
              className="p-2 hover:bg-gray-100 rounded transition-colors"
              disabled={disabled}
            >
              <X size={16} className="text-ink-muted" />
            </button>
          </div>

          <button
            onClick={handleStart}
            disabled={disabled}
            className="w-full mt-5 px-4 py-3 text-[12px] uppercase tracking-wider rounded-sm font-medium flex items-center justify-center gap-2 bg-gold text-navy-dark hover:bg-gold-dark hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles size={14} />
            Run Forensic Audit
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 mt-6">
        {[
          { icon: Sparkles, title: 'Forensic Audit', desc: 'Per-account violation matrix' },
          { icon: Scale, title: 'Account Classification', desc: 'Type A / B / C routing' },
          { icon: Mail, title: 'Phase 1 Letters', desc: 'Generated per account' },
        ].map((s, i) => {
          const Icon = s.icon;
          return (
            <div key={i} className="p-4 border border-border rounded bg-white">
              <Icon size={16} className="text-gold" strokeWidth={1.75} />
              <div className="text-[13px] font-medium mt-2 text-ink">{s.title}</div>
              <div className="text-[11px] mt-0.5 text-ink-muted">{s.desc}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
