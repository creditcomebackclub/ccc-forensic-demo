import React from 'react';
import { CreditCard } from 'lucide-react';

const T = {
  navy: '#1B2A4A',
  navyDark: '#0f1a30',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  grid: '#EEF0F4',
};

export default function BillingTab({ clientMeta }) {
  const ledger = Array.isArray(clientMeta?.ledger) ? clientMeta.ledger : [];
  
  // Balance is sum of all unpaid Invoices
  const balanceDue = ledger.reduce((sum, tx) => {
    if (tx.type === 'Invoice' && tx.status !== 'Paid') return sum + (parseFloat(tx.amount) || 0);
    return sum;
  }, 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      
      {/* Balance Section */}
      <div className="bg-white rounded-xl p-6 md:p-8 flex flex-col md:flex-row items-center justify-between shadow-sm border" style={{ borderColor: T.border }}>
        <div>
          <h2 className="text-sm uppercase tracking-wider font-bold mb-1" style={{ color: T.navy }}>Amount Due</h2>
          <div className="text-[32px] font-bold" style={{ color: balanceDue > 0 ? '#DC2626' : T.navy }}>
            ${balanceDue.toFixed(2)}
          </div>
          {balanceDue > 0 ? (
            <p className="text-xs text-red-600 font-medium mt-1">Payment is currently due on your account.</p>
          ) : (
            <p className="text-xs text-green-600 font-medium mt-1">Your account is in good standing.</p>
          )}
        </div>
        
        {balanceDue > 0 && (
          <button onClick={() => alert('Payment gateway not connected yet.')} className="mt-4 md:mt-0 px-6 py-3 rounded-lg text-sm uppercase tracking-wider font-bold shadow-md hover:opacity-90 transition-opacity flex items-center gap-2 text-white" style={{ background: `linear-gradient(135deg, ${T.navy} 0%, ${T.navyDark} 100%)` }}>
            <CreditCard size={18} />
            Make a Payment
          </button>
        )}
      </div>

      {/* Ledger Section */}
      <div className="bg-white rounded-xl shadow-sm border overflow-hidden" style={{ borderColor: T.border }}>
        <div className="p-6 border-b" style={{ borderColor: T.border }}>
          <h2 className="text-sm uppercase tracking-wider font-bold" style={{ color: T.navy }}>Transaction History</h2>
          <p className="text-xs text-ink-muted mt-1">A record of your invoices and payments.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[600px]">
            <thead>
              <tr className="bg-gray-50 border-b" style={{ borderColor: T.grid }}>
                <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-muted font-bold">Date</th>
                <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-muted font-bold">Type</th>
                <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-muted font-bold">Description</th>
                <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-muted font-bold text-center">Status</th>
                <th className="px-6 py-3 text-[11px] uppercase tracking-wider text-muted font-bold text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {ledger.length === 0 ? (
                <tr><td colSpan="5" className="px-6 py-8 text-center text-sm text-faint italic">No transactions found.</td></tr>
              ) : (
                [...ledger].sort((a,b) => b.date.localeCompare(a.date)).map(tx => (
                  <tr key={tx.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors" style={{ borderColor: T.grid }}>
                    <td className="px-6 py-4 text-sm text-ink whitespace-nowrap font-medium">{tx.date}</td>
                    <td className="px-6 py-4 text-sm whitespace-nowrap">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${tx.type === 'Payment' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-ink w-full">{tx.description}</td>
                    <td className="px-6 py-4 text-center whitespace-nowrap">
                      {tx.type === 'Invoice' ? (
                        <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${tx.status === 'Paid' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                          {tx.status}
                        </span>
                      ) : (
                        <span className="text-[10px] text-faint uppercase">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-ink text-right font-bold whitespace-nowrap">
                      {tx.type === 'Payment' ? '-' : ''}${Number(tx.amount).toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      
    </div>
  );
}
