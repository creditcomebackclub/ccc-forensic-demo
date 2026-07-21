import React, { useState } from 'react';

function ReturnReceiptButton({ lobId, accessToken }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleFetch() {
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
      setError('Could not fetch receipt.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <button
        onClick={handleFetch}
        disabled={loading}
        className="text-[10px] font-semibold text-blue-600 hover:text-blue-800 underline underline-offset-2 transition-colors disabled:opacity-50"
      >
        {loading ? 'Fetching…' : '📋 View Signed Receipt'}
      </button>
      {error && <span className="text-[10px] text-amber-600">{error}</span>}
    </span>
  );
}

export default function TimelineEvent({ icon, title, subtitle, date, tone, lobId, trackingNumber, accessToken }) {
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
              <ReturnReceiptButton lobId={lobId} accessToken={accessToken} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
