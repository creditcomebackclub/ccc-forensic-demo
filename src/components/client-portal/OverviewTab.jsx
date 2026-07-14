import React from 'react';
import { ExternalLink, TrendingUp, Shield } from 'lucide-react';
import ScoreMeter from './ScoreMeter';
import { supabase } from '../../utils/supabase';
import { writeClientSensitiveData } from '../../utils/clientSensitiveData';

export default function OverviewTab({
  profile,
  clientMeta,
  firstName,
  mailed,
  delivered,
  responded,
  deletions,
  latestScores,
  auditHistory,
  clientDocs,
  uploadingDoc,
  handleUploadDoc,
  monitoringStep,
  setMonitoringStep,
  monitoringForm,
  setMonitoringForm,
  monitoringSaving,
  setMonitoringSaving,
  monitoringError,
  setMonitoringError,
  loadData
}) {
  const checks = [
    { key: 'lpoa', label: 'Authorization Signed (LPOA)', done: clientMeta?.lpoa_signed, action: null },
    { key: 'id', label: 'Government-Issued Photo ID', done: !!clientDocs.id, docType: 'government_id' },
    { key: 'address', label: 'Proof of Current Address', done: !!clientDocs.address, docType: 'proof_of_address' },
    { key: 'monitoring', label: 'Credit Monitoring (Recommended)', done: clientMeta?.monitoring_enrolled || clientMeta?.monitoring_not_required, docType: null },
  ];
  const allDone = checks.every(c => c.done);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      {!allDone && (
        <div className="bg-amber-50/50 backdrop-blur-sm border border-amber-200/50 rounded-xl p-5 shadow-sm">
          <div className="text-xs font-bold text-amber-800 mb-4 uppercase tracking-[0.06em]">⚡ Action Required — Complete Your Setup</div>
          <div className="flex flex-col gap-3">
            {checks.map(({ key, label, done, docType }) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{done ? '✅' : '⭕'}</span>
                  <span className={`text-xs ${done ? 'text-gray-500 line-through' : 'text-slate-800 font-semibold'}`}>{label}</span>
                </div>
                {!done && docType && (
                  <label className={`text-[11px] px-3 py-1.5 bg-slate-900 text-amber-400 rounded hover:bg-slate-800 transition-colors font-semibold cursor-pointer whitespace-nowrap shrink-0 ${uploadingDoc === docType ? 'opacity-50 pointer-events-none' : ''}`}>
                    {uploadingDoc === docType ? 'Uploading…' : 'Upload →'}
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
                      onChange={e => { if (e.target.files[0]) handleUploadDoc(docType, e.target.files[0]); }} />
                  </label>
                )}
                {!done && !docType && key === 'monitoring' && (
                  <button onClick={() => setMonitoringStep('edit')} className="text-[11px] px-3 py-1.5 bg-slate-900 text-amber-400 rounded hover:bg-slate-800 transition-colors font-semibold whitespace-nowrap shrink-0">
                    Set Up →
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-slate-900 ccc-display">Welcome back, {firstName}.</h1>
        <p className="text-sm text-gray-500 mt-1">Here's your credit restoration campaign at a glance.</p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: 'Letters Sent', value: mailed.length, icon: '✉️' },
          { label: 'Delivered', value: delivered.length, icon: '✅' },
          { label: 'Responses', value: responded.length, icon: '📬' },
          { label: 'Deletions', value: deletions.length, icon: '🏆' },
        ].map(({ label, value, icon }) => (
          <div key={label} className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
            <div className="text-2xl mb-1">{icon}</div>
            <div className="text-3xl font-bold text-slate-900">{value}</div>
            <div className="text-[10px] uppercase tracking-[0.06em] text-gray-400 mt-1">{label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl overflow-hidden shadow-sm">
        <div className="bg-slate-900 px-5 py-3.5 flex items-center gap-2">
          <TrendingUp size={16} className="text-amber-400" strokeWidth={2} />
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-amber-400">Credit Score Tracker</span>
        </div>
        <div className="p-6">
          {clientMeta && (clientMeta.score_eq_start || clientMeta.score_exp_start || clientMeta.score_tu_start) ? (
            <>
              <div className="flex flex-col sm:flex-row gap-6">
                <ScoreMeter label="Equifax"
                  start={clientMeta.score_eq_start}
                  current={latestScores ? latestScores.equifax : clientMeta.score_eq_start} />
                <ScoreMeter label="Experian"
                  start={clientMeta.score_exp_start}
                  current={latestScores ? latestScores.experian : clientMeta.score_exp_start} />
                <ScoreMeter label="TransUnion"
                  start={clientMeta.score_tu_start}
                  current={latestScores ? latestScores.transunion : clientMeta.score_tu_start} />
              </div>
              {auditHistory.length > 0 && (
                <div className="mt-4 pt-4 border-t border-gray-50 text-[11px] text-gray-400">
                  Last updated: {new Date(auditHistory[0].saved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {auditHistory.length > 1 && ' · ' + auditHistory.length + ' audits on file'}
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-8">
              <TrendingUp size={32} className="text-gray-200 mx-auto mb-3" strokeWidth={1.5} />
              <p className="text-sm text-gray-400">Score tracking will appear here once your audit is complete.</p>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-5 flex items-center gap-4 shadow-sm">
        <Shield size={20} className="text-green-700" strokeWidth={1.75} />
        <div className="flex-1">
          <div className="text-sm font-semibold text-slate-900">Authorization Active</div>
          <div className="text-xs text-gray-500 mt-0.5">Credit Comeback Club is authorized to dispute on your behalf{profile?.agreement_signed_at ? ' since ' + new Date(profile.agreement_signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}</div>
        </div>
        <span className="text-[10px] px-2 py-1 rounded bg-green-50 text-green-700 border border-green-200 uppercase tracking-[0.06em] font-semibold">Active</span>
      </div>

      <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-slate-900">Credit Monitoring</span>
          {clientMeta?.monitoring_enrolled
            ? <span className="text-[10px] px-2.5 py-1 rounded bg-green-50 text-green-700 border border-green-200 font-semibold">✓ Enrolled</span>
            : <span className="text-[10px] px-2.5 py-1 rounded bg-amber-50 text-amber-700 border border-amber-200 font-semibold">Action Required</span>
          }
        </div>
        
        {monitoringStep === 'edit' ? (
          <div className="space-y-3">
            {[
              { key: 'service', label: 'Service', placeholder: 'e.g. PrivacyGuard, MyScoreIQ' },
              { key: 'email', label: 'Login Email', placeholder: 'your@email.com' },
              { key: 'password', label: 'Password', placeholder: '••••••••', type: 'password' },
              { key: 'ssnLast4', label: 'SSN Last 4 Digits', placeholder: '1234' },
            ].map(({ key, label, placeholder, type }) => (
              <div key={key}>
                <div className="text-[10px] uppercase tracking-[0.06em] text-gray-400 mb-1 font-semibold">{label}</div>
                <input type={type || 'text'} placeholder={placeholder}
                  value={monitoringForm[key]}
                  onChange={e => setMonitoringForm(p => ({ ...p, [key]: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition-shadow" />
              </div>
            ))}
            <div className="flex gap-2 pt-2">
              <button disabled={monitoringSaving} onClick={async () => {
                setMonitoringSaving(true);
                setMonitoringError('');
                const serviceUrls = {
                  'privacyguard': 'https://www.privacyguard.com',
                  'myscoreiq': 'https://www.myscoreiq.com',
                  'smart credit': 'https://www.smartcredit.com',
                  'experian': 'https://www.experian.com',
                  'identityiq': 'https://www.identityiq.com',
                };
                const svcKey = (monitoringForm.service || '').toLowerCase();
                const portalUrl = Object.entries(serviceUrls).find(([k]) => svcKey.includes(k))?.[1] || 'https://www.privacyguard.com';
                
                try {
                  await supabase.from('clients').update({
                    monitoring_service: monitoringForm.service,
                    monitoring_email: monitoringForm.email,
                    monitoring_enrolled: true,
                    monitoring_portal_url: portalUrl,
                  }).eq('name', profile.full_name);
                  
                  const sensitive = {};
                  if (monitoringForm.password) sensitive.monitoringPassword = monitoringForm.password;
                  if (monitoringForm.ssnLast4) sensitive.ssnLast4 = monitoringForm.ssnLast4;
                  
                  if (Object.keys(sensitive).length > 0) {
                    await writeClientSensitiveData(profile.full_name, sensitive);
                  }
                  
                  setMonitoringStep('view');
                  loadData();
                } catch (e) {
                  setMonitoringError('Your service/email were saved, but your password/SSN could not be saved securely. Please try again.');
                } finally {
                  setMonitoringSaving(false);
                }
              }} className="text-xs px-4 py-2 bg-slate-900 text-amber-400 rounded hover:bg-slate-800 font-semibold transition-colors disabled:opacity-50">
                {monitoringSaving ? 'Saving…' : 'Save Credentials'}
              </button>
              <button onClick={() => { setMonitoringStep('view'); setMonitoringError(''); }} className="text-xs px-4 py-2 bg-white border border-gray-200 text-gray-500 rounded hover:bg-gray-50 transition-colors font-medium">
                Cancel
              </button>
            </div>
            {monitoringError && (
              <div className="text-[11px] text-red-600 mt-2 bg-red-50 p-2 rounded">{monitoringError}</div>
            )}
          </div>
        ) : clientMeta?.monitoring_enrolled ? (
          <div>
            <a href={clientMeta.monitoring_portal_url || 'https://www.privacyguard.com'} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900 hover:text-blue-600 transition-colors">
              <ExternalLink size={14} strokeWidth={2} />
              Access {clientMeta.monitoring_service || 'Privacy Guard'} →
            </a>
            <button onClick={() => { setMonitoringForm({ service: clientMeta.monitoring_service || '', email: clientMeta.monitoring_email || '', password: '', ssnLast4: '' }); setMonitoringStep('edit'); }}
              className="block mt-3 text-xs text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors">
              Update credentials
            </button>
          </div>
        ) : (
          <div>
            <p className="text-xs text-gray-500 mb-4 leading-relaxed">Credit monitoring lets us track your score progress. Enter your credentials below or sign up for a service.</p>
            <div className="flex gap-2 flex-wrap mb-4">
              {[['PrivacyGuard', 'https://www.privacyguard.com'], ['MyScoreIQ', 'https://www.myscoreiq.com'], ['Smart Credit', 'https://www.smartcredit.com'], ['IdentityIQ', 'https://www.identityiq.com']].map(([name, url]) => (
                <a key={name} href={url} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] px-3 py-1.5 border border-gray-200 rounded-md text-slate-900 font-medium hover:bg-gray-50 transition-colors">
                  {name} →
                </a>
              ))}
            </div>
            <button onClick={() => setMonitoringStep('edit')}
              className="text-xs px-4 py-2 bg-slate-900 text-amber-400 rounded-md font-semibold hover:bg-slate-800 transition-colors">
              Enter My Credentials
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
