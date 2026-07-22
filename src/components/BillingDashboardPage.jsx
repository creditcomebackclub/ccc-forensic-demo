import React, { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, AlertCircle, Clock, CheckCircle, ChevronRight, Activity, Users } from 'lucide-react';
import { adminListClients } from '../utils/storage';

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  grid: '#EEF0F4',
};

function MetricCard({ title, value, icon: Icon, subtitle, highlight = false, alert = false }) {
  return (
    <div className="bg-white p-5 rounded-xl shadow-sm border flex flex-col relative overflow-hidden group" style={{ borderColor: highlight ? T.gold : alert ? '#FECACA' : T.border }}>
      {highlight && <div className="absolute top-0 left-0 w-full h-1" style={{ backgroundColor: T.gold }} />}
      {alert && <div className="absolute top-0 left-0 w-full h-1 bg-red-500" />}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-muted">{title}</h3>
        <div className={`p-2 rounded-lg ${highlight ? 'bg-amber-50 text-gold' : alert ? 'bg-red-50 text-red-500' : 'bg-slate-50 text-navy'}`}>
          <Icon size={18} />
        </div>
      </div>
      <div className="text-3xl font-bold tracking-tight" style={{ color: alert ? '#B91C1C' : T.navy }}>{value}</div>
      {subtitle && <div className="text-[12px] text-faint mt-1 font-medium">{subtitle}</div>}
    </div>
  );
}

export default function BillingDashboardPage({ onNavigate, isAdmin }) {
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    adminListClients().then(data => {
      setClients(data);
      setLoading(false);
    });
  }, []);

  if (!isAdmin) {
    return <div className="p-8 text-center text-muted">Access Denied. Admins only.</div>;
  }

  if (loading) {
    return (
      <div className="w-full h-64 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-navy border-t-gold rounded-full animate-spin"></div>
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted">Aggregating Financials...</div>
        </div>
      </div>
    );
  }

  let totalOutstanding = 0;
  let collected30Days = 0;
  let mrr = 0;
  let lifetimeRevenue = 0;
  let activeClientsCount = 0;
  
  const allTransactions = [];
  const overdueAccounts = [];

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  clients.forEach(c => {
    let clientBalance = 0;
    let hasOverdue30 = false;
    
    if (c.billingStatus === 'Active') {
      activeClientsCount++;
      if (c.billingType === 'Automated Recurring') {
        if (c.billingTier === 'VIP') mrr += 149;
        else if (c.billingTier === 'Standard') mrr += 79;
      }
    }

    if (Array.isArray(c.ledger)) {
      c.ledger.forEach(tx => {
        allTransactions.push({ ...tx, clientName: c.name, clientId: c.id });

        if (tx.type === 'Invoice') {
          if (tx.status !== 'Paid') {
            clientBalance += parseFloat(tx.amount || 0);
            totalOutstanding += parseFloat(tx.amount || 0);
            
            const txDate = new Date(tx.date);
            if (txDate < thirtyDaysAgo) {
              hasOverdue30 = true;
            }
          }
        }
        if (tx.type === 'Payment') {
          lifetimeRevenue += parseFloat(tx.amount || 0);
          const txDate = new Date(tx.date);
          if (txDate >= thirtyDaysAgo) {
            collected30Days += parseFloat(tx.amount || 0);
          }
        }
      });
    }

    if (clientBalance > 0) {
      overdueAccounts.push({ 
        name: c.name, 
        balance: clientBalance,
        hasOverdue30,
        status: c.billingStatus
      });
    }
  });

  allTransactions.sort((a,b) => b.date.localeCompare(a.date));
  overdueAccounts.sort((a,b) => b.balance - a.balance);

  const arpu = activeClientsCount > 0 ? (lifetimeRevenue / activeClientsCount) : 0;
  const overdue30Count = overdueAccounts.filter(a => a.hasOverdue30).length;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-end justify-between mb-2">
        <div>
          <h1 className="text-2xl font-bold ccc-display" style={{ color: T.navy }}>Billing Overview</h1>
          <p className="text-[13px] text-muted mt-1">Real-time aggregation of all client ledgers and revenue metrics.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard 
          title="Outstanding Receivables" 
          value={`$${totalOutstanding.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}
          icon={AlertCircle} 
          subtitle={`${overdueAccounts.length} clients with a balance due`}
          alert={totalOutstanding > 0}
        />
        <MetricCard 
          title="30-Day Collected" 
          value={`$${collected30Days.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}
          icon={TrendingUp} 
          subtitle="Total payments logged in last 30 days"
          highlight={true}
        />
        <MetricCard 
          title="Est. Monthly Recurring" 
          value={`$${mrr.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}
          icon={Activity} 
          subtitle="Based on Active Tiers (excluding PIF)"
        />
        <MetricCard 
          title="Lifetime Revenue" 
          value={`$${lifetimeRevenue.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}
          icon={DollarSign} 
          subtitle={`ARPU: $${arpu.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 pt-4">
        
        {/* Overdue Accounts Panel */}
        <div className="lg:col-span-1 bg-white border rounded-xl shadow-sm overflow-hidden flex flex-col h-[500px]" style={{ borderColor: T.border }}>
          <div className="px-5 py-4 border-b bg-slate-50 flex items-center justify-between" style={{ borderColor: T.grid }}>
            <h2 className="text-[13px] font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: T.navy }}>
              <Clock size={16} className="text-red-500" />
              Action Required
            </h2>
            <span className="text-[11px] font-bold text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
              {overdue30Count} accounts 30+ days
            </span>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {overdueAccounts.length === 0 ? (
              <div className="text-center p-8 text-[12px] text-faint italic">No overdue accounts.</div>
            ) : (
              <div className="flex flex-col gap-1">
                {overdueAccounts.map((account, i) => (
                  <button 
                    key={i}
                    onClick={() => onNavigate('clients', { jumpTo: account.name })}
                    className="flex items-center justify-between p-3 hover:bg-slate-50 rounded-lg text-left transition-colors border border-transparent hover:border-gray-100 group"
                  >
                    <div>
                      <div className="text-[13px] font-semibold text-ink group-hover:text-blue-600 transition-colors">{account.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className={`text-[10px] uppercase tracking-wider font-medium ${account.status === 'Active' ? 'text-green-600' : 'text-amber-600'}`}>{account.status}</span>
                        {account.hasOverdue30 && <span className="text-[10px] uppercase tracking-wider font-bold text-red-600 flex items-center gap-0.5"><AlertCircle size={10} /> 30+ Days</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-[14px] font-bold text-red-600">${account.balance.toFixed(2)}</div>
                      <ChevronRight size={14} className="text-gray-300 group-hover:text-blue-500 transition-colors" />
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Global Feed Panel */}
        <div className="lg:col-span-2 bg-white border rounded-xl shadow-sm overflow-hidden flex flex-col h-[500px]" style={{ borderColor: T.border }}>
          <div className="px-5 py-4 border-b bg-slate-50 flex items-center justify-between" style={{ borderColor: T.grid }}>
            <h2 className="text-[13px] font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: T.navy }}>
              <TrendingUp size={16} className="text-gold" />
              Global Ledger Feed
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-white sticky top-0 border-b z-10" style={{ borderColor: T.grid }}>
                <tr>
                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider text-muted font-bold bg-white">Date</th>
                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider text-muted font-bold bg-white">Client</th>
                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider text-muted font-bold bg-white">Transaction</th>
                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider text-muted font-bold text-right bg-white">Amount</th>
                  <th className="px-5 py-3 text-[10px] uppercase tracking-wider text-muted font-bold text-center bg-white">Status</th>
                </tr>
              </thead>
              <tbody>
                {allTransactions.slice(0, 50).map((tx, i) => (
                  <tr key={tx.id || i} className="border-b last:border-0 hover:bg-slate-50 transition-colors" style={{ borderColor: T.grid }}>
                    <td className="px-5 py-3 text-[12px] text-muted whitespace-nowrap">{tx.date}</td>
                    <td className="px-5 py-3 text-[13px] font-medium text-navy cursor-pointer hover:text-blue-600 hover:underline" onClick={() => onNavigate('clients', { jumpTo: tx.clientName })}>
                      {tx.clientName}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${tx.type === 'Payment' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                          {tx.type}
                        </span>
                        <span className="text-[12px] text-ink">{tx.description}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-[13px] text-ink text-right font-bold">
                      {tx.type === 'Payment' ? <span className="text-green-600">-${Number(tx.amount).toFixed(2)}</span> : <span>${Number(tx.amount).toFixed(2)}</span>}
                    </td>
                    <td className="px-5 py-3 text-center whitespace-nowrap">
                      {tx.type === 'Invoice' ? (
                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${tx.status === 'Paid' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                          {tx.status}
                        </span>
                      ) : (
                        <span className="text-[10px] text-faint uppercase flex justify-center"><CheckCircle size={14} className="text-green-500" /></span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
