import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_PLAN_ID,
  DEMO_AUDIT,
  DEMO_DOCUMENTS,
  DEMO_USER,
  PRICING_PLANS,
} from './demoData';
import { getFieldworkStatus, fieldworkCloudEnabled } from './api';

const STORAGE_KEY = 'fieldwork-saas-v2';

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

export function FieldworkProvider({ children }) {
  const saved = useMemo(() => loadState(), []);
  const [user, setUser] = useState(saved?.user || null);
  const [planId, setPlanId] = useState(saved?.planId || DEFAULT_PLAN_ID);
  const [mailCredits, setMailCredits] = useState(
    saved?.mailCredits ?? planById(saved?.planId || DEFAULT_PLAN_ID).mailCredits,
  );
  const [audit, setAudit] = useState(saved?.audit || null);
  const [selectedIds, setSelectedIds] = useState(saved?.selectedIds || []);
  const [letters, setLetters] = useState(saved?.letters || []);
  const [campaigns, setCampaigns] = useState(saved?.campaigns || []);
  const [documents, setDocuments] = useState(saved?.documents || DEMO_DOCUMENTS);
  const [wizardStep, setWizardStep] = useState(saved?.wizardStep || 'upload');
  const [billingHistory, setBillingHistory] = useState(
    saved?.billingHistory || [
      { id: 'inv_001', date: '2026-08-01', label: 'Pro plan · August', amount: 59, status: 'Paid (demo)' },
    ],
  );
  const [runtime, setRuntime] = useState({
    mode: fieldworkCloudEnabled ? 'cloud' : 'demo',
    isolated: true,
    usesCccKeys: false,
    message: 'Checking Fieldwork lane…',
  });

  const plan = planById(planId);

  useEffect(() => {
    let cancelled = false;
    getFieldworkStatus().then((status) => {
      if (!cancelled) {
        setRuntime({
          mode: status.mode || (fieldworkCloudEnabled ? 'cloud' : 'demo'),
          isolated: status.isolated !== false,
          usesCccKeys: Boolean(status.usesCccKeys),
          message: status.message || '',
        });
      }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        user,
        planId,
        mailCredits,
        audit,
        selectedIds,
        letters,
        campaigns,
        documents,
        wizardStep,
        billingHistory,
      }),
    );
  }, [user, planId, mailCredits, audit, selectedIds, letters, campaigns, documents, wizardStep, billingHistory]);

  const signUp = useCallback((profile, chosenPlanId = DEFAULT_PLAN_ID) => {
    const nextPlan = planById(chosenPlanId);
    setUser({ ...DEMO_USER, ...profile });
    setPlanId(nextPlan.id);
    setMailCredits(nextPlan.mailCredits);
    setBillingHistory([
      {
        id: `inv_${Date.now()}`,
        date: new Date().toISOString().slice(0, 10),
        label: `${nextPlan.name} plan · first month`,
        amount: nextPlan.price,
        status: 'Paid (demo)',
      },
    ]);
  }, []);

  const updateProfile = useCallback((profile) => {
    setUser((prev) => ({ ...prev, ...profile, address: { ...prev.address, ...(profile.address || {}) } }));
  }, []);

  const signOut = useCallback(() => {
    setUser(null);
  }, []);

  const resetAll = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUser(null);
    setPlanId(DEFAULT_PLAN_ID);
    setMailCredits(planById(DEFAULT_PLAN_ID).mailCredits);
    setAudit(null);
    setSelectedIds([]);
    setLetters([]);
    setCampaigns([]);
    setDocuments(DEMO_DOCUMENTS);
    setWizardStep('upload');
    setBillingHistory([]);
  }, []);

  const completeUpload = useCallback(() => {
    setAudit(DEMO_AUDIT);
    setSelectedIds(DEMO_AUDIT.accounts.filter((a) => a.priority === 'high').map((a) => a.id));
    setWizardStep('audit');
    setDocuments((docs) => {
      if (docs.some((d) => d.id === 'doc_report')) return docs;
      return [
        ...docs,
        {
          id: 'doc_report',
          name: 'PrivacyGuard_3bureau_sample.pdf',
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
    updateProfile,
    signOut,
    resetAll,
    completeUpload,
    changePlan,
    completeMail,
    startNewCampaign,
    runtime,
  };

  return <FieldworkContext.Provider value={value}>{children}</FieldworkContext.Provider>;
}

export function useFieldwork() {
  const ctx = useContext(FieldworkContext);
  if (!ctx) throw new Error('useFieldwork must be used within FieldworkProvider');
  return ctx;
}
