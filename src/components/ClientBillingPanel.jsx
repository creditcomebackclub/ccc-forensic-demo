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
  const [showAddTx, setShowAddTx] = useState(false);
  const [newTx, setNewTx] = useState({ date: new Date().toISOString().slice(0, 10), type: 'Invoice', amount: '', description: '', status: 'Due' });

  const ledger = Array.isArray(client.ledger) ? client.ledger : [];
  
  // Balance is sum of all Invoices minus sum of all Payments
  const balanceDue = ledger.reduce((sum, tx) => {
    if (tx.type === 'Payment') return sum - (parseFloat(tx.amount) || 0);
    if (tx.type === 'Invoice') return sum + (parseFloat(tx.amount) || 0);
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

  const addTransaction = async () => {
    if (!newTx.amount) return alert('Amount is required');
    const updatedLedger = [...ledger, {
      id: require('crypto').randomUUID ? require('crypto').randomUUID() : Math.random().toString(36).substring(7),
      date: newTx.date,
      type: newTx.type,
      amount: parseFloat(newTx.amount),
      description: newTx.description || (newTx.type === 'Invoice' ? 'Service Fee' : 'Payment Received'),
      status: newTx.type === 'Payment' ? 'Paid' : newTx.status,
      created_at: new Date().toISOString()
    }];
    await save({ ledger: updatedLedger });
    setShowAddTx(false);
    setNewTx({ date: new Date().toISOString().slice(0, 10), type: 'Invoice', amount: '', description: '', status: 'Due' });
  };

  const deleteTransaction = async (id) => {
    if (!confirm('Delete this transaction?')) return;
    await save({ ledger: ledger.filter(t => t.id !== id) });
  };

  const markPaid = async (id) => {
    const updated = ledger.map(t => t.id === id ? { ...t, status: 'Paid' } : t);
    await save({ ledger: updated });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start mt-2">
      <Section title="Billing Setup">
        <Row label="Current Balance">
          <div className="text-[18px] font-bold" style={{ color: balanceDue > 0 ? '#DC2626' : T.ink }}>
            ${balanceDue.toFixed(2)}
          </div>
        </Row>
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

      <Section title="Ledger" span2>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[12px] text-ink-muted">Transaction history and open invoices.</div>
          <button onClick={() => setShowAddTx(!showAddTx)} className="text-[11px] uppercase tracking-wider bg-navy text-gold px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity">
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
            </div>
            <div className="flex justify-end gap-2 mt-1">
              <button onClick={() => setShowAddTx(false)} className="text-[11px] uppercase tracking-wider text-muted hover:text-ink px-3 py-1">Cancel</button>
              <button onClick={addTransaction} className="text-[11px] uppercase tracking-wider bg-navy text-white px-4 py-1 rounded hover:opacity-90">Save</button>
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
                      <div className="flex justify-end gap-2 opacity-30 hover:opacity-100 transition-opacity">
                        {tx.type === 'Invoice' && tx.status !== 'Paid' && (
                          <button onClick={() => markPaid(tx.id)} className="text-[10px] text-green-600 hover:underline" title="Mark as Paid">
                            Paid
                          </button>
                        )}
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
