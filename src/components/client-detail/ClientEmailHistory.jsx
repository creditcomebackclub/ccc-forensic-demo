import React, { useEffect, useState } from 'react';
import { supabase } from '../../utils/supabase.js';

function stamp(value) {
  if (!value) return 'Queued';
  return new Date(value).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function ClientEmailHistory({ clientId }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    let cancelled = false;
    supabase.from('client_emails').select('id,subject,event_type,send_status,delivery_status,sent_at,created_at').eq('client_id', clientId).order('created_at', { ascending: false }).limit(8)
      .then(({ data, error: loadError }) => {
        if (cancelled) return;
        if (loadError) setError(loadError.message);
        else setRows(data || []);
      });
    return () => { cancelled = true; };
  }, [clientId]);

  if (error) return <div className="text-[11px] text-red-600">Email history unavailable: {error}</div>;
  if (rows === null) return <div className="text-[11px] text-ink-muted">Loading email history…</div>;
  if (!rows.length) return <div className="text-[11px] text-ink-muted">No client emails recorded yet.</div>;
  return <div className="space-y-2">{rows.map((row) => <div key={row.id} className="flex items-start justify-between gap-3 text-[11px] border-b border-border pb-2 last:border-0 last:pb-0"><div className="min-w-0"><div className="text-ink truncate">{row.subject}</div><div className="text-ink-faint mt-0.5">{stamp(row.sent_at || row.created_at)} · {row.event_type || 'custom'}</div></div><span className="shrink-0 uppercase tracking-wider text-[9px] px-1.5 py-0.5 rounded bg-gray-100 text-ink-muted">{row.delivery_status || row.send_status}</span></div>)}</div>;
}
