import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, Eye, FileCheck2, Loader2, Mail, Save, X } from 'lucide-react';
import PdfCanvasPreview from './PdfCanvasPreview.jsx';
import {
  approveBlueprint,
  base64PdfUrl,
  getBlueprintStatus,
  persistReviewedAccounts,
  previewBlueprint,
  sendBlueprint,
} from '../utils/recoveryBlueprintApi.js';

function defaultMessage(audit) {
  const firstName = String(audit.client?.name || 'there').split(' ')[0];
  return `Hi ${firstName},

Your Recovery Blueprint is ready. We completed a forensic review of your credit reports and organized the highest-priority findings into a clear opening strategy.

The attached Blueprint shows your current file snapshot, the accounts selected for the opening campaign, and the documented recovery path we recommend reviewing together.

Please look it over before our consultation. We’ll verify the details, answer your questions, and map the right next step for your file.

— Chris & the Credit Comeback Club Team
970-644-0063 | creditcomebackclub.com`;
}

function StatusPill({ artifact }) {
  if (!artifact) return <span className="text-[10px] px-2.5 py-1 rounded-full bg-gray-100 text-gray-500">No approved version</span>;
  if (!artifact.isCurrent) return <span className="text-[10px] px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 font-semibold">Reapproval required</span>;
  const sent = artifact.status === 'sent';
  return (
    <span className={`text-[10px] px-2.5 py-1 rounded-full border font-semibold ${sent ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
      {sent ? 'Sent' : 'Approved'} · v{artifact.version}
    </span>
  );
}

export default function RecoveryBlueprintStudio({ audit, accounts, correctionsDirty, clientEmail, onCorrectionsSaved, onClose }) {
  const [artifact, setArtifact] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [busy, setBusy] = useState('loading');
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState(clientEmail || '');
  const [subject, setSubject] = useState('Your Credit Comeback Club Recovery Blueprint is Ready');
  const [bodyText, setBodyText] = useState(() => defaultMessage(audit));

  const identity = useMemo(() => ({
    name: audit.client?.name,
    reportDate: audit.client?.reportDate,
  }), [audit.client?.name, audit.client?.reportDate]);

  useEffect(() => {
    setRecipientEmail(clientEmail || '');
  }, [clientEmail]);

  useEffect(() => {
    let active = true;
    setBusy('loading');
    getBlueprintStatus(audit)
      .then((data) => { if (active) setArtifact(data.artifact || null); })
      .catch((err) => { if (active) setError(err.message); })
      .finally(() => { if (active) setBusy(null); });
    return () => { active = false; };
  }, [identity.name, identity.reportDate]);

  useEffect(() => () => { if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  const run = async (label, task) => {
    setBusy(label);
    setError(null);
    try { return await task(); }
    catch (err) { setError(err.message || 'Recovery Blueprint action failed.'); return null; }
    finally { setBusy(null); }
  };

  const saveIfNeeded = async () => {
    if (!correctionsDirty) return true;
    const data = await persistReviewedAccounts(audit, accounts);
    if (data?.saved) {
      onCorrectionsSaved?.();
      setArtifact((current) => current ? { ...current, isCurrent: false } : current);
    }
    return !!data?.saved;
  };

  const handlePreview = () => run('preview', async () => {
    if (!(await saveIfNeeded())) return;
    const data = await previewBlueprint(audit);
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(base64PdfUrl(data.pdfBase64));
  });

  const handleApprove = () => run('approve', async () => {
    if (!(await saveIfNeeded())) return;
    const data = await approveBlueprint(audit);
    setArtifact(data.artifact);
    setPreviewUrl(data.artifact.signedUrl);
  });

  const handleSave = () => run('save', saveIfNeeded);

  const trimmedRecipient = recipientEmail.trim();
  const recipientLooksValid = /^\S+@\S+\.\S+$/.test(trimmedRecipient);

  const handleSend = () => run('send', async () => {
    if (!artifact) throw new Error('Approve the Blueprint before sending it.');
    if (!recipientLooksValid) throw new Error('Enter a valid recipient email before sending.');
    const data = await sendBlueprint(audit, {
      artifactId: artifact.id,
      clientEmail: trimmedRecipient,
      subject,
      bodyText,
    });
    setArtifact(data.artifact);
    setSent(true);
  });

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm p-3 sm:p-6 flex items-center justify-center" onClick={onClose}>
      <div className="bg-[#F7F4ED] w-full max-w-6xl h-[92vh] rounded-2xl overflow-hidden shadow-2xl flex flex-col" onClick={(event) => event.stopPropagation()}>
        <div className="bg-[#121F38] px-5 sm:px-7 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[#C9A84C] text-[10px] uppercase tracking-[.2em] font-bold">Prospect Deliverable</div>
            <div className="text-white text-lg font-semibold truncate">Recovery Blueprint · {audit.client?.name}</div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <StatusPill artifact={artifact} />
            <button onClick={onClose} className="text-white/60 hover:text-white p-1"><X size={19} /></button>
          </div>
        </div>

        <div className="grid lg:grid-cols-[1fr_360px] flex-1 min-h-0">
          <div className="bg-slate-200/70 min-h-[360px] flex flex-col p-3 sm:p-5">
            {previewUrl ? (
              <>
                <div className="flex justify-end mb-2 shrink-0">
                  <a href={previewUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold text-slate-600 hover:text-slate-900">
                    <Download size={12} /> Open PDF in new tab
                  </a>
                </div>
                <PdfCanvasPreview src={previewUrl} className="flex-1 min-h-0" />
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-sm">
                  <FileCheck2 size={42} className="mx-auto text-slate-400 mb-4" strokeWidth={1.4} />
                  <div className="font-semibold text-slate-900">Preview the reviewed Blueprint</div>
                  <p className="text-sm text-slate-500 mt-2">Preview uses the saved forensic audit and your persisted account corrections. Claude does not run again.</p>
                  <button onClick={handlePreview} disabled={!!busy} className="mt-5 inline-flex items-center gap-2 bg-[#121F38] text-[#C9A84C] px-5 py-2.5 rounded-lg text-xs font-bold uppercase tracking-wider disabled:opacity-50">
                    <Eye size={14} /> Generate Preview
                  </button>
                </div>
              </div>
            )}
          </div>

          <aside className="bg-white border-l border-slate-200 p-5 overflow-y-auto">
            <div className="space-y-5">
              <div>
                <div className="text-[10px] uppercase tracking-[.14em] text-slate-400 font-bold mb-2">Review controls</div>
                {correctionsDirty && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-900 mb-3">
                    Account corrections are not saved yet. Preview and approval will save them first.
                  </div>
                )}
                {artifact && !artifact.isCurrent && !correctionsDirty && (
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-800 mb-3">
                    The saved audit changed after version {artifact.version} was approved. Preview and approve a new version before sending.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <button onClick={handleSave} disabled={!!busy || !correctionsDirty} className="flex items-center justify-center gap-1.5 border border-slate-200 rounded-lg py-2 text-[10px] uppercase tracking-wider font-semibold disabled:opacity-40"><Save size={12} /> Save review</button>
                  <button onClick={handlePreview} disabled={!!busy} className="flex items-center justify-center gap-1.5 border border-slate-200 rounded-lg py-2 text-[10px] uppercase tracking-wider font-semibold disabled:opacity-40"><Eye size={12} /> Preview</button>
                </div>
                <button onClick={handleApprove} disabled={!!busy} className="mt-2 w-full flex items-center justify-center gap-2 bg-[#121F38] text-[#C9A84C] rounded-lg py-2.5 text-[10px] uppercase tracking-wider font-bold disabled:opacity-50">
                  <FileCheck2 size={13} /> {artifact ? 'Approve New Version' : 'Approve & Archive'}
                </button>
                {artifact?.signedUrl && (
                  <a href={artifact.signedUrl} target="_blank" rel="noreferrer" className="mt-2 w-full flex items-center justify-center gap-2 border border-[#121F38] text-[#121F38] rounded-lg py-2.5 text-[10px] uppercase tracking-wider font-bold">
                    <Download size={13} /> Download Approved PDF
                  </a>
                )}
              </div>

              <div className="border-t border-slate-100 pt-5">
                <div className="text-[10px] uppercase tracking-[.14em] text-slate-400 font-bold mb-3">Email approved file</div>
                <label className="block text-[10px] text-slate-400 uppercase mb-1">To</label>
                <input
                  type="email"
                  value={recipientEmail}
                  onChange={(event) => setRecipientEmail(event.target.value)}
                  placeholder="client@email.com"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs mb-1"
                />
                {!clientEmail && (
                  <p className="text-[10px] text-amber-700 mb-3">No email on the client record — enter the recipient above to send.</p>
                )}
                {clientEmail && <div className="mb-3" />}
                <label className="block text-[10px] text-slate-400 uppercase mb-1">Subject</label>
                <input value={subject} onChange={(event) => setSubject(event.target.value)} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs mb-3" />
                <label className="block text-[10px] text-slate-400 uppercase mb-1">Message</label>
                <textarea value={bodyText} onChange={(event) => setBodyText(event.target.value)} rows={9} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-xs leading-relaxed" />
                <button onClick={handleSend} disabled={!!busy || !artifact || !artifact.isCurrent || correctionsDirty || !recipientLooksValid || !subject.trim() || !bodyText.trim()} className="mt-3 w-full flex items-center justify-center gap-2 bg-[#C9A84C] text-[#121F38] rounded-lg py-2.5 text-[10px] uppercase tracking-wider font-bold disabled:opacity-40">
                  <Mail size={13} /> Send Approved Blueprint
                </button>
              </div>

              {busy && <div className="flex items-center gap-2 text-xs text-slate-500"><Loader2 size={14} className="animate-spin" /> Working…</div>}
              {error && <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-xs"><AlertCircle size={14} className="shrink-0 mt-0.5" /> {error}</div>}
              {sent && <div className="flex items-start gap-2 bg-green-50 border border-green-200 text-green-700 rounded-lg p-3 text-xs"><CheckCircle2 size={14} className="shrink-0 mt-0.5" /> The exact approved PDF was emailed to {trimmedRecipient}.</div>}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
