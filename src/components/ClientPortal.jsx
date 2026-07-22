import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import { inferMediaType, isAnalyzable, transcodeImageToJpeg, uploadResponseBatch, validateBatch, RESPONSE_ACCEPT } from '../utils/responseFiles';
import { LogOut } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';
import { getSettings } from '../utils/settings';

import OverviewTab from './client-portal/OverviewTab';
import DisputesTab from './client-portal/DisputesTab';
import TimelineTab from './client-portal/TimelineTab';
import DocumentsTab from './client-portal/DocumentsTab';
import VipTab from './client-portal/VipTab';
import ConciergeChat from './client-portal/ConciergeChat';

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
  const [settings, setSettings] = useState(null);
  
  const [monitoringForm, setMonitoringForm] = useState({ service: '', email: '', password: '', ssnLast4: '' });
  const [monitoringStep, setMonitoringStep] = useState('view'); // view | edit
  const [monitoringSaving, setMonitoringSaving] = useState(false);
  const [monitoringError, setMonitoringError] = useState('');
  
  const [uploadSuccess, setUploadSuccess] = useState(null);
  const [stagedFiles, setStagedFiles] = useState({});
  const [stageError, setStageError] = useState({});
  const [submitError, setSubmitError] = useState({});
  const [manualUploadUnlocked, setManualUploadUnlocked] = useState({});

  useEffect(() => { loadData(); }, [session]);

  const loadData = async () => {
    try {
      const s = await getSettings();
      setSettings(s);

      const { data: cpRows } = await supabase.from('client_profiles').select('*').eq('user_id', session.user.id).limit(1);
      let cp = cpRows && cpRows.length > 0 ? cpRows[0] : null;
      if (!cp) {
        const email = (session.user.email || '').toLowerCase();
        const { data: byEmail } = await supabase.from('client_profiles').select('*').eq('email', email).limit(1);
        cp = byEmail && byEmail.length > 0 ? byEmail[0] : null;
        if (cp && !cp.user_id) {
          const { error: linkErr } = await supabase.from('client_profiles').update({ user_id: session.user.id }).eq('email', email);
          if (linkErr) console.warn('Could not link client user_id:', linkErr);
        }
      }
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

        const { data: docRows } = await supabase.from('documents').select('doc_type,file_name,uploaded_at').eq('client_name', cp.full_name);
        if (docRows) {
          setClientDocs({
            id: docRows.find(d => d.doc_type === 'id') || null,
            address: docRows.find(d => d.doc_type === 'address') || null,
          });
        }
      }
    } catch (e) {
      console.error('Portal load error:', e);
      toast.error('Failed to load portal data');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadDoc = async (docType, file) => {
    setUploadingDoc(docType);
    const toastId = toast.loading('Uploading document...');
    try {
      const ext = file.name.split('.').pop();
      const adminUserId = clientMeta?.user_id;
      if (!adminUserId) throw new Error('Could not identify firm admin user id.');
      const slug = String(profile.full_name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const internalDocType = docType === 'government_id' ? 'id' : 'address';
      const path = adminUserId + '/' + slug + '/' + internalDocType + '.' + ext;

      await supabase.storage.from('documents').upload(path, file, { upsert: true });
      await supabase.from('documents').upsert({
        user_id: adminUserId,
        client_name: profile.full_name,
        doc_type: internalDocType,
        file_name: file.name,
        storage_path: path,
        uploaded_at: new Date().toISOString(),
      }, { onConflict: 'user_id,client_name,doc_type' });
      setClientDocs(prev => ({ ...prev, [internalDocType]: { name: path } }));
      toast.success('Document uploaded successfully!', { id: toastId });
    } catch(e) {
      console.error('Doc upload error:', e);
      toast.error('Upload failed. Please try again.', { id: toastId });
    }
    setUploadingDoc(null);
  };

  const handleStageFiles = async (letter, fileList) => {
    const picked = Array.from(fileList || []).filter(Boolean);
    if (!picked.length) return;
    const resolved = [];
    const toastId = toast.loading('Processing files...');
    for (let file of picked) {
      if (!isAnalyzable(inferMediaType(file.name, file.type))) {
        const transcoded = await transcodeImageToJpeg(file);
        if (!transcoded) {
          setStageError(prev => ({ ...prev, [letter.id]: 'That file format isn’t supported. Please upload a PDF or a JPG/PNG photo — on iPhone, choose "Most Compatible" camera format or take a screenshot of the letter.' }));
          toast.error('Unsupported file format', { id: toastId });
          continue;
        }
        file = transcoded;
      }
      resolved.push(file);
    }
    if (!resolved.length) {
      toast.dismiss(toastId);
      return;
    }
    setStagedFiles(prev => {
      const combined = [...(prev[letter.id] || []), ...resolved];
      const batchErr = validateBatch(combined);
      if (batchErr) {
        setStageError(e => ({ ...e, [letter.id]: batchErr }));
        toast.error('Error adding files', { id: toastId });
        return prev;
      }
      setStageError(e => ({ ...e, [letter.id]: null }));
      toast.success('File(s) added successfully', { id: toastId });
      return { ...prev, [letter.id]: combined };
    });
  };

  const handleRemoveStaged = (letterId, idx) => {
    setStagedFiles(prev => ({ ...prev, [letterId]: (prev[letterId] || []).filter((_, i) => i !== idx) }));
  };

  const handleSubmitResponse = async (letter) => {
    const files = stagedFiles[letter.id] || [];
    if (!files.length) return;
    setUploadingLetter(letter.id);
    setSubmitError(prev => ({ ...prev, [letter.id]: null }));
    const toastId = toast.loading('Submitting response...');
    try {
      const basePath = session.user.id + '/' + letter.id;
      const paths = await uploadResponseBatch(supabase, basePath, files);

      // Get the public URL of the first uploaded page so the portal can display it
      const { data: urlData } = supabase.storage.from('client-docs').getPublicUrl(paths[0]);
      const responseFileUrl = urlData?.publicUrl || null;

      // Save the URL and mark the letter as responded
      await supabase.from('letters').update({
        response_outcome: 'received',
        response_date: new Date().toISOString().slice(0, 10),
        ...(responseFileUrl ? { response_file_url: responseFileUrl } : {}),
      }).eq('id', letter.id);

      if (settings?.notifications?.emailClientUploads !== false) {
        await fetch('/.netlify/functions/send-lpoa', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          body: JSON.stringify({
            action: 'client_response_uploaded',
            clientName: profile.full_name,
            furnisher: letter.furnisher,
            phase: letter.phase,
            storagePath: paths[0],
            pageCount: paths.length,
          }),
        });
      }

      setStagedFiles(prev => ({ ...prev, [letter.id]: [] }));
      setUploadSuccess(letter.id);
      toast.success('Response submitted to Credit Comeback Club!', { id: toastId });
      setTimeout(() => setUploadSuccess(null), 4000);
      loadData();
    } catch (e) {
      console.error('Upload error:', e);
      setSubmitError(prev => ({ ...prev, [letter.id]: 'Upload failed: ' + (e.message || e) }));
      toast.error('Upload failed. Please try again.', { id: toastId });
    } finally {
      setUploadingLetter(null);
    }
  };

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-12 h-12 border-4 border-amber-400 border-t-transparent rounded-full animate-spin"></div>
    </div>
  );

  if (!profile) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="text-center max-w-sm bg-white p-8 rounded-2xl shadow-sm border border-gray-100">
        <div className="w-12 h-12 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4 text-xl">!</div>
        <h2 className="text-lg font-bold text-slate-900 mb-2">We couldn't load your portal</h2>
        <p className="text-sm text-gray-500 mb-6 leading-relaxed">Your account may still be setting up. Please try again, or contact us if this keeps happening.</p>
        <div className="flex flex-col gap-3">
          <button onClick={() => window.location.reload()} className="w-full py-2.5 bg-slate-900 text-amber-400 font-bold uppercase tracking-wider rounded-lg hover:bg-slate-800 transition-colors">
            Retry
          </button>
          <button onClick={onSignOut} className="w-full py-2.5 bg-white border border-gray-200 text-gray-500 font-semibold rounded-lg hover:bg-gray-50 transition-colors">
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );

  const mailed = letters.filter(l => l.mailed_date);
  const delivered = letters.filter(l => l.tracking_status === 'Delivered');
  const responded = letters.filter(l => l.response_outcome);
  const deletions = letters.filter(l => l.response_outcome === 'deleted');
  const isVip = clientMeta && clientMeta.is_vip;
  const firstName = (profile && profile.full_name || '').split(' ')[0] || 'there';

  const latestScores = (auditHistory.length > 0 && auditHistory[0].audit && auditHistory[0].audit.scores) || null;

  const timeline = [];
  letters.forEach(l => {
    if (l.saved_at) timeline.push({ date: l.saved_at, icon: '📄', title: 'Dispute letter prepared — ' + l.furnisher, subtitle: l.phase, tone: 'blue' });
    if (l.mailed_date) timeline.push({ date: l.mailed_date, icon: '✉️', title: 'Letter mailed via certified mail — ' + l.furnisher, subtitle: l.tracking_number ? 'USPS #' + l.tracking_number.slice(-8) : null, tone: 'default' });

    // Granular in-transit milestones from Lob webhook
    if (l.tracking_status === 'In Transit' && l.mailed_date)
      timeline.push({ date: l.mailed_date, icon: '🚚', title: 'In Transit — ' + l.furnisher, subtitle: l.tracking_number ? 'USPS #' + l.tracking_number.slice(-8) : null, tone: 'default' });
    if (l.tracking_status === 'Out for Delivery' && l.mailed_date)
      timeline.push({ date: l.mailed_date, icon: '📬', title: 'Out for Delivery — ' + l.furnisher, subtitle: 'Expected delivery today', tone: 'gold' });

    if (l.tracking_status === 'Delivered') timeline.push({ date: l.delivered_at || l.mailed_date, icon: '✅', title: 'Delivered — ' + l.furnisher, subtitle: '30-day response window started', tone: 'green', lobId: l.lob_id, trackingNumber: l.tracking_number });
    if (l.tracking_status === 'Returned to Sender') timeline.push({ date: l.delivered_at || l.mailed_date, icon: '↩️', title: 'Returned to Sender — ' + l.furnisher, subtitle: 'Letter returned — address may need to be verified', tone: 'red' });
    if (l.tracking_status === 'Available for Pickup') timeline.push({ date: l.delivered_at || l.mailed_date, icon: '🏢', title: 'Available for Pickup — ' + l.furnisher, subtitle: 'Awaiting pickup at post office', tone: 'gold' });

    if (l.response_outcome === 'received') timeline.push({ date: l.response_date, icon: '📬', title: 'Response received — ' + l.furnisher, tone: 'gold', responseUrl: l.response_file_url || null });
    if (l.response_outcome === 'no_response') timeline.push({ date: l.response_date || l.mailed_date, icon: '⚠️', title: 'No response — Phase 3 escalation triggered', subtitle: l.furnisher, tone: 'red' });
    if (l.response_outcome === 'deleted') timeline.push({ date: l.response_date, icon: '🏆', title: 'DELETED — ' + l.furnisher, subtitle: 'Account removed from your credit report', tone: 'green', responseUrl: l.response_file_url || null });
  });

  if (clientMeta?.created_at) timeline.push({ date: clientMeta.created_at, icon: '👋', title: 'Enrolled in Credit Comeback Club', tone: 'blue' });
  if (clientMeta?.lpoa_signed_at) timeline.push({ date: clientMeta.lpoa_signed_at, icon: '✍️', title: 'Authorization Signed (LPOA)', tone: 'green' });
  if (clientDocs?.id?.uploaded_at) timeline.push({ date: clientDocs.id.uploaded_at, icon: '🪪', title: 'ID Uploaded', tone: 'default' });
  if (clientDocs?.address?.uploaded_at) timeline.push({ date: clientDocs.address.uploaded_at, icon: '🏠', title: 'Utility Bill Uploaded', tone: 'default' });

  timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

  const docsComplete = !!clientDocs.id && !!clientDocs.address && clientMeta?.lpoa_signed && (clientMeta?.monitoring_enrolled || clientMeta?.monitoring_not_required);

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'disputes', label: 'Disputes' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'documents', label: docsComplete ? '📁 Documents' : '📁 Documents ⚡' },
    ...(isVip ? [{ id: 'vip', label: '⭐ VIP' }] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50/50 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
      <Toaster position="top-center" toastOptions={{ style: { fontSize: '13px', fontWeight: '500' } }} />
      
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <img src="https://files.manuscdn.com/user_upload_by_module/session_file/104892940/PtGXuDEKgTJkOdRf.jpg" alt="Credit Comeback Club"
              className="w-12 h-12 rounded-xl object-cover border-2 border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.3)]" />
            <div>
              <div className="text-amber-400 font-bold text-[15px] tracking-wide">Credit Comeback Club</div>
              <div className="text-white/50 text-[10px] uppercase tracking-[0.1em] font-medium mt-0.5">
                Client Portal {isVip ? '· ⭐ VIP' : ''}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline text-white/70 text-xs font-medium">{profile && profile.full_name}</span>
            <button onClick={onSignOut} className="flex items-center gap-1.5 text-white/40 hover:text-white transition-colors text-xs uppercase tracking-wider font-semibold bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg">
              <LogOut size={14} strokeWidth={2} /> <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="bg-white/70 backdrop-blur-md border-b border-gray-200 sticky top-[80px] z-30">
        <div className="max-w-4xl mx-auto px-6 flex gap-2">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`relative px-4 py-3.5 text-xs uppercase tracking-wider font-bold transition-colors ${activeTab === tab.id ? 'text-slate-900' : 'text-gray-400 hover:text-gray-700'}`}>
              {tab.label}
              {activeTab === tab.id && (
                <motion.div layoutId="activeTabIndicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-6 py-8">
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {activeTab === 'overview' && (
              <OverviewTab
                profile={profile}
                clientMeta={clientMeta}
                firstName={firstName}
                mailed={mailed}
                delivered={delivered}
                responded={responded}
                deletions={deletions}
                totalDisputes={letters.length}
                latestScores={latestScores}
                auditHistory={auditHistory}
              />
            )}

            {activeTab === 'documents' && (
              <DocumentsTab
                profile={profile}
                clientMeta={clientMeta}
                clientDocs={clientDocs}
                uploadingDoc={uploadingDoc}
                handleUploadDoc={handleUploadDoc}
                monitoringStep={monitoringStep}
                setMonitoringStep={setMonitoringStep}
                monitoringForm={monitoringForm}
                setMonitoringForm={setMonitoringForm}
                monitoringSaving={monitoringSaving}
                setMonitoringSaving={setMonitoringSaving}
                monitoringError={monitoringError}
                setMonitoringError={setMonitoringError}
                loadData={loadData}
              />
            )}
            
            {activeTab === 'disputes' && (
              <DisputesTab 
                letters={letters}
                manualUploadUnlocked={manualUploadUnlocked}
                setManualUploadUnlocked={setManualUploadUnlocked}
                uploadSuccess={uploadSuccess}
                stagedFiles={stagedFiles}
                handleRemoveStaged={handleRemoveStaged}
                uploadingLetter={uploadingLetter}
                stageError={stageError}
                submitError={submitError}
                handleStageFiles={handleStageFiles}
                handleSubmitResponse={handleSubmitResponse}
                RESPONSE_ACCEPT={RESPONSE_ACCEPT}
              />
            )}
            
            {activeTab === 'timeline' && (
              <TimelineTab timeline={timeline} letters={letters} accessToken={session?.access_token} />
            )}
            
            {activeTab === 'vip' && isVip && (
              <VipTab isVip={isVip} />
            )}
          </motion.div>
        </AnimatePresence>

        <div className="text-center text-[11px] text-gray-400 mt-16 pb-8 font-medium">
          Credit Comeback Club ·{' '}
          <a href="https://maps.google.com/?q=3088+Colorado+Ave+Grand+Junction+CO+81504" target="_blank" rel="noopener noreferrer" className="hover:text-gray-600 transition-colors">
            3088 Colorado Ave, Grand Junction, CO 81504
          </a>{' '}
          · creditcomebackclub.com ·{' '}
          <a href="tel:9706440063" className="hover:text-gray-600 transition-colors">970-644-0063</a>
        </div>
      </div>
      
      <ConciergeChat clientId={session.user.id} accessToken={session.access_token} />
    </div>
  );
}
