import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Loader2, Mail, RefreshCw, Save, Sparkles, X } from 'lucide-react';
import { getProgressUpdateStatus, saveProgressUpdate, sendProgressUpdate } from '../utils/progressUpdateApi.js';
import { downloadProgressUpdatePdf } from '../utils/progressUpdatePdf.js';

function monthLabel(dateStr) {
  if (!dateStr) return '';
  return new Date(String(dateStr) + (String(dateStr).includes('T') ? '' : 'T00:00:00'))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function defaultSubject(update) {
  const deleted = update?.diff?.deleted?.length || 0;
  if (deleted > 0) return '🏆 An account was deleted from your report!';
  return `Your ${monthLabel(update?.toReportDate)} credit report update`;
}

function defaultEmailBody(narrative) {
  const words = String(narrative || '').split(/\s+/).filter(Boolean);
  if (words.length <= 60) return words.join(' ');
  return words.slice(0, 60).join(' ') + '…';
}

function StatusPill({ update, generating }) {
  if (generating) return <span className="text-[10px] px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-semibold">Generating…</span>;
  if (!update) return <span className="text-[10px] px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">No draft</span>;
  if (update.status === 'sent') return <span className="text-[10px] px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 font-semibold">Sent</span>;
  return <span className="text-[10px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-semibold">Draft</span>;
}

function DiffSummary({ diff }) {
  if (!diff) return null;
  const deleted = diff.deleted || [];
  const added = diff.new || [];
  const deltas = Object.entries(diff.scoreDeltas || {}).filter(([, s]) => s && s.delta != null);
  if (!deleted.length && !added.length && !deltas.length) {
    return <div className="text-xs text-slate-500">No score moves, removals, or new negatives in this comparison.</div>;
  }
  return (
    <div className="space-y-3 text-xs">
      {deltas.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[.14em] text-slate-400 font-bold mb-1.5">Score moves</div>
          <div className="flex flex-wrap gap-2">
            {deltas.map(([bureau, s]) => (
              <span key={bureau} className={`px-2 py-1 rounded-md border font-semibold ${s.delta > 0 ? 'bg-green-50 text-green-700 border-green-200' : s.delta < 0 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>
                {bureau} {s.delta > 0 ? '+' : ''}{s.delta}
              </span>
            ))}
          </div>
        </div>
      )}
      {deleted.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[.14em] text-slate-400 font-bold mb-1.5">Removed</div>
          <ul className="space-y-1">
            {deleted.map((a, i) => (
              <li key={i} className="text-green-800 bg-green-50 border border-green-100 rounded-md px-2.5 py-1.5 font-medium">{a.furnisher}</li>
            ))}
          </ul>
        </div>
      )}
      {added.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[.14em] text-slate-400 font-bold mb-1.5">Added</div>
          <ul className="space-y-1">
            {added.map((a, i) => (
              <li key={i} className="text-amber-900 bg-amber-50 border border-amber-100 rounded-md px-2.5 py-1.5 font-medium">{a.furnisher}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ProgressUpdateStudio({ audit, clientEmail, onClose }) {
  const [update, setUpdate] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [narrative, setNarrative] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyText, setBodyText] = useState('');

  const identity = useMemo(() => ({
    name: audit.client?.name,
    id: audit.client?.id,
    reportDate: audit.client?.reportDate,
  }), [audit.client?.name, audit.client?.id, audit.client?.reportDate]);

  const applyPayload = (data) => {
    const next = data.update || null;
    setUpdate(next);
    setGenerating(!!data.generating);
    if (next?.narrative) setNarrative(next.narrative);
    setSubject(next?.emailSubject || defaultSubject(next));
    setBodyText(next?.emailBody || (next?.narrative ? defaultEmailBody(next.narrative) : ''));
    if (next?.status === 'sent') setSent(true);
  };

  const refresh = async () => {
    const data = await getProgressUpdateStatus(audit);
    applyPayload(data);
    return data;
  };

  useEffect(() => {
    let active = true;
    let timer = null;
    setBusy('loading');
    setError(null);
    refresh()
      .then((data) => {
        if (!active) return;
        if (data.generating) {
          timer = setInterval(() => {
            refresh().then((next) => {
              if (!active) return;
              if (!next.generating && next.update?.narrative) clearInterval(timer);
            }).catch((err) => { if (active) setError(err.message); });
          }, 4000);
        }
      })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setBusy(null); });
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [identity.name, identity.id, identity.reportDate]);

  const run = async (label, task) => {
    setBusy(label);
    setError(null);
    try { return await task(); }
    catch (err) { setError(err.message || 'Progress Update action failed.'); return null; }
    finally { setBusy(null); }
  };

  const handleSave = () => run('save', async () => {
    const data = await saveProgressUpdate(audit, { narrative, emailSubject: subject, emailBody: bodyText });
    applyPayload(data);
  });

  const handleSend = () => run('send', async () => {
    const data = await sendProgressUpdate(audit, {
      clientEmail,
      narrative,
      emailSubject: subject,
      emailBody: bodyText,
    });
    applyPayload(data);
    setSent(true);
  });

  const handleDownloadPdf = () => run('pdf', async () => {
    if (!narrative.trim()) throw new Error('Add or wait for the narrative before downloading the PDF.');
    downloadProgressUpdatePdf({
      clientName: audit.client?.name || update?.clientName || 'Client',
      fromReportDate: update?.fromReportDate,
      toReportDate: update?.toReportDate || audit.client?.reportDate,
      narrative,
      diff: update?.diff,
    });
  });

  const alreadySent = update?.status === 'sent' || sent;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#F7F4ED] w-full max-w-6xl h-[92vh] rounded-2xl overflow-hidden shadow-2xl flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="bg-[#121F38] px-5 sm:px-7 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[#C9A84C] text-[10px] uppercase tracking-[.2em] font-bold">Retention Deliverable</div>
            <div className="text-white text-lg font-semibold truncate">Progress Update · {audit.client?.name}</div>
            {update?.fromReportDate && update?.toReportDate && (
              <div className="text-white/50 text-[11px] mt-0.5">{monthLabel(update.fromReportDate)} → {monthLabel(update.toReportDate)}</div>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <StatusPill update={update} generating={generating} />
            <button onClick={onClose} className="text-white/60 hover:text-white p-1"><X size={19} /></button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] flex-1 min-h-0">
          <div className="bg-white min-h-[360px] p-4 sm:p-6 overflow-y-auto border-r border-slate-200">
            <div className="text-[10px] uppercase tracking-[.14em] text-slate-400 font-bold mb-2">Portal narrative</div>
            {generating && !narrative ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Loader2 size={28} className="animate-spin text-[#C9A84C] mb-3" />
                <div className="font-semibold text-slate-900">Writing the progress narrative…</div>
                <p className="text-sm text-slate-500 mt-2 max-w-sm">This usually takes under a minute. The draft will appear here when Claude finishes.</p>
              </div>
            ) : (
              <textarea
                value={narrative}
                onChange={(event) => setNarrative(event.target.value)}
                disabled={alreadySent || !!busy}
                rows={18}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm leading-relaxed text-slate-800 disabled:bg-slate-50 disabled:opacity-70"
                placeholder="Narrative will appear once generation finishes…"
              />
            )}
            <div className="mt-5 pt-5 border-t border-slate-100">
              <div className="text-[10px] uppercase tracking-[.14em] text-slate-400 font-bold mb-3">Comparison snapshot</div>
              <DiffSummary diff={update?.diff} />
            </div>
          </div>

          <aside className="bg-white p-5 overflow-y-auto">
            <div className="space-y-5">
              <div>
                <div className="text-[10px] uppercase tracking-[.14em] text-slate-400 font-bold mb-2">Review controls</div>
                <p className="text-xs text-slate-500 mb-3">Edit the portal narrative and teaser email, then send. Nothing reaches the client until you send.</p>
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={handleSave} disabled={!!busy || alreadySent || !narrative.trim()} className="flex items-center justify-center gap-1.5 border border-slate-200 rounded-lg py-2 text-[10px] uppercase tracking-wider font-semibold disabled:opacity-40">
                    <Save size={12} /> Save draft
                  </button>
                  <button onClick={() => run('refresh', refresh)} disabled={!!busy} className="flex items-center justify-center gap-1.5 border border-slate-200 rounded-lg py-2 text-[10px] uppercase tracking-wider font-semibold disabled:opacity-40">
                    <RefreshCw size={12} /> Refresh
                  </button>
                </div>
                <button
                  onClick={handleDownloadPdf}
                  disabled={!!busy || generating || !narrative.trim()}
                  className="mt-2 w-full flex items-center justify-center gap-2 bg-[#121F38] text-[#C9A84C] rounded-lg py-2.5 text-[10px] uppercase tracking-wider font-bold disabled:opacity-40"
                >
                  <Download size={13} /> Download PDF
                </button>
              </div>

              <div className="border-t border-slate-100 pt-5">
                <div className="text-[10px] uppercase tracking-[.14em] text-slate-400 font-bold mb-3">Email teaser</div>
                <label className="block text-[10px] text-slate-400 uppercase mb-1">To</label>
                <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600 mb-3">{clientEmail || 'No client email on file'}</div>
                <label className="block text-[10px] text-slate-400 uppercase mb-1">Subject</label>
                <input value={subject} onChange={(event) => setSubject(event.target.value)} disabled={alreadySent || !!busy} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs mb-3 disabled:opacity-60" />
                <label className="block text-[10px] text-slate-400 uppercase mb-1">Message</label>
                <textarea value={bodyText} onChange={(event) => setBodyText(event.target.value)} disabled={alreadySent || !!busy} rows={8} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs leading-relaxed disabled:opacity-60" />
                <p className="mt-2 text-[11px] text-slate-400 flex items-start gap-1.5"><Sparkles size={12} className="mt-0.5 shrink-0" /> Full narrative stays in the portal. This email is a short teaser with a login link.</p>
                <button
                  onClick={handleSend}
                  disabled={!!busy || alreadySent || generating || !narrative.trim() || !clientEmail || !subject.trim() || !bodyText.trim()}
                  className="mt-3 w-full flex items-center justify-center gap-2 bg-[#C9A84C] text-[#121F38] rounded-lg py-2.5 text-[10px] uppercase tracking-wider font-bold disabled:opacity-40"
                >
                  <Mail size={13} /> {alreadySent ? 'Already Sent' : 'Send Progress Update'}
                </button>
              </div>

              {busy && <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Working…</div>}
              {error && <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-xs"><AlertCircle size={14} className="shrink-0 mt-0.5" /> {error}</div>}
              {alreadySent && <div className="flex items-start gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-xs"><CheckCircle2 size={14} className="shrink-0 mt-0.5" /> Progress update emailed to {update?.sentTo || clientEmail}. Visible in the client portal Progress tab.</div>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
