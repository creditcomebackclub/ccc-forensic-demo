import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Copy, ExternalLink, FileSignature, LockKeyhole, Send, ShieldCheck, UserCheck, XCircle } from 'lucide-react';
import { supabase } from '../utils/supabase';

const APPLICATION_URL = 'https://creditcomebackclub.com/affiliate/apply';

const stageLabel = (application, agreement, affiliate) => {
  if (affiliate?.program_status === 'active') return 'Active';
  if (agreement?.status === 'signed') return 'Signed · owner activation required';
  if (agreement?.status === 'sent') return 'Agreement sent';
  if (agreement?.status === 'draft') return agreement.document_snapshot?.legalStatus === 'approved' ? 'Ready to send' : 'Counsel review required';
  return application.status === 'pending' ? 'Owner review' : 'Agreement setup';
};

export default function AffiliateApplicationsPanel({ defaultCommissionRate = 0.20, onAffiliateCreated }) {
  const [applications, setApplications] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [affiliates, setAffiliates] = useState([]);
  const [terms, setTerms] = useState({});
  const [rates, setRates] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [copied, setCopied] = useState(false);

  const agreementByApplication = useMemo(() => {
    const map = new Map();
    for (const agreement of agreements) if (!map.has(agreement.application_id)) map.set(agreement.application_id, agreement);
    return map;
  }, [agreements]);
  const affiliateById = useMemo(() => new Map(affiliates.map((affiliate) => [affiliate.id, affiliate])), [affiliates]);

  const loadApplications = async () => {
    setLoading(true);
    const [applicationResult, agreementResult, affiliateResult] = await Promise.all([
      supabase.from('affiliate_applications').select('*').in('status', ['pending', 'approved']).order('created_at', { ascending: true }),
      supabase.from('affiliate_agreements').select('*').order('created_at', { ascending: false }),
      supabase.from('affiliates').select('id,name,email,program_status,current_agreement_id'),
    ]);
    const loadError = applicationResult.error || agreementResult.error || affiliateResult.error;
    if (loadError) setError(loadError.message || 'Could not load affiliate onboarding.');
    else {
      const nextAffiliates = affiliateResult.data || [];
      const completedAffiliateIds = new Set(nextAffiliates.filter((row) => ['active', 'legacy_active'].includes(row.program_status)).map((row) => row.id));
      const nextApplications = (applicationResult.data || []).filter((row) => !completedAffiliateIds.has(row.affiliate_id));
      const nextAgreements = agreementResult.data || [];
      setApplications(nextApplications);
      setAgreements(nextAgreements);
      setAffiliates(nextAffiliates);
      setTerms((current) => {
        const next = { ...current };
        for (const application of nextApplications) {
          const agreement = nextAgreements.find((row) => row.application_id === application.id);
          if (next[application.id] == null && agreement?.compensation_snapshot?.compensationTerms) next[application.id] = agreement.compensation_snapshot.compensationTerms;
        }
        return next;
      });
      setRates((current) => {
        const next = { ...current };
        for (const application of nextApplications) {
          const agreement = nextAgreements.find((row) => row.application_id === application.id);
          if (next[application.id] == null) next[application.id] = String((Number(agreement?.compensation_snapshot?.commissionRate ?? defaultCommissionRate) * 100).toFixed(2)).replace(/\.00$/, '');
        }
        return next;
      });
    }
    setLoading(false);
  };

  useEffect(() => { loadApplications(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const copyApplicationLink = async () => {
    try {
      await navigator.clipboard.writeText(APPLICATION_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { setError(`Copy this link: ${APPLICATION_URL}`); }
  };

  const prepare = async (application) => {
    const compensationTerms = String(terms[application.id] || '').trim();
    const rate = Number(rates[application.id]) / 100;
    if (compensationTerms.length < 10) {
      setError('Enter the exact owner-approved compensation language before creating an agreement snapshot.');
      return;
    }
    setBusyId(application.id);
    setError(null);
    setNotice(null);
    try {
      const { data, error: prepareError } = await supabase.rpc('ccc_prepare_affiliate_agreement', {
        p_application_id: application.id,
        p_commission_rate: rate,
        p_compensation_terms: compensationTerms,
        p_template_version: 'ccc-affiliate-agreement-v1-draft',
      });
      if (prepareError) throw prepareError;
      setNotice(data?.sendBlocked
        ? `${application.name}'s immutable terms snapshot was prepared, but sending remains blocked until the affiliate agreement receives documented owner/counsel approval.`
        : `${application.name}'s agreement packet is ready to send.`);
      await loadApplications();
      await onAffiliateCreated?.();
    } catch (prepareError) { setError(prepareError.message || 'Could not prepare the affiliate agreement.'); }
    finally { setBusyId(null); }
  };

  const sendAgreement = async (application, agreement, action = 'send') => {
    setBusyId(application.id);
    setError(null);
    setNotice(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Your admin session expired. Sign in again.');
      const response = await fetch('/.netlify/functions/affiliate-agreement-onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ action, agreementId: agreement.id }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not send the partner agreement.');
      setNotice(`Secure agreement link ${action === 'resend' ? 'resent' : 'sent'} to ${application.email}.`);
      await loadApplications();
    } catch (sendError) { setError(sendError.message || 'Could not send the partner agreement.'); }
    finally { setBusyId(null); }
  };

  const activate = async (application) => {
    setBusyId(application.id);
    setError(null);
    setNotice(null);
    try {
      const { error: activationError } = await supabase.rpc('ccc_activate_affiliate', { p_affiliate_id: application.affiliate_id });
      if (activationError) throw activationError;
      setNotice(`${application.name} is activated and can now access partner data and submit referrals.`);
      await loadApplications();
      await onAffiliateCreated?.();
    } catch (activationError) { setError(activationError.message || 'Could not activate this partner.'); }
    finally { setBusyId(null); }
  };

  const reject = async (application) => {
    const notes = window.prompt(`Optional internal reason for rejecting ${application.name}:`, '');
    if (notes === null || !window.confirm(`Reject ${application.name}'s affiliate application?`)) return;
    setBusyId(application.id);
    setError(null);
    try {
      const { error: rejectionError } = await supabase.rpc('reject_affiliate_application', { p_application_id: application.id, p_notes: notes.trim() || null });
      if (rejectionError) throw rejectionError;
      await loadApplications();
    } catch (rejectionError) { setError(rejectionError.message || 'Could not reject the affiliate application.'); }
    finally { setBusyId(null); }
  };

  return (
    <section className="mb-7">
      <div className="rounded border border-border bg-white p-4 mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-[12px] font-semibold text-ink">Professional partner onboarding</div>
          <div className="text-[11px] text-ink-muted mt-1">Application → owner-set terms → immutable agreement → signature → owner activation. Portal data stays locked until the final step.</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={APPLICATION_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-wider rounded-sm border border-border text-ink-muted hover:text-navy"><ExternalLink size={12} /> Preview</a>
          <button onClick={copyApplicationLink} className="flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-wider rounded-sm bg-navy text-gold">{copied ? <CheckCircle size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy Link'}</button>
        </div>
      </div>
      <div className="rounded border border-amber-200 bg-amber-50 p-3 mb-4 flex gap-2 text-[11px] text-amber-900">
        <LockKeyhole size={15} className="shrink-0 mt-0.5" />
        <div><strong>Fail-closed legal gate:</strong> the installed affiliate agreement is a counsel-review placeholder. You can capture the exact compensation clause and prepare a frozen packet now, but no agreement can be sent or activated until the final agreement text and approval reference are supplied.</div>
      </div>
      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div>}
      {notice && <div className="mb-4 rounded border border-green-200 bg-green-50 px-3 py-2 text-[12px] text-green-800">{notice}</div>}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[12px] uppercase tracking-wider font-semibold text-ink-muted">Onboarding queue</h2>
        {!loading && <span className="text-[11px] text-ink-faint">{applications.length}</span>}
      </div>
      {loading ? <div className="rounded border border-border bg-white p-4 text-[12px] text-ink-muted">Loading applications…</div>
        : applications.length === 0 ? <div className="rounded border border-dashed border-border bg-gray-50 p-4 text-[12px] text-ink-muted">No partner applications are awaiting onboarding.</div>
          : <div className="space-y-3">{applications.map((application) => {
            const agreement = agreementByApplication.get(application.id);
            const affiliate = affiliateById.get(application.affiliate_id);
            const stage = stageLabel(application, agreement, affiliate);
            const counselBlocked = agreement?.document_snapshot?.legalStatus !== 'approved';
            return <div key={application.id} className="rounded border border-border bg-white p-4">
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><div className="text-[14px] font-semibold text-ink">{application.name}</div><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] uppercase tracking-wider text-slate-600">{stage}</span></div>
                  <div className="text-[11px] text-ink-muted mt-0.5">{[application.company, application.email, application.phone].filter(Boolean).join(' · ')}</div>
                  {application.website_url && <a href={application.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-2 text-[11px] text-blue-700 hover:underline"><ExternalLink size={11} /> {application.website_url}</a>}
                  {application.referral_notes && <p className="mt-2 text-[11px] leading-relaxed text-ink-muted whitespace-pre-wrap">{application.referral_notes}</p>}
                  {(!agreement || agreement.status === 'draft') && <div className="mt-4 grid gap-3 md:grid-cols-[120px_1fr]">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Commission %<input type="number" min="0.01" max="100" step="0.01" value={rates[application.id] || ''} onChange={(event) => setRates((current) => ({ ...current, [application.id]: event.target.value }))} className="mt-1 w-full rounded border border-border px-2 py-2 text-[12px] text-ink" /></label>
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">Exact compensation terms<textarea value={terms[application.id] || ''} onChange={(event) => setTerms((current) => ({ ...current, [application.id]: event.target.value }))} rows={3} placeholder="Paste the exact owner/counsel-approved definition of eligible revenue, timing, exclusions, reversals, and payout conditions." className="mt-1 w-full rounded border border-border px-2 py-2 text-[12px] normal-case tracking-normal text-ink" /></label>
                  </div>}
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  {application.status === 'pending' && <button onClick={() => reject(application)} disabled={busyId === application.id} className="flex items-center justify-center gap-1.5 rounded-sm border border-red-200 px-3 py-2 text-[10px] uppercase tracking-wider text-red-700 disabled:opacity-50"><XCircle size={12} /> Reject</button>}
                  {(!agreement || agreement.status === 'draft') && <button onClick={() => prepare(application)} disabled={busyId === application.id} className="flex items-center justify-center gap-1.5 rounded-sm bg-navy px-3 py-2 text-[10px] uppercase tracking-wider text-gold disabled:opacity-50"><FileSignature size={12} /> {busyId === application.id ? 'Working…' : agreement ? 'Rebuild snapshot' : 'Approve terms'}</button>}
                  {agreement?.status === 'draft' && <button onClick={() => sendAgreement(application, agreement)} disabled={busyId === application.id || counselBlocked} title={counselBlocked ? 'Counsel approval is required before sending.' : ''} className="flex items-center justify-center gap-1.5 rounded-sm border border-navy px-3 py-2 text-[10px] uppercase tracking-wider text-navy disabled:cursor-not-allowed disabled:opacity-40"><Send size={12} /> Send agreement</button>}
                  {agreement?.status === 'sent' && <button onClick={() => sendAgreement(application, agreement, 'resend')} disabled={busyId === application.id} className="flex items-center justify-center gap-1.5 rounded-sm border border-border px-3 py-2 text-[10px] uppercase tracking-wider text-ink-muted disabled:opacity-50"><Send size={12} /> Resend link</button>}
                  {agreement?.status === 'signed' && <button onClick={() => activate(application)} disabled={busyId === application.id} className="flex items-center justify-center gap-1.5 rounded-sm bg-green-700 px-3 py-2 text-[10px] uppercase tracking-wider text-white disabled:opacity-50"><ShieldCheck size={12} /> Activate portal</button>}
                  {affiliate?.program_status === 'active' && <div className="flex items-center gap-1.5 rounded-sm bg-green-50 px-3 py-2 text-[10px] uppercase tracking-wider text-green-800"><UserCheck size={12} /> Activated</div>}
                </div>
              </div>
            </div>;
          })}</div>}
    </section>
  );
}

export { APPLICATION_URL, stageLabel };
