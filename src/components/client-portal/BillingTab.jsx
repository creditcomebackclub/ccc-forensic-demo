import React, { useEffect, useState } from 'react';
import { CreditCard } from 'lucide-react';
import NmiCollectForm from '../NmiCollectForm';
import { chargeDue, fetchCardOnFile, vaultCard, nmiConfigured } from '../../utils/billingApi';

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

export default function BillingTab({ clientMeta, onRefresh }) {
  const ledger = Array.isArray(clientMeta?.ledger) ? clientMeta.ledger : [];
  const clientId = clientMeta?.id || clientMeta?.client_id || null;

  const balanceDue = ledger.reduce((sum, tx) => {
    if (tx.type === 'Invoice' && tx.status !== 'Paid') return sum + (parseFloat(tx.amount) || 0);
    return sum;
  }, 0);

  const [card, setCard] = useState(null);
  const [showUpdateCard, setShowUpdateCard] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!clientId) return;
      try {
        const row = await fetchCardOnFile(clientId);
        if (!cancelled) setCard(row);
      } catch (e) {
        console.warn('Could not load card on file:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [clientId]);

  const payDue = async () => {
    if (!clientId || balanceDue <= 0) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await chargeDue({ clientId });
      if (result.skipped) {
        setMessage(result.reason || 'Payment skipped');
      } else if (result.charged === false) {
        setMessage(result.reason || 'Nothing to charge');
      } else {
        setMessage('Payment successful. Thank you!');
        if (onRefresh) onRefresh();
      }
    } catch (e) {
      setError(e.message || 'Payment failed');
    } finally {
      setBusy(false);
    }
  };

  const saveCard = async (tokenPayload) => {
    if (!clientId) return;
    setBusy(true);
    setError('');
    try {
      const result = await vaultCard({
        clientId,
        paymentToken: tokenPayload.paymentToken,
        cardLast4: tokenPayload.cardLast4,
        cardType: tokenPayload.cardType,
        cardExpiry: tokenPayload.cardExpiry,
        initiatedBy: 'client',
      });
      setCard({
        card_last4: result.cardLast4 || tokenPayload.cardLast4,
        card_type: result.cardType || tokenPayload.cardType,
        card_expiry: result.cardExpiry || tokenPayload.cardExpiry,
        card_vaulted_at: new Date().toISOString(),
      });
      setShowUpdateCard(false);
      setMessage('Card updated successfully.');
    } catch (e) {
      setError(e.message || 'Could not save card');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
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
          {card?.card_last4 && (
            <p className="text-xs mt-2" style={{ color: T.muted }}>
              Card on file: {card.card_type || 'Card'} ending {card.card_last4}
              {card.card_expiry ? ` · Exp ${card.card_expiry}` : ''}
            </p>
          )}
        </div>

        <div className="mt-4 md:mt-0 flex flex-col gap-2 items-stretch md:items-end">
          {balanceDue > 0 && (
            <button
              onClick={payDue}
              disabled={busy || !clientId || !card?.card_last4}
              className="px-6 py-3 rounded-lg text-sm uppercase tracking-wider font-bold shadow-md hover:opacity-90 transition-opacity flex items-center gap-2 text-white disabled:opacity-50"
              style={{ background: `linear-gradient(135deg, ${T.navy} 0%, ${T.navyDark} 100%)` }}
            >
              <CreditCard size={18} />
              {busy ? 'Processing…' : 'Make a Payment'}
            </button>
          )}
          <button
            onClick={() => setShowUpdateCard((v) => !v)}
            className="text-xs font-bold uppercase tracking-wider px-3 py-2 rounded-md border"
            style={{ borderColor: T.border, color: T.navy }}
          >
            {showUpdateCard ? 'Cancel' : (card?.card_last4 ? 'Update card' : 'Add card')}
          </button>
        </div>
      </div>

      {(message || error) && (
        <div className={`text-sm px-4 py-3 rounded-lg border ${error ? 'bg-red-50 border-red-200 text-red-800' : 'bg-green-50 border-green-200 text-green-800'}`}>
          {error || message}
        </div>
      )}

      {showUpdateCard && (
        <div className="bg-white rounded-xl p-6 shadow-sm border" style={{ borderColor: T.border }}>
          {nmiConfigured() ? (
            <NmiCollectForm
              onToken={saveCard}
              buttonLabel={busy ? 'Saving…' : 'Save card'}
              disabled={busy || !clientId}
              secondaryNote="Updating your card runs a $0 verification. Future invoices charge this card automatically."
            />
          ) : (
            <p className="text-sm text-amber-800">Card payments are not configured yet.</p>
          )}
        </div>
      )}

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
                [...ledger].sort((a, b) => b.date.localeCompare(a.date)).map((tx) => (
                  <tr key={tx.id} className="border-b last:border-0 hover:bg-gray-50 transition-colors" style={{ borderColor: T.grid }}>
                    <td className="px-6 py-4 text-sm text-ink whitespace-nowrap font-medium">{tx.date}</td>
                    <td className="px-6 py-4 text-sm whitespace-nowrap">
                      <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${tx.type === 'Payment' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                        {tx.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-ink w-full">
                      {tx.description}
                      {tx.next_retry_at && tx.status === 'Due' && (
                        <div className="text-[10px] text-amber-700 mt-1">Retry scheduled {String(tx.next_retry_at).slice(0, 10)}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-center whitespace-nowrap">
                      <span className={`text-[11px] font-bold uppercase tracking-wider ${tx.status === 'Paid' ? 'text-green-700' : 'text-amber-700'}`}>
                        {tx.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-right font-medium whitespace-nowrap">
                      ${Number(tx.amount || 0).toFixed(2)}
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
