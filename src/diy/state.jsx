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
  fieldworkCloudEnabled,
  fieldworkGetSession,
  fieldworkSignIn,
  fieldworkSignOut,
  fieldworkSignUp,
  getFieldworkStatus,
} from './api';

const STORAGE_KEY = 'fieldwork-saas-v3';

const FieldworkContext = createContext(null);

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
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
    kind: r.kind || 'other',
    uploadedAt: r.created_at,
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
  const saved = useMemo(() => loadState(), []);
  const [user, setUser] = useState(saved?.user || null);
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
  const [documents, setDocuments] = useState(saved?.documents || DEMO_DOCUMENTS);
  const [wizardStep, setWizardStep] = useState(saved?.wizardStep || 'upload');
  const [billingHistory, setBillingHistory] = useState(
    saved?.billingHistory || [
      { id: 'inv_001', date: '2026-08-01', label: 'Pro plan · August', amount: 99, status: 'Paid (demo)' },
    ],
  );
  const [runtime, setRuntime] = useState({
    mode: fieldworkCloudEnabled ? 'cloud' : 'demo',
    isolated: true,
    message: 'Checking Fieldwork lane…',
  });
  const [authReady, setAuthReady] = useState(!fieldworkCloudEnabled);

  const plan = planById(planId);

  const applyBootstrap = useCallback((snap, fallbackProfile = {}) => {
    if (!snap?.subscriber) return;
    const sub = snap.subscriber;
    setUser(userFromSubscriber(sub, fallbackProfile));
    setPlanId(sub.plan_id || DEFAULT_PLAN_ID);
    const plan = planById(sub.plan_id);
    setMailCredits(typeof sub.mail_credits === 'number' ? sub.mail_credits : plan.mailCredits);
    setAuditCredits(typeof sub.audit_credits === 'number' ? sub.audit_credits : plan.auditCredits);
    setExpertChatCredits(
      typeof sub.expert_chat_credits === 'number' ? sub.expert_chat_credits : plan.expertChats,
    );
    const nextBilling = mapBilling(snap.billing);
    if (nextBilling.length) setBillingHistory(nextBilling);
    const nextDocs = mapDocuments(snap.documents);
    if (nextDocs.length) setDocuments(nextDocs);
    const nextCamps = mapCampaigns(snap.campaigns);
    if (nextCamps.length) setCampaigns(nextCamps);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getFieldworkStatus().then((status) => {
      if (!cancelled) {
        setRuntime({
          mode: status.mode || (fieldworkCloudEnabled ? 'cloud' : 'demo'),
          isolated: status.isolated !== false,
          anthropicConfigured: Boolean(status.anthropicConfigured),
          message: status.message || '',
        });
      }
    });
    return () => { cancelled = true; };
  }, []);

  // Restore Fieldwork Supabase session → bootstrap subscriber
  useEffect(() => {
    if (!fieldworkCloudEnabled) {
      setAuthReady(true);
      return undefined;
    }
    let cancelled = false;
    (async () => {
      try {
        const session = await fieldworkGetSession();
        if (cancelled) return;
        if (session) {
          const snap = await bootstrapFieldwork({});
          if (!cancelled) applyBootstrap(snap, saved?.user || {});
        } else if (saved?.user?.subscriberId) {
          // Stale cloud user in localStorage without session
          setUser(null);
        }
      } catch {
        // Keep local demo state if bootstrap unreachable
      } finally {
        if (!cancelled) setAuthReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [applyBootstrap, saved?.user]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
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
        billingHistory,
      }),
    );
  }, [user, planId, mailCredits, auditCredits, expertChatCredits, audit, selectedIds, letters, campaigns, documents, wizardStep, billingHistory]);

  const signUp = useCallback(async (profile, chosenPlanId = DEFAULT_PLAN_ID) => {
    const nextPlan = planById(chosenPlanId);

    if (!fieldworkCloudEnabled) {
      setUser({ ...DEMO_USER, ...profile });
      setPlanId(nextPlan.id);
      setMailCredits(nextPlan.mailCredits);
      setAuditCredits(nextPlan.auditCredits);
      setExpertChatCredits(nextPlan.expertChats);
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
      address_line1: profile.address?.line1 || DEMO_USER.address.line1,
      address_city: profile.address?.city || DEMO_USER.address.city,
      address_state: profile.address?.state || DEMO_USER.address.state,
      address_zip: profile.address?.zip || DEMO_USER.address.zip,
      plan_id: nextPlan.id,
    });
    applyBootstrap(snap, profile);
  }, [applyBootstrap]);

  const signIn = useCallback(async ({ email, password }) => {
    if (!fieldworkCloudEnabled) {
      throw new Error('Cloud sign-in requires Fieldwork Supabase keys');
    }
    await fieldworkSignIn({ email, password });
    const snap = await bootstrapFieldwork({ email });
    applyBootstrap(snap, { email });
  }, [applyBootstrap]);

  const updateProfile = useCallback((profile) => {
    setUser((prev) => ({ ...prev, ...profile, address: { ...prev.address, ...(profile.address || {}) } }));
  }, []);

  const signOut = useCallback(async () => {
    try {
      await fieldworkSignOut();
    } catch {
      /* ignore */
    }
    setUser(null);
  }, []);

  const resetAll = useCallback(async () => {
    try {
      await fieldworkSignOut();
    } catch {
      /* ignore */
    }
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setPlanId(DEFAULT_PLAN_ID);
    setMailCredits(planById(DEFAULT_PLAN_ID).mailCredits);
    setAuditCredits(planById(DEFAULT_PLAN_ID).auditCredits);
    setExpertChatCredits(planById(DEFAULT_PLAN_ID).expertChats);
    setAudit(null);
    setSelectedIds([]);
    setLetters([]);
    setCampaigns([]);
    setDocuments(DEMO_DOCUMENTS);
    setWizardStep('upload');
    setBillingHistory([]);
  }, []);

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

  const changePlan = useCallback((nextId) => {
    const next = planById(nextId);
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
  }, []);

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
  }, []);

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
    wizardStep,
    setWizardStep,
    billingHistory,
    signUp,
    signIn,
    updateProfile,
    signOut,
    resetAll,
    completeUpload,
    changePlan,
    buyCreditPack,
    completeMail,
    startNewCampaign,
    runtime,
    authReady,
  };

  return <FieldworkContext.Provider value={value}>{children}</FieldworkContext.Provider>;
}

export function useFieldwork() {
  const ctx = useContext(FieldworkContext);
  if (!ctx) throw new Error('useFieldwork must be used within FieldworkProvider');
  return ctx;
}
