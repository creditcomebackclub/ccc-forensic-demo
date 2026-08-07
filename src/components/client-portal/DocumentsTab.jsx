import React, { useState } from 'react';
import { ExternalLink, FileText, Shield, Upload, Eye, Trash2 } from 'lucide-react';
import { supabase } from '../../utils/supabase';
import { writeClientSensitiveData } from '../../utils/clientSensitiveData';
import { getDocumentUrl, deleteDocument } from '../../utils/documents';

const OTHER_DOC_CATEGORIES = [
  'Bank Statement', 'Pay Stub', 'Tax Document', 'Court Document',
  'Insurance Document', 'Correspondence', 'Other',
];

function OtherDocsCard({ docs, uploadingOther, handleUploadOther, clientId, ownerUserId, onChanged }) {
  const [category, setCategory] = useState(OTHER_DOC_CATEGORIES[0]);
  const [customLabel, setCustomLabel] = useState('');
  const [error, setError] = useState(null);

  const handleFile = (file) => {
    const label = category === 'Other' ? customLabel.trim() : category;
    if (!label) { setError('Enter a name for this document.'); return; }
    setError(null);
    setCustomLabel('');
    handleUploadOther(label, file);
  };

  const handleView = async (doc) => {
    try {
      const url = await getDocumentUrl(doc.storage_path);
      window.open(url, '_blank');
    } catch (e) { alert('Could not open document: ' + e.message); }
  };

  const handleDelete = async (doc) => {
    if (!window.confirm('Remove "' + (doc.label || doc.file_name) + '"?')) return;
    try {
      if (!ownerUserId) throw new Error('Could not identify document owner.');
      await deleteDocument(clientId, doc.doc_type, ownerUserId);
      onChanged();
    } catch (e) { alert('Could not delete: ' + e.message); }
  };

  return (
    <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 flex-wrap mb-3">
        <select value={category} onChange={(e) => setCategory(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-3 py-2 bg-white">
          {OTHER_DOC_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {category === 'Other' && (
          <input value={customLabel} onChange={(e) => setCustomLabel(e.target.value)} placeholder="Document name"
            className="text-xs border border-gray-200 rounded-lg px-3 py-2 flex-1 min-w-[140px]" />
        )}
        <label className={`flex items-center gap-1.5 text-[11px] px-4 py-2 rounded-lg font-semibold cursor-pointer whitespace-nowrap shrink-0 bg-slate-900 text-amber-400 hover:bg-slate-800 transition-all ${uploadingOther ? 'opacity-50 pointer-events-none' : ''}`}>
          <Upload size={12} strokeWidth={2.5} />
          {uploadingOther ? 'Uploading…' : 'Upload'}
          <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
            onChange={(e) => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value = ''; }} />
        </label>
      </div>
      {error && <div className="text-[11px] text-red-600 mb-2">{error}</div>}
      {docs && docs.length > 0 && (
        <div className="space-y-2">
          {docs.map((doc) => (
            <div key={doc.id || doc.storage_path} className="flex items-center justify-between gap-3 border border-gray-100 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <FileText size={14} className="text-slate-400 shrink-0" strokeWidth={1.75} />
                <span className="text-xs font-medium text-slate-900 truncate">{doc.label || doc.file_name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={() => handleView(doc)} className="text-[10px] uppercase tracking-wider text-slate-500 hover:text-slate-900 flex items-center gap-1">
                  <Eye size={11} /> View
                </button>
                <button onClick={() => handleDelete(doc)} className="text-slate-300 hover:text-red-600">
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DocCard({ icon, title, subtitle, uploaded_at, docType, uploadingDoc, handleUploadDoc, done }) {
  const isUploading = uploadingDoc === docType;
  return (
    <div className={`bg-white/70 backdrop-blur-md border rounded-xl p-5 shadow-sm flex items-center justify-between gap-4 transition-all
      ${done ? 'border-gray-100' : 'border-amber-200/80 bg-amber-50/30'}`}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 text-lg
          ${done ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
          {done ? '✅' : icon}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            {done && uploaded_at
              ? `On file · Uploaded ${new Date(uploaded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
              : subtitle}
          </div>
        </div>
      </div>
      <label className={`flex items-center gap-1.5 text-[11px] px-4 py-2 rounded-lg font-semibold cursor-pointer whitespace-nowrap shrink-0 border transition-all
        ${done
          ? 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-slate-900 hover:border-gray-300'
          : 'bg-slate-900 text-amber-400 border-transparent hover:bg-slate-800'}
        ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
        <Upload size={12} strokeWidth={2.5} />
        {isUploading ? 'Uploading…' : done ? 'Replace' : 'Upload'}
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden"
          onChange={e => { if (e.target.files[0]) handleUploadDoc(docType, e.target.files[0]); }} />
      </label>
    </div>
  );
}

export default function DocumentsTab({
  profile,
  clientMeta,
  clientDocs,
  uploadingDoc,
  handleUploadDoc,
  handleUploadOther,
  loadData,
  monitoringStep,
  setMonitoringStep,
  monitoringForm,
  setMonitoringForm,
  monitoringSaving,
  setMonitoringSaving,
  monitoringError,
  setMonitoringError,
}) {
  const allDocsDone = !!clientDocs.id && !!clientDocs.address && clientMeta?.lpoa_signed;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
      <div>
        <h2 className="text-xl font-bold text-slate-900">Documents & Setup</h2>
        <p className="text-sm text-gray-500 mt-1">Your identity documents, authorization, and credit monitoring setup.</p>
      </div>

      {/* Authorization status */}
      <div className={`rounded-xl p-4 flex items-center gap-3 border shadow-sm
        ${clientMeta?.lpoa_signed ? 'bg-green-50/60 border-green-200' : 'bg-amber-50/60 border-amber-200'}`}>
        <Shield size={18} className={clientMeta?.lpoa_signed ? 'text-green-600' : 'text-amber-600'} strokeWidth={1.75} />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900">Limited Power of Attorney</div>
          <div className="text-[11px] text-gray-500 mt-0.5">
            {clientMeta?.lpoa_signed
              ? `Signed and active${clientMeta.lpoa_signed_at ? ' · ' + new Date(clientMeta.lpoa_signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}`
              : 'Authorization not yet on file — contact Credit Comeback Club'}
          </div>
        </div>
        <span className={`text-[10px] px-2.5 py-1 rounded-full font-semibold border
          ${clientMeta?.lpoa_signed ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-700 border-amber-200'}`}>
          {clientMeta?.lpoa_signed ? '✓ Active' : 'Pending'}
        </span>
      </div>

      {/* Identity documents */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-gray-500 mb-3">Identity Documents</div>
        <div className="space-y-3">
          <DocCard
            icon="🪪"
            title="Government-Issued Photo ID"
            subtitle="Driver's license, passport, or state ID required"
            uploaded_at={clientDocs.id?.uploaded_at}
            docType="government_id"
            uploadingDoc={uploadingDoc}
            handleUploadDoc={handleUploadDoc}
            done={!!clientDocs.id}
          />
          <DocCard
            icon="🏠"
            title="Proof of Current Address"
            subtitle="Utility bill, bank statement, or lease — dated within 90 days"
            uploaded_at={clientDocs.address?.uploaded_at}
            docType="proof_of_address"
            uploadingDoc={uploadingDoc}
            handleUploadDoc={handleUploadDoc}
            done={!!clientDocs.address}
          />
        </div>
      </div>

      {/* Other documents */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-gray-500 mb-3">Other Documents</div>
        <OtherDocsCard
          docs={clientDocs.other || []}
          uploadingOther={uploadingDoc === 'other'}
          handleUploadOther={handleUploadOther}
          clientId={clientMeta?.id}
          ownerUserId={clientMeta?.user_id}
          onChanged={loadData}
        />
      </div>

      {/* Credit Monitoring */}
      <div>
        <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-gray-500 mb-3">Credit Monitoring</div>
        <div className="bg-white/70 backdrop-blur-md border border-gray-100 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-sm font-semibold text-slate-900">Credit Monitoring Account</div>
              <div className="text-[11px] text-gray-400 mt-0.5">Lets us track your score progress in real-time</div>
            </div>
            {clientMeta?.monitoring_enrolled
              ? <span className="text-[10px] px-2.5 py-1 rounded-full bg-green-50 text-green-700 border border-green-200 font-semibold">✓ Enrolled</span>
              : <span className="text-[10px] px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 font-semibold">Action Required</span>
            }
          </div>

          {monitoringStep === 'edit' ? (
            <div className="space-y-3">
              {[
                { key: 'service', label: 'Service' },
                { key: 'email', label: 'Login Email', placeholder: 'your@email.com' },
                { key: 'password', label: 'Password', placeholder: '••••••••', type: 'password' },
                { key: 'ssnLast4', label: 'SSN Last 4 Digits', placeholder: '1234' },
              ].map(({ key, label, placeholder, type }) => (
                <div key={key}>
                  <div className="text-[10px] uppercase tracking-[0.06em] text-gray-400 mb-1 font-semibold">{label}</div>
                  {key === 'service' ? (
                    <select
                      value={monitoringForm[key]}
                      onChange={e => setMonitoringForm(p => ({ ...p, [key]: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition-shadow bg-white"
                    >
                      <option value="">Select a provider...</option>
                      <option value="PrivacyGuard">PrivacyGuard</option>
                      <option value="MyScoreIQ">MyScoreIQ</option>
                      <option value="Smart Credit">Smart Credit</option>
                      <option value="IdentityIQ">IdentityIQ</option>
                      <option value="My Free Score Now">My Free Score Now</option>
                      <option value="MyFICO">MyFICO</option>
                    </select>
                  ) : (
                    <input type={type || 'text'} placeholder={placeholder}
                      value={monitoringForm[key]}
                      onChange={e => setMonitoringForm(p => ({ ...p, [key]: e.target.value }))}
                      className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-amber-400 focus:border-amber-400 outline-none transition-shadow" />
                  )}
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
                    'my free score': 'https://www.myfreescorenow.com',
                    'myfico': 'https://www.myfico.com',
                  };
                  const svcKey = (monitoringForm.service || '').toLowerCase();
                  const portalUrl = Object.entries(serviceUrls).find(([k]) => svcKey.includes(k))?.[1] || 'https://www.privacyguard.com';
                  try {
                    if (!clientMeta?.id) throw new Error('Could not identify client record.');
                    await supabase.from('clients').update({
                      monitoring_service: monitoringForm.service,
                      monitoring_email: monitoringForm.email,
                      monitoring_enrolled: true,
                      monitoring_portal_url: portalUrl,
                    }).eq('id', clientMeta.id);
                    const sensitive = {};
                    if (monitoringForm.password) sensitive.monitoringPassword = monitoringForm.password;
                    if (monitoringForm.ssnLast4) sensitive.ssnLast4 = monitoringForm.ssnLast4;
                    if (Object.keys(sensitive).length > 0) {
                      await writeClientSensitiveData(profile.full_name, sensitive, clientMeta.id);
                    }
                    setMonitoringStep('view');
                    loadData();
                  } catch (e) {
                    setMonitoringError('Your service/email were saved, but your password/SSN could not be saved securely. Please try again.');
                  } finally {
                    setMonitoringSaving(false);
                  }
                }} className="text-xs px-4 py-2 bg-slate-900 text-amber-400 rounded-lg hover:bg-slate-800 font-semibold transition-colors disabled:opacity-50">
                  {monitoringSaving ? 'Saving…' : 'Save Credentials'}
                </button>
                <button onClick={() => { setMonitoringStep('view'); setMonitoringError(''); }}
                  className="text-xs px-4 py-2 bg-white border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50 transition-colors font-medium">
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
              <p className="text-xs text-gray-500 mb-4 leading-relaxed">Sign up for credit monitoring so we can track your score progress throughout your campaign.</p>
              <div className="flex gap-2 flex-wrap mb-4">
                {[
                  ['PrivacyGuard', 'https://www.privacyguard.com'],
                  ['MyScoreIQ', 'https://www.myscoreiq.com'],
                  ['Smart Credit', 'https://www.smartcredit.com'],
                  ['IdentityIQ', 'https://www.identityiq.com'],
                  ['My Free Score Now', 'https://www.myfreescorenow.com'],
                  ['MyFICO', 'https://www.myfico.com'],
                ].map(([name, url]) => (
                  <a key={name} href={url} target="_blank" rel="noopener noreferrer"
                    className="text-[11px] px-3 py-1.5 border border-gray-200 rounded-md text-slate-900 font-medium hover:bg-gray-50 transition-colors">
                    {name} →
                  </a>
                ))}
              </div>
              <button onClick={() => setMonitoringStep('edit')}
                className="text-xs px-4 py-2 bg-slate-900 text-amber-400 rounded-lg font-semibold hover:bg-slate-800 transition-colors">
                Enter My Credentials
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
