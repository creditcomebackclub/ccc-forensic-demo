import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';
import { DOCUMENTS_BUCKET } from '../utils/storagePaths';
import { inferMediaType, isAnalyzable, transcodeImageToJpeg, validateBatch, RESPONSE_ACCEPT } from '../utils/responseFiles';
import { uploadResponseEvidence } from '../utils/responseEvidence';
import { LogOut } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';
import { motion, AnimatePresence } from 'framer-motion';

import OverviewTab from './client-portal/OverviewTab';
import ProgressTab from './client-portal/ProgressTab';
import DisputesTab from './client-portal/DisputesTab';
import TimelineTab from './client-portal/TimelineTab';
import DocumentsTab from './client-portal/DocumentsTab';
import VipTab from './client-portal/VipTab';
import BillingTab from './client-portal/BillingTab';
import ConciergeChat from './client-portal/ConciergeChat';
import RecoveryPlanTab from './client-portal/RecoveryPlanTab';
import {
  clientCampaignLabel,
  isAccountDisputeCampaign,
  isBureauCampaign,
  isCccDisputeCampaign,
} from '../utils/clientCampaignCopy';
import { notifyStaff } from '../utils/notifyStaff';
import { isPortalBureauDispute, isPortalFileUpdate } from '../utils/portalCampaigns';

export default function ClientPortal({ session, onSignOut }) {
  const [profile, setProfile] = useState(null);
  const [clientMeta, setClientMeta] = useState(null);
  const [letters, setLetters] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [packetCoverage, setPacketCoverage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [auditHistory, setAuditHistory] = useState([]);
  const [progressUpdates, setProgressUpdates] = useState([]);
  const [recoveryBlueprints, setRecoveryBlueprints] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [uploadingLetter, setUploadingLetter] = useState(null);
  const [clientDocs, setClientDocs] = useState({ id: null, address: null, lpoa: null, other: [] });
  const [uploadingDoc, setUploadingDoc] = useState(null);
  
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
        // clients/documents queries prefer client_id (backfilled onto
        // client_profiles — see the client_id migration plan) since
        // clients.name has no unique constraint and a same-named client
        // would otherwise risk resolving to the wrong record. Falls back
        // to the pre-existing name match when client_id wasn't backfilled
        // (e.g. genuine ambiguity, or no matching clients row at all).
        const clientsQuery = cp.client_id
          ? supabase.from('clients').select('*').eq('id', cp.client_id).limit(1)
          : supabase.from('clients').select('*').eq('name', cp.full_name).limit(1);
        const documentsQuery = cp.client_id
          ? supabase.from(DOCUMENTS_BUCKET).select('id,doc_type,label,file_name,storage_path,uploaded_at').eq('client_id', cp.client_id)
          : supabase.from(DOCUMENTS_BUCKET).select('id,doc_type,label,file_name,storage_path,uploaded_at').eq('client_name', cp.full_name);
        // The client portal needs campaign state, not staff-only model output
        // or response-review notes. Keep the browser query intentionally
        // narrow; raw response evidence remains private to the staff UI.
        const portalLetterColumns = 'id,client_id,client_name,furnisher,account_id,phase,type,saved_at,date,summary,mailed_date,response_outcome,response_date,lob_id,tracking_number,tracking_status,delivered_at,mail_service,expected_delivery_date,return_receipt_url,bureau_response_status,bureau_response_received_at,bureau_response_analyzed_at,bureau_review_status,round_id,round_number,letter_kind,target_type,target_bureau,response_due_at,response_window_extension_days,round_review_status,campaign_id,packet_version';
        const lettersQuery = cp.client_id
          ? supabase.from('letters').select(portalLetterColumns).eq('client_id', cp.client_id).order('saved_at', { ascending: true })
          : supabase.from('letters').select(portalLetterColumns).eq('client_name', cp.full_name).order('saved_at', { ascending: true });
        const roundsQuery = cp.client_id
          ? supabase.from('client_dispute_round_status').select('round_id,client_id,client_account_id,round_number,target_type,status,final_disposition,opened_at,closed_at,cancelled_at,letter_count,mailed_count,reviewed_count,campaign_id').eq('client_id', cp.client_id).order('round_number', { ascending: false })
          : Promise.resolve({ data: [], error: null });
        const campaignsQuery = cp.client_id
          ? supabase.from('client_campaign_status').select('campaign_id,client_id,round_number,stage,opened_at,closed_at,selected_cleanup_count,selected_account_count').eq('client_id', cp.client_id).order('round_number', { ascending: false })
          : Promise.resolve({ data: [], error: null });
        const packetCoverageQuery = cp.client_id
          ? supabase.from('client_packet_account_status').select('*').eq('client_id', cp.client_id).order('coverage_order')
          : Promise.resolve({ data: [], error: null });
        const auditsQuery = cp.client_id
          ? supabase.from('audits').select('audit,saved_at').eq('client_id', cp.client_id).order('saved_at', { ascending: false }).limit(5)
          : supabase.from('audits').select('audit,saved_at').eq('client_name', cp.full_name).order('saved_at', { ascending: false }).limit(5);
        // Only staff-sent updates (Progress Update Studio). Drafts stay
        // invisible until Send. emailed_at covers rows sent before status existed.
        const progressQuery = cp.client_id
          ? supabase.from('progress_updates').select('*').eq('client_id', cp.client_id).or('status.eq.sent,emailed_at.not.is.null').order('to_report_date', { ascending: false })
          : supabase.from('progress_updates').select('*').eq('client_name', cp.full_name).or('status.eq.sent,emailed_at.not.is.null').order('to_report_date', { ascending: false });

        const [lettersRes, roundsRes, campaignsRes, packetCoverageRes, metaRes, auditsRes, progressRes, docsRes] = await Promise.all([
          lettersQuery,
          roundsQuery,
          campaignsQuery,
          packetCoverageQuery,
          clientsQuery,
          auditsQuery,
          progressQuery,
          documentsQuery,
        ]);
        setLetters(lettersRes.data || []);
        if (roundsRes.error) console.warn('Client round status unavailable:', roundsRes.error.message);
        else setRounds(roundsRes.data || []);
        if (campaignsRes.error) console.warn('Client campaign status unavailable:', campaignsRes.error.message);
        else setCampaigns(campaignsRes.data || []);
        if (packetCoverageRes.error) console.warn('Client packet status unavailable:', packetCoverageRes.error.message);
        else setPacketCoverage(packetCoverageRes.data || []);
        setClientMeta(metaRes.data && metaRes.data.length > 0 ? metaRes.data[0] : null);
        setAuditHistory(auditsRes.data || []);
        setProgressUpdates(progressRes.data || []);

        // Blueprint delivery is additive and migration-safe: the rest of the
        // portal still loads if the new table has not been deployed yet.
        const blueprintsQuery = cp.client_id
          ? supabase.from('recovery_blueprints').select('id,status,version,template_version,storage_path,file_name,approved_at,sent_at,report_date').eq('client_id', cp.client_id)
          : supabase.from('recovery_blueprints').select('id,status,version,template_version,storage_path,file_name,approved_at,sent_at,report_date').eq('client_name', cp.full_name);
        const { data: blueprintRows, error: blueprintError } = await blueprintsQuery
          .in('status', ['approved', 'sent'])
          .order('approved_at', { ascending: false });
        if (blueprintError) console.warn('Recovery Blueprint portal data unavailable:', blueprintError.message);
        else setRecoveryBlueprints(blueprintRows || []);

        const docRows = docsRes.data;
        if (docRows) {
          setClientDocs({
            id: docRows.find(d => d.doc_type === 'id') || null,
            address: docRows.find(d => d.doc_type === 'address') || null,
            lpoa: docRows.find(d => d.doc_type === 'lpoa' || d.doc_type === 'agreement' || (d.label || '').toLowerCase().includes('lpoa') || (d.label || '').toLowerCase().includes('agreement')) || null,
            other: docRows.filter(d => d.doc_type !== 'id' && d.doc_type !== 'address' && d.doc_type !== 'lpoa' && d.doc_type !== 'agreement'),
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
      // clientId keyed (via utils/documents.js's uploadDocument, the same
      // path the admin-side DocumentManager.jsx uses) instead of an inline
      // name slug — two same-named clients would otherwise silently
      // overwrite each other's ID/address documents. ownerUserId must be
      // the firm's staff user_id, not this session's own (client) auth id,
      // to match staff_all_documents RLS and where admin-side uploads live.
      const clientId = clientMeta?.id;
      const adminUserId = clientMeta?.user_id;
      if (!adminUserId || !clientId) throw new Error('Could not identify client record.');
      const { uploadDocument } = await import('../utils/documents.js');
      const internalDocType = docType === 'government_id' ? 'id' : 'address';
      await uploadDocument(clientId, profile.full_name, internalDocType, file, adminUserId);
      notifyStaff('document_upload', { docLabel: docType === 'government_id' ? 'Government ID' : 'Proof of Address' });
      await loadData();
      toast.success('Document uploaded successfully!', { id: toastId });
    } catch(e) {
      console.error('Doc upload error:', e);
      toast.error('Upload failed. Please try again.', { id: toastId });
    }
    setUploadingDoc(null);
  };

  const handleUploadOther = async (label, file) => {
    setUploadingDoc('other');
    const toastId = toast.loading('Uploading document...');
    try {
      const clientId = clientMeta?.id;
      const adminUserId = clientMeta?.user_id;
      if (!adminUserId || !clientId) throw new Error('Could not identify client record.');
      const { uploadArbitraryDocument } = await import('../utils/documents.js');
      await uploadArbitraryDocument(clientId, profile.full_name, label, file, adminUserId);
      notifyStaff('document_upload', { docLabel: label || 'Other document' });
      await loadData();
      toast.success('Document uploaded successfully!', { id: toastId });
    } catch (e) {
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
      // The server verifies this session owns this exact letter, writes the
      // private evidence record, and then marks only the response state. The
      // portal never receives a public file URL or general letter update
      // permission.
      const evidence = await uploadResponseEvidence(letter.id, files);
      notifyStaff('document_upload', {
        docLabel: 'Dispute response' + (letter.furnisher ? ' — ' + letter.furnisher : ''),
      });

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


  const viewSignedAgreement = async () => {
    try {
      const token = session?.access_token;
      if (!token) {
        toast.error('Your session expired. Please sign in again.');
        return;
      }
      const res = await fetch('/.netlify/functions/portal-agreement-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: '{}',
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Could not open signed agreement.');
      if (!out.signedUrl) throw new Error('No download link returned.');
      const opened = window.open(out.signedUrl, '_blank', 'noopener,noreferrer');
      if (!opened) throw new Error('Popup blocked — allow popups for this site and try again.');
    } catch (e) {
      console.error('Signed agreement open failed:', e);
      toast.error(e.message || 'Could not open signed agreement.');
    }
  };


  const openRecoveryBlueprint = async (blueprint) => {
    const target = blueprint || recoveryBlueprints?.[0];
    if (!target?.storage_path) {
      toast.error('Blueprint file is not available yet.');
      return;
    }
    try {
      const { data, error } = await supabase.storage
        .from('recovery-blueprints')
        .createSignedUrl(target.storage_path, 60 * 10);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error('Could not create blueprint link.');
      window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (e) {
      console.error('Blueprint open failed:', e);
      toast.error(e.message || 'Could not open blueprint.');
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
  const totalDisputes = letters.filter((l) => isAccountDisputeCampaign(l) && !isPortalFileUpdate(l)).length;
  const fileUpdateCount = letters.filter((l) => isPortalFileUpdate(l)).length;
  const isVip = clientMeta && clientMeta.is_vip;

  // Onboarding timeline (Overview tab) — stage from earliest account-dispute mail.
  // File-update letters (PI / inquiries) do not start the dispute journey clock.
  const phase1Mailed = letters
    .filter(l => !isPortalFileUpdate(l) && (l.target_type || isAccountDisputeCampaign(l.phase)) && l.mailed_date)
    .sort((a, b) => new Date(a.mailed_date) - new Date(b.mailed_date));
  const earliestPhase1MailDate = phase1Mailed[0]?.mailed_date || null;
  const earliestCampaignLetter = phase1Mailed[0] || null;
  const earliestReviewStart = earliestCampaignLetter?.delivered_at
    ? String(earliestCampaignLetter.delivered_at).slice(0, 10)
    : isCccDisputeCampaign(earliestCampaignLetter?.phase) && earliestCampaignLetter?.expected_delivery_date
      ? earliestCampaignLetter.expected_delivery_date
      : earliestPhase1MailDate;
  const accountDisputeLetters = letters.filter(l => !isPortalFileUpdate(l) && (l.target_type || isAccountDisputeCampaign(l.phase) || isBureauCampaign(l.phase)));
  const packetLetterIds = new Set(packetCoverage.map((entry) => entry.letter_id));
  const accountDisputeCount = packetCoverage.length
    + accountDisputeLetters.filter((letter) => !packetLetterIds.has(letter.id)).length;
  const fileUpdateLetters = letters.filter(isPortalFileUpdate);
  const windowCloseDate = earliestReviewStart
    ? new Date(new Date(earliestReviewStart + 'T00:00:00').getTime() + 30 * 86400000).toISOString()
    : null;
  const phase3Mailed = letters.some(l => isPortalBureauDispute(l) && l.mailed_date);
  const firstDeletionDate = deletions
    .map(d => d.response_date)
    .filter(Boolean)
    .sort((a, b) => new Date(a) - new Date(b))[0] || null;

  let onboardingStage;
  if (!earliestPhase1MailDate) onboardingStage = 1;
  else if (firstDeletionDate) onboardingStage = 4;
  else if (phase3Mailed || (windowCloseDate && new Date() > new Date(windowCloseDate))) onboardingStage = 3;
  else onboardingStage = 2;

  const onboardingDates = { mailDate: earliestPhase1MailDate, windowCloseDate, firstDeletionDate };
  const firstName = (profile && profile.full_name || '').split(' ')[0] || 'there';

  const latestScores = (auditHistory.length > 0 && auditHistory[0].audit && auditHistory[0].audit.scores) || null;

  const timeline = [];
  letters.forEach(l => {
    const fileUpdate = isPortalFileUpdate(l);
    const preparedTitle = fileUpdate
      ? 'File update prepared — ' + l.furnisher
      : 'Dispute letter prepared — ' + l.furnisher;
    const roundLabel = l.round_number
      ? `Round ${l.round_number} · ${l.target_type === 'bureau' ? 'Credit Bureau Dispute' : 'Direct Furnisher Dispute'}`
      : clientCampaignLabel(l.phase);
    if (l.saved_at) timeline.push({ date: l.saved_at, icon: '📄', title: preparedTitle, subtitle: roundLabel, tone: 'blue' });
    if (l.mailed_date) {
      const firstClassCcc = isCccDisputeCampaign(l.phase) && l.mail_service === 'usps_first_class';
      timeline.push({
        date: l.mailed_date,
        icon: '✉️',
        title: `Letter mailed via ${firstClassCcc ? 'USPS First Class' : 'certified mail'} — ${l.furnisher}`,
        subtitle: l.tracking_number && !firstClassCcc
          ? 'USPS #' + l.tracking_number.slice(-8)
          : firstClassCcc && l.expected_delivery_date
            ? 'Estimated delivery ' + new Date(l.expected_delivery_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : null,
        tone: 'default',
      });
    }

    // Granular in-transit milestones from Lob webhook
    if (l.tracking_status === 'In Transit' && l.mailed_date)
      timeline.push({ date: l.mailed_date, icon: '🚚', title: 'In Transit — ' + l.furnisher, subtitle: l.tracking_number && l.mail_service !== 'usps_first_class' ? 'USPS #' + l.tracking_number.slice(-8) : 'Lob mailpiece scan', tone: 'default' });
    if (l.tracking_status === 'Out for Delivery' && l.mailed_date)
      timeline.push({ date: l.mailed_date, icon: '📬', title: 'Out for Delivery — ' + l.furnisher, subtitle: 'Expected delivery today', tone: 'gold' });

    if (l.tracking_status === 'Delivered') {
      const responseWindow = isCccDisputeCampaign(l.phase)
        ? '30-day CCC round review'
        : fileUpdate ? '30-day file update' : (isPortalBureauDispute(l) ? '45-day bureau review' : '30-day response');
      timeline.push({ date: l.delivered_at || l.mailed_date, icon: '✅', title: 'Delivered — ' + l.furnisher, subtitle: responseWindow + ' response window started', tone: 'green', lobId: l.lob_id, trackingNumber: l.mail_service === 'usps_first_class' ? null : l.tracking_number });
    }
    if (l.tracking_status === 'Returned to Sender') timeline.push({ date: l.delivered_at || l.mailed_date, icon: '↩️', title: 'Returned to Sender — ' + l.furnisher, subtitle: 'Letter returned — address may need to be verified', tone: 'red' });
    if (l.tracking_status === 'Available for Pickup') timeline.push({ date: l.delivered_at || l.mailed_date, icon: '🏢', title: 'Available for Pickup — ' + l.furnisher, subtitle: 'Awaiting pickup at post office', tone: 'gold' });

    if (l.response_outcome === 'received') {
      const bureauUpdate = isPortalBureauDispute(l);
      const bureauStatus = l.bureau_response_status;
      const subtitle = bureauUpdate
        ? (bureauStatus === 'analyzing' ? 'Staff is reviewing the bureau response' : bureauStatus === 'review_ready' ? 'Staff review is ready for the next decision' : bureauStatus === 'reviewed' ? 'Next campaign step recorded' : 'Response received and queued for staff review')
        : fileUpdate
          ? 'File update response queued for staff review'
          : null;
      const receivedTitle = bureauUpdate
        ? 'Bureau response received — '
        : fileUpdate
          ? 'File update response received — '
          : 'Response received — ';
      timeline.push({ date: l.response_date, icon: '📬', title: receivedTitle + l.furnisher, subtitle, tone: 'gold' });
    }
    if (l.response_outcome === 'no_response') {
      const closedTitle = fileUpdate
        ? 'File update window closed — staff review pending'
        : 'Response window closed — staff review pending';
      timeline.push({ date: l.response_date || l.mailed_date, icon: '⚠️', title: closedTitle, subtitle: l.furnisher, tone: 'red' });
    }
    if (l.response_outcome === 'deleted') {
      const deletedSubtitle = fileUpdate
        ? 'Item removed from your credit file'
        : 'Account removed from your credit report';
      timeline.push({ date: l.response_date, icon: '🏆', title: 'DELETED — ' + l.furnisher, subtitle: deletedSubtitle, tone: 'green', responseUrl: l.response_file_url || null });
    }
  });

  rounds.filter((round) => round.status === 'closed' && round.closed_at).forEach((round) => {
    const outcome = round.final_disposition === 'resolved'
      ? { title: `Round ${round.round_number} review complete`, subtitle: 'Account campaign resolved', tone: 'green', icon: '✅' }
      : round.final_disposition === 'escalate'
        ? { title: `Round ${round.round_number} ready for escalation review`, subtitle: 'No complaint or legal filing has been submitted', tone: 'gold', icon: '⚖️' }
        : { title: `Round ${round.round_number} review complete`, subtitle: 'Another round may be prepared', tone: 'blue', icon: '📋' };
    timeline.push({ date: round.closed_at, ...outcome });
  });

  if (clientMeta?.created_at) timeline.push({ date: clientMeta.created_at, icon: '👋', title: 'Enrolled in Credit Comeback Club', tone: 'blue' });
  if (clientMeta?.lpoa_signed_at) timeline.push({ date: clientMeta.lpoa_signed_at, icon: '✍️', title: 'Authorization Signed (LPOA)', tone: 'green' });
  if (clientDocs?.id?.uploaded_at) timeline.push({ date: clientDocs.id.uploaded_at, icon: '🪪', title: 'ID Uploaded', tone: 'default' });
  if (clientDocs?.address?.uploaded_at) timeline.push({ date: clientDocs.address.uploaded_at, icon: '🏠', title: 'Utility Bill Uploaded', tone: 'default' });

  timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

  const docsComplete = !!clientDocs.id && !!clientDocs.address && clientMeta?.lpoa_signed && (clientMeta?.monitoring_enrolled || clientMeta?.monitoring_not_required);

  const tabs = [
    { id: 'overview', label: 'Overview' },
    ...(recoveryBlueprints.length ? [{ id: 'recovery-plan', label: '✨ Recovery Plan' }] : []),
    { id: 'progress', label: 'Progress' },
    { id: 'disputes', label: 'Disputes' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'documents', label: docsComplete ? '📁 Documents' : '📁 Documents ⚡' },
    { id: 'billing', label: '💳 Billing' },
    ...(isVip ? [{ id: 'vip', label: '⭐ VIP' }] : []),
  ];

  return (
    <div className="min-h-screen bg-gray-50/50 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]">
      <Toaster position="top-center" toastOptions={{ style: { fontSize: '13px', fontWeight: '500' } }} />
      
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 sticky top-0 z-40 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img src="https://files.manuscdn.com/user_upload_by_module/session_file/104892940/PtGXuDEKgTJkOdRf.jpg" alt="Credit Comeback Club"
              className="w-12 h-12 rounded-xl object-cover border-2 border-amber-400 shadow-[0_0_15px_rgba(251,191,36,0.3)]" />
            <div className="min-w-0">
              <div className="text-amber-400 font-bold text-[15px] tracking-wide truncate">Credit Comeback Club</div>
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
        <div className="max-w-4xl mx-auto px-4 sm:px-6 flex gap-1 overflow-x-auto scrollbar-none">
          {tabs.map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              className={`relative shrink-0 px-3 sm:px-4 py-3.5 text-xs uppercase tracking-wider font-bold transition-colors ${activeTab === tab.id ? 'text-slate-900' : 'text-gray-400 hover:text-gray-700'}`}>
              {tab.label}
              {activeTab === tab.id && (
                <motion.div layoutId="activeTabIndicator" className="absolute bottom-0 left-0 right-0 h-0.5 bg-amber-400" />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
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
              totalDisputes={totalDisputes}
              fileUpdateCount={fileUpdateCount}
              latestScores={latestScores}
              auditHistory={auditHistory}
              onboardingStage={onboardingStage}
              onboardingDates={onboardingDates}
              recoveryBlueprints={recoveryBlueprints}
              rounds={rounds}
              campaigns={campaigns}
              packetCoverage={packetCoverage}
              letters={letters}
              clientDocs={clientDocs}
              stagedFiles={stagedFiles}
              uploadSuccess={uploadSuccess}
              onNavigate={setActiveTab}
            />
            )}

            {activeTab === 'progress' && (
              <ProgressTab updates={progressUpdates} />
            )}

            {activeTab === 'recovery-plan' && (
              <RecoveryPlanTab blueprints={recoveryBlueprints} session={session} />
            )}

            {activeTab === 'documents' && (
              <DocumentsTab
                profile={profile}
                clientMeta={clientMeta}
                clientDocs={clientDocs}
                uploadingDoc={uploadingDoc}
                handleUploadDoc={handleUploadDoc}
                handleUploadOther={handleUploadOther}
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
                rounds={rounds}
                campaigns={campaigns}
                packetCoverage={packetCoverage}
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
              <TimelineTab timeline={timeline} letters={letters} campaigns={campaigns} accessToken={session?.access_token} />
            )}
            
            {activeTab === 'billing' && (
              <BillingTab
              signedAgreementAvailable={true}
              onViewAgreement={viewSignedAgreement} clientMeta={clientMeta} />
            )}
            
            {activeTab === 'vip' && isVip && (
              <VipTab isVip={isVip} />
            )}
          </motion.div>
        </AnimatePresence>

        <div className="text-center text-[11px] text-gray-400 mt-16 pb-8 font-medium">
          Credit Comeback Club · creditcomebackclub.com ·{' '}
          <a href="tel:9706440063" className="hover:text-gray-600 transition-colors">970-644-0063</a>
        </div>
      </div>
      
      <ConciergeChat clientId={clientMeta?.id || null} accessToken={session.access_token} />
    </div>
  );
}
