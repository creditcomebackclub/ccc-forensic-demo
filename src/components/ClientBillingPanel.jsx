import React, { useState, useEffect } from 'react';
import { updateClientProfile } from '../utils/storage';
import { supabase } from '../utils/supabase';
import { Check, X, DollarSign, Edit2, Link, FileSignature } from 'lucide-react';
import {
  collectedTotal,
  computeClientCommission,
} from '../utils/affiliateCommission';
import { notifyAffiliate } from '../utils/notifyAffiliate';
import {
  INQUIRY_ONLY_FEE_TEXT,
  buildLatePaymentPackage,
  hasCustomServiceAgreement,
} from '../utils/pricing';
import {
  agreementOpeningInvoicePreview,
  mutateClientLedger,
  openingInvoiceConfirmation,
} from '../utils/manualBilling';
import { toast } from 'react-hot-toast';

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  grid: '#EEF0F4',
};

function Section({ title, children, span2 }) {
  return (
    <div className={'bg-white p-5 rounded-xl flex flex-col gap-4 ' + (span2 ? 'md:col-span-2' : '')} style={{ border: '1px solid ' + T.border }}>
      <h3 className="text-[11px] font-bold uppercase tracking-wider ccc-display" style={{ color: T.navy }}>{title}</h3>
      <div className="flex flex-col gap-3">
        {children}
      </div>
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[12px] font-medium mt-0.5" style={{ color: T.muted }}>{label}</span>
      <div className="text-right flex-1 flex flex-col items-end">
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onSave, type = 'text', placeholder = '', options = null }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value || '');

  const save = async () => {
    await onSave(val);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center justify-end gap-1.5 w-full">
        {options ? (
          <select
            value={val}
            onChange={(e) => setVal(e.target.value)}
            className="border rounded-md px-2 py-1 text-[12px] focus:outline-none focus:border-navy bg-white"
            style={{ borderColor: T.border, minWidth: 140 }}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          >
            <option value="">Select...</option>
            {options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <input
            type={type}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder={placeholder}
            autoFocus
            className="border rounded-md px-2 py-1 text-[12px] focus:outline-none focus:border-navy"
            style={{ borderColor: T.border, minWidth: 100, width: '100%', maxWidth: 200 }}
            onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
          />
        )}
        <button onClick={save} className="text-green-600 hover:text-green-700 flex-shrink-0"><Check size={13} strokeWidth={2} /></button>
        <button onClick={() => setEditing(false)} className="text-ink-faint hover:text-red-600 flex-shrink-0"><X size={13} strokeWidth={2} /></button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 group justify-end">
      <span className="text-[12px]" style={{ color: value ? T.ink : T.faint, fontStyle: value ? 'normal' : 'italic' }}>{value || 'Not set'}</span>
      <button onClick={() => { setVal(value || ''); setEditing(true); }}
        title={'Edit ' + (label || 'field')}
        className="opacity-30 group-hover:opacity-100 text-ink-faint hover:text-navy transition-opacity">
        <Edit2 size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

// Retention Build 3 — lifecycle status. A dedicated field (not the generic
// Field above) because it has cross-field validation the generic one
// doesn't support: exit_reason is required whenever status isn't 'Active',
// and both fields save together in one call.
const LIFECYCLE_STATUSES = ['Active', 'Paused', 'Graduated', 'Inactive'];
const EXIT_REASON_LABELS = {
  graduated: 'Graduated — arc complete',
  non_payment: 'Non-payment',
  dissatisfied: 'Dissatisfied',
  went_dark: 'Went dark',
  client_paused: 'Client requested pause',
  price: 'Price',
  other: 'Other',
};
const EXIT_REASONS = Object.keys(EXIT_REASON_LABELS);

function LifecycleStatusField({ status, exitReason, onSave }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(status || '');
  const [reason, setReason] = useState(exitReason || '');

  const needsReason = !!val && val !== 'Active';
  const canSave = !!val && (!needsReason || !!reason);

  const save = async () => {
    if (!canSave) return;
    await onSave({ billing_status: val, exit_reason: needsReason ? reason : null });
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex flex-col items-end gap-1.5 w-full">
        <div className="flex items-center gap-1.5 w-full justify-end">
          <select
            value={val}
            onChange={(e) => setVal(e.target.value)}
            className="border rounded-md px-2 py-1 text-[12px] focus:outline-none focus:border-navy bg-white"
            style={{ borderColor: T.border, minWidth: 140 }}
          >
            <option value="">Select...</option>
            {LIFECYCLE_STATUSES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <button onClick={save} disabled={!canSave} title={!canSave && needsReason ? 'Exit reason required' : 'Save'} className="text-green-600 hover:text-green-700 flex-shrink-0 disabled:opacity-30 disabled:cursor-not-allowed"><Check size={13} strokeWidth={2} /></button>
          <button onClick={() => setEditing(false)} className="text-ink-faint hover:text-red-600 flex-shrink-0"><X size={13} strokeWidth={2} /></button>
        </div>
        {needsReason && (
          <select
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="border rounded-md px-2 py-1 text-[12px] focus:outline-none focus:border-navy bg-white"
            style={{ borderColor: reason ? T.border : '#F59E0B', minWidth: 200 }}
          >
            <option value="">Exit reason (required)...</option>
            {EXIT_REASONS.map((r) => <option key={r} value={r}>{EXIT_REASON_LABELS[r]}</option>)}
          </select>
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5 group justify-end">
      <div className="text-right">
        <div className="text-[12px]" style={{ color: status ? T.ink : T.faint, fontStyle: status ? 'normal' : 'italic' }}>{status || 'Not set'}</div>
        {exitReason && <div className="text-[10px]" style={{ color: T.faint }}>{EXIT_REASON_LABELS[exitReason] || exitReason}</div>}
      </div>
      <button onClick={() => { setVal(status || ''); setReason(exitReason || ''); setEditing(true); }}
        title="Edit billing status"
        className="opacity-30 group-hover:opacity-100 text-ink-faint hover:text-navy transition-opacity">
        <Edit2 size={11} strokeWidth={2} />
      </button>
    </div>
  );
}

const ENGAGEMENT_LABELS = {
  pending_onboarding: 'Pending Onboarding', active: 'Active', paused: 'Paused', inactive: 'Inactive', graduated: 'Graduated',
};

function EngagementStatusField({ status, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(status || 'pending_onboarding');
  useEffect(() => setValue(status || 'pending_onboarding'), [status]);
  if (editing) return <div className="flex items-center gap-1.5 justify-end"><select value={value} onChange={(e) => setValue(e.target.value)} className="border rounded-md px-2 py-1 text-[12px] bg-white" style={{ borderColor: T.border }}><option value="pending_onboarding">Pending Onboarding</option><option value="active">Active</option><option value="paused">Paused</option><option value="inactive">Inactive</option><option value="graduated">Graduated</option></select><button onClick={async () => { await onSave(value); setEditing(false); }} className="text-green-600"><Check size={13} /></button><button onClick={() => setEditing(false)} className="text-ink-faint"><X size={13} /></button></div>;
  return <div className="flex items-center gap-1.5 group justify-end"><span className="text-[12px]" style={{ color: status === 'active' ? '#15803D' : T.ink }}>{ENGAGEMENT_LABELS[status] || 'Pending Onboarding'}</span><button onClick={() => setEditing(true)} className="opacity-30 group-hover:opacity-100 text-ink-faint hover:text-navy"><Edit2 size={11} /></button></div>;
}

function ServiceAgreementSection({ client, save, onChanged, canManageLedger }) {
  const savedMode = (client.serviceAgreementMode || 'tier') === 'custom' ? 'custom' : 'tier';
  const savedAgreementFingerprint = JSON.stringify({
    mode: savedMode,
    label: savedMode === 'custom' ? (client.serviceAgreementLabel || '') : '',
    amount: savedMode === 'custom' && client.serviceAgreementAmount != null ? String(Number(client.serviceAgreementAmount)) : '',
    feeText: savedMode === 'custom' ? (client.serviceAgreementFeeText || '') : '',
    billingTier: client.billingTier || '',
    billingType: client.billingType || '',
  });
  const isCustom = (client.serviceAgreementMode || 'tier') === 'custom';
  const [mode, setMode] = useState(isCustom ? 'custom' : 'tier');
  const [label, setLabel] = useState(client.serviceAgreementLabel || '');
  const [amount, setAmount] = useState(
    client.serviceAgreementAmount != null ? String(client.serviceAgreementAmount) : ''
  );
  const [feeText, setFeeText] = useState(client.serviceAgreementFeeText || '');
  const [customBillingType, setCustomBillingType] = useState(
    isCustom && ['Automated Recurring', 'Paid in Full'].includes(client.billingType)
      ? client.billingType
      : 'Paid in Full'
  );
  const [perBureau, setPerBureau] = useState('75');
  const [bureauCount, setBureauCount] = useState('2');
  const [includeInquiryPi, setIncludeInquiryPi] = useState(true);
  const [saving, setSaving] = useState(false);
  const [startingOnboarding, setStartingOnboarding] = useState(false);
  const [creatingOpeningInvoice, setCreatingOpeningInvoice] = useState(false);
  const [latestAgreement, setLatestAgreement] = useState(null);
  const [onboardingMessage, setOnboardingMessage] = useState('');
  const [lastSavedFingerprint, setLastSavedFingerprint] = useState(savedAgreementFingerprint);

  useEffect(() => {
    setMode((client.serviceAgreementMode || 'tier') === 'custom' ? 'custom' : 'tier');
    setLabel(client.serviceAgreementLabel || '');
    setAmount(client.serviceAgreementAmount != null ? String(client.serviceAgreementAmount) : '');
    setFeeText(client.serviceAgreementFeeText || '');
    setCustomBillingType(
      (client.serviceAgreementMode || 'tier') === 'custom'
        && ['Automated Recurring', 'Paid in Full'].includes(client.billingType)
        ? client.billingType
        : 'Paid in Full'
    );
    setLastSavedFingerprint(savedAgreementFingerprint);
  }, [
    client.id,
    client.serviceAgreementMode,
    client.serviceAgreementLabel,
    client.serviceAgreementAmount,
    client.serviceAgreementFeeText,
    client.billingTier,
    client.billingType,
    savedAgreementFingerprint,
  ]);

  useEffect(() => {
    let cancelled = false;
    setLatestAgreement(null);
    if (!client.id) return () => { cancelled = true; };
    supabase
      .from('client_service_agreements')
      .select('id,status,template_version,plan_snapshot,created_at')
      .eq('client_id', client.id)
      .in('status', ['draft', 'sent', 'signed'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn('Could not load the latest agreement billing snapshot:', error.message);
          return;
        }
        setLatestAgreement(data || null);
      });
    return () => { cancelled = true; };
  }, [client.id]);

  const currentAgreementFingerprint = JSON.stringify({
    mode,
    label: mode === 'custom' ? label.trim() : '',
    amount: mode === 'custom' && amount !== '' && !Number.isNaN(Number(amount)) ? String(Number(amount)) : '',
    feeText: mode === 'custom' ? feeText.trim() : '',
    billingTier: client.billingTier || '',
    billingType: mode === 'custom' ? customBillingType : (client.billingType || ''),
  });
  const agreementHasUnsavedChanges = currentAgreementFingerprint !== lastSavedFingerprint;

  const applyLatePaymentPreset = () => {
    const built = buildLatePaymentPackage({
      perBureau,
      bureauCount,
      includeInquiryPi,
    });
    setMode('custom');
    setLabel(built.label);
    setAmount(String(built.amount));
    setFeeText(built.feeText);
    setCustomBillingType('Paid in Full');
  };

  const applyInquiryPreset = () => {
    setMode('custom');
    setLabel('Inquiry / PI removal');
    setAmount('');
    setFeeText(INQUIRY_ONLY_FEE_TEXT);
    setCustomBillingType('Paid in Full');
  };

  const applyBlankCustom = () => {
    setMode('custom');
    setLabel('');
    setAmount('');
    setFeeText('');
    setCustomBillingType('Paid in Full');
  };

  const saveAgreement = async () => {
    if (mode === 'custom' && !String(feeText || '').trim()) {
      toast.error('Custom agreement needs the exact fee terms the client will sign.');
      return;
    }
    if (mode === 'custom' && !String(label || '').trim()) {
      toast.error('Add a client-facing package name before saving.');
      return;
    }
    if (mode === 'custom' && !['Automated Recurring', 'Paid in Full'].includes(customBillingType)) {
      toast.error('Choose monthly recurring or one-time billing for the custom agreement.');
      return;
    }
    const customAmount = amount === '' ? null : Number(amount);
    if (mode === 'custom' && customAmount != null
        && (!Number.isFinite(customAmount) || customAmount <= 0
          || Math.abs(customAmount * 100 - Math.round(customAmount * 100)) > 1e-8)) {
      toast.error('Custom billing amounts must be greater than $0 and use no more than two decimal places.');
      return;
    }
    if (mode === 'custom' && customBillingType === 'Automated Recurring'
        && customAmount == null) {
      toast.error('Custom monthly billing requires an amount greater than $0.');
      return;
    }
    if (mode === 'tier' && !client.billingTier) {
      toast.error('Choose and save the client service tier before saving the agreement.');
      return;
    }
    setSaving(true);
    try {
      const fields = mode === 'custom'
        ? {
            service_agreement_mode: 'custom',
            service_agreement_label: label.trim() || null,
            service_agreement_amount: customAmount,
            service_agreement_fee_text: feeText.trim(),
            billing_type: customBillingType,
            billing_recurring_amount: customBillingType === 'Automated Recurring'
              && customAmount != null
              ? customAmount
              : null,
          }
        : {
            service_agreement_mode: 'tier',
            service_agreement_label: null,
            service_agreement_amount: null,
            service_agreement_fee_text: null,
            billing_type: client.billingTier === 'Paid In Full' ? 'Paid in Full' : 'Automated Recurring',
            billing_recurring_amount: client.billingTier === 'Paid In Full' ? null : client.billingRecurringAmount,
          };
      const saved = await save(fields);
      if (saved === false) return;
      setLastSavedFingerprint(currentAgreementFingerprint);
      toast.success(mode === 'custom' ? 'Custom service agreement saved' : 'Tier service agreement saved');
    } finally {
      setSaving(false);
    }
  };

  // This is the only new-client onboarding entry point. The server rereads
  // the saved client billing fields, snapshots the exact agreement version,
  // plan, fees, and client identity, then emails a single-use signing link.
  // Later billing edits cannot mutate a packet that was already prepared.
  const startOnboarding = async () => {
    if (mode === 'custom' && !String(feeText || '').trim()) {
      toast.error('Save the custom plan terms before starting onboarding.');
      return;
    }
    if (!client.email) {
      toast.error('Add the client email before starting onboarding.');
      return;
    }
    if (mode === 'tier' && !client.billingTier) {
      toast.error('Choose and save the client service tier before starting onboarding.');
      return;
    }
    if (mode === 'tier') {
      const expectedBillingType = client.billingTier === 'Paid In Full' ? 'Paid in Full' : 'Automated Recurring';
      if (client.billingType !== expectedBillingType) {
        toast.error(`${client.billingTier} requires Billing Type “${expectedBillingType}” before starting onboarding.`);
        return;
      }
    }
    if (agreementHasUnsavedChanges) {
      toast.error('Save the agreement changes before starting onboarding.');
      return;
    }
    setStartingOnboarding(true);
    setOnboardingMessage('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const adminToken = session?.access_token;
      const res = await fetch('/.netlify/functions/agreement-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}) },
        body: JSON.stringify({ clientId: client.id, action: 'start' }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || out.sendBlocked) {
        const blockers = Array.isArray(out.blockers) && out.blockers.length
          ? ` (${out.blockers.join(', ')})`
          : '';
        throw new Error((out.error || out.message || 'Could not start onboarding.') + blockers);
      }
      setOnboardingMessage('Onboarding link sent. The wizard uses the frozen client name, agreement version, and billing snapshot, then requires disclosure review, agreement signature, ID, and proof of address before portal access.');
      setLatestAgreement({
        id: out.agreementId,
        status: out.status,
        template_version: out.templateVersion,
        plan_snapshot: out.planSnapshot,
        created_at: new Date().toISOString(),
      });
      toast.success('Secure onboarding link sent');
      if (onChanged) onChanged();
    } catch (e) {
      toast.error(e.message || 'Could not start onboarding.');
    } finally {
      setStartingOnboarding(false);
    }
  };

  const openingInvoicePreview = (() => {
    try {
      return latestAgreement
        ? agreementOpeningInvoicePreview(latestAgreement.plan_snapshot, {
            templateVersion: latestAgreement.template_version,
            status: latestAgreement.status,
          })
        : null;
    }
    catch { return null; }
  })();

  const createOpeningInvoice = async () => {
    if (!canManageLedger) {
      toast.error('Only the account owner can create ledger invoices.');
      return;
    }
    if (!latestAgreement?.id || !openingInvoicePreview) {
      toast.error('Start onboarding to freeze the exact pricing first, or use Add Transaction for a custom amount.');
      return;
    }
    if (!confirm(openingInvoiceConfirmation(openingInvoicePreview))) return;
    const requestKey = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : null;
    if (!requestKey) {
      toast.error('This browser cannot create a secure invoice request.');
      return;
    }
    setCreatingOpeningInvoice(true);
    try {
      const { data, error } = await supabase.rpc('ccc_create_manual_agreement_invoice', {
        p_client_id: client.id,
        p_agreement_id: latestAgreement.id,
        p_request_key: requestKey,
        p_invoice_date: new Date().toISOString().slice(0, 10),
      });
      if (error) throw error;
      toast.success(data?.alreadyCreated
        ? 'That agreement already has its opening ledger invoice'
        : `Opening ledger invoice created for $${Number(data?.invoice?.amount || openingInvoicePreview.total).toFixed(2)}`);
      if (onChanged) onChanged();
    } catch (error) {
      toast.error(error.message || 'Could not create the opening ledger invoice.');
    } finally {
      setCreatingOpeningInvoice(false);
    }
  };

  return (
    <Section title="Service Agreement" span2>
      <p className="text-[12px]" style={{ color: T.muted }}>
        Choose and save the exact plan first. Start Onboarding freezes the client name, agreement version, selected plan, and fee terms, then emails one secure wizard link. The client reviews the required disclosure, signs the agreement, and uploads ID and proof of address before portal access. It never creates a payment.
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode('tier')}
          className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-md border transition-colors"
          style={{
            borderColor: mode === 'tier' ? T.navy : T.border,
            background: mode === 'tier' ? T.navy : '#fff',
            color: mode === 'tier' ? T.gold : T.ink,
          }}
        >
          Tier plan
        </button>
        <button
          type="button"
          onClick={() => setMode('custom')}
          className="text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-md border transition-colors"
          style={{
            borderColor: mode === 'custom' ? T.navy : T.border,
            background: mode === 'custom' ? T.navy : '#fff',
            color: mode === 'custom' ? T.gold : T.ink,
          }}
        >
          Custom package
        </button>
      </div>

      {mode === 'tier' ? (
        <div className="text-[12px] px-3 py-2 rounded-md border" style={{ borderColor: T.border, color: T.muted }}>
          Agreement fees follow the Service Tier below
          {client.billingTier ? ` (${client.billingTier})` : ' (set a tier first)'}.
          {hasCustomServiceAgreement(client) && (
            <span className="block mt-1 text-amber-700">A custom agreement is saved — click Save to clear it and return to tier fees.</span>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider font-bold" style={{ color: T.faint }}>$ / bureau</label>
              <input type="number" value={perBureau} onChange={(e) => setPerBureau(e.target.value)}
                className="border rounded-md px-2 py-1 text-[12px] w-20" style={{ borderColor: T.border }} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider font-bold" style={{ color: T.faint }}>Bureaus</label>
              <input type="number" min="1" max="3" value={bureauCount} onChange={(e) => setBureauCount(e.target.value)}
                className="border rounded-md px-2 py-1 text-[12px] w-16" style={{ borderColor: T.border }} />
            </div>
            <label className="flex items-center gap-1.5 text-[12px] mb-1" style={{ color: T.ink }}>
              <input type="checkbox" checked={includeInquiryPi} onChange={(e) => setIncludeInquiryPi(e.target.checked)} />
              Include inquiry/PI letters
            </label>
            <button type="button" onClick={applyLatePaymentPreset}
              className="text-[11px] uppercase tracking-wider px-2.5 py-1.5 rounded-md border hover:bg-gray-50" style={{ borderColor: T.border, color: T.navy }}>
              Late payment preset
            </button>
            <button type="button" onClick={applyInquiryPreset}
              className="text-[11px] uppercase tracking-wider px-2.5 py-1.5 rounded-md border hover:bg-gray-50" style={{ borderColor: T.border, color: T.navy }}>
              Inquiry/PI only
            </button>
            <button type="button" onClick={applyBlankCustom}
              className="text-[11px] uppercase tracking-wider px-2.5 py-1.5 rounded-md border hover:bg-gray-50" style={{ borderColor: T.border, color: T.muted }}>
              Blank custom
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider font-bold" style={{ color: T.faint }}>Package label</label>
              <input value={label} onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Late payment + inquiry/PI (2 bureaus)"
                className="border rounded-md px-2 py-1.5 text-[12px]" style={{ borderColor: T.border }} />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] uppercase tracking-wider font-bold" style={{ color: T.faint }}>Amount ($)</label>
              <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                placeholder="150"
                className="border rounded-md px-2 py-1.5 text-[12px]" style={{ borderColor: T.border }} />
            </div>
            <div className="flex flex-col gap-1 md:col-span-2">
              <label className="text-[10px] uppercase tracking-wider font-bold" style={{ color: T.faint }}>Billing schedule</label>
              <select value={customBillingType} onChange={(e) => setCustomBillingType(e.target.value)}
                className="border rounded-md px-2 py-1.5 text-[12px] bg-white" style={{ borderColor: T.border }}>
                <option value="Automated Recurring">Monthly recurring</option>
                <option value="Paid in Full">One-time payment</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[10px] uppercase tracking-wider font-bold" style={{ color: T.faint }}>Client-facing fee terms</label>
            <textarea value={feeText} onChange={(e) => setFeeText(e.target.value)} rows={4}
              placeholder="Exact prose the client will sign…"
              className="border rounded-md px-2 py-1.5 text-[12px] w-full" style={{ borderColor: T.border }} />
          </div>

          <div className="text-[11px] px-3 py-2 rounded-md bg-amber-50 text-amber-800 border border-amber-200">
            The selected schedule and exact fee terms are frozen into the agreement. Saving terms never creates an invoice or payment.
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" onClick={saveAgreement} disabled={saving}
          className="text-[11px] uppercase tracking-wider px-3 py-2 rounded-md disabled:opacity-50"
          style={{ background: T.navy, color: T.gold }}>
          {saving ? 'Saving…' : 'Save agreement'}
        </button>
        <button type="button" onClick={startOnboarding} disabled={startingOnboarding || saving || agreementHasUnsavedChanges}
          className="text-[11px] uppercase tracking-wider px-3 py-2 rounded-md border hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-50"
          style={{ borderColor: T.navy, color: T.navy }}>
          <FileSignature size={12} /> {startingOnboarding ? 'Preparing…' : 'Start onboarding'}
        </button>
        {canManageLedger && <button
          type="button"
          onClick={createOpeningInvoice}
          disabled={creatingOpeningInvoice || !openingInvoicePreview}
          title={openingInvoicePreview
            ? 'Creates a ledger invoice only; it does not charge a payment method.'
            : 'Start onboarding to freeze exact agreement pricing, or use Add Transaction below.'}
          className="text-[11px] uppercase tracking-wider px-3 py-2 rounded-md border hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-50"
          style={{ borderColor: T.border, color: T.ink }}
        >
          <DollarSign size={12} /> {creatingOpeningInvoice ? 'Creating…' : 'Create opening invoice'}
        </button>}
      </div>
      {openingInvoicePreview && (
        <div className="text-[11px] px-3 py-2 rounded-md bg-slate-50 border" style={{ borderColor: T.border, color: T.muted }}>
          Owner action only: {openingInvoicePreview.lineItems.map((item) => `${item.description} $${item.amount.toFixed(2)}`).join(' + ')} = <strong>${`$${openingInvoicePreview.total.toFixed(2)}`}</strong>. It records a ledger invoice and never charges automatically.
        </div>
      )}
      {agreementHasUnsavedChanges && <div className="text-[11px] px-3 py-2 rounded-md bg-amber-50 text-amber-800 border border-amber-200">Save the current agreement selection before starting onboarding.</div>}
      {onboardingMessage && <div className="text-[11px] px-3 py-2 rounded-md bg-amber-50 text-amber-800 border border-amber-200">{onboardingMessage}</div>}
    </Section>
  );
}

export default function ClientBillingPanel({ client, onChanged, isAdmin = false }) {
  const today = new Date().toISOString().slice(0, 10);
  const [showAddTx, setShowAddTx] = useState(false);
  const [newTx, setNewTx] = useState({ date: today, type: 'Invoice', amount: '', description: '', status: 'Due', paidDate: today });
  const [affiliates, setAffiliates] = useState({});
  const [commissionPayouts, setCommissionPayouts] = useState([]);
  const [markingPaidId, setMarkingPaidId] = useState(null);
  const [markPaidDate, setMarkPaidDate] = useState(today);
  const [payingCommission, setPayingCommission] = useState(false);
  const [commissionPayAmount, setCommissionPayAmount] = useState('');
  const [commissionPayDate, setCommissionPayDate] = useState(today);

  useEffect(() => {
    // Raw rows keyed by id — affiliateCommission.js reads .commission_rate
    // directly; display name is composed where needed.
    supabase.from('affiliates').select('id, name, company, commission_rate').then(({ data }) => {
      if (data) {
        const map = {};
        data.forEach(a => { map[a.id] = a; });
        setAffiliates(map);
      }
    });
    supabase.from('commission_payouts').select('covered_tx_ids, amount').eq('client_id', client.id).then(({ data }) => {
      if (data) setCommissionPayouts(data);
    });
  }, [client.id]);

  const ledger = Array.isArray(client.ledger) ? client.ledger : [];
  
  // Balance is sum of all unpaid Invoices
  const balanceDue = ledger.reduce((sum, tx) => {
    if (tx.type === 'Invoice' && tx.status !== 'Paid') return sum + (parseFloat(tx.amount) || 0);
    return sum;
  }, 0);

  const totalPaid = collectedTotal({ ledger });

  const save = async (fields) => {
    try {
      await updateClientProfile(client.name, fields, client.id);
      if (onChanged) onChanged();
      return true;
    } catch (e) {
      console.error('Failed to save billing settings:', e);
      alert('Failed to save: ' + e.message);
      return false;
    }
  };

  const runLedgerCommand = async ({ operation, transactionId, changes = {} }) => {
    if (!isAdmin) {
      toast.error('Only the account owner can change the ledger.');
      return null;
    }
    try {
      const result = await mutateClientLedger({
        clientId: client.id,
        expectedLedger: ledger,
        operation,
        transactionId,
        changes,
      });
      if (onChanged) await onChanged();
      return result;
    } catch (error) {
      const message = error.message || 'Could not update the ledger.';
      toast.error(message);
      if (/changed in another session/i.test(message) && onChanged) await onChanged();
      return null;
    }
  };

  const notifyCommissionEarnedIfNeeded = (prevLedger, nextLedger, ledgerTransactionId) => {
    if (!client.referredBy || !ledgerTransactionId) return;
    const affiliate = affiliates[client.referredBy] || null;
    const before = computeClientCommission(
      { referral_fee: client.referralFee, ledger: prevLedger },
      affiliate,
      commissionPayouts
    ).earned;
    const after = computeClientCommission(
      { referral_fee: client.referralFee, ledger: nextLedger },
      affiliate,
      commissionPayouts
    ).earned;
    const delta = after - before;
    if (delta <= 0.004) return;
    notifyAffiliate('commission_earned', {
      clientId: client.id,
      ledgerTransactionId,
    });
  };

  const [editingTxId, setEditingTxId] = useState(null);

  const addTransaction = async () => {
    if (!newTx.amount) return alert('Amount is required');

    // Backfilling history: "Paid on" is independent of "Date" (the invoice
    // date) so a historical invoice can carry its real payment date instead
    // of silently defaulting to today — that default is exactly what made
    // Avg. days to pay meaningless for backfilled clients before this field
    // existed. Payment-type rows have no separate invoice date, so their
    // own date field doubles as the paid date.
    const paidAt = newTx.type === 'Payment'
      ? new Date(newTx.date + 'T12:00:00').toISOString()
      : (newTx.status === 'Paid' ? new Date((newTx.paidDate || newTx.date) + 'T12:00:00').toISOString() : null);

    let transactionId = editingTxId;
    let changes;
    if (editingTxId) {
      const existing = ledger.find((transaction) => transaction.id === editingTxId);
      if (existing?.source === 'manual_agreement_opening_invoice') {
        toast.error('Agreement opening invoices cannot be edited. Record payment status instead.');
        return;
      }
      changes = {
        date: newTx.date,
        type: newTx.type,
        amount: parseFloat(newTx.amount),
        description: newTx.description || (newTx.type === 'Invoice' ? 'Service Fee' : 'Payment Received'),
        status: newTx.type === 'Payment' ? 'Paid' : newTx.status,
        paid_at: paidAt,
      };
    } else {
      transactionId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : null;
      if (!transactionId) {
        toast.error('This browser cannot create a secure ledger transaction.');
        return;
      }
      changes = {
        date: newTx.date,
        type: newTx.type,
        amount: parseFloat(newTx.amount),
        description: newTx.description || (newTx.type === 'Invoice' ? 'Service Fee' : 'Payment Received'),
        status: newTx.type === 'Payment' ? 'Paid' : newTx.status,
        ...(paidAt ? { paid_at: paidAt } : {}),
      };
    }

    const result = await runLedgerCommand({
      operation: editingTxId ? 'edit' : 'add',
      transactionId,
      changes,
    });
    if (!result) return;
    notifyCommissionEarnedIfNeeded(ledger, result.ledger, transactionId);
    setShowAddTx(false);
    setEditingTxId(null);
    setNewTx({ date: new Date().toISOString().slice(0, 10), type: 'Invoice', amount: '', description: '', status: 'Due', paidDate: today });
  };

  const startEditTx = (tx) => {
    setNewTx({
      date: tx.date,
      type: tx.type,
      amount: tx.amount,
      description: tx.description || '',
      status: tx.status,
      paidDate: tx.paid_at ? tx.paid_at.slice(0, 10) : tx.date,
    });
    setEditingTxId(tx.id);
    setShowAddTx(true);
  };

  const deleteTransaction = async (id) => {
    const transaction = ledger.find((entry) => entry.id === id);
    if (transaction?.source === 'manual_agreement_opening_invoice') {
      toast.error('Agreement opening invoices are immutable and cannot be deleted.');
      return;
    }
    if (!confirm('Delete this transaction?')) return;
    await runLedgerCommand({ operation: 'delete', transactionId: id });
  };

  const markPaid = async (id, paidOnDate) => {
    // Stamp paid_at so the Billing Dashboard can compute days-to-pay / DSO.
    // Preserve any existing paid_at (idempotent re-marks). paidOnDate lets
    // the caller pick the real payment date instead of always "now" — see
    // the inline date picker this opens into below.
    const stamp = paidOnDate ? new Date(paidOnDate + 'T12:00:00').toISOString() : new Date().toISOString();
    const result = await runLedgerCommand({
      operation: 'mark_paid',
      transactionId: id,
      changes: { paid_at: stamp },
    });
    if (!result) return;
    notifyCommissionEarnedIfNeeded(ledger, result.ledger, id);
    setMarkingPaidId(null);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start mt-2">
      <ServiceAgreementSection client={client} save={save} onChanged={onChanged} canManageLedger={isAdmin} />

      <Section title="Billing Setup">
        <Row label="Amount Due">
          <div className="text-[18px] font-bold" style={{ color: balanceDue > 0 ? '#DC2626' : T.ink }}>
            ${balanceDue.toFixed(2)}
          </div>
        </Row>
        <Row label="Total Paid (Lifetime)">
          <div className="text-[14px] font-medium" style={{ color: totalPaid > 0 ? '#15803D' : T.faint }}>
            ${totalPaid.toFixed(2)}
          </div>
        </Row>

        {hasCustomServiceAgreement(client) && (
          <>
            <Row label="Active Package">
              <div className="text-[12px] font-medium text-right" style={{ color: T.ink }}>
                {client.serviceAgreementLabel || 'Custom package'}
              </div>
            </Row>
            <Row label="Package Amount">
              <div className="text-[14px] font-semibold" style={{ color: T.navy }}>
                {client.serviceAgreementAmount != null
                  ? `$${Number(client.serviceAgreementAmount).toFixed(2)}`
                  : '—'}
              </div>
            </Row>
          </>
        )}

        <Row label="Service Eligibility">
          <EngagementStatusField
            status={client.engagementStatus}
            onSave={(value) => save({ engagement_status: value, engagement_status_changed_at: new Date().toISOString() })}
          />
          <div className="text-[10px] mt-1 text-right" style={{ color: T.faint }}>Controls starting new rounds only; it does not stop work already in flight.</div>
        </Row>

        <Row label="Billing Status">
          <LifecycleStatusField
            status={client.billingStatus}
            exitReason={client.exitReason}
            onSave={async (fields) => {
              const prev = client.billingStatus || 'Active';
              await save(fields);
              if (
                client.referredBy
                && ['Paused', 'Graduated', 'Inactive'].includes(fields.billing_status)
                && fields.billing_status !== prev
              ) {
                notifyAffiliate('exited', {
                  clientId: client.id,
                });
              }
            }}
          />
        </Row>
        <Row label="Billing Start Date">
          <Field 
            label="billing start date" 
            value={client.billingStartDate} 
            type="date"
            placeholder="YYYY-MM-DD"
            onSave={(v) => save({ billing_start_date: v })} 
          />
        </Row>
        {!hasCustomServiceAgreement(client) && (
          <Row label="Service Tier">
            <Field
              label="service tier"
              value={client.billingTier}
              options={['Standard', 'VIP', 'Paid In Full']}
              placeholder="Select tier..."
              onSave={(v) => save({
                billing_tier: v,
                billing_type: v === 'Paid In Full' ? 'Paid in Full' : 'Automated Recurring',
                billing_recurring_amount: v === 'Paid In Full' ? null : client.billingRecurringAmount,
              })}
            />
          </Row>
        )}
        {hasCustomServiceAgreement(client) && (
          <Row label="Service Tier">
            <span className="text-[12px] italic" style={{ color: T.faint }}>
              Custom package (uses the Service Agreement above)
            </span>
          </Row>
        )}
        <Row label="Billing Type">
          <Field 
            label="billing type" 
            value={client.billingType} 
            options={hasCustomServiceAgreement(client)
              ? ['Automated Recurring', 'Paid in Full']
              : client.billingTier === 'Paid In Full'
                ? ['Paid in Full']
                : client.billingTier
                  ? ['Automated Recurring']
                  : ['Automated Recurring', 'Paid in Full']}
            onSave={(v) => {
              const expected = hasCustomServiceAgreement(client)
                ? null
                : client.billingTier === 'Paid In Full'
                  ? 'Paid in Full'
                  : client.billingTier
                    ? 'Automated Recurring'
                    : null;
              if (expected && v !== expected) {
                toast.error(`${client.billingTier} requires Billing Type “${expected}”.`);
                return false;
              }
              return save({ billing_type: v });
            }}
          />
        </Row>
        {!hasCustomServiceAgreement(client) && client.billingType === 'Automated Recurring' && (
          <Row label="Custom Monthly Fee">
            <Field
              label="custom monthly fee"
              value={client.billingRecurringAmount != null ? String(client.billingRecurringAmount) : ''}
              type="number"
              placeholder="Uses tier price"
              onSave={(value) => {
                const amount = value === '' ? null : Number(value);
                if (amount != null && (!Number.isFinite(amount) || amount <= 0)) {
                  toast.error('Custom monthly fee must be greater than $0.');
                  return;
                }
                return save({ billing_recurring_amount: amount });
              }}
            />
            <div className="text-[10px] mt-1 text-right" style={{ color: T.faint }}>
              Optional recurring-plan price override used in the agreement and MRR. Invoices are still created manually.
            </div>
          </Row>
        )}
        
        {client.billingStatus === 'Active' && (
          <div className="mt-2 bg-green-50 text-green-800 text-[11px] px-3 py-2 rounded-md border border-green-200 flex items-start gap-2">
            <Check size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              {hasCustomServiceAgreement(client) || client.billingType === 'Paid in Full' ? (
                <>
                  <strong>One-time / paid-in-full billing.</strong>
                  {hasCustomServiceAgreement(client)
                    ? ' Custom package drives the signed service agreement. Invoices remain owner-controlled.'
                    : ' Any invoice remains owner-controlled.'}
                </>
              ) : (
                <>
                  <strong>Recurring plan is active.</strong> CCC will not create invoices, charge a payment method, or pause service automatically. Use the ledger or the agreement-based opening-invoice action when you choose.
                </>
              )}
            </div>
          </div>
        )}
        
        {client.billingStatus === 'Paused' && (
          <div className="mt-2 bg-amber-50 text-amber-800 text-[11px] px-3 py-2 rounded-md border border-amber-200 flex items-start gap-2">
            <DollarSign size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              <strong>Billing is paused.</strong> File stays open — letters may still be in flight. Not counted as churn.
            </div>
          </div>
        )}

        {client.billingStatus === 'Graduated' && (
          <div className="mt-2 bg-green-50 text-green-800 text-[11px] px-3 py-2 rounded-md border border-green-200 flex items-start gap-2">
            <Check size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              <strong>Graduated.</strong> Arc complete, exited successfully. Not counted as churn.
            </div>
          </div>
        )}

        {client.billingStatus === 'Inactive' && (
          <div className="mt-2 bg-red-50 text-red-800 text-[11px] px-3 py-2 rounded-md border border-red-200 flex items-start gap-2">
            <X size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              <strong>Inactive.</strong> Involuntary or dissatisfied exit. Counted as churn.
            </div>
          </div>
        )}
      </Section>

      <Section title="Affiliate Connection">
        <div className="text-[12px] text-ink-muted mb-2">
          This section tracks if this client was referred by a partner and the commission owed.
        </div>
        
        <Row label="Referred By">
          <div className="flex items-center gap-1.5 justify-end">
            <Link size={12} className="text-navy" />
            <span className="text-[12px] font-medium" style={{ color: client.referredBy ? T.ink : T.faint }}>
              {client.referredBy ? (affiliates[client.referredBy] ? affiliates[client.referredBy].name + (affiliates[client.referredBy].company ? ` (${affiliates[client.referredBy].company})` : '') : client.referredBy) : 'No affiliate linked'}
            </span>
          </div>
        </Row>

        <Row label="Commission Override (%)">
          <Field
            label="custom commission rate"
            value={client.referralFee ? String(client.referralFee) : ''}
            type="number"
            placeholder={client.referredBy ? `Default: ${Math.round((affiliates[client.referredBy]?.commission_rate || 0.20) * 100)}%` : 'e.g. 25'}
            onSave={(v) => save({ referral_fee: v ? parseFloat(v) : null })}
          />
        </Row>

        {client.referredBy && (() => {
          const affiliate = affiliates[client.referredBy] || null;
          const { earned, paid, owed, unpaidTxIds } = computeClientCommission(
            { referral_fee: client.referralFee, ledger },
            affiliate,
            commissionPayouts
          );

          const payCommission = async () => {
            const amount = parseFloat(commissionPayAmount);
            if (isNaN(amount) || amount <= 0) { alert('Enter a valid amount before confirming.'); return; }
            if (amount > owed + 0.01) { alert(`This payout exceeds the $${owed.toFixed(2)} currently owed.`); return; }
            if (!commissionPayDate) { alert('Pick a paid-on date before confirming.'); return; }
            try {
              const { data: { user } } = await supabase.auth.getUser();
              const { data: payout, error } = await supabase.from('commission_payouts').insert({
                affiliate_id: client.referredBy,
                client_id: client.id,
                client_name: client.name,
                // Financial reporting uses amount as the source of truth.
                // This is retained only as a legacy audit hint, and never
                // claims a partially-paid transaction is fully settled.
                covered_tx_ids: amount >= owed - 0.01 ? unpaidTxIds : [],
                amount,
                paid_at: new Date(commissionPayDate + 'T12:00:00').toISOString(),
                paid_by: user?.id || null,
              }).select('id').single();
              if (error) throw error;
              setPayingCommission(false);
              notifyAffiliate('commission_paid', {
                payoutId: payout.id,
              });
              if (onChanged) onChanged();
            } catch (e) {
              console.error('Failed to record commission payout:', e);
              alert('Could not save this payout: ' + (e.message || e));
            }
          };

          return (
            <Row label="Commission Status">
              <div className="text-right flex flex-col items-end gap-1.5">
                <div className="flex items-center justify-between w-36 text-[12px]">
                  <span className="text-ink-muted">Total Earned:</span>
                  <span className="font-bold text-ink">${earned.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between w-36 text-[12px]">
                  <span className="text-ink-muted">Paid Out:</span>
                  <span className="font-bold text-green-700">${paid.toFixed(2)}</span>
                </div>
                <div className="w-36 h-px bg-border my-0.5"></div>
                <div className="flex items-center justify-between w-36 text-[12px]">
                  <span className="text-ink-muted">Owed:</span>
                  <span className="font-bold text-amber-600">${owed.toFixed(2)}</span>
                </div>
                {owed <= 0.01 ? (
                  <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border bg-green-50 text-green-700 border-green-300 mt-1">✓ Paid Up</span>
                ) : payingCommission ? (
                  <div className="flex items-center gap-1 mt-1">
                    <input type="date" value={commissionPayDate} onChange={e => setCommissionPayDate(e.target.value)} className="w-28 text-[10px] px-1 py-1 border rounded" style={{ borderColor: T.border }} />
                    <input type="number" step="0.01" value={commissionPayAmount} onChange={e => setCommissionPayAmount(e.target.value)} className="w-16 text-[10px] px-1 py-1 border rounded text-right" style={{ borderColor: T.border }} />
                    <button onClick={payCommission} className="text-green-600 hover:text-green-700" title="Confirm payout"><Check size={13} strokeWidth={3} /></button>
                    <button onClick={() => setPayingCommission(false)} className="text-ink-faint hover:text-red-600" title="Cancel"><X size={13} strokeWidth={3} /></button>
                  </div>
                ) : isAdmin ? (
                  <button
                    onClick={() => { setPayingCommission(true); setCommissionPayAmount(owed.toFixed(2)); setCommissionPayDate(today); }}
                    className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-300 mt-1 hover:bg-amber-100 transition-colors">
                    Pay ${owed.toFixed(2)}
                  </button>
                ) : null}
              </div>
            </Row>
          );
        })()}
      </Section>

      <Section title="Ledger" span2>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[12px] text-ink-muted">Transaction history and open invoices.</div>
          {isAdmin && <button onClick={() => { setEditingTxId(null); setNewTx({ date: today, type: 'Invoice', amount: '', description: '', status: 'Due', paidDate: today }); setShowAddTx(!showAddTx); }} className="text-[11px] uppercase tracking-wider bg-navy text-gold px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity">
            + Add Transaction
          </button>}
        </div>

        {showAddTx && (
          <div className="bg-grid p-4 rounded-lg flex flex-col gap-3 mb-2" style={{ border: '1px solid ' + T.border }}>
            <div className="flex gap-3 flex-wrap">
              <label className="flex flex-col gap-1 text-[11px] font-bold text-navy uppercase tracking-wider">
                Date
                <input type="date" value={newTx.date} onChange={e => setNewTx({...newTx, date: e.target.value})} className="border rounded px-2 py-1 text-[12px] font-normal" style={{ borderColor: T.border }} />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-bold text-navy uppercase tracking-wider">
                Type
                <select value={newTx.type} onChange={e => setNewTx({...newTx, type: e.target.value})} className="border rounded px-2 py-1 text-[12px] font-normal bg-white" style={{ borderColor: T.border }}>
                  <option value="Invoice">Charge / Invoice</option>
                  <option value="Payment">Payment Received</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-bold text-navy uppercase tracking-wider">
                Amount ($)
                <input type="number" step="0.01" value={newTx.amount} onChange={e => setNewTx({...newTx, amount: e.target.value})} placeholder="0.00" className="border rounded px-2 py-1 text-[12px] font-normal w-24" style={{ borderColor: T.border }} />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-bold text-navy uppercase tracking-wider flex-1 min-w-[150px]">
                Description
                <input type="text" value={newTx.description} onChange={e => setNewTx({...newTx, description: e.target.value})} placeholder={newTx.type === 'Invoice' ? "e.g. Monthly Fee" : "e.g. Credit Card"} className="border rounded px-2 py-1 text-[12px] font-normal w-full" style={{ borderColor: T.border }} />
              </label>
              {newTx.type === 'Invoice' && (
                <label className="flex flex-col gap-1 text-[11px] font-bold text-navy uppercase tracking-wider">
                  Status
                  <select value={newTx.status} onChange={e => setNewTx({...newTx, status: e.target.value})} className="border rounded px-2 py-1 text-[12px] font-normal bg-white" style={{ borderColor: T.border }}>
                    <option value="Due">Due</option>
                    <option value="Paid">Paid</option>
                  </select>
                </label>
              )}
              {newTx.type === 'Invoice' && newTx.status === 'Paid' && (
                <label className="flex flex-col gap-1 text-[11px] font-bold text-navy uppercase tracking-wider">
                  Paid on
                  <input type="date" value={newTx.paidDate || newTx.date} onChange={e => setNewTx({...newTx, paidDate: e.target.value})} className="border rounded px-2 py-1 text-[12px] font-normal" style={{ borderColor: T.border }} />
                </label>
              )}
            </div>
            {newTx.type === 'Invoice' && newTx.status === 'Paid' && (
              <div className="text-[11px] text-faint -mt-1">
                Backfilling history? Set "Paid on" to the real payment date — it's used for the Avg. days to pay metric, so leaving it at today's date will understate it.
              </div>
            )}
            <div className="flex justify-end gap-2 mt-1">
              <button onClick={() => { setShowAddTx(false); setEditingTxId(null); }} className="text-[11px] uppercase tracking-wider text-muted hover:text-ink px-3 py-1">Cancel</button>
              <button onClick={addTransaction} className="text-[11px] uppercase tracking-wider bg-navy text-white px-4 py-1 rounded hover:opacity-90">
                {editingTxId ? 'Save Changes' : 'Save'}
              </button>
            </div>
          </div>
        )}

        <div className="border rounded-lg overflow-hidden" style={{ borderColor: T.grid }}>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b" style={{ borderColor: T.grid }}>
                <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted font-bold">Date</th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted font-bold">Type</th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted font-bold">Description</th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted font-bold text-right">Amount</th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted font-bold text-center">Status</th>
                <th className="px-3 py-2 text-[10px] uppercase tracking-wider text-muted font-bold text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr><td colSpan="6" className="px-3 py-6 text-center text-[12px] text-faint italic">No transactions yet.</td></tr>
              ) : (
                [...ledger].sort((a,b) => b.date.localeCompare(a.date)).map(tx => (
                  <tr key={tx.id} className="border-b last:border-0 hover:bg-gray-50" style={{ borderColor: T.grid }}>
                    <td className="px-3 py-2 text-[12px] text-ink whitespace-nowrap">{tx.date}</td>
                    <td className="px-3 py-2 text-[12px] whitespace-nowrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider ${tx.type === 'Payment' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-[12px] text-ink w-full">{tx.description}</td>
                    <td className="px-3 py-2 text-[12px] text-ink text-right font-medium">
                      {tx.type === 'Payment' ? '-' : ''}${Number(tx.amount).toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-center whitespace-nowrap">
                      {tx.type === 'Invoice' ? (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase tracking-wider ${tx.status === 'Paid' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                          {tx.status}
                        </span>
                      ) : (
                        <span className="text-[10px] text-faint uppercase">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {isAdmin ? <div className="flex justify-end items-center gap-2 opacity-30 hover:opacity-100 transition-opacity">
                        {tx.type === 'Invoice' && tx.status !== 'Paid' && (
                          markingPaidId === tx.id ? (
                            <span className="flex items-center gap-1">
                              <input
                                type="date"
                                value={markPaidDate}
                                onChange={(e) => setMarkPaidDate(e.target.value)}
                                className="border rounded px-1 py-0.5 text-[10px]"
                                style={{ borderColor: T.border }}
                              />
                              <button onClick={() => markPaid(tx.id, markPaidDate)} className="text-green-600 hover:text-green-700" title="Confirm paid on this date">
                                <Check size={12} strokeWidth={3} />
                              </button>
                              <button onClick={() => setMarkingPaidId(null)} className="text-ink-faint hover:text-red-600" title="Cancel">
                                <X size={12} strokeWidth={3} />
                              </button>
                            </span>
                          ) : (
                            <button
                              onClick={() => { setMarkingPaidId(tx.id); setMarkPaidDate(tx.date || today); }}
                              className="text-[10px] text-green-600 hover:underline"
                              title="Mark as Paid"
                            >
                              Paid
                            </button>
                          )
                        )}
                        {tx.source === 'manual_agreement_opening_invoice' ? (
                          <span className="text-[9px] uppercase tracking-wider text-faint" title="Agreement invoice terms are immutable">Agreement invoice</span>
                        ) : (
                          <>
                            <button onClick={() => startEditTx(tx)} className="text-blue-500 hover:text-blue-700" title="Edit">
                              <Edit2 size={12} strokeWidth={3} />
                            </button>
                            <button onClick={() => deleteTransaction(tx.id)} className="text-red-500 hover:text-red-700" title="Delete">
                              <X size={12} strokeWidth={3} />
                            </button>
                          </>
                        )}
                      </div> : <span className="text-[10px] text-faint uppercase">Owner only</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
