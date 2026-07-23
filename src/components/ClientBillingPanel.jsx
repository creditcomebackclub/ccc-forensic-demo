import React, { useState, useEffect } from 'react';
import { updateClientProfile } from '../utils/storage';
import { supabase } from '../utils/supabase';
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

export default function ClientBillingPanel({ client, onChanged }) {
  const today = new Date().toISOString().slice(0, 10);
  const [showAddTx, setShowAddTx] = useState(false);
  const [newTx, setNewTx] = useState({ date: today, type: 'Invoice', amount: '', description: '', status: 'Due', paidDate: today });
  const [affiliates, setAffiliates] = useState({});
  const [markingPaidId, setMarkingPaidId] = useState(null);
  const [markPaidDate, setMarkPaidDate] = useState(today);

  useEffect(() => {
    supabase.from('affiliates').select('id, name, company, commission_rate').then(({ data }) => {
      if (data) {
        const map = {};
        data.forEach(a => {
          map[a.id] = {
            name: a.name + (a.company ? ` (${a.company})` : ''),
            rate: a.commission_rate || 0.20
          };
        });
        setAffiliates(map);
      }
    });
  }, []);

  const ledger = Array.isArray(client.ledger) ? client.ledger : [];
  
  // Balance is sum of all unpaid Invoices
  const balanceDue = ledger.reduce((sum, tx) => {
    if (tx.type === 'Invoice' && tx.status !== 'Paid') return sum + (parseFloat(tx.amount) || 0);
    return sum;
  }, 0);

  const totalPaid = ledger.reduce((sum, tx) => {
    if (tx.type === 'Payment' || (tx.type === 'Invoice' && tx.status === 'Paid')) {
      return sum + (parseFloat(tx.amount) || 0);
    }
    return sum;
  }, 0);

  const save = async (fields) => {
    try {
      await updateClientProfile(client.name, fields);
      if (onChanged) onChanged();
    } catch (e) {
      console.error('Failed to save billing settings:', e);
      alert('Failed to save: ' + e.message);
    }
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

    let updatedLedger;
    if (editingTxId) {
      updatedLedger = ledger.map(t => t.id === editingTxId ? {
        ...t,
        date: newTx.date,
        type: newTx.type,
        amount: parseFloat(newTx.amount),
        description: newTx.description || (newTx.type === 'Invoice' ? 'Service Fee' : 'Payment Received'),
        status: newTx.type === 'Payment' ? 'Paid' : newTx.status,
        paid_at: paidAt,
      } : t);
    } else {
      updatedLedger = [...ledger, {
        id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Math.random().toString(36).substring(7),
        date: newTx.date,
        type: newTx.type,
        amount: parseFloat(newTx.amount),
        description: newTx.description || (newTx.type === 'Invoice' ? 'Service Fee' : 'Payment Received'),
        status: newTx.type === 'Payment' ? 'Paid' : newTx.status,
        ...(paidAt ? { paid_at: paidAt } : {}),
        created_at: new Date().toISOString()
      }];
    }

    await save({ ledger: updatedLedger });
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
    if (!confirm('Delete this transaction?')) return;
    await save({ ledger: ledger.filter(t => t.id !== id) });
  };

  const markPaid = async (id, paidOnDate) => {
    // Stamp paid_at so the Billing Dashboard can compute days-to-pay / DSO.
    // Preserve any existing paid_at (idempotent re-marks). paidOnDate lets
    // the caller pick the real payment date instead of always "now" — see
    // the inline date picker this opens into below.
    const stamp = paidOnDate ? new Date(paidOnDate + 'T12:00:00').toISOString() : new Date().toISOString();
    const updated = ledger.map(t => t.id === id ? { ...t, status: 'Paid', paid_at: t.paid_at || stamp } : t);
    await save({ ledger: updated });
    setMarkingPaidId(null);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start mt-2">
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
        <Row label="Billing Status">
          <LifecycleStatusField
            status={client.billingStatus}
            exitReason={client.exitReason}
            onSave={(fields) => save(fields)}
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
        <Row label="Service Tier">
          <Field 
            label="service tier" 
            value={client.billingTier} 
            options={['Standard', 'VIP', 'Paid In Full']}
            placeholder="Select tier..."
            onSave={(v) => save({ billing_tier: v })} 
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
              {client.referredBy ? (affiliates[client.referredBy]?.name || client.referredBy) : 'No affiliate linked'}
            </span>
          </div>
        </Row>
        
        <Row label="Commission Override (%)">
          <Field 
            label="custom commission rate" 
            value={client.referralFee ? String(client.referralFee) : ''} 
            type="number"
            placeholder={client.referredBy ? `Default: ${((affiliates[client.referredBy]?.rate || 0.20) * 100)}%` : 'e.g. 25'}
            onSave={(v) => save({ referral_fee: v ? parseFloat(v) : null })} 
          />
        </Row>

        {client.referredBy && (() => {
          const totalEarned = totalPaid * ((client.referralFee !== null && client.referralFee !== undefined ? client.referralFee : ((affiliates[client.referredBy]?.rate || 0.20) * 100)) / 100);
          const paidOut = client.commissionPaid ? totalEarned : 0;
          const pending = totalEarned - paidOut;
          
          return (
            <Row label="Commission Status">
              <div className="text-right flex flex-col items-end gap-1">
                <div className="flex items-center justify-between w-32 text-[12px]">
                  <span className="text-ink-muted">Total Earned:</span>
                  <span className="font-bold text-ink">${totalEarned.toFixed(2)}</span>
                </div>
                <div className="flex items-center justify-between w-32 text-[12px]">
                  <span className="text-ink-muted">Paid Out:</span>
                  <span className="font-bold text-green-700">${paidOut.toFixed(2)}</span>
                </div>
                <div className="w-32 h-px bg-border my-0.5"></div>
                <div className="flex items-center justify-between w-32 text-[12px]">
                  <span className="text-ink-muted">Pending:</span>
                  <span className="font-bold text-amber-600">${pending.toFixed(2)}</span>
                </div>
              </div>
            </Row>
          );
        })()}
        
        <Row label="Payment Status">
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

      <Section title="Ledger" span2>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[12px] text-ink-muted">Transaction history and open invoices.</div>
          <button onClick={() => { setEditingTxId(null); setNewTx({ date: today, type: 'Invoice', amount: '', description: '', status: 'Due', paidDate: today }); setShowAddTx(!showAddTx); }} className="text-[11px] uppercase tracking-wider bg-navy text-gold px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity">
            + Add Transaction
          </button>
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
                      <div className="flex justify-end items-center gap-2 opacity-30 hover:opacity-100 transition-opacity">
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
                        <button onClick={() => startEditTx(tx)} className="text-blue-500 hover:text-blue-700" title="Edit">
                          <Edit2 size={12} strokeWidth={3} />
                        </button>
                        <button onClick={() => deleteTransaction(tx.id)} className="text-red-500 hover:text-red-700" title="Delete">
                          <X size={12} strokeWidth={3} />
                        </button>
                      </div>
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
