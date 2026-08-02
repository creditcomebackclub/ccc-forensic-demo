import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PLAN_ID,
  DEMO_AUDIT,
  DEMO_DOCUMENTS,
  DEMO_USER,
  PRICING_PLANS,
} from './demoData';
import { CREDIT_PACKS } from './mailEconomics';
import {
  bootstrapFieldwork,
  fieldworkCheckout,
  fieldworkCloudEnabled,
  fieldworkGetSession,
  fieldworkSignIn,
  fieldworkSignOut,
  fieldworkSignUp,
  getFieldworkStatus,
} from './api';
import {
  deleteFieldworkDocument,
  uploadFieldworkDocument,
} from './documents';

// v5: response analyses + mail handoff for Pro follow-up drafts.
const ACCOUNT_STORAGE_KEY = 'fieldwork-saas-v5';
const GUEST_STORAGE_KEY = 'fieldwork-guest-demo-v1';
const LEGACY_STORAGE_KEYS = ['fieldwork-saas-v4'];

const FieldworkContext = createContext(null);

function loadState(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);
    if (key === ACCOUNT_STORAGE_KEY) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        const legacy = localStorage.getItem(legacyKey);
        if (legacy) {
          localStorage.setItem(ACCOUNT_STORAGE_KEY, legacy);
          return JSON.parse(legacy);
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

function planById(id) {
  return PRICING_PLANS.find((p) => p.id === id) || PRICING_PLANS.find((p) => p.id === DEFAULT_PLAN_ID);
}

function userFromSubscriber(subscriber, fallback = {}) {
  return {
    name: subscriber.full_name || fallback.name || '',
    email: subscriber.email || fallback.email || '',
    address: {
      line1: subscriber.address_line1 || fallback.address?.line1 || '',
      city: subscriber.address_city || fallback.address?.city || '',
      state: subscriber.address_state || fallback.address?.state || '',
      zip: subscriber.address_zip || fallback.address?.zip || '',
    },
    signatureData: subscriber.signature_data || fallback.signatureData || null,
    subscriberId: subscriber.id,
  };
}

function mapBilling(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.map((r) => ({
    id: r.id,
    date: (r.created_at || '').slice(0, 10),
    label: r.label,
    amount: Math.round((r.amount_cents || 0) / 100),
    status: r.status || 'Paid',
  }));
}

function mapDocuments(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    kind: r.kind || 'Other',
    uploadedAt: r.created_at,
    size: typeof r.byte_size === 'number' ? r.byte_size : null,
    contentType: r.content_type || null,
    storagePath: r.storage_path || null,
    cloud: Boolean(r.storage_path),
  }));
}

function mapCampaigns(rows) {
  if (!Array.isArray(rows) || !rows.length) return [];
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.created_at,
    letterCount: (r.selected_account_ids || []).length,
    status: r.status,
    letters: [],
    auditSummary: r.audit_json?.summary || null,
  }));
}

export function FieldworkProvider({ children }) {
  // Guest product tour uses a separate storage key so it never pollutes real logins.
  const [isGuestDemo, setIsGuestDemo] = useState(() => {
    try {
      return localStorage.getItem('fieldwork-guest-active') === '1';
    } catch {
      return false;
    }
  });
  const saved = useMemo(
    () => loadState(isGuestDemo ? GUEST_STORAGE_KEY : ACCOUNT_STORAGE_KEY),
    // Only hydrate from the active lane on first mount / guest toggle via enterGuestDemo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [user, setUser] = useState(() => {
    if (isGuestDemo) {
      const g = loadState(GUEST_STORAGE_KEY);
      return g?.user || { ...DEMO_USER, email: 'demo@fieldwork.local', guest: true };
    }
    // Never restore a guest user into the real account lane
    if (saved?.user?.guest) return null;
    return saved?.user || null;
  });
  const [planId, setPlanId] = useState(saved?.planId || DEFAULT_PLAN_ID);
  const [mailCredits, setMailCredits] = useState(
    saved?.mailCredits ?? planById(saved?.planId || DEFAULT_PLAN_ID).mailCredits,
  );
  const [auditCredits, setAuditCredits] = useState(
    saved?.auditCredits ?? planById(saved?.planId || DEFAULT_PLAN_ID).auditCredits,
  );
  const [expertChatCredits, setExpertChatCredits] = useState(
    saved?.expertChatCredits ?? planById(saved?.planId || DEFAULT_PLAN_ID).expertChats,
  );
  const [audit, setAudit] = useState(saved?.audit || null);
  const [selectedIds, setSelectedIds] = useState(saved?.selectedIds || []);
  const [letters, setLetters] = useState(saved?.letters || []);
  const [campaigns, setCampaigns] = useState(saved?.campaigns || []);
  // Real accounts start with an empty vault — sample docs only in guest demo.
  const [documents, setDocuments] = useState(
    saved?.documents || (isGuestDemo ? DEMO_DOCUMENTS : []),
  );
  const [wizardStep, setWizardStep] = useState(saved?.wizardStep || 'upload');
  const [mailPhaseId, setMailPhaseId] = useState(saved?.mailPhaseId || 'phase1');
  const [letterOverrides, setLetterOverrides] = useState(saved?.letterOverrides || {});
  const [responseAnalyses, setResponseAnalyses] = useState(saved?.responseAnalyses || []);
  const [billingHistory, setBillingHistory] = useState(saved?.billingHistory || []);
  const [runtime, setRuntime] = useState({
    mode: isGuestDemo ? 'guest-demo' : (fieldworkCloudEnabled ? 'cloud' : 'demo'),
    isolated: true,
    message: 'Checking Fieldwork lane…',
  });
  const [authReady, setAuthReady] = useState(!fieldworkCloudEnabled || isGuestDemo);

  const plan = planById(planId);

  const applyBootstrap = useCallback((snap, fallbackProfile = {}) => {
    if (!snap?.subscriber) return;
    // Leaving guest tour — cloud account is source of truth.
    setIsGuestDemo(false);
    try {
      localStorage.removeItem('fieldwork-guest-active');
    } catch {
      /* ignore */
    }
    const sub = snap.subscriber;
    setUser(userFromSubscriber(sub, fallbackProfile));
    setPlanId(sub.plan_id || DEFAULT_PLAN_ID);
    const plan = planById(sub.plan_id);
    setMailCredits(typeof sub.mail_credits === 'number' ? sub.mail_credits : plan.mailCredits);
    setAuditCredits(typeof sub.audit_credits === 'number' ? sub.audit_credits : plan.auditCredits);
    setExpertChatCredits(
      typeof sub.expert_chat_credits === 'number' ? sub.expert_chat_credits : plan.expertChats,
    );
    // Always replace — empty server lists clear leftover sample campaigns from localStorage.
    setBillingHistory(mapBilling(snap.billing));
    setDocuments(mapDocuments(snap.documents));
    setCampaigns(mapCampaigns(snap.campaigns));
    setLetters([]);
    setAudit(null);
    setSelectedIds([]);
    setWizardStep('upload');
    setMailPhaseId('phase1');
    setLetterOverrides({});
    setResponseAnalyses([]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getFieldworkStatus().then((status) => {
      if (cancelled) return;
      setRuntime((prev) => {
        // Don't overwrite an active guest tour with cloud/demo status.
        if (prev.mode === 'guest-demo' || isGuestDemo) {
          return {
            ...prev,
            isolated: true,
            anthropicConfigured: Boolean(status.anthropicConfigured),
            mode: 'guest-demo',
            message: prev.message || 'Guest product tour — not your account.',
          };
        }
        return {
          mode: status.mode || (fieldworkCloudEnabled ? 'cloud' : 'demo'),
          isolated: status.isolated !== false,
          anthropicConfigured: Boolean(status.anthropicConfigured),
          message: status.message || '',
        };
      });
    });
    return () => { cancelled = true; };
  }, [isGuestDemo]);

  // Restore Fieldwork Supabase session → bootstrap subscriber (skip guest tour)
  useEffect(() => {
    if (isGuestDemo) {
      setAuthReady(true);
      setRuntime((r) => ({
        ...r,
        mode: 'guest-demo',
        message: 'Guest product tour — not your account.',
      }));
      return undefined;
    }
    if (!fieldworkCloudEnabled) {
      setAuthReady(true);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const session = await fieldworkGetSession();
        if (cancelled) return;
        // Guest tour may flip on while this request was in flight — never clobber it.
        const guestActive = (() => {
          try {
            return localStorage.getItem('fieldwork-guest-active') === '1';
          } catch {
            return false;
          }
        })();
        if (guestActive) return;
        if (session) {
          const snap = await bootstrapFieldwork({});
          if (cancelled) return;
          try {
            if (localStorage.getItem('fieldwork-guest-active') === '1') return;
          } catch {
            /* ignore */
          }
          applyBootstrap(snap, saved?.user || {});
        } else if (saved?.user?.subscriberId || saved?.user?.guest) {
          // Stale cloud / guest user in account storage without session
          setUser(null);
          setCampaigns([]);
          setLetters([]);
          setAudit(null);
          setDocuments([]);
        }
      } catch {
        // Keep local state if bootstrap unreachable
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [applyBootstrap, saved?.user, isGuestDemo]);

  useEffect(() => {
    const key = isGuestDemo ? GUEST_STORAGE_KEY : ACCOUNT_STORAGE_KEY;
    // Never persist a guest user into the real account key
    if (!isGuestDemo && user?.guest) return;
    localStorage.setItem(
      key,
      JSON.stringify({
        user,
        planId,
        mailCredits,
        auditCredits,
        expertChatCredits,
        audit,
        selectedIds,
        letters,
        campaigns,
        documents,
        wizardStep,
        mailPhaseId,
        letterOverrides,
        responseAnalyses,
        billingHistory,
      }),
    );
  }, [
    isGuestDemo, user, planId, mailCredits, auditCredits, expertChatCredits, audit, selectedIds,
    letters, campaigns, documents, wizardStep, mailPhaseId, letterOverrides,
    responseAnalyses, billingHistory,
  ]);

  const signUp = useCallback(async (profile, chosenPlanId = DEFAULT_PLAN_ID) => {
    const nextPlan = planById(chosenPlanId);
    // Exit guest tour before creating a real account
    setIsGuestDemo(false);
    try {
      localStorage.removeItem('fieldwork-guest-active');
    } catch {
      /* ignore */
    }

    if (!fieldworkCloudEnabled) {
      setUser({ ...DEMO_USER, ...profile, guest: false });
      setPlanId(nextPlan.id);
      setMailCredits(nextPlan.mailCredits);
      setAuditCredits(nextPlan.auditCredits);
      setExpertChatCredits(nextPlan.expertChats);
      setCampaigns([]);
      setLetters([]);
      setAudit(null);
      setDocuments([]);
      setBillingHistory([
        {
          id: `inv_${Date.now()}`,
          date: new Date().toISOString().slice(0, 10),
          label: `${nextPlan.name} plan · first month`,
          amount: nextPlan.price,
          status: 'Paid (demo)',
        },
      ]);
      return;
    }

    if (!profile.email || !profile.password) {
      throw new Error('Email and password are required');
    }

    await fieldworkSignUp({
      email: profile.email,
      password: profile.password,
      name: profile.name,
    });

    const snap = await bootstrapFieldwork({
      email: profile.email,
      full_name: profile.name,
      address_line1: profile.address?.line1 || '',
      address_city: profile.address?.city || '',
      address_state: profile.address?.state || '',
      address_zip: profile.address?.zip || '',
    });
    applyBootstrap(snap, profile);
  }, [applyBootstrap]);

  const signIn = useCallback(async ({ email, password }) => {
    if (!fieldworkCloudEnabled) {
      throw new Error('Cloud sign-in requires Fieldwork Supabase keys');
    }
    setIsGuestDemo(false);
    try {
      localStorage.removeItem('fieldwork-guest-active');
    } catch {
      /* ignore */
    }
    await fieldworkSignIn({ email, password });
    const snap = await bootstrapFieldwork({ email });
    applyBootstrap(snap, { email });
  }, [applyBootstrap]);

  /** Public product tour — sample audit/mail, never writes to a real subscriber. */
  const enterGuestDemo = useCallback(() => {
    const pro = planById('pro');
    setIsGuestDemo(true);
    try {
      localStorage.setItem('fieldwork-guest-active', '1');
    } catch {
      /* ignore */
    }
    setUser({
      ...DEMO_USER,
      email: 'demo@fieldwork.local',
      guest: true,
    });
    setPlanId(pro.id);
    setMailCredits(pro.mailCredits);
    setAuditCredits(pro.auditCredits);
    setExpertChatCredits(pro.expertChats);
    setAudit(null);
    setSelectedIds([]);
    setLetters([]);
    setCampaigns([]);
    setDocuments(DEMO_DOCUMENTS);
    setWizardStep('upload');
    setMailPhaseId('phase1');
    setLetterOverrides({});
    setResponseAnalyses([]);
    setBillingHistory([]);
    setRuntime({
      mode: 'guest-demo',
      isolated: true,
      message: 'Guest product tour — sample data only. Create an account to keep real work.',
    });
    setAuthReady(true);
  }, []);

  const updateProfile = useCallback(async (profile) => {
    const nextLocal = (prev) => ({
      ...prev,
      ...profile,
      address: { ...prev.address, ...(profile.address || {}) },
      signatureData:
        profile.signatureData !== undefined ? profile.signatureData : prev.signatureData,
    });
    setUser(nextLocal);

    if (!fieldworkCloudEnabled) return { mode: 'demo' };

    const snap = await bootstrapFieldwork({
      email: profile.email,
      full_name: profile.name,
      address_line1: profile.address?.line1,
      address_city: profile.address?.city,
      address_state: profile.address?.state,
      address_zip: profile.address?.zip,
      ...(Object.prototype.hasOwnProperty.call(profile, 'signatureData')
        ? { signature_data: profile.signatureData || null }
        : {}),
    });
    if (snap?.subscriber) {
      applyBootstrap(snap, {
        name: profile.name,
        email: profile.email,
        address: profile.address,
        signatureData: profile.signatureData,
      });
    }
    return snap;
  }, [applyBootstrap]);

  const signOut = useCallback(async () => {
    if (isGuestDemo) {
      setIsGuestDemo(false);
      try {
        localStorage.removeItem('fieldwork-guest-active');
        localStorage.removeItem(GUEST_STORAGE_KEY);
      } catch {
        /* ignore */
      }
      setUser(null);
      setCampaigns([]);
      setLetters([]);
      setAudit(null);
      setDocuments([]);
      return;
    }
    try {
      await fieldworkSignOut();
    } catch {
      /* ignore */
    }
    setUser(null);
  }, [isGuestDemo]);

  const resetAll = useCallback(async () => {
    if (isGuestDemo) {
      enterGuestDemo();
      return;
    }
    try {
      await fieldworkSignOut();
    } catch {
      /* ignore */
    }
    localStorage.removeItem(ACCOUNT_STORAGE_KEY);
    setUser(null);
    setPlanId(DEFAULT_PLAN_ID);
    setMailCredits(planById(DEFAULT_PLAN_ID).mailCredits);
    setAuditCredits(planById(DEFAULT_PLAN_ID).auditCredits);
    setExpertChatCredits(planById(DEFAULT_PLAN_ID).expertChats);
    setAudit(null);
    setSelectedIds([]);
    setLetters([]);
    setCampaigns([]);
    setDocuments([]);
    setWizardStep('upload');
    setMailPhaseId('phase1');
    setLetterOverrides({});
    setResponseAnalyses([]);
    setBillingHistory([]);
  }, [enterGuestDemo, isGuestDemo]);

  const completeUpload = useCallback((auditOverride, meta = {}) => {
    const nextAudit = auditOverride || DEMO_AUDIT;
    // Live forensic runs burn an audit credit; canned sample demos do not.
    if (auditOverride) {
      setAuditCredits((c) => Math.max(0, c - 1));
    }
    setAudit(nextAudit);
    const highs = nextAudit.accounts.filter((a) => a.priority === 'high').map((a) => a.id);
    setSelectedIds(highs.length ? highs : nextAudit.accounts.slice(0, 2).map((a) => a.id));
    setWizardStep('audit');
    setDocuments((docs) => {
      const name = meta.fileName || (auditOverride ? 'Uploaded_credit_report.pdf' : 'PrivacyGuard_3bureau_sample.pdf');
      if (docs.some((d) => d.kind === 'Credit report' && d.name === name)) return docs;
      return [
        ...docs.filter((d) => d.kind !== 'Credit report' || d.id === 'doc_report'),
        {
          id: `doc_report_${Date.now()}`,
          name,
          kind: 'Credit report',
          uploadedAt: new Date().toISOString(),
        },
      ];
    });
  }, []);

  const changePlan = useCallback(async (nextId) => {
    const next = planById(nextId);
    // Local offline demo mode still applies immediately.
    if (!fieldworkCloudEnabled) {
      setPlanId(next.id);
      setMailCredits(next.mailCredits);
      setAuditCredits(next.auditCredits);
      setExpertChatCredits(next.expertChats);
      setBillingHistory((prev) => [
        {
          id: `inv_${Date.now()}`,
          date: new Date().toISOString().slice(0, 10),
          label: `Switched to ${next.name}`,
          amount: next.price,
          status: 'Paid (demo)',
        },
        ...prev,
      ]);
      return;
    }

    // Cloud mode: server controls entitlements, so route through checkout.
    const checkout = await fieldworkCheckout(next.id);
    if (checkout.mode === 'stripe' && checkout.url) {
      window.location.assign(checkout.url);
      return;
    }
    // Fallback if Stripe key is not configured in this environment yet.
    if (checkout.mode === 'demo') {
      setPlanId(next.id);
      setMailCredits(checkout.mail_credits ?? next.mailCredits);
      setAuditCredits(checkout.audit_credits ?? next.auditCredits);
      setExpertChatCredits(checkout.expert_chat_credits ?? next.expertChats);
      setBillingHistory((prev) => [
        {
          id: `inv_${Date.now()}`,
          date: new Date().toISOString().slice(0, 10),
          label: `Switched to ${next.name}`,
          amount: next.price,
          status: 'Paid (demo)',
        },
        ...prev,
      ]);
      return;
    }
    throw new Error('Checkout did not return a redirect URL.');
  }, []);

  const refreshWorkspace = useCallback(async () => {
    if (!fieldworkCloudEnabled) return;
    if (isGuestDemo || user?.guest) return;
    const snap = await bootstrapFieldwork({});
    if (snap?.subscriber) applyBootstrap(snap, user || {});
  }, [applyBootstrap, isGuestDemo, user]);

  const buyCreditPack = useCallback((packId) => {
    const pack = CREDIT_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    setMailCredits((c) => c + pack.credits);
    setBillingHistory((prev) => [
      {
        id: `inv_${Date.now()}`,
        date: new Date().toISOString().slice(0, 10),
        label: `Mail credit pack · ${pack.label}`,
        amount: pack.price,
        status: 'Paid (demo)',
      },
      ...prev,
    ]);
  }, []);

  const completeMail = useCallback((newLetters) => {
    const cost = newLetters.length;
    setMailCredits((c) => Math.max(0, c - cost));
    setLetters(newLetters);
    const campaign = {
      id: `camp_${Date.now()}`,
      name: `Furnisher wave · ${new Date().toLocaleDateString()}`,
      createdAt: new Date().toISOString(),
      letterCount: newLetters.length,
      status: 'In flight',
      letters: newLetters,
      auditSummary: audit?.summary || null,
    };
    setCampaigns((prev) => [campaign, ...prev]);
    setWizardStep('track');
  }, [audit]);

  const startNewCampaign = useCallback(() => {
    setAudit(null);
    setSelectedIds([]);
    setLetters([]);
    setWizardStep('upload');
    setMailPhaseId('phase1');
    setLetterOverrides({});
  }, []);

  /** Save an analysis record (Starter talking points or Pro draft). */
  const saveResponseAnalysis = useCallback((record) => {
    setResponseAnalyses((prev) => [record, ...prev].slice(0, 20));
  }, []);

  /**
   * Hand off a Pro/Campaign follow-up draft into the campaign mail step
   * with phase2 + preloaded letter HTML.
   */
  const beginFollowUpMail = useCallback(({ accountId, letterHtml, analysis }) => {
    if (!accountId) return;
    setSelectedIds([accountId]);
    setMailPhaseId('phase2');
    setLetterOverrides({ [accountId]: letterHtml });
    if (analysis) {
      setResponseAnalyses((prev) => {
        if (prev.some((r) => r.id === analysis.id)) return prev;
        return [analysis, ...prev].slice(0, 20);
      });
    }
    setWizardStep('mail');
  }, []);

  /** Persist a real file to fieldwork-docs (or demo localDataUrl). */
  const uploadDocument = useCallback(async (kind, file) => {
    const guest = isGuestDemo || user?.guest;
    const { doc, removeIds } = await uploadFieldworkDocument({
      kind,
      file,
      subscriberId: guest ? null : user?.subscriberId,
      existingDocs: documents,
      forceLocal: guest,
    });
    setDocuments((prev) => [
      doc,
      ...prev.filter((d) => d.id !== doc.id && !removeIds.includes(d.id)),
    ]);
    return doc;
  }, [documents, isGuestDemo, user?.guest, user?.subscriberId]);

  const removeDocument = useCallback(async (doc) => {
    if (!doc?.id) return;
    const guest = isGuestDemo || user?.guest;
    if (!guest) {
      await deleteFieldworkDocument({
        id: doc.id,
        storagePath: doc.storagePath || null,
      });
    }
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
  }, [isGuestDemo, user?.guest]);

  const value = {
    user,
    plan,
    planId,
    mailCredits,
    auditCredits,
    expertChatCredits,
    setExpertChatCredits,
    audit,
    selectedIds,
    setSelectedIds,
    letters,
    campaigns,
    documents,
    setDocuments,
    uploadDocument,
    removeDocument,
    wizardStep,
    setWizardStep,
    mailPhaseId,
    setMailPhaseId,
    letterOverrides,
    setLetterOverrides,
    responseAnalyses,
    saveResponseAnalysis,
    beginFollowUpMail,
    billingHistory,
    signUp,
    signIn,
    updateProfile,
    signOut,
    resetAll,
    enterGuestDemo,
    isGuestDemo,
    completeUpload,
    changePlan,
    buyCreditPack,
    completeMail,
    startNewCampaign,
    runtime,
    authReady,
    refreshWorkspace,
  };

  return <FieldworkContext.Provider value={value}>{children}</FieldworkContext.Provider>;
}

export function useFieldwork() {
  const ctx = useContext(FieldworkContext);
  if (!ctx) throw new Error('useFieldwork must be used within FieldworkProvider');
  return ctx;
}
