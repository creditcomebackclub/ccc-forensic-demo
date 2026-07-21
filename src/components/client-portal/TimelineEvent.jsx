import React, { useState } from 'react';

function ReturnReceiptButton({ lobId, accessToken, returnReceiptUrl }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleFetch() {
    if (returnReceiptUrl) {
      window.open(returnReceiptUrl, '_blank');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/.netlify/functions/get-return-receipt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ lobId }),
      });
      const data = await res.json();
      if (!res.ok || !data.return_receipt_url) {
        setError('Receipt not available yet — check back 24–48 hrs after delivery.');
        return;
      }
      window.open(data.return_receipt_url, '_blank');
    } catch (e) {
      setError('Failed to fetch return receipt.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2.5">
      <button 
        onClick={handleFetch}
        disabled={loading}
        className="text-[11px] font-semibold text-slate-900 hover:text-blue-600 uppercase tracking-wider disabled:opacity-50 transition-colors inline-flex items-center gap-1.5"
      >
        <span className="text-[14px]">🖋️</span> {loading ? 'Fetching...' : 'View USPS Signed Receipt'}
      </button>
      {error && <div className="text-[10px] text-red-600 font-medium mt-1">{error}</div>}
    </div>
  );
}

export default function TimelineEvent({ icon, title, subtitle, date, tone, lobId, trackingNumber, accessToken, responseUrl, returnReceiptUrl }) {
  const tones = {
    default: 'bg-gray-50 border-gray-200 text-gray-700',
    green: 'bg-green-50 border-green-200 text-green-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    gold: 'bg-amber-50 border-amber-200 text-amber-700',
    red: 'bg-red-50 border-red-200 text-red-700',
  };
  const toneClass = tones[tone] || tones.default;

  return (
    <div className="flex gap-3 items-start relative group">
      {/* Connector line */}
      <div className="absolute left-3.5 top-7 bottom-[-24px] w-px bg-gray-100 group-last:hidden" />

      <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[13px] border relative z-10 ${toneClass}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0 pb-6">
        <div className="text-[13px] font-medium text-gray-900">{title}</div>
        {subtitle && <div className="text-[11px] text-gray-500 mt-0.5">{subtitle}</div>}
        {date && <div className="text-[10px] text-gray-400 mt-1 uppercase tracking-wider">{new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>}

        {/* USPS tracking link + Return Receipt for delivered letters */}
        {trackingNumber && (
          <div className="flex flex-wrap items-center gap-3 mt-1.5">
            <a
              href={`https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`}
              target="_blank" rel="noopener noreferrer"
              className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-2 transition-colors"
            >
              🔍 USPS Tracking #{trackingNumber.slice(-8)}
            </a>
            {lobId && (
              <ReturnReceiptButton lobId={lobId} accessToken={accessToken} returnReceiptUrl={returnReceiptUrl} />
            )}
          </div>
        )}

        {/* View Creditor Response — shown when a response document is on file */}
        {responseUrl && (
          <div className="mt-1.5">
            <a
              href={responseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 underline underline-offset-2 transition-colors"
            >
              📄 View Creditor Response
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
