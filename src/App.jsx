import React, { useState, useEffect, Suspense, lazy } from 'react';
import { LayoutDashboard, BookOpen, Users, AlertCircle, LogOut, Shield, UserCog, Home, Settings, Handshake, CheckCircle, DollarSign, UserPlus, Clock, Copy, Inbox, Activity } from 'lucide-react';
import ProspectChatWidget from './components/ProspectChatWidget';
import { Toaster } from 'react-hot-toast';
import { supabase } from './utils/supabase';
import { runAudit, runTripleBureauAudit, runSingleBureauAudit, runMergeBureauAudits } from './utils/api';
import { getUnanalyzedResponseStats } from './utils/actionItems';
import { computeClientCommission } from './utils/affiliateCommission';
import { getSettings } from './utils/settings';
import AffiliateProfilePanel from './components/AffiliateProfilePanel';
import AffiliateApplicationsPanel from './components/AffiliateApplicationsPanel';

const UploadZone = lazy(() => import('./components/UploadZone'));
const AuditProgress = lazy(() => import('./components/AuditProgress'));
const AuditResults = lazy(() => import('./components/AuditResults'));
const BureauParseStatus = lazy(() => import('./components/BureauParseStatus'));
const ClientsPage = lazy(() => import('./components/ClientsPage'));
const MethodologyPage = lazy(() => import('./components/MethodologyPage'));
const AuthPage = lazy(() => import('./components/AuthPage'));
const TeamPage = lazy(() => import('./components/TeamPage'));
const DashboardPage = lazy(() => import('./components/DashboardPage'));
const ClientSetupFlow = lazy(() => import('./components/ClientSetupFlow'));
const ClientPortal = lazy(() => import('./components/ClientPortal'));
const AffiliatePortal = lazy(() => import('./components/AffiliatePortal'));
const SettingsModal = lazy(() => import('./components/SettingsModal'));
const BillingDashboardPage = lazy(() => import('./components/BillingDashboardPage'));
const LetterTrackerPage = lazy(() => import('./components/LetterTrackerPage'));
const InboxPage = lazy(() => import('./components/InboxPage'));
const OperationsPage = lazy(() => import('./components/OperationsPage'));

const STATE = { IDLE: 'idle', PROCESSING: 'processing', RESULTS: 'results', ERROR: 'error' };
const VIEW = { DASHBOARD: 'dashboard', OPERATIONS: 'operations', AUDIT: 'audit', CLIENTS: 'clients', LEADS: 'leads', BILLING: 'billing', LETTER_TRACKER: 'letter-tracker', INBOX: 'inbox', METHODOLOGY: 'methodology', TEAM: 'team', AFFILIATES: 'affiliates' };

// Same link format shown inside the affiliate's own portal
// (AffiliatePortal.jsx) — lets Chris grab it for an affiliate without
// impersonating their account just to read it off their Commissions tab.
function CopyReferralLinkButton({ affiliate }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = (e) => {
    e.stopPropagation();
    navigator.clipboard.writeText(`https://creditcomebackclub.com/join?ref=${affiliate.id.slice(0, 8)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={handleCopy}
      title="Copy referral link"
      className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wider rounded-sm border transition-colors"
      style={{ borderColor: copied ? '#15803D' : '#E7EAF0', color: copied ? '#15803D' : '#6B7280' }}
    >
      {copied ? <CheckCircle size={12} /> : <Copy size={12} />}
      {copied ? 'Copied' : 'Copy Link'}
    </button>
  );
}

function AffiliatesPage() {
  const [affiliates, setAffiliates] = React.useState([]);
  const [clients, setClients] = React.useState([]);
  const [commissionPayouts, setCommissionPayouts] = React.useState([]);
  const [selectedAffiliate, setSelectedAffiliate] = useState(null);
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [form, setForm] = React.useState({ name: '', email: '', company: '', brand_name: '', brand_color: '#22C55E', brand_logo_url: '', commission_rate: '0.20' });
  const [creating, setCreating] = React.useState(false);
  const [sendingInviteId, setSendingInviteId] = React.useState(null);
  const [error, setError] = React.useState(null);
  // Settings' "Default Commission Rate" previously only displayed itself —
  // nothing that creates an affiliate ever read it, so it was cosmetic.
  // Wired here as the actual default for new affiliates' rate field.
  const [defaultCommissionRate, setDefaultCommissionRate] = React.useState('0.20');

  React.useEffect(() => {
    loadData();
    getSettings().then((s) => {
      const pct = s?.affiliates?.defaultCommissionRate ?? 20;
      const decimal = (pct / 100).toFixed(2);
      setDefaultCommissionRate(decimal);
      setForm((f) => ({ ...f, commission_rate: decimal }));
    }).catch(() => {});
  }, []);

  const loadData = async () => {
    const [affRes, clientRes, payoutsRes] = await Promise.all([
      supabase.from('affiliates').select('*').order('created_at', { ascending: false }),
      supabase.from('clients').select('id, name, created_at, referred_by, referral_fee, commission_paid, commission_paid_at, ledger').not('referred_by', 'is', null),
      supabase.from('commission_payouts').select('client_id, covered_tx_ids, amount'),
    ]);
    setAffiliates(affRes.data || []);
    setClients(clientRes.data || []);
    setCommissionPayouts(payoutsRes.data || []);
    setLoading(false);
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.email.trim()) { setError('Name and email required.'); return; }
    setCreating(true);
    setError(null);
    try {
      const normEmail = form.email.trim().toLowerCase();

      // Insert affiliate record
      const { error: insertErr } = await supabase.from('affiliates').insert({
        name: form.name.trim(),
        email: normEmail,
        company: form.company.trim() || null,
        brand_name: form.brand_name.trim() || form.company.trim() || form.name.trim(),
        brand_color: form.brand_color || '#22C55E',
        brand_logo_url: form.brand_logo_url.trim() || null,
        commission_rate: parseFloat(form.commission_rate) || 0.20,
      });
      if (insertErr) throw insertErr;

      // Provision the auth user server-side and link affiliates.user_id
      // before any magic link goes out
      const { data: { session: _adminSess } } = await supabase.auth.getSession();
      const _adminTok = _adminSess?.access_token;
      const _adminHeaders = { 'Content-Type': 'application/json', ...(_adminTok ? { Authorization: `Bearer ${_adminTok}` } : {}) };

      const provRes = await fetch('/.netlify/functions/provision-user', {
        method: 'POST',
        headers: _adminHeaders,
        body: JSON.stringify({ email: normEmail, fullName: form.name.trim(), kind: 'affiliate' }),
      });
      if (!provRes.ok) {
        const out = await provRes.json().catch(() => ({}));
        throw new Error(out.error || 'Could not provision affiliate account');
      }

      setShowCreate(false);
      setForm({ name: '', email: '', company: '', brand_name: '', brand_color: '#22C55E', brand_logo_url: '', commission_rate: defaultCommissionRate });
      loadData();
      alert('Affiliate created and magic link sent to ' + form.email);
    } catch(e) {
      setError(e.message || 'Could not create affiliate');
    } finally {
      setCreating(false);
    }
  };

  const handleResendInvite = async (affiliate, event) => {
    event.stopPropagation();
    if (!affiliate.email) { alert('Add an email address before sending an invite.'); return; }
    setSendingInviteId(affiliate.id);
    try {
      const { data: { session: adminSession } } = await supabase.auth.getSession();
      const adminToken = adminSession?.access_token;
      if (!adminToken) throw new Error('Your admin session has expired. Please sign in again.');
      const response = await fetch('/.netlify/functions/provision-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ email: affiliate.email.trim().toLowerCase(), fullName: affiliate.name, kind: 'affiliate' }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not resend affiliate invitation');
      alert('A new secure partner portal invite was sent to ' + affiliate.email);
    } catch (error) {
      alert(error.message || 'Could not resend affiliate invitation');
    } finally {
      setSendingInviteId(null);
    }
  };

  if (loading) return <div className="p-8 text-ink-muted text-[13px]">Loading affiliates…</div>;

  return (
    <div className="max-w-4xl mx-auto" style={{ padding: '24px 32px' }}>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="ccc-display text-[22px] text-ink font-medium">Affiliates</h1>
          <p className="text-[12px] text-ink-muted mt-1">{affiliates.length} affiliate partner{affiliates.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 text-[12px] uppercase tracking-wider rounded-sm"
          style={{ background: '#1B2A4A', color: '#C9A84C' }}>
          + New Affiliate
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-[12px] text-red-700">{error}</div>}

      <AffiliateApplicationsPanel
        defaultCommissionRate={Number(defaultCommissionRate) || 0.20}
        onAffiliateCreated={loadData}
      />

      {affiliates.length === 0 ? (
        <div className="border border-border rounded p-12 text-center">
          <Handshake size={28} className="text-ink-faint mx-auto mb-3" strokeWidth={1.5} />
          <p className="text-[13px] text-ink-muted">No affiliates yet. Create one to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {affiliates.map(aff => {
            const affClients = clients.filter(c => c.referred_by === aff.id);
            let paidComm = 0, pendingComm = 0;
            for (const c of affClients) {
              const payoutsForClient = commissionPayouts.filter(p => p.client_id === c.id);
              const { paid, owed } = computeClientCommission(c, aff, payoutsForClient);
              paidComm += paid;
              pendingComm += owed;
            }
            return (
              <div 
                key={aff.id} 
                className="border border-border rounded bg-white cursor-pointer hover:shadow-sm transition-shadow"
                onClick={() => setSelectedAffiliate(aff)}
              >
                <div className="p-4 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {aff.brand_logo_url && <img src={aff.brand_logo_url} alt={aff.brand_name} style={{ height: 28, objectFit: 'contain' }} />}
                    <div>
                      <div className="text-[14px] font-medium text-ink">{aff.name}</div>
                      <div className="text-[11px] text-ink-muted">{aff.company} · {aff.email} · {Math.round(aff.commission_rate * 100)}% commission</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 text-right">
                    <div>
                      <div className="text-[18px] font-bold text-ink">{affClients.length}</div>
                      <div className="text-[10px] uppercase tracking-wider text-ink-faint">Clients</div>
                    </div>
                    <div>
                      <div className="text-[18px] font-bold" style={{ color: '#15803D' }}>${paidComm.toFixed(2)}</div>
                      <div className="text-[10px] uppercase tracking-wider text-ink-faint">Paid</div>
                    </div>
                    <div>
                      <div className="text-[18px] font-bold" style={{ color: '#D97706' }}>${pendingComm.toFixed(2)}</div>
                      <div className="text-[10px] uppercase tracking-wider text-ink-faint">Pending</div>
                    </div>
                    <button
                      onClick={(event) => handleResendInvite(aff, event)}
                      disabled={sendingInviteId === aff.id || !aff.email}
                      className="flex items-center gap-1 px-2 py-1 text-[10px] uppercase tracking-wider rounded-sm border transition-colors disabled:opacity-50"
                      style={{ borderColor: '#E7EAF0', color: '#6B7280' }}
                    >
                      {sendingInviteId === aff.id ? 'Sending…' : 'Resend Invite'}
                    </button>
                    <CopyReferralLinkButton affiliate={aff} />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedAffiliate && (() => {
        const affClientIds = new Set(clients.filter(c => c.referred_by === selectedAffiliate.id).map(c => c.id));
        return (
          <AffiliateProfilePanel
            affiliate={selectedAffiliate}
            clients={clients.filter(c => c.referred_by === selectedAffiliate.id)}
            commissionPayouts={commissionPayouts.filter(p => affClientIds.has(p.client_id))}
            onClose={() => setSelectedAffiliate(null)}
            onUpdate={loadData}
          />
        );
      })()}

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-6" onClick={() => setShowCreate(false)}>
          <div className="bg-white border border-border rounded w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-[15px] font-medium text-ink mb-5">New Affiliate Partner</h2>
            {[
              { key: 'name', label: 'Contact Name', required: true },
              { key: 'email', label: 'Email Address', required: true },
              { key: 'company', label: 'Company Name' },
              { key: 'brand_name', label: 'Portal Brand Name' },
              { key: 'brand_logo_url', label: 'Logo URL' },
              { key: 'brand_color', label: 'Brand Color (hex)' },
              { key: 'commission_rate', label: 'Commission Rate (e.g. 0.20 = 20%)' },
            ].map(({ key, label, required }) => (
              <div key={key} className="mb-3">
                <label className="block text-[11px] uppercase tracking-wider text-ink-muted mb-1">{label}{required && <span className="text-red-500 ml-1">*</span>}</label>
                <input
                  type="text"
                  value={form[key]}
                  onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
                  className="w-full border border-border rounded px-3 py-2 text-[13px] text-ink"
                />
              </div>
            ))}
            {error && <div className="mb-3 text-[12px] text-red-600">{error}</div>}
            <div className="flex gap-2 mt-5">
              <button onClick={handleCreate} disabled={creating}
                className="flex-1 py-2.5 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                style={{ background: creating ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C' }}>
                {creating ? 'Creating…' : 'Create & Send Magic Link'}
              </button>
              <button onClick={() => setShowCreate(false)} className="px-4 py-2.5 text-[12px] uppercase tracking-wider border border-border rounded-sm text-ink-muted hover:text-ink">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  if (window.location.pathname === '/widget') {
    return <ProspectChatWidget />;
  }

  const [session, setSession] = useState(undefined);
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [view, setView] = useState(VIEW.DASHBOARD);
  const [clientsContext, setClientsContext] = useState(null);
  const [clientsNavigationKey, setClientsNavigationKey] = useState(0);
  const [state, setState] = useState(STATE.IDLE);
  const [auditResult, setAuditResult] = useState(null);
  const [fileName, setFileName] = useState('');
  const [auditMode, setAuditMode] = useState(null);
  const [auditProgress, setAuditProgress] = useState(null);
  const [error, setError] = useState(null);
  const [auditClientName, setAuditClientName] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [isAffiliate, setIsAffiliate] = useState(false);
  const [clientOnboarded, setClientOnboarded] = useState(false);
  const [needsPasswordSetup, setNeedsPasswordSetup] = useState(false);
  const [actionItemCount, setActionItemCount] = useState(0);
  const [ackedActionItems, setAckedActionItems] = useState(0);
  const [newLeadsCount, setNewLeadsCount] = useState(0);
  const [unanalyzedClientNames, setUnanalyzedClientNames] = useState(new Set());
  const [unanalyzedClientIds, setUnanalyzedClientIds] = useState(new Set());
  const refreshActionItems = () => {
    getUnanalyzedResponseStats().then(({ count, clientNames, clientIds }) => {
      setActionItemCount(count);
      setUnanalyzedClientNames(clientNames);
      setUnanalyzedClientIds(clientIds);
    }).catch(() => {});
    import('./utils/actionItems').then(m => m.getNewLeadsCount()).then(c => setNewLeadsCount(c)).catch(() => {});
  };
  const loadUserInFlight = React.useRef(false);
  // Mirror of profile state for the visibilitychange handler, which is bound
  // once on mount and would otherwise close over stale values
  const appStateRef = React.useRef({ profile: null, profileLoading: false });
  useEffect(() => { appStateRef.current = { profile, profileLoading }; }, [profile, profileLoading]);

  // Sidebar action-item badge — unanalyzed client-uploaded responses.
  // Admin/auditor only; clients and affiliates don't see this shell.
  useEffect(() => {
    if (session && profile && !isClient && !isAffiliate) {
      refreshActionItems();
    }
  }, [session, profile, isClient, isAffiliate]);

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
      if (_event === 'PASSWORD_RECOVERY') {
        // Force password setup screen for explicit password recovery only
        if (session) {
          setSession(session);
          setNeedsPasswordSetup(true);
          setIsClient(true);
          setProfileLoading(false);
        }
        return;
      }
      setSession(session);
      if (!session) {
        setProfile(null);
        setIsClient(false);
        setProfileLoading(false);
        return;
      }
      // Only reload user on actual sign-in — token refreshes and metadata
      // updates (USER_UPDATED) don't change role classification, and re-running
      // loadUser mid-flow unmounts the setup/portal screens
      if (_event === 'SIGNED_IN') {
        await loadUser(session, _event);
      }
    });
    // On tab focus — reload only if a session exists but the app never
    // managed to classify the account (state lost). A signed-in user with a
    // loaded profile must NOT be reloaded, or tabbing away mid-onboarding
    // wipes their progress.
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;
      const hasToken = Object.keys(localStorage).some(k => k.includes('auth-token'));
      const { profile, profileLoading } = appStateRef.current;
      if (hasToken && !profile && !profileLoading) {
        window.location.reload();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      subscription.unsubscribe();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  const loadUser = async (session, _event) => {
    // Serialize — initAuth and onAuthStateChange both fire on first login;
    // two concurrent classification passes must never race each other
    if (loadUserInFlight.current) return;
    loadUserInFlight.current = true;
    setProfileLoading(true);
    // Safety timeout — never stay loading forever
    const safetyTimer = setTimeout(() => {
      console.warn('loadUser timeout — could not verify account role in time, showing retry screen rather than guessing a role');
      setProfileLoadFailed(true);
      setProfileLoading(false);
    }, 5000);
    try {
      // PostgREST eq is case-sensitive; auth stores emails lowercased
      const email = (session.user.email || '').toLowerCase();

      // Raw fetch — supabase client hangs intermittently
      const _url = import.meta.env.VITE_SUPABASE_URL;
      const _key = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const _tok = session.access_token;
      const _hdrs = { apikey: _key, Authorization: 'Bearer ' + _tok };
      const _pr = await fetch(_url + '/rest/v1/profiles?id=eq.' + session.user.id + '&limit=1', { headers: _hdrs });
      const _prd = await _pr.json();
      const prof = Array.isArray(_prd) && _prd.length > 0 ? _prd[0] : null;

      // Check affiliates table FIRST — before profiles, so affiliates aren't misrouted
      const _ar = await fetch(_url + '/rest/v1/affiliates?email=eq.' + encodeURIComponent(email) + '&limit=1', { headers: _hdrs });
      const _ard = await _ar.json();
      const aff = Array.isArray(_ard) && _ard.length > 0 ? _ard[0] : null;
      if (aff) {
        // Wire user_id on first login if provisioning didn't already set it
        if (!aff.user_id) {
          const wireRes = await fetch(_url + '/rest/v1/affiliates?id=eq.' + aff.id, {
            method: 'PATCH',
            headers: { ..._hdrs, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ user_id: session.user.id })
          });
          if (!wireRes.ok) console.warn('Could not link affiliate user_id (status ' + wireRes.status + ')');
        }
        setIsAffiliate(true);
        setIsClient(false);
        setProfile(prof || { id: session.user.id, email, role: 'affiliate' });
        return;
      }

      if (prof && (prof.role === 'admin' || prof.role === 'auditor')) {
        setProfile(prof);
        setIsClient(false);
        return;
      }

      const _cr = await fetch(_url + '/rest/v1/client_profiles?email=eq.' + encodeURIComponent(email) + '&limit=1', { headers: _hdrs });
      const _crd = await _cr.json();
      let cp = Array.isArray(_crd) && _crd.length > 0 ? _crd[0] : null;
      if (!cp) {
        // Second look via the supabase client before concluding they're not a client
        const { data: cpCheck } = await supabase.from('client_profiles').select('*').eq('email', email).limit(1);
        cp = cpCheck && cpCheck.length > 0 ? cpCheck[0] : null;
      }

      if (cp) {
        setIsClient(true);

        // Also check clients table — lpoa_signed=true means they went through the
        // admin/manual LPOA flow and are fully onboarded even if onboarding_complete
        // was never flipped on client_profiles (e.g. Chris signed on their behalf).
        let lpoaSigned = false;
        try {
          const _clr = await fetch(_url + '/rest/v1/clients?email=eq.' + encodeURIComponent(email) + '&select=lpoa_signed&limit=1', { headers: _hdrs });
          const _cld = await _clr.json();
          lpoaSigned = Array.isArray(_cld) && _cld.length > 0 && _cld[0].lpoa_signed === true;
        } catch (_e) { /* non-fatal */ }

        const effectivelyOnboarded = cp.onboarding_complete === true || lpoaSigned;

        // Auto-heal: if LPOA is signed but onboarding_complete is not yet set, fix it now
        if (lpoaSigned && !cp.onboarding_complete) {
          fetch(_url + '/rest/v1/client_profiles?email=eq.' + encodeURIComponent(email), {
            method: 'PATCH',
            headers: { ..._hdrs, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ onboarding_complete: true }),
          }).catch(e => console.warn('Auto-heal onboarding_complete failed:', e));
        }

        setClientOnboarded(effectivelyOnboarded);
        // Always require a password on first portal login (or recovery), even if
        // LPOA was signed out-of-band. Skipping this left clients who never set
        // a password stuck on "forgot password" later.
        const passwordSet = session.user.user_metadata?.password_set;
        const fromRecovery = _event === 'PASSWORD_RECOVERY';
        setNeedsPasswordSetup(fromRecovery || !passwordSet);
        if (!cp.user_id) {
          const wireRes = await fetch(_url + '/rest/v1/client_profiles?email=eq.' + encodeURIComponent(email), {
            method: 'PATCH',
            headers: { ..._hdrs, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
            body: JSON.stringify({ user_id: session.user.id })
          });
          if (!wireRes.ok) console.warn('Could not link client user_id (status ' + wireRes.status + ')');
        }
        setProfile(prof || { id: session.user.id, email, role: 'client' });
        return;
      }

      if (!prof) {
        // Staff roles are provisioned by an admin/backend before first login.
        // Never derive an auditor role from user-editable auth metadata or let
        // a browser create a profiles row — that would make the paid AI
        // endpoints privilege-escalatable by any new account.
        setProfileLoadFailed(true);
        return;
      }
      setProfile(prof);
      setIsClient(false);
    } catch (e) {
      console.error('loadUser error:', e);
      setProfileLoadFailed(true);
    } finally {
      clearTimeout(safetyTimer);
      setProfileLoading(false);
      loadUserInFlight.current = false;
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

  if (profileLoadFailed) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-center max-w-sm px-6">
          <div className="text-[14px] text-ink font-medium mb-2">Couldn't verify your account</div>
          <p className="text-[13px] text-ink-muted mb-4">This can happen on a slow connection. Please try again — we won't guess your account type.</p>
          <button
            onClick={() => { setProfileLoadFailed(false); window.location.reload(); }}
            className="px-4 py-2 text-[12px] uppercase tracking-wider rounded-sm"
            style={{ backgroundColor: '#1B2A4A', color: '#C9A84C' }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (profileLoading || (session && !profile)) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="text-[13px] text-ink-muted">Loading…</div>
      </div>
    );
  }

  // Affiliate portal routing
  if (isAffiliate) {
    return <AffiliatePortal session={session} onSignOut={async () => { try { await supabase.auth.signOut(); } catch(e) {} setIsAffiliate(false); window.location.href = '/'; }} />;
  }

  // Client portal routing
  if (isClient) {
    if (needsPasswordSetup) {
      return (
        <ClientSetupFlow
          session={session}
          requireOnboarding={!clientOnboarded}
          onComplete={async () => {
            setNeedsPasswordSetup(false);
            setClientOnboarded(true);
            try { await supabase.auth.updateUser({ data: { password_set: true } }); }
            catch (e) { console.warn('Could not persist password_set flag:', e); }
          }}
        />
      );
    }
    if (!clientOnboarded) {
      return <ClientSetupFlow session={session} initialStep="onboarding" onComplete={() => setClientOnboarded(true)} />;
    }
    return <ClientPortal session={session} onSignOut={async () => { try { await supabase.auth.signOut(); } catch(e) {} window.location.href = '/'; }} />;
  }

  const user = session.user;
  const isAdmin = profile && profile.role === 'admin';
  const displayName = (profile && profile.full_name) || (user.user_metadata && user.user_metadata.full_name) || user.email || 'Auditor';
  const initials = displayName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();

  const handleNavigate = async (viewName, context = null) => {
    // Sidebar red badges: treat click as "I've seen these."
    // Leads → persist viewed so the count actually drops.
    // Clients action items → acknowledge current count for this session; badge
    // returns only if new unanalyzed responses arrive (or after refresh + work left
    // if they never ack — analyzing still lowers the raw count).
    if (viewName === 'leads' && newLeadsCount > 0) {
      try {
        const { markAllLeadsViewed } = await import('./utils/storage');
        await markAllLeadsViewed();
        setNewLeadsCount(0);
      } catch (e) {
        console.warn('Could not mark leads viewed:', e.message || e);
      }
    }
    if (viewName === 'clients' && actionItemCount > 0) {
      setAckedActionItems(actionItemCount);
    }

    setClientsContext(context);
    // auditClientName is a one-time "jump to the client whose audit I just
    // opened" signal (set in handleOpenSavedAudit) — it must be cleared on
    // every navigation to 'clients', even when a context is also being set
    // (e.g. the sidebar's own "Clients" button passes a {filter:'unanalyzed'}
    // context whenever there's a pending unanalyzed response). Otherwise
    // that context is unrelated to the stale jump target, which then keeps
    // re-surfacing the same old client indefinitely.
    if (viewName === 'clients') {
      setAuditClientName(null);
      setClientsNavigationKey((current) => current + 1);
    }
    setView(viewName);
    refreshActionItems();
  };

  const handleAuditStart = async (payload) => {
    setView(VIEW.AUDIT);
    setState(STATE.PROCESSING);
    setError(null);
    setAuditProgress(null);
    setAuditMode(payload.mode || 'combined');
    try {
      let res;
      if (!payload.mode || payload.mode === 'combined') {
        const file = payload.file || payload;
        setFileName(file.name || 'report.pdf');
        res = await runAudit(file, setAuditProgress, payload.clientSelection);
      } else if (payload.mode === 'individual') {
        setFileName('3-Bureau Individual Audit');
        res = await runTripleBureauAudit(payload.files, setAuditProgress, payload.clientSelection);
      } else if (payload.mode === 'single') {
        setFileName(payload.bureau + ' Single Bureau Parse');
        res = await runSingleBureauAudit(payload.file, payload.bureau, setAuditProgress, payload.clientSelection);
      } else if (payload.mode === 'merge') {
        setFileName('Merge bureau parses');
        res = await runMergeBureauAudits(payload.clientSelection, setAuditProgress);
      }
      setAuditResult(res.audit);
      setState(STATE.RESULTS);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Audit failed');
      setState(STATE.ERROR);
    }
  };

  const handleMergeFromParseStatus = async () => {
    if (!auditResult?.clientId) {
      setError('Missing client id for merge — re-select the client and try Merge from the upload screen.');
      setState(STATE.ERROR);
      return;
    }
    setState(STATE.PROCESSING);
    setError(null);
    setFileName('Merge bureau parses');
    try {
      const res = await runMergeBureauAudits(
        { type: 'existing', id: auditResult.clientId, name: auditResult.clientName },
        setAuditProgress,
      );
      setAuditResult(res.audit);
      setState(STATE.RESULTS);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Merge failed');
      setState(STATE.ERROR);
    }
  };

  const handleReset = () => { setView(VIEW.AUDIT); setState(STATE.IDLE); setAuditResult(null); setError(null); };
  const handleOpenSavedAudit = (audit) => {
    setAuditResult(audit);
    setState(STATE.RESULTS);
    setView(VIEW.AUDIT);
    setAuditClientName(audit && audit.client && audit.client.name || null);
  };
  const handleSignOut = async () => { try { await supabase.auth.signOut(); } catch(e) {} window.location.href = '/'; };

  return (
    <div className="min-h-screen bg-bg flex">
      <Toaster position="bottom-right" />
      <Sidebar view={view} onNavigate={handleNavigate} displayName={displayName} initials={initials} isAdmin={isAdmin} onSignOut={handleSignOut} onSettings={() => setShowSettings(true)} actionItemCount={Math.max(0, actionItemCount - ackedActionItems)} newLeadsCount={newLeadsCount} />
      <main className="flex-1 flex flex-col">
        <TopBar view={view} state={state} isAdmin={isAdmin} />
        <div className="flex-1 overflow-auto p-8">
          <Suspense fallback={
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-8 h-8 border-4 border-navy border-t-gold rounded-full animate-spin"></div>
            </div>
          }>
            {view === VIEW.DASHBOARD && (
              <DashboardPage isAdmin={isAdmin} onNavigate={handleNavigate} displayName={displayName} />
            )}
            {view === VIEW.CLIENTS && (
              <ClientsPage onOpenAudit={handleOpenSavedAudit} isAdmin={isAdmin} jumpTo={clientsContext?.jumpTo || auditClientName || null} filter={clientsContext?.filter || null} navigationKey={clientsNavigationKey} forceTab="clients" unanalyzedNames={unanalyzedClientNames} unanalyzedClientIds={unanalyzedClientIds} onLeadsChanged={refreshActionItems} />
            )}
            {view === VIEW.LEADS && (
              <ClientsPage onOpenAudit={handleOpenSavedAudit} isAdmin={isAdmin} jumpTo={null} filter={clientsContext?.filter || null} forceTab="leads" onLeadsChanged={refreshActionItems} />
            )}
            {view === VIEW.METHODOLOGY && <MethodologyPage />}
            {view === VIEW.TEAM && isAdmin && <TeamPage currentUserId={user.id} />}
            {view === VIEW.AFFILIATES && isAdmin && <AffiliatesPage />}
            {view === VIEW.BILLING && isAdmin && <BillingDashboardPage onNavigate={handleNavigate} isAdmin={isAdmin} />}
            {view === VIEW.LETTER_TRACKER && isAdmin && <LetterTrackerPage onNavigate={handleNavigate} isAdmin={isAdmin} />}
            {view === VIEW.INBOX && isAdmin && <InboxPage onNavigate={handleNavigate} isAdmin={isAdmin} />}
            {view === VIEW.OPERATIONS && isAdmin && <OperationsPage onNavigate={handleNavigate} />}
            {view === VIEW.AUDIT && (
              <>
                {state === STATE.IDLE && <UploadZone onAuditStart={handleAuditStart} />}
                {state === STATE.PROCESSING && <AuditProgress fileName={fileName} progress={auditProgress} mode={auditMode} />}
                {state === STATE.RESULTS && auditResult?.kind === 'bureau_parse' && (
                  <BureauParseStatus
                    result={auditResult}
                    onMerge={handleMergeFromParseStatus}
                    onReset={handleReset}
                  />
                )}
                {state === STATE.RESULTS && auditResult && auditResult.kind !== 'bureau_parse' && (
                  <AuditResults audit={auditResult} onReset={handleReset} onBackToClients={() => setView(VIEW.CLIENTS)} />
                )}
                {state === STATE.ERROR && <ErrorView error={error} onReset={handleReset} />}
              </>
            )}
          </Suspense>
        </div>
      </main>
      <Suspense fallback={null}>
        {showSettings && (
          <SettingsModal onClose={() => setShowSettings(false)} displayName={displayName} email={user.email} isAdmin={isAdmin} />
        )}
      </Suspense>
    </div>
  );
}

function Sidebar({ view, onNavigate, displayName, initials, isAdmin, onSignOut, onSettings, actionItemCount, newLeadsCount }) {
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
        {isAdmin && (
          <NavItem icon={Inbox} label="Inbox" active={view === 'inbox'} onClick={() => onNavigate('inbox')} />
        )}
        {isAdmin && (
          <NavItem icon={Activity} label="Operations" active={view === 'operations'} onClick={() => onNavigate('operations')} />
        )}
        <NavItem icon={LayoutDashboard} label="New Audit" active={view === 'audit'} onClick={() => onNavigate('audit')} />
        <NavItem icon={Users} label="Clients" active={view === 'clients'} onClick={() => onNavigate('clients')} badge={actionItemCount} badgeTitle="unanalyzed client response(s)" />
        <NavItem icon={UserPlus} label="Leads" active={view === 'leads'} onClick={() => onNavigate('leads', newLeadsCount > 0 ? { filter: 'unviewed' } : null)} badge={newLeadsCount} badgeTitle="unviewed lead(s) — click to open & clear badge" />
        <NavItem icon={BookOpen} label="Methodology" active={view === 'methodology'} onClick={() => onNavigate('methodology')} />
        {isAdmin && (
          <NavItem icon={DollarSign} label="Billing" active={view === 'billing'} onClick={() => onNavigate('billing')} />
        )}
        {isAdmin && (
          <NavItem icon={Clock} label="Letter Tracker" active={view === 'letter-tracker'} onClick={() => onNavigate('letter-tracker')} />
        )}
        {isAdmin && (
          <NavItem icon={UserCog} label="Team" active={view === 'team'} onClick={() => onNavigate('team')} />
        )}
        {isAdmin && (
          <NavItem icon={Handshake} label="Affiliates" active={view === 'affiliates'} onClick={() => onNavigate('affiliates')} />
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

function NavItem({ icon: Icon, label, active, onClick, badge, badgeTitle }) {
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
      {badge > 0 && (
        <span title={badge + ' ' + badgeTitle}
          className="ml-auto flex items-center justify-center text-[10px] font-semibold rounded-full"
          style={{ minWidth: 17, height: 17, padding: '0 5px', background: '#DC2626', color: '#fff' }}>
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  );
}

function TopBar({ view, state, isAdmin }) {
  // These views carry their own branded page headers
  if (['dashboard', 'clients', 'leads', 'methodology', 'team', 'audit', 'letter-tracker', 'inbox', 'operations'].includes(view)) return null;
  if (view === 'clients') return (
    <header className="px-8 py-5 border-b border-border bg-white">
      <h1 className="ccc-display text-2xl text-ink font-medium">Clients</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">{isAdmin ? 'All clients across all auditors' : 'Your saved audits and letters'}</p>
    </header>
  );
  if (view === 'leads') return (
    <header className="px-8 py-5 border-b border-border bg-white">
      <h1 className="ccc-display text-2xl text-ink font-medium">Leads</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">Prospects in the pipeline — not yet signed or paid</p>
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
  if (view === 'affiliates') return (
    <header className="px-8 py-5 border-b border-border bg-white">
      <h1 className="ccc-display text-2xl text-ink font-medium">Affiliate Partners</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">Manage referral partners, commissions, and branded portals</p>
    </header>
  );
  if (view === 'billing') return (
    <header className="px-8 py-5 border-b border-border bg-white">
      <h1 className="ccc-display text-2xl text-ink font-medium">Billing &amp; Revenue</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">Company-wide ledger and financial metrics</p>
    </header>
  );
  const titles = {
    idle: { title: 'New 3B Audit', subtitle: 'Upload report → classify the correct Consent, Accuracy, or Collection R1' },
    processing: { title: 'Analyzing Report', subtitle: 'Extracting report facts for deterministic R1 classification' },
    results: { title: 'R1 Start Instructions', subtitle: 'Review the bureau plan before opening the stored-template campaign builder' },
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
