import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileSearch,
  Loader2,
  MapPin,
  Save,
  Sparkles,
} from 'lucide-react';
import { supabase } from '../utils/supabase.js';
import { getBlueprintStatus, persistReviewedAccounts } from '../utils/recoveryBlueprintApi.js';
import RecoveryBlueprintStudio from './RecoveryBlueprintStudio.jsx';
import DisputeCampaignStudio from './DisputeCampaignStudio.jsx';
import {
  buildR1CampaignPlan,
  FLOW_LABELS,
} from '../utils/disputeFlow.js';
import {
  craTrackInitializationBlocker,
  initializeCraAccountTracks,
} from '../utils/disputeStateApi.js';
import { ADMIN_BRAND } from '../utils/adminBrand.js';

const T = {
  navy: ADMIN_BRAND.ink,
  gold: ADMIN_BRAND.accent,
  border: ADMIN_BRAND.border,
  ink: ADMIN_BRAND.ink,
  muted: ADMIN_BRAND.muted,
  faint: ADMIN_BRAND.faint,
  shadow: ADMIN_BRAND.shadow,
};

const ACCOUNT_KINDS = [
  ['charge_off', 'Charge-off'],
  ['collection', 'Collection'],
  ['repossession', 'Repossession'],
  ['bankruptcy', 'Bankruptcy'],
  ['student_loan', 'Student loan'],
  ['late_payment', 'Late payment'],
  ['positive', 'Healthy / exclude'],
  ['other', 'Needs review'],
];

const BUREAU_NAMES = { EQ: 'Equifax', EXP: 'Experian', TU: 'TransUnion' };

function accountKey(account, index) {
  return account.id || `${account.furnisher || 'account'}-${account.accountNumberMasked || index}`;
}

function accountClassificationKey(account, index = 0) {
  return account.clientAccountId || account.client_account_id || accountKey(account, index);
}

async function lookupClientEmail(clientName, clientId) {
  if (clientId) {
    const { data, error } = await supabase.from('clients').select('email').eq('id', clientId).limit(1);
    if (error) throw error;
    return data?.[0]?.email || null;
  }
  if (!clientName) return null;
  const { data, error } = await supabase.from('clients').select('email').eq('name', clientName).limit(2);
  if (error) throw error;
  return data?.length === 1 ? data[0].email || null : null;
}

function Card({ children, className = '' }) {
  return <section className={`rounded-xl border bg-white ${className}`} style={{ borderColor: T.border, boxShadow: T.shadow }}>{children}</section>;
}

function RouteBadge({ classification }) {
  if (classification.excluded) {
    return <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">Excluded</span>;
  }
  if (classification.needsReview || !classification.flow) {
    return <span className="rounded-full bg-red-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-red-700">Stop · review</span>;
  }
  return <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-blue-700">{FLOW_LABELS[classification.flow]} R1</span>;
}

function BureauPlanCard({ item }) {
  return (
    <div className={`rounded-xl border p-4 ${item.recommendations.length ? 'border-blue-200 bg-blue-50/60' : 'border-gray-200 bg-gray-50'}`}>
      <div className="text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: T.faint }}>{item.bureau.name}</div>
      {item.recommendations.length ? (
        <div className="mt-3 space-y-3">
          {item.recommendations.map((recommendation, recommendationIndex) => (
            <div key={`${recommendation.trackCode || recommendation.flow}-${recommendation.round || 1}`} className="rounded-lg border border-blue-200 bg-white/90 p-3">
              <div className="text-[9px] font-extrabold uppercase tracking-[.16em] text-blue-700">
                R1 letter {recommendationIndex + 1} of {item.recommendations.length}
              </div>
              <div className="mt-1 text-[13px] font-bold leading-snug" style={{ color: T.navy }}>
                {recommendation.label || FLOW_LABELS[recommendation.flow]} R{recommendation.round || 1}
              </div>
              <div className="mt-0.5 text-[10px] leading-snug" style={{ color: T.muted }}>{recommendation.law}</div>
              <div className="mt-3 space-y-1.5">
                {recommendation.accounts.map((account, index) => (
                  <div key={accountKey(account, index)} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-2.5 py-2 text-[11px]">
                    <span className="min-w-0 truncate font-medium" style={{ color: T.ink }}>{account.furnisher}</span>
                    <span className="shrink-0 font-mono" style={{ color: T.muted }}>{account.accountNumberMasked || 'No masked number'}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-[12px] font-medium" style={{ color: T.muted }}>No R1 letter for this bureau.</div>
      )}
      {!!item.deferred.length && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] leading-relaxed text-red-900">
          <strong>Routing stop:</strong> {item.deferred.length} routed account{item.deferred.length === 1 ? '' : 's'} did not receive a separate R1 letter. Do not build the campaign until this planner error is resolved.
        </div>
      )}
      {!!item.needsReview.length && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[10px] font-semibold text-red-800">
          {item.needsReview.length} account{item.needsReview.length === 1 ? '' : 's'} must be classified before mailing.
        </div>
      )}
    </div>
  );
}

function AccountRow({ account, classifications, index, expanded, onToggle, onChange }) {
  const primaryClassification = classifications[0] || { kind: account.accountKind || 'other', flow: null, needsReview: true, reason: 'Classification is unavailable.' };
  const isLate = account.accountKind === 'late_payment' || primaryClassification.kind === 'late_payment';
  const lateByBureau = account.latePaymentByBureau || account.routingFacts?.bureauFacts || {};
  return (
    <div className="border-t first:border-t-0" style={{ borderColor: T.border }}>
      <div className="grid items-center gap-3 px-4 py-3 lg:grid-cols-[1.4fr_.8fr_1fr_1.4fr_.9fr]">
        <button type="button" onClick={onToggle} className="min-w-0 text-left">
          <div className="flex items-center gap-2">
            <span className="truncate text-[12px] font-semibold" style={{ color: T.ink }}>{account.furnisher || 'Unknown furnisher'}</span>
            {expanded ? <ChevronUp size={13} style={{ color: T.faint }} /> : <ChevronDown size={13} style={{ color: T.faint }} />}
          </div>
          <div className="mt-0.5 font-mono text-[10px]" style={{ color: T.faint }}>{account.accountNumberMasked || `Account ${index + 1}`}</div>
        </button>
        <div className="text-[10px] font-semibold" style={{ color: T.muted }}>{(account.bureaus || []).map((code) => BUREAU_NAMES[code] || code).join(' · ') || 'No bureau found'}</div>
        <select
          aria-label={`Account category for ${account.furnisher}`}
          value={account.accountKind || primaryClassification.kind || 'other'}
          onChange={(event) => onChange({ accountKind: event.target.value })}
          className="rounded-lg border bg-white px-2.5 py-2 text-[11px] outline-none focus:border-blue-500"
          style={{ borderColor: T.border, color: T.ink }}
        >
          {ACCOUNT_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <div className="space-y-2">
          {classifications.map((classification) => (
            <div key={`${classification.bureauCode || 'unknown'}-${classification.flow || 'review'}`}>
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] font-bold" style={{ color: T.faint }}>{BUREAU_NAMES[classification.bureauCode] || classification.bureauCode || 'Bureau'}</span>
                <RouteBadge classification={classification} />
              </div>
              <div className="mt-1 text-[10px] leading-snug" style={{ color: T.muted }}>{classification.reason}</div>
            </div>
          ))}
        </div>
        <label className="flex items-start gap-2 text-[10px] leading-snug" style={{ color: account.classificationAttested ? T.navy : T.muted }}>
          <input
            type="checkbox"
            checked={account.classificationAttested === true}
            onChange={(event) => onChange({ classificationAttested: event.target.checked })}
            className="mt-0.5"
          />
          <span>I reviewed the source evidence and confirm this category.</span>
        </label>
      </div>
      {expanded && (
        <div className="border-t bg-gray-50/70 px-4 py-4" style={{ borderColor: T.border }}>
          <div className="grid gap-4 lg:grid-cols-3">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: T.faint }}>Report facts</div>
              <div className="mt-2 space-y-1 text-[11px]" style={{ color: T.muted }}>
                <div>Status: <span style={{ color: T.ink }}>{account.status || 'Not extracted'}</span></div>
                <div>Balance: <span style={{ color: T.ink }}>{Number.isFinite(Number(account.balance)) ? `$${Number(account.balance).toLocaleString()}` : 'Not extracted'}</span></div>
                <div>Original creditor: <span style={{ color: T.ink }}>{account.originalCreditor || 'Not extracted'}</span></div>
              </div>
              <div className="mt-3 text-[9px] font-bold uppercase tracking-wider" style={{ color: T.faint }}>Category evidence</div>
              <div className="mt-2 space-y-2">
                {(account.routingFacts?.evidence || []).length ? account.routingFacts.evidence.map((item, evidenceIndex) => (
                  <div key={`${item.bureau || 'bureau'}-${item.field || 'field'}-${evidenceIndex}`} className={`rounded-lg border px-2.5 py-2 text-[10px] leading-relaxed ${item.autoEligible ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}`}>
                    <div className="font-semibold" style={{ color: T.ink }}>{BUREAU_NAMES[item.bureau] || item.bureau || 'Bureau'} · {item.field || 'Narrative'}</div>
                    <div className="mt-0.5" style={{ color: T.muted }}>{item.value || 'No value'}</div>
                    <div className="mt-1 font-semibold" style={{ color: item.autoEligible ? '#166534' : '#92400e' }}>
                      {item.autoEligible ? `Page ${item.page} · structured source` : 'Narrative-only extraction · staff confirmation required'}
                    </div>
                  </div>
                )) : <div className="text-[10px] text-amber-800">No page-anchored category evidence was extracted. Confirm the category manually before saving.</div>}
              </div>
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: T.faint }}>Late-payment routing facts</div>
              {isLate ? (
                <div className="mt-2 space-y-3">
                  {(account.bureaus || []).map((bureauCode) => {
                    const fact = lateByBureau[bureauCode] || {};
                    const updateFact = (patch) => onChange({
                      latePaymentByBureau: {
                        ...lateByBureau,
                        [bureauCode]: { ...fact, ...patch, accountKind: 'late_payment', latePaymentStatus: 'staff_pending' },
                      },
                    });
                    return (
                      <div key={bureauCode} className="rounded-lg border bg-white p-2.5" style={{ borderColor: T.border }}>
                        <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: T.navy }}>{BUREAU_NAMES[bureauCode] || bureauCode}</div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <label className="text-[10px]" style={{ color: T.muted }}>
                            Visible late markers
                            <input
                              type="number"
                              min="1"
                              value={fact.latePaymentCount ?? ''}
                              onChange={(event) => updateFact({ latePaymentCount: event.target.value === '' ? null : Number(event.target.value) })}
                              className="mt-1 w-full rounded-lg border bg-white px-2.5 py-2 text-[11px]"
                              style={{ borderColor: T.border, color: T.ink }}
                            />
                          </label>
                          <label className="text-[10px]" style={{ color: T.muted }}>
                            Pattern
                            <select
                              value={fact.latePaymentBand || 'unclear'}
                              onChange={(event) => updateFact({ latePaymentBand: event.target.value })}
                              className="mt-1 w-full rounded-lg border bg-white px-2.5 py-2 text-[11px]"
                              style={{ borderColor: T.border, color: T.ink }}
                            >
                              <option value="two_or_fewer">2 or fewer</option>
                              <option value="three_or_more">3 or more</option>
                              <option value="mixed">Mixed stretches</option>
                              <option value="unclear">Unclear</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : <div className="mt-2 text-[11px]" style={{ color: T.muted }}>Not used for this account category.</div>}
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: T.faint }}>Factual findings</div>
              <div className="mt-2 space-y-2">
                {(account.violations || []).length ? account.violations.map((finding, findingIndex) => (
                  <div key={`${finding.field || 'finding'}-${findingIndex}`} className="text-[10px] leading-relaxed" style={{ color: T.muted }}>
                    <strong style={{ color: T.ink }}>{finding.field || 'Report issue'}:</strong> {finding.issue || finding.reason || 'No detail extracted.'}
                  </div>
                )) : <div className="text-[11px]" style={{ color: T.muted }}>No factual issue detail was extracted.</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AuditResults({ audit, onReset, onBackToClients }) {
  const [accounts, setAccounts] = useState(audit.accounts || []);
  const [savedAuditId, setSavedAuditId] = useState(audit.id || audit.auditId || null);
  const [auditRevision, setAuditRevision] = useState(audit.auditRevision ?? audit.savedAt ?? null);
  const [auditSha256, setAuditSha256] = useState(audit.auditSha256 || null);
  const [resolvingAuditIdentity, setResolvingAuditIdentity] = useState(true);
  const [classificationReview, setClassificationReview] = useState(audit.classificationReview || null);
  const [correctionsDirty, setCorrectionsDirty] = useState(false);
  const [savingCorrections, setSavingCorrections] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [initializingTracks, setInitializingTracks] = useState(false);
  const [initializationError, setInitializationError] = useState(null);
  const [initialTracks, setInitialTracks] = useState([]);
  const [expandedAccount, setExpandedAccount] = useState(null);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [blueprintOpen, setBlueprintOpen] = useState(false);
  const [clientEmail, setClientEmail] = useState(null);

  useEffect(() => {
    setAccounts(audit.accounts || []);
    setSavedAuditId(audit.id || audit.auditId || null);
    setAuditRevision(audit.auditRevision ?? audit.savedAt ?? null);
    setAuditSha256(audit.auditSha256 || null);
    setResolvingAuditIdentity(true);
    setClassificationReview(audit.classificationReview || null);
    setCorrectionsDirty(false);
    setSaveError(null);
    setInitializingTracks(false);
    setInitializationError(null);
    setInitialTracks([]);
    setCampaignOpen(false);
    setExpandedAccount(null);
  }, [audit]);

  useEffect(() => {
    let active = true;
    getBlueprintStatus(audit)
      .then((status) => {
        if (!active) return;
        setSavedAuditId(status.auditId || null);
        setAuditRevision(status.auditRevision ?? null);
        setAuditSha256(status.auditSha256 || null);
        setClassificationReview(status.classificationReview || null);
        setResolvingAuditIdentity(false);
      })
      .catch((error) => {
        if (!active) return;
        setResolvingAuditIdentity(false);
        setSaveError(error?.message || 'CCC could not resolve the exact saved audit record.');
      });
    return () => { active = false; };
  }, [audit]);

  useEffect(() => {
    let active = true;
    lookupClientEmail(audit.client?.name, audit.client?.id)
      .then((email) => { if (active) setClientEmail(email); })
      .catch(() => { if (active) setClientEmail(null); });
    return () => { active = false; };
  }, [audit.client?.id, audit.client?.name]);

  const auditView = useMemo(() => ({
    ...audit,
    id: savedAuditId || undefined,
    auditRevision,
    auditSha256,
    accounts,
    classificationReview,
  }), [audit, accounts, auditRevision, auditSha256, classificationReview, savedAuditId]);
  const plan = useMemo(() => buildR1CampaignPlan(auditView), [auditView]);
  const classifications = useMemo(() => {
    const grouped = new Map();
    plan.accountClassifications.forEach((item, index) => {
      const key = accountClassificationKey(item.account, index);
      grouped.set(key, [...(grouped.get(key) || []), item]);
    });
    return grouped;
  }, [plan]);
  const targetAccounts = new Set(plan.accountClassifications.filter((item) => item.flow && !item.excluded).map((item, index) => accountClassificationKey(item.account, index))).size;
  const silentlyDeferred = plan.bureaus.reduce((total, bureau) => total + bureau.deferred.length, 0);
  const initializationBlocker = useMemo(() => craTrackInitializationBlocker(auditView), [auditView]);
  const hasSavedReview = classificationReview?.status === 'confirmed'
    && classificationReview?.auditId === savedAuditId
    && classificationReview?.clientId === audit.client?.id;
  const canBuild = hasSavedReview && plan.needsReview.length === 0 && plan.recommendedLetterCount > 0 && silentlyDeferred === 0;

  const updateAccount = (index, patch) => {
    setAccounts((current) => current.map((account, accountIndex) => {
      if (accountIndex !== index) return account;
      const accountKind = patch.accountKind || account.accountKind;
      const attestationOnly = Object.keys(patch).length === 1 && Object.prototype.hasOwnProperty.call(patch, 'classificationAttested');
      return {
        ...account,
        ...patch,
        classificationAttested: attestationOnly ? patch.classificationAttested === true : false,
        routingFacts: {
          ...(account.routingFacts || {}),
          status: 'review_required',
          source: 'staff_pending',
          accountKind,
          staffAttested: false,
        },
        _edited: true,
      };
    }));
    setClassificationReview(null);
    setCorrectionsDirty(true);
    setSaveError(null);
    setInitializationError(null);
  };

  const saveCorrections = async () => {
    setSavingCorrections(true);
    setSaveError(null);
    try {
      if (resolvingAuditIdentity || !savedAuditId || !auditSha256) throw new Error('Wait for CCC to load the exact saved audit revision before confirming classifications.');
      if (accounts.some((account) => account.classificationAttested !== true)) throw new Error('Confirm the source evidence and category for every account before saving.');
      const result = await persistReviewedAccounts(auditView, accounts);
      if (!result?.saved) throw new Error('CCC did not confirm the classification save.');
      if (!result.auditId) throw new Error('CCC saved the review but did not return the exact audit record. Retry before building letters.');
      setSavedAuditId(result.auditId);
      setAuditRevision(result.auditRevision ?? null);
      setAuditSha256(result.auditSha256 || null);
      setAccounts(result.audit?.accounts || accounts);
      setClassificationReview(result.classificationReview || result.audit?.classificationReview || null);
      setCorrectionsDirty(false);
      setInitializationError(null);
    } catch (error) {
      setSaveError(error.message || 'Could not save the classification review.');
    } finally {
      setSavingCorrections(false);
    }
  };

  const refreshSavedClassification = async () => {
    try {
      const status = await getBlueprintStatus(auditView);
      setSavedAuditId(status.auditId || savedAuditId);
      setAuditRevision(status.auditRevision ?? null);
      setAuditSha256(status.auditSha256 || null);
      setAccounts(status.audit?.accounts || accounts);
      setClassificationReview(status.classificationReview || status.audit?.classificationReview || null);
      setCorrectionsDirty(false);
      setInitializationError(null);
    } catch (error) {
      setSaveError(error?.message || 'The review saved, but CCC could not reload its exact revision. Reload the audit before opening Campaign Studio.');
    }
  };

  const openCampaign = async () => {
    setInitializationError(null);
    if (correctionsDirty) {
      setInitializationError('Save the classification review before initializing CRA account tracks.');
      return;
    }
    if (!hasSavedReview) {
      setInitializationError('Confirm and save the exact staff classification review before initializing CRA account tracks.');
      return;
    }
    if (!canBuild) {
      setInitializationError('Resolve every classification and R1 routing stop before opening Campaign Studio.');
      return;
    }
    setInitializingTracks(true);
    try {
      const tracks = await initializeCraAccountTracks(auditView);
      setInitialTracks(tracks);
      setCampaignOpen(true);
    } catch (error) {
      setInitializationError(error?.message || 'CCC could not initialize the CRA account tracks. Retry before building letters.');
    } finally {
      setInitializingTracks(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-10">
      {campaignOpen && (
        <DisputeCampaignStudio
          key={auditView.client?.id || auditView.client?.name || 'campaign'}
          audit={auditView}
          initialTracks={initialTracks}
          onSaved={() => {}}
          onClose={() => setCampaignOpen(false)}
        />
      )}
      {blueprintOpen && (
        <RecoveryBlueprintStudio
          audit={auditView}
          accounts={accounts}
          correctionsDirty={correctionsDirty}
          clientEmail={clientEmail}
          onCorrectionsSaved={refreshSavedClassification}
          onClose={() => setBlueprintOpen(false)}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="h-8 w-1 rounded" style={{ background: T.gold }} />
          <div>
            <h1 className="ccc-display text-[22px] font-medium" style={{ color: T.ink }}>R1 Start Instructions</h1>
            <p className="text-[11px]" style={{ color: T.muted }}>{audit.client?.name || 'Unknown client'} · deterministic Consent, Accuracy, Collection routing</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onBackToClients && <button onClick={onBackToClients} className="flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ borderColor: T.border, color: T.muted }}><ArrowLeft size={13} /> Clients</button>}
          <button onClick={() => setBlueprintOpen(true)} className="flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ borderColor: T.navy, color: T.navy }}><BookOpenCheck size={13} /> Recovery Blueprint</button>
          <button
            onClick={openCampaign}
            disabled={!canBuild || correctionsDirty || initializingTracks || !!initializationBlocker}
            title={plan.needsReview.length || silentlyDeferred ? 'Resolve all red classification and routing stops first.' : correctionsDirty || !hasSavedReview ? 'Save the exact staff classification review first.' : initializationBlocker || undefined}
            className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: T.navy, color: T.gold }}
          >{initializingTracks ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} {initializingTracks ? 'Initializing CRA tracks' : 'Open R1 Campaign Builder'}</button>
        </div>
      </div>

      {initializationBlocker && plan.needsReview.length === 0 && silentlyDeferred === 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <div><strong>CRA initialization required:</strong> {initializationBlocker}</div>
        </div>
      )}
      {initializationError && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-900">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <div><strong>Campaign Studio stayed closed:</strong> {initializationError}</div>
        </div>
      )}

      {plan.needsReview.length > 0 || silentlyDeferred > 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-900">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <div><strong>Mailing stop:</strong> {plan.needsReview.length > 0 ? `${plan.needsReview.length} account/bureau route${plan.needsReview.length === 1 ? '' : 's'} lack enough confirmed facts for deterministic routing.` : `${silentlyDeferred} routed account${silentlyDeferred === 1 ? '' : 's'} did not receive an R1 letter.`} Correct the red stops and save before opening the campaign builder.</div>
        </div>
      ) : !hasSavedReview ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <div><strong>Staff confirmation required:</strong> Review every independent bureau route and save this classification review before CCC can initialize R1.</div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-[12px] text-green-900">
          <CheckCircle2 size={17} className="shrink-0" /> <div><strong>R1 classification is complete.</strong> Review every bureau letter, save any team corrections, then initialize the CRA account tracks. This entry point does not create Direct tracks.</div>
        </div>
      )}

      <Card className="p-5">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <div className="text-[9px] font-bold uppercase tracking-[.14em]" style={{ color: T.faint }}>Client</div>
            <div className="mt-1 text-[20px] font-semibold" style={{ color: T.ink }}>{audit.client?.name || 'Unknown client'}</div>
            {audit.client?.address && <div className="mt-1 flex items-start gap-1.5 text-[11px]" style={{ color: T.muted }}><MapPin size={12} className="mt-0.5 shrink-0" />{audit.client.address}</div>}
          </div>
          {[
            ['Report date', audit.client?.reportDate || 'Not found'],
            ['Negative accounts', targetAccounts],
            ['R1 bureau letters', plan.recommendedLetterCount],
          ].map(([label, value]) => <div key={label} className="rounded-xl border bg-gray-50 px-3 py-3" style={{ borderColor: T.border }}><div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: T.faint }}>{label}</div><div className="mt-1 text-[16px] font-semibold" style={{ color: T.ink }}>{value}</div></div>)}
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3">
          <FileSearch size={18} style={{ color: T.gold }} />
          <div><h2 className="ccc-display text-[16px] font-medium" style={{ color: T.ink }}>Exactly where this client starts</h2><p className="mt-1 text-[11px]" style={{ color: T.muted }}>Every R1 letter is listed separately. Build each letter shown for the bureau, using only the accounts inside that letter.</p></div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">{plan.bureaus.map((item) => <BureauPlanCard key={item.bureau.code} item={item} />)}</div>
        {Object.values(plan.overridesByBureau || {}).some((override) => override.forceConsent || override.forceLatePayForLates) && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            <strong>Bureau-specific override applied:</strong> Review the independent bureau cards above. Student-majority and mixed-late rules are calculated separately for each bureau.
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div><h2 className="ccc-display text-[16px] font-medium" style={{ color: T.ink }}>Account Classification Review</h2><p className="mt-1 text-[11px]" style={{ color: T.muted }}>Claude extracts report facts; CCC applies the fixed routing rules. Expand a row to verify late counts and factual findings.</p></div>
          <button onClick={saveCorrections} disabled={(!correctionsDirty && hasSavedReview) || savingCorrections || resolvingAuditIdentity || !savedAuditId || !auditSha256 || accounts.some((account) => account.classificationAttested !== true)} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-wider disabled:opacity-40" style={{ background: T.navy, color: T.gold }}>
            {savingCorrections ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {savingCorrections ? 'Saving' : correctionsDirty ? 'Save classification review' : hasSavedReview ? 'Review saved' : 'Confirm classification review'}
          </button>
        </div>
        {saveError && <div className="mx-4 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{saveError}</div>}
        <div className="border-t" style={{ borderColor: T.border }}>
          {accounts.length ? accounts.map((account, index) => {
            const key = accountKey(account, index);
            const accountClassifications = classifications.get(accountClassificationKey(account, index)) || [];
            return <AccountRow key={key} account={account} classifications={accountClassifications} index={index} expanded={expandedAccount === key} onToggle={() => setExpandedAccount((current) => current === key ? null : key)} onChange={(patch) => updateAccount(index, patch)} />;
          }) : <div className="px-5 py-8 text-center text-[12px]" style={{ color: T.muted }}>No accounts were extracted from this report.</div>}
        </div>
      </Card>

      {audit.executiveSummary && (
        <Card className="p-5">
          <div className="text-[9px] font-bold uppercase tracking-[.14em]" style={{ color: T.faint }}>Source-report summary</div>
          <p className="mt-2 text-[12px] leading-relaxed" style={{ color: T.muted }}>{audit.executiveSummary}</p>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <div className="text-[10px]" style={{ color: T.faint }}>Historical letters and responses remain available on the client record. New campaigns use only the stored flow templates.</div>
        {onReset && <button onClick={onReset} className="text-[10px] font-bold uppercase tracking-wider" style={{ color: T.navy }}>Start another audit</button>}
      </div>
    </div>
  );
}
