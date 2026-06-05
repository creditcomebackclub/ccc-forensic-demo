import React, { useState, useEffect } from 'react';
import { LayoutDashboard, BookOpen, Users, AlertCircle, LogOut, Shield, UserCog, Home, Settings } from 'lucide-react';
import UploadZone from './components/UploadZone';
import AuditProgress from './components/AuditProgress';
import AuditResults from './components/AuditResults';
import LetterViewer from './components/LetterViewer';
import ClientsPage from './components/ClientsPage';
import MethodologyPage from './components/MethodologyPage';
import AuthPage from './components/AuthPage';
import TeamPage from './components/TeamPage';
import DashboardPage from './components/DashboardPage';
import ClientSetupFlow from './components/ClientSetupFlow';
import ClientPortal from './components/ClientPortal';
import SettingsModal from './components/SettingsModal';
import { supabase } from './utils/supabase';
import { getProfile } from './utils/storage';
import { runAudit, runTripleBureauAudit, runSingleBureauAudit, fileToBase64 } from './utils/api';

const STATE = { IDLE: 'idle', PROCESSING: 'processing', RESULTS: 'results', ERROR: 'error' };
const VIEW = { DASHBOARD: 'dashboard', AUDIT: 'audit', CLIENTS: 'clients', METHODOLOGY: 'methodology', TEAM: 'team' };

export default function App() {
  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [view, setView] = useState(VIEW.DASHBOARD);
  const [clientsContext, setClientsContext] = useState(null);
  const [state, setState] = useState(STATE.IDLE);
  const [auditResult, setAuditResult] = useState(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState(null);
  const [activeLetter, setActiveLetter] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [clientOnboarded, setClientOnboarded] = useState(false);
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);

  useEffect(() => {
    const initAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setSession(session);
        await loadUser(session);
      } else {
        setSession(null);
        setProfileLoading(false);
      }
    };
    initAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (!session) {
        setProfile(null);
        setIsClient(false);
        setProfileLoading(false);
        return;
      }
      // Only reload user on actual auth events, not token refreshes
      if (_event === 'SIGNED_IN' || _event === 'USER_UPDATED') {
        await loadUser(session);
      }
    });
    // Refresh session when tab becomes visible again
    const handleVisibility = async () => {
      if (document.visibilityState === 'visible') {
        try {
          const { data: { session: currentSession } } = await supabase.auth.getSession();
          if (currentSession) {
            setSession(currentSession);
            if (!profile) await loadUser(currentSession);
          }
        } catch(e) { console.error('visibility refresh error:', e); }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const loadUser = async (session) => {
    setProfileLoading(true);
    // Safety timeout — never stay loading forever
    const safetyTimer = setTimeout(() => {
      console.warn('loadUser timeout — forcing profile from session');
      setProfile({ id: session.user.id, email: session.user.email, role: session.user.user_metadata?.role || 'admin', full_name: session.user.user_metadata?.full_name || session.user.email });
      setIsClient(false);
      setProfileLoading(false);
    }, 5000);
    try {
      const email = session.user.email;

      // Direct Supabase query — bypass getProfile complexity
      const { data: profArr } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', session.user.id)
        .limit(1);
      const prof = profArr && profArr.length > 0 ? profArr[0] : null;

      if (prof && (prof.role === 'admin' || prof.role === 'auditor')) {
        setProfile(prof);
        setIsClient(false);
        setProfileLoading(false);
        return;
      }

      // Check client_profiles
      const { data: cpArr } = await supabase
        .from('client_profiles')
        .select('*')
        .eq('email', email)
        .limit(1);
      const cp = cpArr && cpArr.length > 0 ? cpArr[0] : null;

      if (cp) {
        setIsClient(true);
        setClientOnboarded(cp.onboarding_complete === true);
        setNeedsPasswordSetup(!session.user.user_metadata?.password_set);
        if (!cp.user_id) {
          await supabase.from('client_profiles').update({ user_id: session.user.id }).eq('email', email);
        }
        setProfile(prof || { id: session.user.id, email, role: 'client' });
        setProfileLoading(false);
        return;
      }

      // No profile found — create one
      if (!prof) {
        const fullName = session.user.user_metadata?.full_name || email;
        await supabase.from('profiles').insert({ id: session.user.id, full_name: fullName, role: 'auditor' });
        setProfile({ id: session.user.id, full_name: fullName, role: 'auditor' });
      } else {
        setProfile(prof);
      }
      setIsClient(false);
    } catch (e) {
      console.error('loadUser error:', e);
    } finally {
      clearTimeout(safetyTimer);
      setProfileLoading(false);
    }
  };


  if (session === undefined) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-[13px] text-ink-muted">Loading…</div>
      </div>
    );
  }

  if (!session) return <AuthPage />;

  if (profileLoading || (session && !profile)) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-[13px] text-ink-muted">Loading…</div>
      </div>
    );
  }

  // Client portal routing
  if (isClient) {
    if (needsPasswordSetup) {
      return <ClientSetupFlow session={session} onComplete={() => {
        setNeedsPasswordSetup(false);
        setClientOnboarded(true);
        supabase.auth.updateUser({ data: { password_set: true } });
      }} />;
    }
    if (!clientOnboarded) {
      return <ClientSetupFlow session={session} onComplete={() => setClientOnboarded(true)} />;
    }
    return <ClientPortal session={session} onSignOut={async () => { try { await supabase.auth.signOut(); } catch(e) {} window.location.href = '/'; }} />;
  }

  const user = session.user;
  const isAdmin = profile && profile.role === 'admin';
  const displayName = (profile && profile.full_name) || (user.user_metadata && user.user_metadata.full_name) || user.email || 'Auditor';
  const initials = displayName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  const handleNavigate = (viewName, context = null) => {
    if (viewName === 'clients' && context) {
      setClientsContext(context);
    } else {
      setClientsContext(null);
    }
    setView(viewName);
  };

  const handleAuditStart = async (payload) => {
    setView(VIEW.AUDIT);
    setState(STATE.PROCESSING);
    setError(null);
    try {
      let res;
      if (!payload.mode || payload.mode === 'combined') {
        const file = payload.file || payload;
        setFileName(file.name || 'report.pdf');
        const base64 = await fileToBase64(file);
        res = await runAudit(base64);
      } else if (payload.mode === 'individual') {
        setFileName('3-Bureau Individual Audit');
        const [eq, exp, tu] = await Promise.all([
          fileToBase64(payload.files.equifax),
          fileToBase64(payload.files.experian),
          fileToBase64(payload.files.transunion),
        ]);
        res = await runTripleBureauAudit(eq, exp, tu, (msg) => setFileName(msg));
      } else if (payload.mode === 'single') {
        setFileName(payload.bureau + ' Single Bureau Audit');
        const base64 = await fileToBase64(payload.file);
        res = await runSingleBureauAudit(base64, payload.bureau);
      }
      setAuditResult(res.audit);
      setState(STATE.RESULTS);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Audit failed');
      setState(STATE.ERROR);
    }
  };

  const handleReset = () => { setView(VIEW.AUDIT); setState(STATE.IDLE); setAuditResult(null); setError(null); };
  const handleGenerateLetter = (account) => setActiveLetter(account);
  const handleOpenSavedAudit = (audit) => { setAuditResult(audit); setState(STATE.RESULTS); setView(VIEW.AUDIT); };
  const handleSignOut = async () => { try { await supabase.auth.signOut(); } catch(e) {} window.location.href = '/'; };

  return (
    <div className="min-h-screen bg-bg flex">
      <Sidebar view={view} onNavigate={handleNavigate} displayName={displayName} initials={initials} isAdmin={isAdmin} onSignOut={handleSignOut} onSettings={() => setShowSettings(true)} />
      <main className="flex-1 flex flex-col">
        <TopBar view={view} state={state} isAdmin={isAdmin} />
        <div className="flex-1 overflow-auto p-8">
          {view === VIEW.DASHBOARD && (
            <DashboardPage isAdmin={isAdmin} onNavigate={handleNavigate} onAuditStart={handleAuditStart} />
          )}
          {view === VIEW.CLIENTS && (
            <ClientsPage onOpenAudit={handleOpenSavedAudit} isAdmin={isAdmin} jumpTo={clientsContext?.jumpTo || null} filter={clientsContext?.filter || null} />
          )}
          {view === VIEW.METHODOLOGY && <MethodologyPage />}
          {view === VIEW.TEAM && isAdmin && <TeamPage currentUserId={user.id} />}
          {view === VIEW.AUDIT && (
            <>
              {state === STATE.IDLE && <UploadZone onAuditStart={handleAuditStart} />}
              {state === STATE.PROCESSING && <AuditProgress fileName={fileName} />}
              {state === STATE.RESULTS && auditResult && (
                <AuditResults audit={auditResult} onGenerateLetter={handleGenerateLetter} onReset={handleReset} />
              )}
              {state === STATE.ERROR && <ErrorView error={error} onReset={handleReset} />}
            </>
          )}
        </div>
      </main>
      {activeLetter && auditResult && (
        <LetterViewer account={activeLetter} client={auditResult.client} onClose={() => setActiveLetter(null)} />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} displayName={displayName} email={user.email} />
      )}
    </div>
  );
}

function Sidebar({ view, onNavigate, displayName, initials, isAdmin, onSignOut, onSettings }) {
  return (
    <aside className="w-60 flex flex-col border-r border-navy-light bg-navy-dark">
      <div className="px-5 py-5 border-b border-navy-light">
        <div className="flex items-center gap-2.5">
          <img src="/logo.jpg" alt="CCC" className="w-8 h-8 object-contain rounded" />
          <div>
            <div className="text-white text-[13px] font-medium leading-tight ccc-display">Credit Comeback Club</div>
            <div className="text-[10px] uppercase tracking-[0.18em] text-gold">Forensic Suite</div>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-3">
        <NavItem icon={Home} label="Dashboard" active={view === 'dashboard'} onClick={() => onNavigate('dashboard')} />
        <NavItem icon={LayoutDashboard} label="New Audit" active={view === 'audit'} onClick={() => onNavigate('audit')} />
        <NavItem icon={Users} label="Clients" active={view === 'clients'} onClick={() => onNavigate('clients')} />
        <NavItem icon={BookOpen} label="Methodology" active={view === 'methodology'} onClick={() => onNavigate('methodology')} />
        {isAdmin && (
          <NavItem icon={UserCog} label="Team" active={view === 'team'} onClick={() => onNavigate('team')} />
        )}
      </nav>

      <div className="border-t border-navy-light px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-medium bg-navy-light text-gold shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white text-[12px] truncate">{displayName}</div>
            <div className="text-[10px] uppercase tracking-wider text-gray-400 flex items-center gap-1">
              {isAdmin ? (
                <><Shield size={10} strokeWidth={2} className="text-gold" /><span className="text-gold">Admin</span></>
              ) : 'Auditor'}
            </div>
          </div>
          <button onClick={onSettings} title="Settings" className="text-gray-400 hover:text-gold transition-colors mr-1">
            <Settings size={14} strokeWidth={1.5} />
          </button>
          <button onClick={onSignOut} title="Sign out" className="text-gray-400 hover:text-gold transition-colors">
            <LogOut size={14} strokeWidth={1.5} />
          </button>
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

function TopBar({ view, state, isAdmin }) {
  if (view === 'dashboard') return (
    <header className="px-8 py-5 border-b border-border bg-white">
      <h1 className="ccc-display text-2xl text-ink font-medium">Dashboard</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">
        {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </p>
    </header>
  );
  if (view === 'clients') return (
    <header className="px-8 py-5 border-b border-border bg-white">
      <h1 className="ccc-display text-2xl text-ink font-medium">Clients</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">{isAdmin ? 'All clients across all auditors' : 'Your saved audits and letters'}</p>
    </header>
  );
  if (view === 'methodology') return (
    <header className="px-8 py-5 border-b border-border bg-white">
      <h1 className="ccc-display text-2xl text-ink font-medium">Methodology</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">The Setup &amp; Spike operating doctrine</p>
    </header>
  );
  if (view === 'team') return (
    <header className="px-8 py-5 border-b border-border bg-white">
      <h1 className="ccc-display text-2xl text-ink font-medium">Team</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">Manage users and roles</p>
    </header>
  );
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
      <button onClick={onReset} className="mt-5 px-4 py-2 text-[12px] uppercase tracking-wider rounded-sm bg-navy text-white hover:bg-navy-dark">
        Try Again
      </button>
    </div>
  );
}
