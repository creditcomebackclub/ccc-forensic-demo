import React, { useState } from 'react';
import { LayoutDashboard, BookOpen, Users, Settings, AlertCircle } from 'lucide-react';
import UploadZone from './components/UploadZone';
import AuditProgress from './components/AuditProgress';
import AuditResults from './components/AuditResults';
import LetterViewer from './components/LetterViewer';
import ClientsPage from './components/ClientsPage';
import MethodologyPage from './components/MethodologyPage';
import { runAudit, fileToBase64 } from './utils/api';

const STATE = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  RESULTS: 'results',
  ERROR: 'error',
};

const VIEW = {
  AUDIT: 'audit',
  CLIENTS: 'clients',
  METHODOLOGY: 'methodology',
};

export default function App() {
  const [view, setView] = useState(VIEW.AUDIT);
  const [state, setState] = useState(STATE.IDLE);
  const [auditResult, setAuditResult] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState(null);
  const [activeLetter, setActiveLetter] = useState(null);

  const handleAuditStart = async (file) => {
    setView(VIEW.AUDIT);
    setState(STATE.PROCESSING);
    setFileName(file.name);
    setError(null);

    try {
      const base64 = await fileToBase64(file);
      const res = await runAudit(base64);
      setAuditResult(res.audit);
      setState(STATE.RESULTS);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Audit failed');
      setState(STATE.ERROR);
    }
  };

  const handleReset = () => {
    setView(VIEW.AUDIT);
    setState(STATE.IDLE);
    setAuditResult(null);
    setError(null);
  };

  const handleGenerateLetter = (account) => {
    setActiveLetter(account);
  };

  const handleOpenSavedAudit = (audit) => {
    setAuditResult(audit);
    setState(STATE.RESULTS);
    setView(VIEW.AUDIT);
  };

  return (
    <div className="min-h-screen bg-bg flex">
      <Sidebar view={view} onNavigate={setView} />
      <main className="flex-1 flex flex-col">
        <TopBar view={view} state={state} />
        <div className="flex-1 overflow-auto p-8">
          {view === VIEW.CLIENTS && (
            <ClientsPage onOpenAudit={handleOpenSavedAudit} />
          )}

          {view === VIEW.METHODOLOGY && (
            <MethodologyPage />
          )}

          {view === VIEW.AUDIT && (
            <>
              {state === STATE.IDLE && <UploadZone onAuditStart={handleAuditStart} />}
              {state === STATE.PROCESSING && <AuditProgress fileName={fileName} />}
              {state === STATE.RESULTS && auditResult && (
                <AuditResults
                  audit={auditResult}
                  onGenerateLetter={handleGenerateLetter}
                  onReset={handleReset}
                />
              )}
              {state === STATE.ERROR && (
                <ErrorView error={error} onReset={handleReset} />
              )}
            </>
          )}
        </div>
      </main>

      {activeLetter && auditResult && (
        <LetterViewer
          account={activeLetter}
          client={auditResult.client}
          onClose={() => setActiveLetter(null)}
        />
      )}
    </div>
  );
}

function Sidebar({ view, onNavigate }) {
  return (
    <aside className="w-60 flex flex-col border-r border-navy-light bg-navy-dark">
      <div className="px-5 py-5 border-b border-navy-light">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded flex items-center justify-center text-[13px] font-bold bg-gold text-navy-dark"
            style={{ fontFamily: 'Fraunces, serif' }}
          >
            CCC
          </div>
          <div>
            <div className="text-white text-[13px] font-medium leading-tight ccc-display">
              Credit Comeback
            </div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-gold">
              Forensic Suite
            </div>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-3">
        <NavItem icon={LayoutDashboard} label="New Audit" active={view === 'audit'} onClick={() => onNavigate('audit')} />
        <NavItem icon={Users} label="Clients" active={view === 'clients'} onClick={() => onNavigate('clients')} />
        <NavItem icon={BookOpen} label="Methodology" active={view === 'methodology'} onClick={() => onNavigate('methodology')} />
      </nav>

      <div className="border-t border-navy-light px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-medium bg-navy-light text-gold">
            CH
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-[12px] truncate">Chris Holland</div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400">
              Lead Auditor
            </div>
          </div>
          <Settings size={14} strokeWidth={1.5} className="text-gray-400" />
        </div>
      </div>
    </aside>
  );
}

function NavItem({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center px-5 py-2 text-[13px] gap-2.5 transition-colors"
      style={{
        color: active ? '#FFFFFF' : '#B5BBC9',
        backgroundColor: active ? '#2A3C5F' : 'transparent',
        borderLeft: active ? '2px solid #C9A84C' : '2px solid transparent',
      }}
    >
      <Icon size={15} strokeWidth={1.75} />
      {label}
    </button>
  );
}

function TopBar({ view, state }) {
  if (view === 'clients') {
    return (
      <header className="px-8 py-5 border-b border-border bg-white">
        <h1 className="ccc-display text-2xl text-ink font-medium">Clients</h1>
        <p className="text-[12px] mt-0.5 text-ink-muted">Saved audits and letters on this device</p>
      </header>
    );
  }

  if (view === 'methodology') {
    return (
      <header className="px-8 py-5 border-b border-border bg-white">
        <h1 className="ccc-display text-2xl text-ink font-medium">Methodology</h1>
        <p className="text-[12px] mt-0.5 text-ink-muted">The Setup &amp; Spike operating doctrine</p>
      </header>
    );
  }

  const titles = {
    idle: { title: 'New Forensic Audit', subtitle: 'Upload report → run Setup & Spike Phase 1 pipeline' },
    processing: { title: 'Analyzing Report', subtitle: 'Claude is performing forensic analysis' },
    results: { title: 'Audit Results', subtitle: 'Phase 1 strategy ready for review' },
    error: { title: 'Audit Failed', subtitle: 'Something went wrong' },
  };
  const cfg = titles[state] || titles.idle;

  return (
    <header className="px-8 py-5 border-b border-border bg-white">
      <h1 className="ccc-display text-2xl text-ink font-medium">{cfg.title}</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">{cfg.subtitle}</p>
    </header>
  );
}

function ErrorView({ error, onReset }) {
  return (
    <div className="max-w-md mx-auto bg-white border border-red-200 rounded p-8 text-center">
      <AlertCircle size={32} className="text-red-600 mx-auto mb-3" strokeWidth={1.5} />
      <h2 className="ccc-display text-xl text-ink font-medium">Audit failed</h2>
      <p className="text-[12px] text-ink-muted mt-2">{error}</p>
      <button
        onClick={onReset}
        className="mt-5 px-4 py-2 text-[12px] uppercase tracking-wider rounded-sm bg-navy text-white hover:bg-navy-dark"
      >
        Try Again
      </button>
      <div className="mt-6 pt-4 border-t border-border text-[10px] text-ink-faint text-left">
        <div className="font-medium uppercase tracking-wider mb-2">Common issues:</div>
        <ul className="space-y-1">
          <li>· ANTHROPIC_API_KEY missing from Netlify env vars</li>
          <li>· PDF is image-only (no text layer) — try a different export</li>
          <li>· File too large or corrupted</li>
          <li>· Network timeout (try smaller PDF or retry)</li>
        </ul>
      </div>
    </div>
  );
}
