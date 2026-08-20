import React, { useEffect, useState } from 'react';
import { CheckCircle, Copy, ExternalLink, UserCheck, XCircle } from 'lucide-react';
import { supabase } from '../utils/supabase';

const APPLICATION_URL = 'https://creditcomebackclub.com/affiliate/apply';

export default function AffiliateApplicationsPanel({ defaultCommissionRate = 0.20, onAffiliateCreated }) {
  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const loadApplications = async () => {
    setLoading(true);
    const { data, error: loadError } = await supabase
      .from('affiliate_applications')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (loadError) setError(loadError.message || 'Could not load affiliate applications.');
    else setApplications(data || []);
    setLoading(false);
  };

  useEffect(() => { loadApplications(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const copyApplicationLink = async () => {
    try {
      await navigator.clipboard.writeText(APPLICATION_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch (_error) {
      setError(`Copy this link: ${APPLICATION_URL}`);
    }
  };

  const approve = async (application) => {
    setBusyId(application.id);
    setError(null);
    let affiliateCreated = false;
    try {
      const rate = Number(defaultCommissionRate) || 0.20;
      const { data, error: approvalError } = await supabase.rpc('approve_affiliate_application', {
        p_application_id: application.id,
        p_commission_rate: rate,
      });
      if (approvalError) throw approvalError;
      affiliateCreated = true;
      const affiliate = data?.affiliate;
      if (!affiliate?.email) throw new Error('Affiliate approved, but the new record could not be loaded.');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Affiliate approved, but your admin session expired before the invite could be sent.');
      const invite = await fetch('/.netlify/functions/provision-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ email: affiliate.email, fullName: affiliate.name, kind: 'affiliate' }),
      });
      const inviteBody = await invite.json().catch(() => ({}));
      if (!invite.ok) throw new Error(`Affiliate approved, but the portal invite failed: ${inviteBody.error || 'use Resend Invite on the affiliate record.'}`);
      await loadApplications();
      await onAffiliateCreated?.();
    } catch (approvalError) {
      setError(approvalError.message || 'Could not approve the affiliate application.');
      if (affiliateCreated) {
        await loadApplications();
        await onAffiliateCreated?.();
      }
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (application) => {
    const notes = window.prompt(`Optional internal reason for rejecting ${application.name}:`, '');
    if (notes === null) return;
    if (!window.confirm(`Reject ${application.name}'s affiliate application?`)) return;
    setBusyId(application.id);
    setError(null);
    try {
      const { error: rejectionError } = await supabase.rpc('reject_affiliate_application', {
        p_application_id: application.id,
        p_notes: notes.trim() || null,
      });
      if (rejectionError) throw rejectionError;
      await loadApplications();
    } catch (rejectionError) {
      setError(rejectionError.message || 'Could not reject the affiliate application.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="mb-7">
      <div className="rounded border border-border bg-white p-4 mb-4 flex items-center justify-between gap-4">
        <div>
          <div className="text-[12px] font-semibold text-ink">Public affiliate application</div>
          <div className="text-[11px] text-ink-muted mt-1">Send this link instead of entering a partner manually. Applications require your approval before portal access is sent.</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href={APPLICATION_URL} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-wider rounded-sm border border-border text-ink-muted hover:text-navy">
            <ExternalLink size={12} /> Preview
          </a>
          <button onClick={copyApplicationLink} className="flex items-center gap-1.5 px-3 py-2 text-[10px] uppercase tracking-wider rounded-sm bg-navy text-gold">
            {copied ? <CheckCircle size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy Link'}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">{error}</div>}

      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[12px] uppercase tracking-wider font-semibold text-ink-muted">Pending applications</h2>
        {!loading && <span className="text-[11px] text-ink-faint">{applications.length}</span>}
      </div>
      {loading ? (
        <div className="rounded border border-border bg-white p-4 text-[12px] text-ink-muted">Loading applications…</div>
      ) : applications.length === 0 ? (
        <div className="rounded border border-dashed border-border bg-gray-50 p-4 text-[12px] text-ink-muted">No affiliate applications are waiting for review.</div>
      ) : (
        <div className="space-y-3">
          {applications.map((application) => (
            <div key={application.id} className="rounded border border-border bg-white p-4">
              <div className="flex items-start justify-between gap-5">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-ink">{application.name}</div>
                  <div className="text-[11px] text-ink-muted mt-0.5">
                    {[application.company, application.email, application.phone].filter(Boolean).join(' · ')}
                  </div>
                  {application.website_url && <a href={application.website_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-2 text-[11px] text-blue-700 hover:underline"><ExternalLink size={11} /> {application.website_url}</a>}
                  {application.referral_notes && <p className="mt-2 text-[11px] leading-relaxed text-ink-muted whitespace-pre-wrap">{application.referral_notes}</p>}
                  <div className="mt-2 text-[9px] uppercase tracking-wider text-ink-faint">Applied {new Date(application.created_at).toLocaleString()}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <button onClick={() => reject(application)} disabled={busyId === application.id} className="flex items-center gap-1.5 rounded-sm border border-red-200 px-3 py-2 text-[10px] uppercase tracking-wider text-red-700 disabled:opacity-50">
                    <XCircle size={12} /> Reject
                  </button>
                  <button onClick={() => approve(application)} disabled={busyId === application.id} className="flex items-center gap-1.5 rounded-sm bg-navy px-3 py-2 text-[10px] uppercase tracking-wider text-gold disabled:opacity-50">
                    <UserCheck size={12} /> {busyId === application.id ? 'Working…' : `Approve at ${Math.round((Number(defaultCommissionRate) || 0.20) * 100)}%`}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export { APPLICATION_URL };
