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
import { persistReviewedAccounts } from '../utils/recoveryBlueprintApi.js';
import RecoveryBlueprintStudio from './RecoveryBlueprintStudio.jsx';
import DisputeCampaignStudio from './DisputeCampaignStudio.jsx';
import {
  buildR1CampaignPlan,
  FLOW_LABELS,
  flowRoundLabel,
} from '../utils/disputeFlow.js';

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  shadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
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
  const primary = item.primary;
  return (
    <div className={`rounded-xl border p-4 ${primary ? 'border-blue-200 bg-blue-50/60' : 'border-gray-200 bg-gray-50'}`}>
      <div className="text-[10px] font-bold uppercase tracking-[.14em]" style={{ color: T.faint }}>{item.bureau.name}</div>
      {primary ? (
        <>
          <div className="mt-2 text-[10px] font-extrabold uppercase tracking-[.16em] text-blue-700">Start with</div>
          <div className="mt-1 text-[14px] font-bold leading-snug" style={{ color: T.navy }}>{flowRoundLabel(primary.flow, 1)}</div>
          <div className="mt-3 space-y-1.5">
            {primary.accounts.map((account, index) => (
              <div key={accountKey(account, index)} className="flex items-center justify-between gap-3 rounded-lg bg-white/80 px-2.5 py-2 text-[11px]">
                <span className="min-w-0 truncate font-medium" style={{ color: T.ink }}>{account.furnisher}</span>
                <span className="shrink-0 font-mono" style={{ color: T.muted }}>{account.accountNumberMasked || 'No masked number'}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-2 text-[12px] font-medium" style={{ color: T.muted }}>No R1 letter for this bureau.</div>
      )}
      {!!item.deferred.length && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] leading-relaxed text-amber-900">
          <strong>Separate route:</strong> {item.deferred.map((entry) => `${entry.account.furnisher} → ${FLOW_LABELS[entry.flow]} R1`).join('; ')}. Do not place these accounts in the primary letter.
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

function AccountRow({ account, classification, index, expanded, onToggle, onChange }) {
  const isLate = account.accountKind === 'late_payment' || classification.kind === 'late_payment';
  return (
    <div className="border-t first:border-t-0" style={{ borderColor: T.border }}>
      <div className="grid items-center gap-3 px-4 py-3 lg:grid-cols-[1.4fr_.8fr_1fr_1.4fr_auto]">
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
          value={account.accountKind || classification.kind || 'other'}
          onChange={(event) => onChange({ accountKind: event.target.value })}
          className="rounded-lg border bg-white px-2.5 py-2 text-[11px] outline-none focus:border-blue-500"
          style={{ borderColor: T.border, color: T.ink }}
        >
          {ACCOUNT_KINDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <div>
          <RouteBadge classification={classification} />
          <div className="mt-1 text-[10px] leading-snug" style={{ color: T.muted }}>{classification.reason}</div>
        </div>
        <div className="text-right text-[10px]" style={{ color: T.faint }}>{account._edited ? 'Edited' : 'Extracted'}</div>
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
            </div>
            <div>
              <div className="text-[9px] font-bold uppercase tracking-wider" style={{ color: T.faint }}>Late-payment routing facts</div>
              {isLate ? (
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <label className="text-[10px]" style={{ color: T.muted }}>
                    Visible late markers
                    <input
                      type="number"
                      min="0"
                      value={account.latePaymentCount ?? ''}
                      onChange={(event) => onChange({ latePaymentCount: event.target.value === '' ? null : Number(event.target.value) })}
                      className="mt-1 w-full rounded-lg border bg-white px-2.5 py-2 text-[11px]"
                      style={{ borderColor: T.border, color: T.ink }}
                    />
                  </label>
                  <label className="text-[10px]" style={{ color: T.muted }}>
                    Pattern
                    <select
                      value={account.latePaymentBand || 'unclear'}
                      onChange={(event) => onChange({ latePaymentBand: event.target.value })}
                      className="mt-1 w-full rounded-lg border bg-white px-2.5 py-2 text-[11px]"
                      style={{ borderColor: T.border, color: T.ink }}
                    >
                      <option value="none">None</option>
                      <option value="two_or_fewer">2 or fewer</option>
                      <option value="three_or_more">3 or more</option>
                      <option value="mixed">Mixed stretches</option>
                      <option value="unclear">Unclear</option>
                    </select>
                  </label>
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
  const [correctionsDirty, setCorrectionsDirty] = useState(false);
  const [savingCorrections, setSavingCorrections] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [expandedAccount, setExpandedAccount] = useState(null);
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [blueprintOpen, setBlueprintOpen] = useState(false);
  const [clientEmail, setClientEmail] = useState(null);

  useEffect(() => {
    setAccounts(audit.accounts || []);
    setCorrectionsDirty(false);
    setSaveError(null);
    setExpandedAccount(null);
  }, [audit]);

  useEffect(() => {
    let active = true;
    lookupClientEmail(audit.client?.name, audit.client?.id)
      .then((email) => { if (active) setClientEmail(email); })
      .catch(() => { if (active) setClientEmail(null); });
    return () => { active = false; };
  }, [audit.client?.id, audit.client?.name]);

  const auditView = useMemo(() => ({ ...audit, accounts }), [audit, accounts]);
  const plan = useMemo(() => buildR1CampaignPlan(auditView), [auditView]);
  const classifications = useMemo(() => new Map(plan.accountClassifications.map((item, index) => [accountKey(item.account, index), item])), [plan]);
  const targetAccounts = plan.accountClassifications.filter((item) => item.flow && !item.excluded).length;
  const canBuild = plan.needsReview.length === 0 && plan.recommendedLetterCount > 0;

  const updateAccount = (index, patch) => {
    setAccounts((current) => current.map((account, accountIndex) => accountIndex === index ? { ...account, ...patch, _edited: true } : account));
    setCorrectionsDirty(true);
    setSaveError(null);
  };

  const saveCorrections = async () => {
    setSavingCorrections(true);
    setSaveError(null);
    try {
      const result = await persistReviewedAccounts(auditView, accounts);
      if (!result?.saved) throw new Error('CCC did not confirm the classification save.');
      setCorrectionsDirty(false);
    } catch (error) {
      setSaveError(error.message || 'Could not save the classification review.');
    } finally {
      setSavingCorrections(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-10">
      {campaignOpen && (
        <DisputeCampaignStudio
          key={auditView.client?.id || auditView.client?.name || 'campaign'}
          audit={auditView}
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
          onCorrectionsSaved={() => setCorrectionsDirty(false)}
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
            onClick={() => setCampaignOpen(true)}
            disabled={!canBuild || correctionsDirty}
            title={plan.needsReview.length ? 'Resolve all red classification stops first.' : correctionsDirty ? 'Save classification changes first.' : undefined}
            className="flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[10px] font-bold uppercase tracking-wider disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: T.navy, color: T.gold }}
          ><Sparkles size={13} /> Open R1 Campaign Builder</button>
        </div>
      </div>

      {plan.needsReview.length > 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-900">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <div><strong>Mailing stop:</strong> {plan.needsReview.length} account{plan.needsReview.length === 1 ? '' : 's'} lack enough report facts for deterministic routing. Correct the red rows and save before opening the campaign builder.</div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-[12px] text-green-900">
          <CheckCircle2 size={17} className="shrink-0" /> <strong>R1 classification is complete.</strong> Review each bureau card, save any team corrections, then open the stored-template campaign builder.
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
          <div><h2 className="ccc-display text-[16px] font-medium" style={{ color: T.ink }}>Exactly where this client starts</h2><p className="mt-1 text-[11px]" style={{ color: T.muted }}>Each card is an internal mailing instruction. Only the listed accounts belong in that bureau’s primary R1 letter.</p></div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">{plan.bureaus.map((item) => <BureauPlanCard key={item.bureau.code} item={item} />)}</div>
        {(plan.overrides.forceConsent || plan.overrides.forceLatePayForLates) && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
            <strong>File override applied:</strong> {plan.overrides.forceConsent ? 'student loans are the only or majority negative category, so all negative accounts start on Consent R1.' : 'a mixed late-payment stretch routes every late-payment account to Late Pay R1.'}
          </div>
        )}
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div><h2 className="ccc-display text-[16px] font-medium" style={{ color: T.ink }}>Account Classification Review</h2><p className="mt-1 text-[11px]" style={{ color: T.muted }}>Claude extracts report facts; CCC applies the fixed routing rules. Expand a row to verify late counts and factual findings.</p></div>
          <button onClick={saveCorrections} disabled={!correctionsDirty || savingCorrections} className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-bold uppercase tracking-wider disabled:opacity-40" style={{ background: T.navy, color: T.gold }}>
            {savingCorrections ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {savingCorrections ? 'Saving' : correctionsDirty ? 'Save classification review' : 'Review saved'}
          </button>
        </div>
        {saveError && <div className="mx-4 mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700">{saveError}</div>}
        <div className="border-t" style={{ borderColor: T.border }}>
          {accounts.length ? accounts.map((account, index) => {
            const key = accountKey(account, index);
            const classification = classifications.get(key) || plan.accountClassifications[index];
            return <AccountRow key={key} account={account} classification={classification} index={index} expanded={expandedAccount === key} onToggle={() => setExpandedAccount((current) => current === key ? null : key)} onChange={(patch) => updateAccount(index, patch)} />;
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
