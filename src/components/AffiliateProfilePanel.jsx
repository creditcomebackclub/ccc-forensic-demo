import React, { useState } from 'react';
import { X, CheckCircle, ExternalLink, Link as LinkIcon, DollarSign, TrendingUp, Users, Check } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { computeClientCommission, recognizedTotal } from '../utils/affiliateCommission';

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  bg: '#FAFBFC',
};

export default function AffiliateProfilePanel({ affiliate, clients = [], commissionPayouts = [], onClose, onUpdate }) {
  const [editingRate, setEditingRate] = useState(false);
  const [rateVal, setRateVal] = useState(affiliate.commission_rate ? String(Math.round(affiliate.commission_rate * 100)) : '20');

  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editForm, setEditForm] = useState({
    name: affiliate.name || '',
    company: affiliate.company || '',
    email: affiliate.email || ''
  });
  const [payingClientId, setPayingClientId] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));

  const payoutsFor = (clientId) => commissionPayouts.filter((p) => p.client_id === clientId);

  const totalRevenue = clients.reduce((sum, c) => sum + recognizedTotal(c), 0);
  let paidCommission = 0, pendingCommission = 0;
  for (const c of clients) {
    const { paid, owed } = computeClientCommission(c, affiliate, payoutsFor(c.id));
    paidCommission += paid;
    pendingCommission += owed;
  }

  const saveGlobalRate = async () => {
    let newRate = parseFloat(rateVal) / 100;
    if (isNaN(newRate)) return;
    await supabase.from('affiliates').update({ commission_rate: newRate }).eq('id', affiliate.id);
    onUpdate && onUpdate();
    setEditingRate(false);
  };

  // Payout ledger, not a boolean — a client who keeps paying monthly keeps
  // accruing new commission after this, since covered_tx_ids only marks
  // what's actually been paid out so far, not "this client is done forever."
  const payCommission = async (client) => {
    const amount = parseFloat(payAmount);
    if (isNaN(amount) || amount <= 0) { alert('Enter a valid amount before confirming.'); return; }
    if (!payDate) { alert('Pick a paid-on date before confirming.'); return; }
    try {
      const { unpaidTxIds } = computeClientCommission(client, affiliate, payoutsFor(client.id));
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('commission_payouts').insert({
        affiliate_id: affiliate.id,
        client_id: client.id,
        client_name: client.name,
        covered_tx_ids: unpaidTxIds,
        amount,
        paid_at: new Date(payDate + 'T12:00:00').toISOString(),
        paid_by: user?.id || null,
      });
      if (error) throw error;
      setPayingClientId(null);
      onUpdate && onUpdate();
    } catch (e) {
      console.error('Failed to record commission payout:', e);
      alert('Could not save this payout: ' + (e.message || e));
      // Leave the form open (date/amount already entered) so nothing is lost.
    }
  };

  const setClientRateOverride = async (clientName, value) => {
    let override = value ? parseFloat(value) : null;
    await supabase.from('clients').update({ referral_fee: override }).eq('name', clientName);
    onUpdate && onUpdate();
  };

  const saveAffiliateInfo = async () => {
    await supabase.from('affiliates').update({
      name: editForm.name,
      company: editForm.company,
      email: editForm.email
    }).eq('id', affiliate.id);
    
    // Also update all clients that reference this affiliate if we wanted to denormalize, 
    // but the clients table uses `referred_by` UUID, so we only need to update the affiliates table!
    
    Object.assign(affiliate, {
      name: editForm.name,
      company: editForm.company,
      email: editForm.email
    });

    setIsEditingInfo(false);
    onUpdate && onUpdate();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: 'rgba(0,0,0,0.1)' }} onClick={onClose}>
      <div className="w-[600px] h-full bg-white shadow-2xl flex flex-col transform transition-transform" 
        onClick={e => e.stopPropagation()} style={{ borderLeft: '1px solid ' + T.border }}>
        
        {/* Header */}
        <div className="px-6 py-5 border-b flex items-start justify-between bg-white" style={{ borderColor: T.border }}>
          <div className="flex items-center gap-4">
            {affiliate.brand_logo_url ? (
              <img src={affiliate.brand_logo_url} alt="Logo" className="w-12 h-12 rounded object-contain border" style={{ borderColor: T.border }} />
            ) : (
              <div className="w-12 h-12 rounded flex items-center justify-center text-white text-lg font-bold shadow-sm" style={{ background: T.navy }}>
                {affiliate.name.charAt(0)}
              </div>
            )}
            <div>
              {isEditingInfo ? (
                <div className="flex flex-col gap-2">
                  <input 
                    type="text" 
                    value={editForm.name} 
                    onChange={e => setEditForm({...editForm, name: e.target.value})}
                    className="text-[16px] font-bold px-2 py-1 border rounded"
                    placeholder="Affiliate Name"
                  />
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={editForm.company} 
                      onChange={e => setEditForm({...editForm, company: e.target.value})}
                      className="text-[12px] px-2 py-1 border rounded w-1/2"
                      placeholder="Company"
                    />
                    <input 
                      type="email" 
                      value={editForm.email} 
                      onChange={e => setEditForm({...editForm, email: e.target.value})}
                      className="text-[12px] px-2 py-1 border rounded w-1/2"
                      placeholder="Email"
                    />
                  </div>
                  <div className="flex gap-2 mt-1">
                    <button onClick={saveAffiliateInfo} className="text-[11px] bg-navy text-white px-3 py-1 rounded font-medium">Save</button>
                    <button onClick={() => setIsEditingInfo(false)} className="text-[11px] text-muted px-3 py-1 border rounded">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="group relative">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[20px] font-bold tracking-tight" style={{ color: T.navy }}>{affiliate.name}</h2>
                    <button onClick={() => setIsEditingInfo(true)} className="opacity-0 group-hover:opacity-100 text-[10px] text-navy uppercase font-bold tracking-wider hover:underline transition-opacity">
                      Edit
                    </button>
                  </div>
                  <div className="text-[12px] mt-1" style={{ color: T.muted }}>
                    {affiliate.company ? `${affiliate.company} • ` : ''}{affiliate.email}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 self-start mt-1">
            <ImpersonateButton affiliate={affiliate} />
            <button onClick={onClose} className="p-1 rounded-md text-ink-faint hover:bg-gray-100 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6" style={{ background: T.bg }}>
          
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-xl p-4 border shadow-sm" style={{ borderColor: T.border }}>
              <div className="flex items-center gap-2 mb-3">
                <Users size={14} style={{ color: T.gold }} />
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: T.navy }}>Network</span>
              </div>
              <div className="text-[28px] font-bold leading-none mb-1" style={{ color: T.ink }}>{clients.length}</div>
              <div className="text-[11px]" style={{ color: T.muted }}>Total Referred Clients</div>
            </div>

            <div className="bg-white rounded-xl p-4 border shadow-sm" style={{ borderColor: T.border }}>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} style={{ color: T.gold }} />
                <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: T.navy }}>Revenue</span>
              </div>
              <div className="text-[28px] font-bold leading-none mb-1" style={{ color: T.ink }}>${totalRevenue.toFixed(2)}</div>
              <div className="text-[11px]" style={{ color: T.muted }}>Generated for CCC</div>
            </div>

            <div className="bg-white rounded-xl p-4 border shadow-sm col-span-2" style={{ borderColor: T.border }}>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <DollarSign size={14} style={{ color: T.gold }} />
                  <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: T.navy }}>Commission</span>
                </div>
                {editingRate ? (
                  <div className="flex items-center gap-1">
                    <input 
                      type="number" 
                      value={rateVal} 
                      onChange={e => setRateVal(e.target.value)}
                      className="w-12 text-[11px] px-1 py-0.5 border rounded"
                      autoFocus
                    />
                    <span className="text-[11px]">%</span>
                    <button onClick={saveGlobalRate} className="text-green-600 ml-1"><CheckCircle size={12} /></button>
                  </div>
                ) : (
                  <button onClick={() => setEditingRate(true)} className="text-[10px] text-navy hover:underline">
                    {Math.round((affiliate.commission_rate || 0.20) * 100)}% Global Rate
                  </button>
                )}
              </div>
              <div className="flex items-end justify-between">
                <div>
                  <div className="text-[28px] font-bold leading-none mb-1 text-green-700">${paidCommission.toFixed(2)}</div>
                  <div className="text-[11px]" style={{ color: T.muted }}>Paid Out</div>
                </div>
                <div className="text-right">
                  <div className="text-[16px] font-bold leading-none mb-1 text-amber-600">${pendingCommission.toFixed(2)}</div>
                  <div className="text-[11px]" style={{ color: T.muted }}>Pending</div>
                </div>
              </div>
            </div>
          </div>

          <h3 className="text-[14px] font-bold mb-3" style={{ color: T.navy }}>Referred Clients</h3>
          <div className="bg-white rounded-xl border overflow-hidden shadow-sm" style={{ borderColor: T.border }}>
            {clients.length === 0 ? (
              <div className="p-6 text-center text-[12px]" style={{ color: T.muted }}>No clients referred yet.</div>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b" style={{ borderColor: T.border }}>
                    <th className="py-2.5 px-4 text-[10px] font-bold uppercase tracking-wider" style={{ color: T.muted }}>Client</th>
                    <th className="py-2.5 px-4 text-[10px] font-bold uppercase tracking-wider" style={{ color: T.muted }}>Override %</th>
                    <th className="py-2.5 px-4 text-[10px] font-bold uppercase tracking-wider text-right" style={{ color: T.muted }}>Rev / Owed</th>
                    <th className="py-2.5 px-4 text-[10px] font-bold uppercase tracking-wider text-right" style={{ color: T.muted }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {clients.map(c => {
                    const totalPaid = recognizedTotal(c);
                    const { owed } = computeClientCommission(c, affiliate, payoutsFor(c.id));
                    const isPayingThis = payingClientId === c.id;
                    return (
                      <tr key={c.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors" style={{ borderColor: T.border }}>
                        <td className="py-3 px-4">
                          <div className="text-[12px] font-medium" style={{ color: T.ink }}>{c.name}</div>
                          <div className="text-[10px] mt-0.5" style={{ color: T.faint }}>
                            {new Date(c.created_at).toLocaleDateString()}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <input
                            type="number"
                            defaultValue={c.referral_fee || ''}
                            placeholder={`${Math.round((affiliate.commission_rate || 0.20) * 100)}%`}
                            onBlur={e => setClientRateOverride(c.name, e.target.value)}
                            className="w-14 text-[11px] px-1.5 py-1 border rounded bg-white text-center"
                          />
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="text-[12px] font-medium" style={{ color: owed > 0.01 ? '#D97706' : T.ink }}>${owed.toFixed(2)}</div>
                          <div className="text-[10px]" style={{ color: T.faint }}>of ${totalPaid.toFixed(2)} paid in</div>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {owed <= 0.01 ? (
                            <div className="inline-flex items-center gap-1 px-2 py-1 rounded bg-green-50 text-green-700 text-[10px] font-bold uppercase tracking-wide border border-green-100">
                              <CheckCircle size={10} /> Paid Up
                            </div>
                          ) : isPayingThis ? (
                            <div className="flex items-center justify-end gap-1">
                              <input
                                type="date"
                                value={payDate}
                                onChange={e => setPayDate(e.target.value)}
                                className="w-28 text-[10px] px-1 py-1 border rounded"
                                style={{ borderColor: T.border }}
                              />
                              <input
                                type="number"
                                step="0.01"
                                value={payAmount}
                                onChange={e => setPayAmount(e.target.value)}
                                className="w-16 text-[10px] px-1 py-1 border rounded text-right"
                                style={{ borderColor: T.border }}
                              />
                              <button onClick={() => payCommission(c)} className="text-green-600 hover:text-green-700" title="Confirm payout">
                                <Check size={14} strokeWidth={3} />
                              </button>
                              <button onClick={() => setPayingClientId(null)} className="text-ink-faint hover:text-red-600" title="Cancel">
                                <X size={14} strokeWidth={3} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setPayingClientId(c.id); setPayAmount(owed.toFixed(2)); setPayDate(new Date().toISOString().slice(0, 10)); }}
                              className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wide border transition-colors bg-white text-amber-600 border-amber-200 hover:bg-amber-50">
                              Pay ${owed.toFixed(2)}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ImpersonateButton({ affiliate }) {
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState(null);

  const handleImpersonate = async () => {
    if (!affiliate.email) { setErr('No email on file.'); return; }
    setLoading(true);
    setErr(null);
    
    // Open tab synchronously to prevent popup blockers
    const newTab = window.open('about:blank', '_blank');
    
    try {
      const { data: { session: adminSess } } = await supabase.auth.getSession();
      const adminTok = adminSess?.access_token;
      const res = await fetch('/.netlify/functions/admin-impersonate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(adminTok ? { Authorization: `Bearer ${adminTok}` } : {}),
        },
        body: JSON.stringify({ email: affiliate.email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      if (!data.link) throw new Error('No link returned');
      
      if (newTab) {
        newTab.location.href = data.link;
      } else {
        window.open(data.link, '_blank');
      }
    } catch (e) {
      if (newTab) newTab.close();
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-end">
      <button
        onClick={handleImpersonate}
        disabled={loading || !affiliate.email}
        className="flex items-center gap-2 px-3 py-1.5 text-[11px] uppercase tracking-wider rounded border border-amber-300 text-amber-700 hover:bg-amber-50 transition-colors disabled:opacity-50"
      >
        {loading ? 'Generating…' : '🔑 View Portal'}
      </button>
      {err && <div className="text-[10px] text-red-600 mt-1">{err}</div>}
    </div>
  );
}
