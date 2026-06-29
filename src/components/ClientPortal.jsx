import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import { LogOut, FileText, Mail, CheckCircle, Clock, AlertCircle, Shield, TrendingUp, ExternalLink, ChevronRight, Star, Calendar } from 'lucide-react';

function ScoreMeter({ label, start, current }) {
  const score = current || start || null;
  const diff = (start && current && current !== start) ? current - start : null;
  const pct = score ? Math.min(100, Math.max(0, ((score - 300) / 550) * 100)) : 0;
  const startPct = start ? Math.min(100, Math.max(0, ((start - 300) / 550) * 100)) : 0;

  const getColor = (s) => {
    if (!s) return '#9CA3AF';
    if (s >= 750) return '#15803D';
    if (s >= 700) return '#16A34A';
    if (s >= 650) return '#D97706';
    if (s >= 600) return '#EA580C';
    return '#DC2626';
  };

  const getRating = (s) => {
    if (!s) return '';
    if (s >= 750) return 'Excellent';
    if (s >= 700) return 'Good';
    if (s >= 650) return 'Fair';
    if (s >= 600) return 'Poor';
    return 'Very Poor';
  };

  return (
    <div className="w-full" style={{ flex: 1, minWidth: 140 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#9CA3AF', fontWeight: 600 }}>{label}</span>
        {diff !== null && (
          <span style={{ fontSize: 11, fontWeight: 700, color: diff > 0 ? '#15803D' : diff < 0 ? '#DC2626' : '#6B7280', background: diff > 0 ? '#F0FDF4' : diff < 0 ? '#FEF2F2' : '#F9FAFB', padding: '1px 6px', borderRadius: 4 }}>
            {diff > 0 ? '▲ +' : diff < 0 ? '▼ ' : ''}{diff}
          </span>
        )}
      </div>

      <div style={{ position: 'relative', marginBottom: 8 }}>
        <div style={{ height: 8, background: '#F3F4F6', borderRadius: 8, position: 'relative' }}>
          <div style={{ position: 'absolute', inset: 0, borderRadius: 8, background: 'linear-gradient(90deg, #DC2626 0%, #EA580C 20%, #D97706 40%, #16A34A 65%, #15803D 100%)', opacity: 0.15 }} />
          {start && current && current !== start && (
            <div style={{ position: 'absolute', top: -2, width: 3, height: 12, background: '#9CA3AF', borderRadius: 2, left: startPct + '%', transform: 'translateX(-50%)' }} title={'Started: ' + start} />
          )}
          <div style={{ height: '100%', borderRadius: 8, transition: 'width 0.8s ease', background: getColor(score), width: pct + '%', position: 'relative' }}>
            <div style={{ position: 'absolute', right: -1, top: -3, width: 14, height: 14, borderRadius: '50%', background: getColor(score), border: '2px solid #fff', boxShadow: '0 1px 4px rgba(0,0,0,0.2)' }} />
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 9, color: '#D1D5DB' }}>300</span>
          <span style={{ fontSize: 9, color: '#D1D5DB' }}>850</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: getColor(score), lineHeight: 1 }}>{score || '—'}</span>
        <span style={{ fontSize: 11, color: getColor(score), fontWeight: 600 }}>{getRating(score)}</span>
      </div>
      {start && current && current !== start && (
        <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Started at {start}</div>
      )}
      {start && (!current || current === start) && (
        <div style={{ fontSize: 10, color: '#9CA3AF', marginTop: 2 }}>Enrollment score</div>
      )}
    </div>
  );
}

function TimelineEvent({ icon, title, subtitle, date, tone }) {
  const colors = {
    default: { bg: '#F9FAFB', border: '#E5E7EB' },
    green: { bg: '#F0FDF4', border: '#BBF7D0' },
    blue: { bg: '#EFF6FF', border: '#BFDBFE' },
    gold: { bg: '#FFFBEB', border: '#FDE68A' },
    red: { bg: '#FEF2F2', border: '#FECACA' },
  };
  const c = colors[tone] || colors.default;
  return (
    <div className="flex gap-3 items-start">
      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[13px]"
        style={{ backgroundColor: c.bg, border: '1px solid ' + c.border }}>
        {icon}
      </div>
      <div className="flex-1 min-w-0 pb-4 border-b border-border last:border-b-0">
        <div className="text-[13px] font-medium text-ink">{title}</div>
        {subtitle && <div className="text-[11px] text-ink-muted mt-0.5">{subtitle}</div>}
        {date && <div className="text-[10px] text-ink-faint mt-1">{new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</div>}
      </div>
    </div>
  );
}

export default function ClientPortal({ session, onSignOut }) {
  const [profile, setProfile] = useState(null);
  const [clientMeta, setClientMeta] = useState(null);
  const [letters, setLetters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [auditHistory, setAuditHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [uploadingLetter, setUploadingLetter] = useState(null);
  const [clientDocs, setClientDocs] = useState({ id: null, address: null });
  const [uploadingDoc, setUploadingDoc] = useState(null);
  const [monitoringForm, setMonitoringForm] = useState({ service: '', email: '', password: '', ssnLast4: '' });
  const [monitoringStep, setMonitoringStep] = useState('view'); // view | edit
  const [monitoringSaving, setMonitoringSaving] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(null);

  useEffect(() => { loadData(); }, [session]);

  const loadData = async () => {
    try {
      const { data: cp } = await supabase.from('client_profiles').select('*').eq('user_id', session.user.id).single();
      setProfile(cp);
      if (cp) {
        const [lettersRes, metaRes, auditsRes] = await Promise.all([
          supabase.from('letters').select('*').eq('client_name', cp.full_name).order('saved_at', { ascending: true }),
          supabase.from('clients').select('*').eq('name', cp.full_name).limit(1),
          supabase.from('audits').select('audit,saved_at').eq('client_name', cp.full_name).order('saved_at', { ascending: false }).limit(5),
        ]);
        setLetters(lettersRes.data || []);
        setClientMeta(metaRes.data && metaRes.data.length > 0 ? metaRes.data[0] : null);
        setAuditHistory(auditsRes.data || []);
      }
      // Load client documents from documents table
      const { data: docRows, error: docErr } = await supabase.from('documents').select('doc_type,file_name').eq('client_name', cp.full_name);
      console.log('Doc query — name:', cp.full_name, 'rows:', docRows, 'error:', docErr);
      if (docRows) {
        setClientDocs({
          id: docRows.find(d => d.doc_type === 'id') || null,
          address: docRows.find(d => d.doc_type === 'address') || null,
        });
      }
    } catch (e) { console.error('Portal load error:', e); }
    finally { setLoading(false); }
  };

  const handleUploadDoc = async (docType, file) => {
    setUploadingDoc(docType);
    try {
      const ext = file.name.split('.').pop();
      const path = session.user.id + '/' + docType + '_' + Date.now() + '.' + ext;
      await supabase.storage.from('client-docs').upload(path, file, { upsert: true });
      // Also write to documents table so admin side can see it
      await supabase.from('documents').upsert({
        client_name: profile.full_name,
        doc_type: docType === 'government_id' ? 'id' : 'address',
        file_name: file.name,
        storage_path: path,
        uploaded_at: new Date().toISOString(),
      }, { onConflict: 'client_name,doc_type' });
      setClientDocs(prev => ({ ...prev, [docType === 'government_id' ? 'id' : 'address']: { name: path } }));
    } catch(e) { console.error('Doc upload error:', e); }
    setUploadingDoc(null);
  };

  const handleUploadResponse = async (letter, file) => {
    if (!file) return;
    setUploadingLetter(letter.id);
    try {
      const ext = file.name.split('.').pop() || 'pdf';
      const path = session.user.id + '/' + letter.id + '/response_' + Date.now() + '.' + ext;
      const { error: uploadErr } = await supabase.storage.from('responses').upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;

      // Notify Chris
      await fetch('/.netlify/functions/send-lpoa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'client_response_uploaded',
          clientName: profile.full_name,
          furnisher: letter.furnisher,
          phase: letter.phase,
          storagePath: path,
        }),
      });

      setUploadSuccess(letter.id);
      setTimeout(() => setUploadSuccess(null), 4000);
    } catch (e) {
      console.error('Upload error:', e);
      alert('Upload failed: ' + (e.message || e));
    } finally {
      setUploadingLetter(null);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: '#F8F9FA' }}>
      <div className="text-[13px] text-gray-400">Loading your portal…</div>
    </div>
  );

  const mailed = letters.filter(l => l.mailed_date);
  const delivered = letters.filter(l => l.tracking_status === 'Delivered');
  const responded = letters.filter(l => l.response_outcome);
  const deletions = letters.filter(l => l.response_outcome === 'deleted');
  const isVip = clientMeta && clientMeta.is_vip;
  const firstName = (profile && profile.full_name || '').split(' ')[0] || 'there';

  // Most recent audit's scores, pulled from the jsonb audit blob
  const latestScores = (auditHistory.length > 0 && auditHistory[0].audit && auditHistory[0].audit.scores) || null;

  const timeline = [];
  letters.forEach(l => {
    if (l.saved_at) timeline.push({ date: l.saved_at, icon: '📄', title: 'Dispute letter prepared — ' + l.furnisher, subtitle: l.phase, tone: 'blue' });
    if (l.mailed_date) timeline.push({ date: l.mailed_date, icon: '✉️', title: 'Letter mailed via certified mail — ' + l.furnisher, subtitle: l.tracking_number ? 'USPS #' + l.tracking_number.slice(-8) : null, tone: 'default' });
    if (l.tracking_status === 'Delivered') timeline.push({ date: l.delivered_at || l.mailed_date, icon: '✅', title: 'Delivered — ' + l.furnisher, subtitle: '30-day response window started', tone: 'green' });
    if (l.response_outcome === 'received') timeline.push({ date: l.response_date, icon: '📬', title: 'Response received — ' + l.furnisher, tone: 'gold' });
    if (l.response_outcome === 'no_response') timeline.push({ date: l.response_date || l.mailed_date, icon: '⚠️', title: 'No response — Phase 3 escalation triggered', subtitle: l.furnisher, tone: 'red' });
    if (l.response_outcome === 'deleted') timeline.push({ date: l.response_date, icon: '🏆', title: 'DELETED — ' + l.furnisher, subtitle: 'Account removed from your credit report', tone: 'green' });
  });
  timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

  const tabs = ['overview', 'disputes', 'timeline', ...(isVip ? ['vip'] : [])];

  return (
    <div className="min-h-screen" style={{ background: '#F8F9FA' }}>
      <div style={{ background: '#1B2A4A' }} className="px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="https://files.manuscdn.com/user_upload_by_module/session_file/104892940/PtGXuDEKgTJkOdRf.jpg" alt="Credit Comeback Club"
              style={{ height: 48, width: 48, borderRadius: 8, objectFit: 'cover', border: '2px solid #C9A84C' }} />
            <div>
              <div style={{ color: '#C9A84C', fontWeight: 700, fontSize: 14 }}>Credit Comeback Club</div>
              <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Client Portal {isVip ? '· ⭐ VIP Member' : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <span className="hidden sm:inline" style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{profile && profile.full_name}</span>
            <button onClick={onSignOut} className="flex items-center gap-1 hover:opacity-100 transition-opacity"
              style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <LogOut size={14} strokeWidth={1.75} /> <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </div>

      <div style={{ background: '#fff', borderBottom: '1px solid #E5E7EB' }}>
        <div className="max-w-3xl mx-auto px-6 flex">
          {tabs.map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className="px-4 py-3 text-[12px] uppercase tracking-wider transition-colors"
              style={{
                color: activeTab === tab ? '#1B2A4A' : '#9CA3AF',
                borderBottom: activeTab === tab ? '2px solid #C9A84C' : '2px solid transparent',
                fontWeight: activeTab === tab ? 600 : 400,
              }}>
              {tab === 'vip' ? '⭐ VIP' : tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">

        {activeTab === 'overview' && (
          <>
            {/* Campaign Setup Checklist */}
            {(() => {
              const checks = [
                { key: 'lpoa', label: 'Authorization Signed (LPOA)', done: clientMeta && clientMeta.lpoa_signed, action: null },
                { key: 'id', label: 'Government-Issued Photo ID', done: !!clientDocs.id, docType: 'government_id' },
                { key: 'address', label: 'Proof of Current Address', done: !!clientDocs.address, docType: 'proof_of_address' },
                { key: 'monitoring', label: 'Credit Monitoring (Recommended)', done: (clientMeta && clientMeta.monitoring_enrolled) || (clientMeta && clientMeta.monitoring_not_required), docType: null },
              ];
              const allDone = checks.every(c => c.done);
              if (allDone) return null;
              return (
                <div style={{ background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, padding: 16, marginBottom: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#92400E', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.06em' }}>⚡ Action Required — Complete Your Setup</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {checks.map(({ key, label, done, docType }) => (
                      <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 14 }}>{done ? '✅' : '⭕'}</span>
                          <span style={{ fontSize: 12, color: done ? '#6B7280' : '#1B2A4A', fontWeight: done ? 400 : 600, textDecoration: done ? 'line-through' : 'none' }}>{label}</span>
                        </div>
                        {!done && docType && (
                          <label style={{ fontSize: 11, padding: '4px 12px', background: '#1B2A4A', color: '#C9A84C', borderRadius: 4, fontWeight: 600, cursor: uploadingDoc === docType ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {uploadingDoc === docType ? 'Uploading…' : 'Upload →'}
                            <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }}
                              onChange={e => { if (e.target.files[0]) handleUploadDoc(docType, e.target.files[0]); }} />
                          </label>
                        )}
                        {!done && !docType && key === 'monitoring' && (
                          <button onClick={() => setMonitoringStep('edit')} style={{ fontSize: 11, padding: '4px 12px', background: '#1B2A4A', color: '#C9A84C', border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                            Set Up →
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div>
              <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1B2A4A' }}>Welcome back, {firstName}.</h1>
              <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>Here's your credit restoration campaign at a glance.</p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Letters Sent', value: mailed.length, icon: '✉️' },
                { label: 'Delivered', value: delivered.length, icon: '✅' },
                { label: 'Responses', value: responded.length, icon: '📬' },
                { label: 'Deletions', value: deletions.length, icon: '🏆' },
              ].map(({ label, value, icon }) => (
                <div key={label} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 16 }}>
                  <div style={{ fontSize: 20, marginBottom: 4 }}>{icon}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: '#1B2A4A' }}>{value}</div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9CA3AF', marginTop: 2 }}>{label}</div>
                </div>
              ))}
            </div>

            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ background: '#1B2A4A', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingUp size={14} style={{ color: '#C9A84C' }} strokeWidth={2} />
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#C9A84C' }}>Credit Score Tracker</span>
              </div>
              <div style={{ padding: 20 }}>
                {clientMeta && (clientMeta.score_eq_start || clientMeta.score_exp_start || clientMeta.score_tu_start) ? (
                  <>
                    <div className="flex flex-col sm:flex-row" style={{ gap: 24 }}>
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
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #F3F4F6', fontSize: 11, color: '#9CA3AF' }}>
                        Last updated: {new Date(auditHistory[0].saved_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {auditHistory.length > 1 && ' · ' + auditHistory.length + ' audits on file'}
                      </div>
                    )}
                  </>
                ) : (
                  <div style={{ textAlign: 'center', padding: '20px 0' }}>
                    <TrendingUp size={24} style={{ color: '#E5E7EB', margin: '0 auto 8px' }} strokeWidth={1.5} />
                    <p style={{ fontSize: 12, color: '#9CA3AF' }}>Score tracking will appear here once your audit is complete.</p>
                  </div>
                )}
              </div>
            </div>

            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <Shield size={15} style={{ color: '#15803D' }} strokeWidth={1.75} />
              <div className="flex-1">
                <div style={{ fontSize: 12, fontWeight: 600, color: '#1B2A4A' }}>Authorization Active</div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>Credit Comeback Club is authorized to dispute on your behalf{profile && profile.agreement_signed_at ? ' since ' + new Date(profile.agreement_signed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}</div>
              </div>
              <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Active</span>
            </div>

            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 20 }}>
              <div className="flex items-center justify-between mb-3">
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1B2A4A' }}>Credit Monitoring</span>
                {clientMeta && clientMeta.monitoring_enrolled
                  ? <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' }}>✓ Enrolled</span>
                  : <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A' }}>Action Required</span>
                }
              </div>
              {monitoringStep === 'edit' ? (
                <div>
                  {[
                    { key: 'service', label: 'Service', placeholder: 'e.g. PrivacyGuard, MyScoreIQ' },
                    { key: 'email', label: 'Login Email', placeholder: 'your@email.com' },
                    { key: 'password', label: 'Password', placeholder: '••••••••', type: 'password' },
                    { key: 'ssnLast4', label: 'SSN Last 4 Digits', placeholder: '1234' },
                  ].map(({ key, label, placeholder, type }) => (
                    <div key={key} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9CA3AF', marginBottom: 4 }}>{label}</div>
                      <input type={type || 'text'} placeholder={placeholder}
                        value={monitoringForm[key]}
                        onChange={e => setMonitoringForm(p => ({ ...p, [key]: e.target.value }))}
                        style={{ width: '100%', border: '1px solid #E5E7EB', borderRadius: 4, padding: '7px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box' }} />
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button disabled={monitoringSaving} onClick={async () => {
                      setMonitoringSaving(true);
                      const serviceUrls = {
                        'privacyguard': 'https://www.privacyguard.com',
                        'myscoreiq': 'https://www.myscoreiq.com',
                        'smart credit': 'https://www.smartcredit.com',
                        'experian': 'https://www.experian.com',
                        'identityiq': 'https://www.identityiq.com',
                      };
                      const svcKey = (monitoringForm.service || '').toLowerCase();
                      const portalUrl = Object.entries(serviceUrls).find(([k]) => svcKey.includes(k))?.[1] || 'https://www.privacyguard.com';
                      await supabase.from('clients').update({
                        monitoring_service: monitoringForm.service,
                        monitoring_email: monitoringForm.email,
                        monitoring_password: monitoringForm.password,
                        monitoring_enrolled: true,
                        monitoring_portal_url: portalUrl,
                        ...(monitoringForm.ssnLast4 ? { ssn_last4: monitoringForm.ssnLast4 } : {}),
                      }).eq('name', profile.full_name);
                      setMonitoringStep('view');
                      setMonitoringSaving(false);
                      loadData();
                    }} style={{ fontSize: 12, padding: '7px 16px', background: '#1B2A4A', color: '#C9A84C', border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>
                      {monitoringSaving ? 'Saving…' : 'Save Credentials'}
                    </button>
                    <button onClick={() => setMonitoringStep('view')} style={{ fontSize: 12, padding: '7px 12px', background: 'none', border: '1px solid #E5E7EB', borderRadius: 4, cursor: 'pointer', color: '#6B7280' }}>Cancel</button>
                  </div>
                </div>
              ) : clientMeta && clientMeta.monitoring_enrolled ? (
                <div>
                  <a href={(clientMeta && clientMeta.monitoring_portal_url) || 'https://www.privacyguard.com'} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[12px] font-medium" style={{ color: '#1B2A4A' }}>
                    <ExternalLink size={12} strokeWidth={2} />
                    Access {(clientMeta && clientMeta.monitoring_service) || 'Privacy Guard'} →
                  </a>
                  <button onClick={() => { setMonitoringForm({ service: clientMeta.monitoring_service || '', email: clientMeta.monitoring_email || '', password: '', ssnLast4: '' }); setMonitoringStep('edit'); }}
                    style={{ marginTop: 8, fontSize: 11, color: '#9CA3AF', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    Update credentials
                  </button>
                </div>
              ) : (
                <div>
                  <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 10 }}>Credit monitoring lets us track your score progress. Enter your credentials below or sign up for a service.</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    {[['PrivacyGuard', 'https://www.privacyguard.com'], ['MyScoreIQ', 'https://www.myscoreiq.com'], ['Smart Credit', 'https://www.smartcredit.com'], ['IdentityIQ', 'https://www.identityiq.com']].map(([name, url]) => (
                      <a key={name} href={url} target="_blank" rel="noopener noreferrer"
                        style={{ fontSize: 11, padding: '4px 10px', border: '1px solid #E5E7EB', borderRadius: 4, color: '#1B2A4A', textDecoration: 'none', fontWeight: 500 }}>
                        {name} →
                      </a>
                    ))}
                  </div>
                  <button onClick={() => setMonitoringStep('edit')}
                    style={{ fontSize: 12, padding: '7px 16px', background: '#1B2A4A', color: '#C9A84C', border: 'none', borderRadius: 4, fontWeight: 600, cursor: 'pointer' }}>
                    Enter My Credentials
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === 'disputes' && (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B2A4A' }}>Your Dispute Letters</h2>
            {letters.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 40, textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: '#9CA3AF' }}>No dispute letters yet. Your campaign will begin shortly.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {letters.map(l => (
                  <div key={l.id} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 16 }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: '#1B2A4A' }}>{l.furnisher}</div>
                        <div style={{ fontSize: 11, color: '#6B7280', marginTop: 2 }}>{l.phase}{l.type ? ' · Type ' + l.type : ''}</div>
                      </div>
                      <span style={{ fontSize: 10, padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap', textTransform: 'uppercase', letterSpacing: '0.05em',
                        ...(l.response_outcome === 'deleted' ? { background: '#F0FDF4', color: '#15803D', border: '1px solid #BBF7D0' }
                          : l.tracking_status === 'Delivered' ? { background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }
                          : l.mailed_date ? { background: '#FFFBEB', color: '#D97706', border: '1px solid #FDE68A' }
                          : { background: '#F9FAFB', color: '#9CA3AF', border: '1px solid #E5E7EB' })
                      }}>
                        {l.response_outcome === 'deleted' ? '🏆 Deleted' : l.response_outcome === 'received' ? 'Response Received' : l.tracking_status === 'Delivered' ? 'Delivered' : l.mailed_date ? 'In Transit' : 'Pending'}
                      </span>
                    </div>
                    {l.summary && (
                      <div style={{ fontSize: 12, color: '#4B5563', marginTop: 10, paddingTop: 10, borderTop: '1px solid #F3F4F6', lineHeight: 1.5 }}>
                        {l.summary}
                      </div>
                    )}
                    {l.mailed_date && (
                      <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 8 }}>
                        Mailed {new Date(l.mailed_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        {l.tracking_number && (
                          <a href={'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + l.tracking_number} target="_blank" rel="noopener noreferrer"
                            style={{ marginLeft: 8, color: '#1B2A4A', fontWeight: 500 }}>Track →</a>
                        )}
                      </div>
                    )}
                    {l.tracking_status === 'Delivered' && !l.response_outcome && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #F3F4F6' }}>
                        {uploadSuccess === l.id ? (
                          <div style={{ fontSize: 12, color: '#15803D', fontWeight: 600 }}>✓ Response uploaded — Credit Comeback Club has been notified.</div>
                        ) : (
                          <div>
                            <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 8 }}>
                              Did you receive a response from {l.furnisher} in the mail? Upload it here and we'll take it from there.
                            </p>
                            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '7px 14px', background: '#1B2A4A', color: '#C9A84C', borderRadius: 4, fontWeight: 600, cursor: uploadingLetter === l.id ? 'not-allowed' : 'pointer', opacity: uploadingLetter === l.id ? 0.6 : 1 }}>
                              {uploadingLetter === l.id ? 'Uploading…' : '📎 Upload Response'}
                              <input type="file" accept=".pdf,image/*" style={{ display: 'none' }}
                                onChange={e => { if (e.target.files[0]) handleUploadResponse(l, e.target.files[0]); }}
                                disabled={uploadingLetter === l.id} />
                            </label>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {activeTab === 'timeline' && (
          <>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1B2A4A' }}>Dispute Journal</h2>
            <p style={{ fontSize: 12, color: '#6B7280', marginTop: -8 }}>A chronological record of every action in your campaign.</p>
            {timeline.length === 0 ? (
              <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 40, textAlign: 'center' }}>
                <p style={{ fontSize: 13, color: '#9CA3AF' }}>Your timeline will populate as your campaign progresses.</p>
              </div>
            ) : (
              <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 20 }}>
                {timeline.map((event, i) => <TimelineEvent key={i} {...event} />)}
              </div>
            )}
          </>
        )}

        {activeTab === 'vip' && isVip && (
          <>
            <div style={{ background: 'linear-gradient(135deg, #1B2A4A 0%, #2A3C5F 100%)', borderRadius: 12, padding: 24 }}>
              <div className="flex items-center gap-2 mb-2">
                <Star size={15} style={{ color: '#C9A84C' }} strokeWidth={2} />
                <span style={{ color: '#C9A84C', fontWeight: 700, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.08em' }}>VIP Member</span>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Your VIP Benefits</h2>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Priority service, monthly strategy calls, and exclusive business credit resources.</p>
            </div>

            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 20 }}>
              <div className="flex items-center gap-2 mb-3">
                <Calendar size={14} style={{ color: '#C9A84C' }} strokeWidth={2} />
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1B2A4A' }}>Monthly Strategy Call</span>
              </div>
              <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>Book your 15-minute strategy call with Christopher Holland. Review your campaign, discuss next steps, and map your path to business credit.</p>
              <a href="https://calendly.com" target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 20px', background: '#1B2A4A', color: '#C9A84C', borderRadius: 4, fontWeight: 700, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <Calendar size={13} strokeWidth={2} />
                Book Your Call →
              </a>
            </div>

            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 8, padding: 20 }}>
              <div className="flex items-center gap-2 mb-3">
                <TrendingUp size={14} style={{ color: '#C9A84C' }} strokeWidth={2} />
                <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#1B2A4A' }}>Business Credit & Funding</span>
              </div>
              <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>Once your personal credit is positioned, the next step is business credit and funding. Our partner Swiftedly specializes in business funding for entrepreneurs.</p>
              <p style={{ fontSize: 12, color: '#6B7280', marginBottom: 12 }}>Business credit is completely separate from personal credit — you can start building it now.</p>
              <a href="https://swiftedly.com" target="_blank" rel="noopener noreferrer"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '8px 20px', background: '#C9A84C', color: '#1B2A4A', borderRadius: 4, fontWeight: 700, textDecoration: 'none', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <ExternalLink size={13} strokeWidth={2} />
                Explore Business Funding →
              </a>
            </div>
          </>
        )}

        <div style={{ textAlign: 'center', fontSize: 11, color: '#D1D5DB', paddingBottom: 32 }}>
          Credit Comeback Club · Grand Junction, CO · creditcomebackclub.com · 970-644-0063
        </div>
      </div>
    </div>
  );
}
