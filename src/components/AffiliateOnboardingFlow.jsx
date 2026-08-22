import React, { useEffect, useState } from 'react';
import { CheckCircle, FileSignature, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';

const authHeaders = (session) => ({
  'Content-Type': 'application/json',
  ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
});

export default function AffiliateOnboardingFlow({ session, onSignOut, onActivated }) {
  const [agreement, setAgreement] = useState(null);
  const [signerName, setSignerName] = useState('');
  const [accepted, setAccepted] = useState({ affiliate_agreement: false, compensation_terms: false, electronic_records: false });
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/.netlify/functions/affiliate-agreement', {
        method: 'POST', headers: authHeaders(session), body: JSON.stringify({ action: 'load' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not load your partner agreement.');
      setAgreement(body);
      setSignerName(body.applicantName || '');
      if (body.hasPortalAccess) onActivated?.();
    } catch (loadError) { setError(loadError.message || 'Could not load your partner agreement.'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [session?.access_token]); // eslint-disable-line react-hooks/exhaustive-deps

  const sign = async () => {
    setSigning(true);
    setError(null);
    try {
      const response = await fetch('/.netlify/functions/affiliate-agreement', {
        method: 'POST', headers: authHeaders(session),
        body: JSON.stringify({ action: 'sign', signerName, acknowledgements: accepted }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Could not sign the partner agreement.');
      await load();
    } catch (signError) { setError(signError.message || 'Could not sign the partner agreement.'); }
    finally { setSigning(false); }
  };

  const allAccepted = Object.values(accepted).every(Boolean);
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-[#1B2A4A] px-6 py-4 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div><div className="text-sm font-semibold tracking-wide text-[#D9BD67]">CREDIT COMEBACK CLUB</div><div className="mt-0.5 text-xs text-slate-300">Secure Partner Onboarding</div></div>
          <button onClick={onSignOut} className="flex items-center gap-2 text-xs text-slate-300 hover:text-white"><LogOut size={14} /> Sign out</button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 py-10">
        {loading ? <div className="rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading your agreement…</div>
          : error && !agreement ? <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800"><LockKeyhole size={22} className="mb-3" />{error}</div>
            : agreement?.status === 'signed' || agreement?.programStatus === 'agreement_signed' ? (
              <div className="rounded-xl border border-emerald-200 bg-white p-8 text-center shadow-sm">
                <CheckCircle className="mx-auto mb-4 text-emerald-600" size={40} />
                <h1 className="text-xl font-semibold">Agreement signed</h1>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-600">Your immutable signed packet has been stored. Credit Comeback Club must complete the final owner activation before referral and commission data becomes available.</p>
                <button onClick={load} className="mt-6 rounded-md border border-slate-300 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-slate-700">Check activation status</button>
              </div>
            ) : agreement?.hasPortalAccess ? (
              <div className="rounded-xl border border-emerald-200 bg-white p-8 text-center"><ShieldCheck className="mx-auto mb-3 text-emerald-600" size={40} /><h1 className="text-xl font-semibold">Partner portal activated</h1><button onClick={onActivated} className="mt-5 rounded-md bg-[#1B2A4A] px-5 py-2.5 text-xs font-semibold uppercase tracking-wider text-[#D9BD67]">Open partner portal</button></div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="flex items-start gap-3"><FileSignature className="mt-0.5 text-[#1B2A4A]" size={24} /><div><h1 className="text-xl font-semibold">Review your partner agreement</h1><p className="mt-1 text-sm leading-6 text-slate-600">This screen is bound to template <strong>{agreement?.templateVersion}</strong>. Your signature applies only to the frozen terms shown below.</p></div></div>
                </div>
                {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Affiliate agreement</h2><div className="mt-4 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-4 text-sm leading-6 text-slate-700">{agreement?.agreementText || 'The approved agreement text is unavailable. Signing is blocked.'}</div></section>
                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm"><h2 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Compensation terms</h2><div className="mt-4 rounded-lg border border-slate-200 p-4"><div className="text-lg font-semibold">{Math.round(Number(agreement?.commissionRate || 0) * 10000) / 100}%</div><div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{agreement?.compensationTerms}</div></div></section>
                <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Acknowledge and sign</h2>
                  <div className="mt-4 space-y-3 text-sm text-slate-700">
                    <Checkbox checked={accepted.affiliate_agreement} onChange={(value) => setAccepted((current) => ({ ...current, affiliate_agreement: value }))}>I have read and accept the complete affiliate partner agreement shown above.</Checkbox>
                    <Checkbox checked={accepted.compensation_terms} onChange={(value) => setAccepted((current) => ({ ...current, compensation_terms: value }))}>I accept the exact commission rate and compensation terms shown above.</Checkbox>
                    <Checkbox checked={accepted.electronic_records} onChange={(value) => setAccepted((current) => ({ ...current, electronic_records: value }))}>I consent to electronic records and signatures and intend my typed legal name to be my electronic signature.</Checkbox>
                  </div>
                  <label className="mt-5 block text-xs font-semibold uppercase tracking-wider text-slate-600">Full legal name<input value={signerName} onChange={(event) => setSignerName(event.target.value)} autoComplete="name" className="mt-2 w-full rounded-md border border-slate-300 px-3 py-3 text-sm font-normal normal-case tracking-normal" /></label>
                  <button onClick={sign} disabled={signing || !allAccepted || signerName.trim().length < 2 || !agreement?.agreementText} className="mt-5 w-full rounded-md bg-[#1B2A4A] px-5 py-3 text-xs font-semibold uppercase tracking-[0.12em] text-[#D9BD67] disabled:cursor-not-allowed disabled:opacity-40">{signing ? 'Securing signed packet…' : 'Sign partner agreement'}</button>
                </section>
              </div>
            )}
      </main>
    </div>
  );
}

function Checkbox({ checked, onChange, children }) {
  return <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5 h-4 w-4" /><span className="leading-5">{children}</span></label>;
}
