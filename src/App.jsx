import React, { useState, useEffect, Suspense, lazy } from 'react';
import { LayoutDashboard, BookOpen, Users, AlertCircle, LogOut, Shield, UserCog, Home, Settings, Handshake, CheckCircle, DollarSign, UserPlus, Clock, Copy, Inbox, Activity } from 'lucide-react';
import { Toaster } from 'react-hot-toast';
import { supabase } from './utils/supabase';
import { runAudit, runTripleBureauAudit, runSingleBureauAudit, runMergeBureauAudits } from './utils/api';
import {
  auditRecoveryDisposition,
  SAVED_AUDIT_TIMEOUT_MESSAGE,
  findLatestRecoverableAuditJob,
  findOwnedAuditJob,
  forgetAuditRecovery,
  readRememberedAuditRecovery,
  rememberAuditRecovery,
  resumeAuditJob,
  selectAuditRecoveryCandidate,
} from './utils/auditJobs.js';
import { getUnanalyzedResponseStats } from './utils/actionItems';
import { computeClientCommission } from './utils/affiliateCommission';
import { getSettings } from './utils/settings';
import { ADMIN_THEME_VARS } from './utils/adminBrand';
import { listBureauParsesForClient, summarizeBureauParses } from './utils/auditBureauParses';
import AffiliateProfilePanel from './components/AffiliateProfilePanel';
import AffiliateApplicationsPanel from './components/AffiliateApplicationsPanel';

const UploadZone = lazy(() => import('./components/UploadZone'));
const ProspectChatWidget = lazy(() => import('./components/ProspectChatWidget'));
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
const AffiliateOnboardingFlow = lazy(() => import('./components/AffiliateOnboardingFlow'));
const SettingsModal = lazy(() => import('./components/SettingsModal'));
const BillingDashboardPage = lazy(() => import('./components/BillingDashboardPage'));
const LetterTrackerPage = lazy(() => import('./components/LetterTrackerPage'));
const InboxPage = lazy(() => import('./components/InboxPage'));
const OperationsPage = lazy(() => import('./components/OperationsPage'));

const STATE = { IDLE: 'idle', PROCESSING: 'processing', RESULTS: 'results', ERROR: 'error' };
const VIEW = { DASHBOARD: 'dashboard', OPERATIONS: 'operations', AUDIT: 'audit', CLIENTS: 'clients', LEADS: 'leads', BILLING: 'billing', LETTER_TRACKER: 'letter-tracker', INBOX: 'inbox', METHODOLOGY: 'methodology', TEAM: 'team', AFFILIATES: 'affiliates' };

function LazyRouteFallback() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center" role="status" aria-live="polite">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-4 border-navy border-t-gold rounded-full animate-spin" aria-hidden="true" />
        <div className="text-[11px] font-bold uppercase tracking-widest text-ink-muted">Loading…</div>
      </div>
    </div>
  );
}

function LazyRoute({ children }) {
  return <Suspense fallback={<LazyRouteFallback />}>{children}</Suspense>;
}

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

      const { data: { session: adminSession } } = await supabase.auth.getSession();
      if (!adminSession?.user?.id) throw new Error('Your admin session has expired. Sign in again.');
      // Staff-entered partners use the same owner review and agreement gate as
      // public applicants. No affiliate identity or portal invite is created here.
      const { error: insertErr } = await supabase.from('affiliate_applications').insert({
        user_id: adminSession.user.id,
        name: form.name.trim(),
        email: normEmail,
        company: form.company.trim() || null,
        source: 'staff_entered',
        referral_notes: [
          'Staff-entered application.',
          form.brand_name.trim() ? `Requested portal brand: ${form.brand_name.trim()}.` : '',
          form.brand_logo_url.trim() ? `Requested logo: ${form.brand_logo_url.trim()}.` : '',
        ].filter(Boolean).join(' '),
      });
      if (insertErr) throw insertErr;

      setShowCreate(false);
      setForm({ name: '', email: '', company: '', brand_name: '', brand_color: '#22C55E', brand_logo_url: '', commission_rate: defaultCommissionRate });
      loadData();
      alert('Partner application added to the owner review queue. No portal access was sent.');
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
      const onboardingInvite = affiliate.program_status === 'agreement_sent' && affiliate.current_agreement_id;
      const response = await fetch(onboardingInvite ? '/.netlify/functions/affiliate-agreement-onboarding' : '/.netlify/functions/provision-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(onboardingInvite
          ? { action: 'resend', agreementId: affiliate.current_agreement_id }
          : { email: affiliate.email.trim().toLowerCase(), fullName: affiliate.name, kind: 'affiliate' }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not resend affiliate invitation');
      alert(`A new secure ${onboardingInvite ? 'agreement' : 'partner portal'} invite was sent to ${affiliate.email}`);
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
          + New Applicant
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
                    {aff.brand_logo_url && <img src={aff.brand_logo_url} alt={aff.brand_name} loading="lazy" decoding="async" style={{ height: 28, objectFit: 'contain' }} />}
                    <div>
                      <div className="text-[14px] font-medium text-ink">{aff.name}</div>
                      <div className="text-[11px] text-ink-muted">{aff.company} · {aff.email} · {Math.round(aff.commission_rate * 100)}% commission · {(aff.program_status || 'pending').replaceAll('_', ' ')}</div>
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
                      disabled={sendingInviteId === aff.id || !aff.email || !['legacy_active', 'active', 'agreement_sent'].includes(aff.program_status)}
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
            <h2 className="text-[15px] font-medium text-ink mb-1">New Partner Application</h2>
            <p className="text-[11px] text-ink-muted mb-5">This creates an owner-review application. It does not create portal access or send an invite.</p>
            {[
              { key: 'name', label: 'Contact Name', required: true },
              { key: 'email', label: 'Email Address', required: true },
              { key: 'company', label: 'Company Name' },
              { key: 'brand_name', label: 'Portal Brand Name' },
              { key: 'brand_logo_url', label: 'Logo URL' },
              { key: 'brand_color', label: 'Brand Color (hex)' },
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
                {creating ? 'Adding…' : 'Add to Review Queue'}
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
    return <Suspense fallback={<div className="h-screen w-full bg-transparent" />}><ProspectChatWidget /></Suspense>;
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
  const [failedAuditRecovery, setFailedAuditRecovery] = useState(null);
  const [auditRecoveryChecked, setAuditRecoveryChecked] = useState(false);
  const [auditClientName, setAuditClientName] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [isClient, setIsClient] = useState(false);
  const [isAffiliate, setIsAffiliate] = useState(false);
  const [affiliateAccess, setAffiliateAccess] = useState(null);
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
  const recoveryHydratedForUser = React.useRef(null);
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

  // A terminal provider timeout owns a durable report and paid checkpoints.
  // Hydrate that exact job before exposing UploadZone so a refresh, closed
  // tab, or deploy cannot accidentally turn recovery into a second paid job.
  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId || !profile || isClient || isAffiliate) return;
    if (recoveryHydratedForUser.current === userId) return;
    recoveryHydratedForUser.current = userId;
    setAuditRecoveryChecked(false);
    setFailedAuditRecovery(null);
    setError(null);
    setState(STATE.IDLE);
    let cancelled = false;
    const rememberedJobId = readRememberedAuditRecovery(userId);
    let unresolvedRememberedJobId = rememberedJobId;
    const showRecovery = (jobId, message = SAVED_AUDIT_TIMEOUT_MESSAGE, canResume = true) => {
      if (cancelled) return;
      setFailedAuditRecovery({ jobId: jobId || null, canResume });
      setError(message);
      setFileName('Saved forensic audit');
      setView(VIEW.AUDIT);
      setState(STATE.ERROR);
      if (jobId) rememberAuditRecovery(userId, jobId);
    };

    const hydrateRecovery = async () => {
      try {
        let exactJob = null;
        if (rememberedJobId) {
          exactJob = await findOwnedAuditJob(rememberedJobId, userId);
          const disposition = auditRecoveryDisposition(exactJob);
          if (['done', 'missing', 'expired'].includes(disposition.kind)) {
            forgetAuditRecovery(userId, rememberedJobId);
            unresolvedRememberedJobId = null;
          }
        }

        const latestJob = await findLatestRecoverableAuditJob();
        const candidate = selectAuditRecoveryCandidate(exactJob, latestJob);
        if (candidate.kind === 'resume' || candidate.kind === 'operations') {
          showRecovery(
            candidate.jobId,
            candidate.message,
            candidate.kind === 'resume' && candidate.canResume === true,
          );
          return;
        }
        if (candidate.kind === 'done') {
          if (cancelled) return;
          setAuditResult(candidate.audit);
          setFileName('Saved forensic audit');
          setView(VIEW.AUDIT);
          setState(STATE.RESULTS);
        }
      } catch (_) {
        showRecovery(
          unresolvedRememberedJobId,
          'CCC could not verify whether a saved audit is waiting. Do not re-upload the report; retry recovery or open Operations.',
          Boolean(unresolvedRememberedJobId),
        );
      } finally {
        if (!cancelled) setAuditRecoveryChecked(true);
      }
    };
    void hydrateRecovery();
    return () => { cancelled = true; };
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
        setIsAffiliate(false);
        setAffiliateAccess(null);
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

      // Partner identity and activation are resolved by narrow database RPCs.
      // The browser never patches affiliate rows or unlocks itself by email.
      const readAffiliateAccess = async () => {
        const response = await fetch(_url + '/rest/v1/rpc/ccc_current_affiliate_access_state', {
          method: 'POST', headers: { ..._hdrs, 'Content-Type': 'application/json' }, body: '{}',
        });
        if (!response.ok) return null;
        return response.json();
      };
      let aff = await readAffiliateAccess();
      if (!aff && !prof) {
        // Compatibility-only one-time claim for partners who were live before
        // server-side identity linking existed. It is restricted to records
        // snapshotted as legacy_active and the authenticated email.
        await fetch(_url + '/rest/v1/rpc/ccc_claim_legacy_affiliate_portal_identity', {
          method: 'POST', headers: { ..._hdrs, 'Content-Type': 'application/json' }, body: '{}',
        });
        aff = await readAffiliateAccess();
      }
      if (aff?.affiliateId) {
        setAffiliateAccess(aff);
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

      // Client identity is resolved only by the authenticated Auth UUID inside
      // a SECURITY DEFINER projection. The browser cannot read raw profile
      // rows, fall back to an email/name match, or wire itself to a client.
      const _clientBootstrapRes = await fetch(_url + '/rest/v1/rpc/get_my_client_portal_bootstrap', {
        method: 'POST',
        headers: { ..._hdrs, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!_clientBootstrapRes.ok) {
        throw new Error('Could not verify the client portal identity (' + _clientBootstrapRes.status + ').');
      }
      const _clientBootstrap = await _clientBootstrapRes.json();

      if (_clientBootstrap?.profile) {
        setIsClient(true);
        setClientOnboarded(_clientBootstrap.has_portal_access === true);
        // Always require a password on first portal login or recovery.
        const passwordSet = session.user.user_metadata?.password_set;
        const fromRecovery = _event === 'PASSWORD_RECOVERY';
        setNeedsPasswordSetup(fromRecovery || !passwordSet);
        setProfile(prof || {
          id: session.user.id,
          email,
          full_name: _clientBootstrap.profile.full_name,
          role: 'client',
        });
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

  if (!session) return <LazyRoute><AuthPage /></LazyRoute>;

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
    const signOutAffiliate = async () => { try { await supabase.auth.signOut(); } catch(e) {} setIsAffiliate(false); setAffiliateAccess(null); window.location.href = '/'; };
    if (!affiliateAccess?.hasPortalAccess) {
      return <LazyRoute><AffiliateOnboardingFlow session={session} onSignOut={signOutAffiliate} onActivated={() => window.location.reload()} /></LazyRoute>;
    }
    return <LazyRoute><AffiliatePortal session={session} onSignOut={signOutAffiliate} /></LazyRoute>;
  }

  // Client portal routing
  if (isClient) {
    if (needsPasswordSetup) {
      return (
        <LazyRoute>
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
        </LazyRoute>
      );
    }
    if (!clientOnboarded) {
      return <LazyRoute><ClientSetupFlow session={session} initialStep="onboarding" onComplete={() => setClientOnboarded(true)} /></LazyRoute>;
    }
    return <LazyRoute><ClientPortal session={session} onSignOut={async () => { try { await supabase.auth.signOut(); } catch(e) {} window.location.href = '/'; }} /></LazyRoute>;
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

  const captureAuditFailure = (err, fallbackMessage = 'Audit failed') => {
    setError(err?.message || fallbackMessage);
    const jobId = err?.auditJobId || null;
    const blocksNewUpload = Boolean(jobId) && err?.auditSafeToUpload !== true;
    if (blocksNewUpload) {
      setFailedAuditRecovery({ jobId, canResume: err?.auditCanResume === true });
      rememberAuditRecovery(session?.user?.id, jobId);
    } else {
      setFailedAuditRecovery(null);
    }
  };

  const handleAuditStart = async (payload) => {
    if (!auditRecoveryChecked || failedAuditRecovery) {
      setView(VIEW.AUDIT);
      setState(STATE.ERROR);
      setError('CCC must resolve the saved audit before another report can be uploaded.');
      return;
    }
    setView(VIEW.AUDIT);
    setState(STATE.PROCESSING);
    setError(null);
    setFailedAuditRecovery(null);
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
        res = await runMergeBureauAudits(payload.clientSelection, setAuditProgress, payload.mergeSelection);
      }
      setAuditResult(res.audit);
      setState(STATE.RESULTS);
    } catch (err) {
      console.error(err);
      captureAuditFailure(err);
      setState(STATE.ERROR);
    }
  };

  const handleResumeFailedAudit = async () => {
    const jobId = failedAuditRecovery?.jobId;
    if (!jobId) return;
    setState(STATE.PROCESSING);
    setError(null);
    setAuditProgress({
      stage: 'Recovering the saved audit from its completed checkpoints',
      pct: null,
      tokens: 0,
    });
    try {
      const res = await resumeAuditJob(jobId, setAuditProgress);
      setAuditResult(res.audit);
      setFailedAuditRecovery(null);
      forgetAuditRecovery(session?.user?.id, jobId);
      setState(STATE.RESULTS);
    } catch (err) {
      console.error(err);
      if (err?.auditSafeToUpload === true) {
        forgetAuditRecovery(session?.user?.id, jobId);
      }
      captureAuditFailure(err, 'CCC could not resume the saved audit yet.');
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
    setFailedAuditRecovery(null);
    setFileName('Merge bureau parses');
    try {
      const rows = await listBureauParsesForClient({
        type: 'existing', id: auditResult.clientId, name: auditResult.clientName,
      });
      const summary = summarizeBureauParses(rows);
      if (!summary.canMerge || !summary.mergeSelection) {
        throw new Error('The exact same-date three-bureau cohort is not ready. Return to upload and run the missing bureau.');
      }
      const res = await runMergeBureauAudits(
        { type: 'existing', id: auditResult.clientId, name: auditResult.clientName },
        setAuditProgress,
        summary.mergeSelection,
      );
      setAuditResult(res.audit);
      setState(STATE.RESULTS);
    } catch (err) {
      console.error(err);
      captureAuditFailure(err, 'Merge failed');
      setState(STATE.ERROR);
    }
  };

  const handleReset = () => {
    if (failedAuditRecovery) {
      setView(VIEW.AUDIT);
      setState(STATE.ERROR);
      setError('Resume the saved audit or open Operations before starting another audit.');
      return;
    }
    setView(VIEW.AUDIT);
    setState(STATE.IDLE);
    setAuditResult(null);
    setError(null);
    setFailedAuditRecovery(null);
  };
  const handleOpenSavedAudit = (audit) => {
    setAuditResult(audit);
    setState(STATE.RESULTS);
    setView(VIEW.AUDIT);
    setAuditClientName(audit && audit.client && audit.client.name || null);
  };
  const handleSignOut = async () => { try { await supabase.auth.signOut(); } catch(e) {} window.location.href = '/'; };

  return (
    <div className="ccc-ops-shell min-h-screen flex" style={ADMIN_THEME_VARS}>
      <Toaster position="bottom-right" />
      <Sidebar view={view} onNavigate={handleNavigate} displayName={displayName} initials={initials} isAdmin={isAdmin} onSignOut={handleSignOut} onSettings={() => setShowSettings(true)} actionItemCount={Math.max(0, actionItemCount - ackedActionItems)} newLeadsCount={newLeadsCount} />
      <main className="ccc-ops-main flex-1 flex flex-col">
        <TopBar view={view} state={state} isAdmin={isAdmin} />
        <div className="ccc-ops-content flex-1 overflow-auto p-4 sm:p-6 xl:p-8">
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
                {state === STATE.IDLE && !auditRecoveryChecked && (
                  <div className="min-h-[240px] flex items-center justify-center" role="status" aria-live="polite">
                    <div className="text-[12px] text-ink-muted">Checking for a saved audit…</div>
                  </div>
                )}
                {state === STATE.IDLE && auditRecoveryChecked && <UploadZone onAuditStart={handleAuditStart} />}
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
                {state === STATE.ERROR && (
                  <ErrorView
                    error={error}
                    recoveryJobId={failedAuditRecovery?.jobId || null}
                    locked={Boolean(failedAuditRecovery)}
                    onResume={failedAuditRecovery?.canResume && failedAuditRecovery?.jobId
                      ? handleResumeFailedAudit
                      : null}
                    onOperations={failedAuditRecovery && isAdmin
                      ? () => handleNavigate(VIEW.OPERATIONS)
                      : null}
                    onReset={handleReset}
                  />
                )}
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
    <aside className="ccc-ops-sidebar w-60 flex flex-col border-r">
      <div className="ccc-ops-brand px-5 py-5 border-b">
        <div className="flex items-center gap-2.5">
          <img src="/logo.jpg" alt="CCC" className="ccc-ops-logo w-9 h-9 object-contain rounded-lg" />
          <div>
            <div className="ccc-ops-brand-title text-[13px] font-semibold leading-tight">Credit Comeback Club</div>
            <div className="ccc-ops-brand-kicker text-[9px] font-semibold uppercase tracking-[0.2em]">Operations Suite</div>
          </div>
        </div>
      </div>

      <nav className="ccc-ops-nav flex-1 py-3" aria-label="Operations workspace">
        <div className="ccc-ops-nav-section px-5 pb-2 pt-1 text-[9px] font-semibold uppercase tracking-[0.18em]">Workspace</div>
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

      <div className="ccc-ops-user border-t px-5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="ccc-ops-avatar w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-medium truncate text-slate-950">{displayName}</div>
            <div className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
              {isAdmin ? (
                <><Shield size={10} strokeWidth={2} className="text-sky-600" /><span className="text-sky-700">Admin</span></>
              ) : 'Auditor'}
            </div>
          </div>
          <button onClick={onSettings} title="Settings" className="ccc-ops-icon-button transition-colors mr-1">
            <Settings size={14} strokeWidth={1.5} />
          </button>
          <button onClick={onSignOut} title="Sign out" className="ccc-ops-icon-button transition-colors">
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
      className="ccc-ops-nav-item w-full flex items-center px-5 py-2 text-[12px] gap-2.5 transition-colors"
      data-active={active ? 'true' : 'false'}
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={15} strokeWidth={1.75} />
      <span>{label}</span>
      {badge > 0 && (
        <span title={badge + ' ' + badgeTitle}
          className="ccc-ops-nav-badge ml-auto flex items-center justify-center text-[10px] font-semibold rounded-full">
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
    <header className="ccc-ops-topbar px-8 py-5 border-b">
      <h1 className="ccc-display text-2xl text-ink font-medium">Clients</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">{isAdmin ? 'All clients across all auditors' : 'Your saved audits and letters'}</p>
    </header>
  );
  if (view === 'leads') return (
    <header className="ccc-ops-topbar px-8 py-5 border-b">
      <h1 className="ccc-display text-2xl text-ink font-medium">Leads</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">Prospects in the pipeline — not yet signed or paid</p>
    </header>
  );
  if (view === 'methodology') return (
    <header className="ccc-ops-topbar px-8 py-5 border-b">
      <h1 className="ccc-display text-2xl text-ink font-medium">Methodology</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">The Consent, Accuracy, Collection, Combo, and Late Pay operating playbook</p>
    </header>
  );
  if (view === 'team') return (
    <header className="ccc-ops-topbar px-8 py-5 border-b">
      <h1 className="ccc-display text-2xl text-ink font-medium">Team</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">Manage users and roles</p>
    </header>
  );
  if (view === 'affiliates') return (
    <header className="ccc-ops-topbar px-8 py-5 border-b">
      <h1 className="ccc-display text-2xl text-ink font-medium">Affiliate Partners</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">Manage referral partners, commissions, and branded portals</p>
    </header>
  );
  if (view === 'billing') return (
    <header className="ccc-ops-topbar px-8 py-5 border-b">
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
    <header className="ccc-ops-topbar px-8 py-5 border-b">
      <h1 className="ccc-display text-2xl text-ink font-medium">{cfg.title}</h1>
      <p className="text-[12px] mt-0.5 text-ink-muted">{cfg.subtitle}</p>
    </header>
  );
}

function ErrorView({ error, recoveryJobId, locked, onResume, onOperations, onReset }) {
  return (
    <div className="max-w-md mx-auto bg-white border border-red-200 rounded p-8 text-center">
      <AlertCircle size={32} className="text-red-600 mx-auto mb-3" strokeWidth={1.5} />
      <h2 className="ccc-display text-xl text-ink font-medium">{locked ? 'Saved audit paused' : 'Audit failed'}</h2>
      <p className="text-[12px] text-ink-muted mt-2">{error}</p>
      {locked && (
        <>
          <p className="text-[11px] text-ink-muted mt-3">
            CCC will reuse the report and every completed checkpoint. It will not upload the report or create a new audit job.
          </p>
          {recoveryJobId && <p className="text-[10px] text-ink-muted mt-1 break-all">Recovery reference: {recoveryJobId}</p>}
          {onResume && (
            <button onClick={onResume} className="mt-5 px-4 py-2 text-[12px] uppercase tracking-wider rounded-sm bg-navy text-white hover:bg-navy-dark">
              Resume saved audit
            </button>
          )}
          {!onResume && onOperations && (
            <button onClick={onOperations} className="mt-5 px-4 py-2 text-[12px] uppercase tracking-wider rounded-sm bg-navy text-white hover:bg-navy-dark">
              Open Operations
            </button>
          )}
          {!onResume && !onOperations && (
            <p className="text-[11px] text-ink-muted mt-4">Ask an administrator to review this saved audit in Operations.</p>
          )}
        </>
      )}
      {!locked && (
        <button onClick={onReset} className="mt-5 px-4 py-2 text-[12px] uppercase tracking-wider rounded-sm bg-navy text-white hover:bg-navy-dark">
          Back to audit upload
        </button>
      )}
    </div>
  );
}
