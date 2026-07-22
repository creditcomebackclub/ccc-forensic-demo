import React, { useState } from 'react';
import { updateClientProfile } from '../utils/storage';
import { Check, X, DollarSign, Edit2, Link } from 'lucide-react';

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

export default function ClientBillingPanel({ client, onChanged }) {
  const save = async (fields) => {
    try {
      await updateClientProfile(client.name, fields);
      if (onChanged) onChanged();
    } catch (e) {
      console.error('Failed to save billing settings:', e);
      alert('Failed to save: ' + e.message);
    }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start mt-2">
      <Section title="Billing Setup">
        <Row label="Billing Status">
          <Field 
            label="billing status" 
            value={client.billingStatus} 
            options={['Active', 'Paused', 'Inactive']} 
            onSave={(v) => save({ billing_status: v })} 
          />
        </Row>
        <Row label="Billing Type">
          <Field 
            label="billing type" 
            value={client.billingType} 
            options={['Automated Recurring', 'Paid in Full']} 
            onSave={(v) => save({ billing_type: v })} 
          />
        </Row>
        
        {client.billingStatus === 'Active' && (
          <div className="mt-2 bg-green-50 text-green-800 text-[11px] px-3 py-2 rounded-md border border-green-200 flex items-start gap-2">
            <Check size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              <strong>Billing is active.</strong> Client will be included in the automated billing cycle (once gateway is integrated).
            </div>
          </div>
        )}
        
        {client.billingStatus === 'Paused' && (
          <div className="mt-2 bg-amber-50 text-amber-800 text-[11px] px-3 py-2 rounded-md border border-amber-200 flex items-start gap-2">
            <DollarSign size={14} className="mt-0.5 flex-shrink-0" />
            <div>
              <strong>Billing is paused.</strong> Services may continue but invoicing is suspended.
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
              {client.referredBy || 'No affiliate linked'}
            </span>
          </div>
        </Row>
        
        <Row label="Referral Fee ($)">
          <Field 
            label="referral fee" 
            value={client.referralFee ? String(client.referralFee) : ''} 
            type="number"
            placeholder="0.00"
            onSave={(v) => save({ referral_fee: v ? parseFloat(v) : null })} 
          />
        </Row>

        <Row label="Commission Status">
          <div className="flex items-center gap-2 justify-end mt-1">
            <button 
              onClick={() => save({ commission_paid: !client.commissionPaid, commission_paid_at: !client.commissionPaid ? new Date().toISOString() : null })}
              className={'text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full border transition-colors ' +
                (client.commissionPaid
                  ? 'bg-green-50 text-green-700 border-green-300'
                  : 'bg-amber-50 text-amber-700 border-amber-300')}>
              {client.commissionPaid ? '✓ Paid' : '○ Unpaid'}
            </button>
          </div>
        </Row>
      </Section>
    </div>
  );
}
