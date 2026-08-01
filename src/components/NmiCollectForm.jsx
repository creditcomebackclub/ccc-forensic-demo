import React, { useEffect, useRef, useState } from 'react';
import { CreditCard } from 'lucide-react';
import { nmiTokenizationKey, nmiConfigured } from '../utils/billingApi';

const COLLECT_SRC = 'https://secure.nmi.com/token/Collect.js';

/**
 * NMI Collect.js card capture. Calls onToken({ paymentToken, card }) when
 * the customer finishes entering card details. Never touches PAN/CVV in JS.
 */
export default function NmiCollectForm({
  onToken,
  buttonLabel = 'Save card',
  disabled = false,
  secondaryNote = 'We authorize $0.00 to verify your card. You will not be charged until your forensic audit is delivered.',
}) {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const configured = nmiConfigured();
  const callbackRef = useRef(onToken);
  callbackRef.current = onToken;

  useEffect(() => {
    if (!configured) return undefined;
    const key = nmiTokenizationKey();

    function configure() {
      if (!window.CollectJS) return;
      try {
        window.CollectJS.configure({
          tokenizationKey: key,
          variant: 'inline',
          styleSniffer: true,
          callback: (response) => {
            setBusy(false);
            if (!response || !response.token) {
              setError('Card tokenization failed. Please try again.');
              return;
            }
            const card = response.card || {};
            callbackRef.current?.({
              paymentToken: response.token,
              cardLast4: card.number || card.lastFour || null,
              cardType: card.type || null,
              cardExpiry: card.exp || (card.exp_month && card.exp_year
                ? `${card.exp_month}/${String(card.exp_year).slice(-2)}`
                : null),
            });
          },
          fieldsAvailableCallback: () => setReady(true),
          fields: {
            ccnumber: { selector: '#ccnumber', placeholder: 'Card number' },
            ccexp: { selector: '#ccexp', placeholder: 'MM / YY' },
            cvv: { selector: '#cvv', placeholder: 'CVV' },
          },
        });
        setReady(true);
      } catch (e) {
        setError(e.message || 'Could not initialize card form');
      }
    }

    const existing = document.querySelector(`script[src="${COLLECT_SRC}"]`);
    if (existing && window.CollectJS) {
      configure();
      return undefined;
    }

    const script = document.createElement('script');
    script.src = COLLECT_SRC;
    script.setAttribute('data-tokenization-key', key);
    script.setAttribute('data-variant', 'inline');
    script.async = true;
    script.onload = () => configure();
    script.onerror = () => setError('Could not load payment form');
    document.body.appendChild(script);
    return undefined;
  }, [configured]);

  if (!configured) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Card payments are not configured in this environment (missing tokenization key).
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-700">
          <CreditCard size={14} /> Payment method
        </div>
        <div id="ccnumber" className="min-h-[44px] rounded-lg border border-gray-200 bg-gray-50 px-3 py-2" />
        <div className="grid grid-cols-2 gap-3">
          <div id="ccexp" className="min-h-[44px] rounded-lg border border-gray-200 bg-gray-50 px-3 py-2" />
          <div id="cvv" className="min-h-[44px] rounded-lg border border-gray-200 bg-gray-50 px-3 py-2" />
        </div>
        {secondaryNote && (
          <p className="text-[11px] text-gray-500 leading-relaxed">{secondaryNote}</p>
        )}
        {error && <p className="text-xs text-red-600 font-medium">{error}</p>}
      </div>
      <button
        type="button"
        disabled={disabled || busy || !ready}
        onClick={() => {
          setError('');
          setBusy(true);
          try {
            window.CollectJS.startPaymentRequest();
          } catch (e) {
            setBusy(false);
            setError(e.message || 'Could not start card capture');
          }
        }}
        className="w-full py-3.5 text-xs font-bold uppercase tracking-[0.08em] rounded-xl transition-all shadow-md disabled:opacity-60"
        style={{ backgroundColor: '#0f172a', color: '#fbbf24' }}
      >
        {busy ? 'Securing card…' : buttonLabel}
      </button>
    </div>
  );
}
