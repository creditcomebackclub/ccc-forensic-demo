import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabase';
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
import {
  hasClientVisibleDelivery,
  hasPortalReviewStarted,
  isPortalMailTerminal,
  isPortalBureauDispute,
  isPortalFileUpdate,
  portalMailPresentation,
  portalReviewStartDate,
} from '../utils/portalCampaigns';
import { combinedDeletionResults, normalizeDeletionOutcome, standaloneDeletionResults } from '../utils/deletionOutcomes.js';

const SIGNED_ARTIFACT_KINDS = ['agreement', 'disclosure', 'cancellation'];
const EMPTY_CCC_PROJECTION = Object.freeze({ tracks: [], results: [], deletions: [], latest_audit: null });

function normalizePortalProjection(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...EMPTY_CCC_PROJECTION };
  return {
    tracks: Array.isArray(value.tracks) ? value.tracks : [],
    results: Array.isArray(value.results) ? value.results : [],
    deletions: Array.isArray(value.deletions) ? value.deletions : [],
    latest_audit: value.latest_audit && typeof value.latest_audit === 'object' ? value.latest_audit : null,
  };
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('Could not read the selected file.'));
    reader.readAsDataURL(file);
  });
}

async function signedArtifactAvailability(accessToken) {
  const entries = await Promise.all(SIGNED_ARTIFACT_KINDS.map(async (kind) => {
    const response = await fetch('/.netlify/functions/portal-agreement-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ kind }),
    });
    return [kind, response.ok];
  }));
  return Object.fromEntries(entries);
}

export default function ClientPortal({ session, onSignOut }) {
  const [profile, setProfile] = useState(null);
  const [clientMeta, setClientMeta] = useState(null);
  const [letters, setLetters] = useState([]);
  const [deletionOutcomes, setDeletionOutcomes] = useState([]);
  const [cccProjection, setCccProjection] = useState(EMPTY_CCC_PROJECTION);
  const [rounds, setRounds] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [packetCoverage, setPacketCoverage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [auditHistory, setAuditHistory] = useState([]);
  const [progressUpdates, setProgressUpdates] = useState([]);
  const [recoveryBlueprints, setRecoveryBlueprints] = useState([]);
  const [activeTab, setActiveTab] = useState('overview');
  const [uploadingLetter, setUploadingLetter] = useState(null);
  const [clientDocs, setClientDocs] = useState({ id: null, address: null, other: [] });
  const [signedArtifacts, setSignedArtifacts] = useState({ agreement: false, disclosure: false, cancellation: false });
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
    setLoading(true);
    try {
      const portalUserId = session?.user?.id;
      if (!portalUserId || !session?.access_token) throw new Error('A signed-in portal session is required.');

      // One exact-auth database projection is the browser's sole read path.
      // Raw CRM rows, audits, letter HTML/templates, internal flow codes,
      // staff notes, credentials, legal artifacts, and source hashes never
      // cross the portal boundary.
      const { data: snapshot, error: snapshotError } = await supabase.rpc('get_my_client_portal_snapshot');
      if (snapshotError) throw snapshotError;
      if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)
        || snapshot.has_portal_access !== true || !snapshot.profile || !snapshot.client) {
        throw new Error('Your client portal enrollment could not be verified safely.');
      }

      const cp = snapshot.profile;
      const client = snapshot.client;
      setProfile(cp);
      setLetters(Array.isArray(snapshot.letters) ? snapshot.letters : []);
      setRounds(Array.isArray(snapshot.rounds) ? snapshot.rounds : []);
      setCampaigns(Array.isArray(snapshot.campaigns) ? snapshot.campaigns : []);
      setPacketCoverage(Array.isArray(snapshot.packet_coverage) ? snapshot.packet_coverage : []);

      const projection = normalizePortalProjection(snapshot.ccc);
      setCccProjection(projection);
      setDeletionOutcomes((projection.deletions || []).map(normalizeDeletionOutcome));
      setAuditHistory(projection.latest_audit ? [{
        audit: { scores: projection.latest_audit.scores || {} },
        saved_at: projection.latest_audit.saved_at || null,
      }] : []);
      setProgressUpdates(Array.isArray(snapshot.progress_updates) ? snapshot.progress_updates : []);

      setClientMeta({
        ...client,
        agreement_signed: !!cp.agreement_signed_at,
        agreement_signed_at: cp.agreement_signed_at || null,
      });
      const docRows = Array.isArray(snapshot.documents) ? snapshot.documents : [];
      setClientDocs({
        id: docRows.find((d) => d.doc_type === 'id') || null,
        address: docRows.find((d) => d.doc_type === 'address') || null,
        other: docRows.filter((d) => !['id', 'address'].includes(d.doc_type)),
      });
      setRecoveryBlueprints(Array.isArray(snapshot.recovery_blueprints) ? snapshot.recovery_blueprints : []);

      if (cp.agreement_signed_at) {
        try {
          setSignedArtifacts(await signedArtifactAvailability(session.access_token));
        } catch (artifactError) {
          console.warn('Signed enrollment artifacts unavailable:', artifactError);
          setSignedArtifacts({ agreement: false, disclosure: false, cancellation: false });
        }
      } else {
        setSignedArtifacts({ agreement: false, disclosure: false, cancellation: false });
      }
    } catch (e) {
      console.error('Portal load error:', e);
      setProfile(null);
      setClientMeta(null);
      setLetters([]);
      setDeletionOutcomes([]);
      setCccProjection(EMPTY_CCC_PROJECTION);
      setRounds([]);
      setCampaigns([]);
      setPacketCoverage([]);
      setAuditHistory([]);
      setProgressUpdates([]);
      setRecoveryBlueprints([]);
      toast.error('Failed to load portal data');
    } finally {
      setLoading(false);
    }
  };

  const handleUploadDoc = async (docType, file) => {
    setUploadingDoc(docType);
    const toastId = toast.loading('Uploading document...');
    try {
      const internalDocType = docType === 'government_id' ? 'id' : 'address';
      const dataBase64 = await fileToDataUrl(file);
      const response = await fetch('/.netlify/functions/portal-enroll-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          kind: internalDocType,
          dataBase64,
          contentType: file.type,
          fileName: file.name,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Secure document upload failed.');
      if (result.clientId !== clientMeta?.id) throw new Error('The document did not resolve to this client record.');
      notifyStaff('document_upload', { docLabel: docType === 'government_id' ? 'Government ID' : 'Proof of Address' });
      await loadData();
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


  const viewSignedAgreement = async (kind = 'agreement') => {
    try {
      const token = session?.access_token;
      if (!token) {
        toast.error('Your session expired. Please sign in again.');
        return;
      }
      const res = await fetch('/.netlify/functions/portal-agreement-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ kind }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Could not open the signed document.');
      if (!out.signedUrl) throw new Error('No download link returned.');
      const opened = window.open(out.signedUrl, '_blank', 'noopener,noreferrer');
      if (!opened) throw new Error('Popup blocked — allow popups for this site and try again.');
    } catch (e) {
      console.error('Signed document open failed:', e);
      toast.error(e.message || 'Could not open the signed document.');
    }
  };


  const openRecoveryBlueprint = async (blueprint) => {
    const target = blueprint || recoveryBlueprints?.[0];
    if (!target?.id) {
      toast.error('Blueprint file is not available yet.');
      return;
    }
    try {
      const response = await fetch('/.netlify/functions/portal-blueprint-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ blueprintId: target.id }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not create blueprint link.');
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
  const reviewStarted = letters.filter((letter) => hasPortalReviewStarted(letter));
  const responded = letters.filter(l => l.response_outcome);
  const deletions = combinedDeletionResults(letters, deletionOutcomes);
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
  const earliestReviewStart = portalReviewStartDate(earliestCampaignLetter || {});
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
    .map(d => d.confirmedAt)
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
    const currentCcc = isCccDisputeCampaign(l.phase);
    const mail = portalMailPresentation(l);
    const mailTimelineLabel = mail.timelineLabel;
    const reviewStart = portalReviewStartDate(l);
    const terminalMail = isPortalMailTerminal(l);
    const preparedTitle = fileUpdate
      ? 'File update prepared — ' + l.furnisher
      : 'Case letter prepared — ' + l.furnisher;
    const roundLabel = l.round_number
      ? `Round ${l.round_number} · ${l.target_type === 'bureau' ? 'Credit bureau case' : 'Direct account correspondence'}`
      : currentCcc ? 'Credit bureau case' : clientCampaignLabel(l.phase);
    if (l.saved_at) timeline.push({ date: l.saved_at, icon: '📄', title: preparedTitle, subtitle: roundLabel, tone: 'blue' });
    if (l.mailed_date) {
      timeline.push({
        date: l.mailed_date,
        icon: '✉️',
        title: `Letter mailed via ${mailTimelineLabel} — ${l.furnisher}`,
        subtitle: l.tracking_number && mail.legacyCertified
          ? 'USPS #' + l.tracking_number.slice(-8)
          : terminalMail
            ? 'Mailing issue recorded'
            : mail.currentFirstClass && reviewStart
            ? 'Expected-delivery review scheduled for ' + new Date(`${reviewStart}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : mail.untracked
              ? 'Review schedule pending'
            : null,
        tone: 'default',
      });
    }

    if (mail.currentFirstClass && reviewStart) {
      const reviewHasStarted = hasPortalReviewStarted(l);
      timeline.push({
        date: reviewStart,
        icon: reviewHasStarted ? '🕒' : '🗓️',
        title: `${reviewHasStarted ? 'Expected-delivery review started' : 'Expected-delivery review scheduled'} — ${l.furnisher}`,
        subtitle: 'USPS First Class review milestone',
        tone: reviewHasStarted ? 'gold' : 'default',
      });
    }

    // Granular in-transit milestones from Lob webhook
    if (mail.legacyCertified && l.tracking_status === 'In Transit' && l.mailed_date)
      timeline.push({ date: l.mailed_date, icon: '🚚', title: 'In Transit — ' + l.furnisher, subtitle: l.tracking_number ? 'USPS #' + l.tracking_number.slice(-8) : 'Certified Mail (legacy history)', tone: 'default' });
    if (mail.legacyCertified && l.tracking_status === 'Out for Delivery' && l.mailed_date)
      timeline.push({ date: l.mailed_date, icon: '📬', title: 'Out for Delivery — ' + l.furnisher, subtitle: 'Expected delivery today', tone: 'gold' });

    if (hasClientVisibleDelivery(l)) {
      const responseWindow = isCccDisputeCampaign(l.phase)
        ? '30-day case review'
        : fileUpdate ? '30-day file update' : (isPortalBureauDispute(l) ? '45-day bureau review' : '30-day response');
      timeline.push({
        date: l.delivered_at || l.mailed_date,
        icon: '✅',
        title: 'Delivered — ' + l.furnisher,
        subtitle: responseWindow + ' window started',
        tone: 'green',
        lobId: mail.legacyCertified ? l.lob_id : null,
        trackingNumber: mail.legacyCertified ? l.tracking_number : null,
        returnReceiptUrl: mail.legacyCertified ? l.return_receipt_url : null,
      });
    }
    if (l.tracking_status === 'Returned to Sender') timeline.push({ date: l.delivered_at || l.mailed_date, icon: '↩️', title: 'Returned to Sender — ' + l.furnisher, subtitle: 'Letter returned — address may need to be verified', tone: 'red' });
    if (mail.legacyCertified && l.tracking_status === 'Available for Pickup') timeline.push({ date: l.delivered_at || l.mailed_date, icon: '🏢', title: 'Available for Pickup — ' + l.furnisher, subtitle: 'Awaiting pickup at post office', tone: 'gold' });

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

  standaloneDeletionResults(letters, deletionOutcomes).forEach((deletion) => {
    timeline.push({
      date: deletion.confirmedAt,
      icon: '🏆',
      title: 'DELETED — ' + deletion.furnisher,
      subtitle: `${deletion.bureauLabel} confirmed account removal`,
      tone: 'green',
    });
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
  if (clientMeta?.agreement_signed_at) timeline.push({ date: clientMeta.agreement_signed_at, icon: '✍️', title: 'Client Service Agreement signed', tone: 'green' });
  if (clientDocs?.id?.uploaded_at) timeline.push({ date: clientDocs.id.uploaded_at, icon: '🪪', title: 'ID Uploaded', tone: 'default' });
  if (clientDocs?.address?.uploaded_at) timeline.push({ date: clientDocs.address.uploaded_at, icon: '🏠', title: 'Utility Bill Uploaded', tone: 'default' });

  timeline.sort((a, b) => new Date(b.date) - new Date(a.date));

  const docsComplete = !!clientDocs.id && !!clientDocs.address && clientMeta?.agreement_signed && (clientMeta?.monitoring_enrolled || clientMeta?.monitoring_not_required);

  const tabs = [
    { id: 'overview', label: 'Overview' },
    ...(recoveryBlueprints.length ? [{ id: 'recovery-plan', label: '✨ Recovery Plan' }] : []),
    { id: 'progress', label: 'Progress' },
    { id: 'disputes', label: 'Casework' },
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
              reviewStarted={reviewStarted}
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
                monitoringStep={monitoringStep}
                setMonitoringStep={setMonitoringStep}
                monitoringForm={monitoringForm}
                setMonitoringForm={setMonitoringForm}
                monitoringSaving={monitoringSaving}
                setMonitoringSaving={setMonitoringSaving}
                monitoringError={monitoringError}
                setMonitoringError={setMonitoringError}
                loadData={loadData}
                signedArtifacts={signedArtifacts}
                onViewSignedArtifact={viewSignedAgreement}
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
                cccProjection={cccProjection}
              />
            )}
            
            {activeTab === 'timeline' && (
              <TimelineTab timeline={timeline} letters={letters} campaigns={campaigns} accessToken={session?.access_token} />
            )}
            
            {activeTab === 'billing' && (
              <BillingTab
              signedAgreementAvailable={signedArtifacts.agreement}
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
      
      <ConciergeChat accessToken={session.access_token} />
    </div>
  );
}
