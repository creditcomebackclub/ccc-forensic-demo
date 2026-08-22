import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, MapPin, Send, X } from 'lucide-react';
import { getDocuments } from '../utils/documents.js';
import { inferMediaType } from '../utils/responseFiles.js';
import { supabase } from '../utils/supabase.js';
import {
  USPS_FIRST_CLASS,
  isCccDisputePhase,
  requiresCccR1IdentityDocuments,
} from '../utils/cccMailRules.js';
import {
  DISPUTE_SCREENSHOT_BUCKET,
  resolveDisputeScreenshotPolicy,
  validateDisputeScreenshotManifest,
} from '../utils/disputeScreenshots.js';
import {
  assembleBoundCccMailpiece,
  canonicalizeCccLetterHtml,
  cccLetterBindingInput,
  renderCccImageExhibit,
} from '../utils/cccMailpieceIntegrity.js';
import {
  canMailLetter,
  generationErrorMessage,
  isGenerationRunning,
} from '../utils/letterGeneration.js';
import { cccLetterIdentityDocumentIssues } from '../utils/cccLetterIdentity.js';
import { remoteImageSources } from '../utils/signatureInjection.js';
import { tempLetterPath } from '../utils/storagePaths.js';

const LOB_FUNCTION_URL = '/.netlify/functions/lob';
const RETIRED_MAIL_MESSAGE =
  'This historical letter belongs to a retired dispute workflow. It remains available for review, but it cannot be mailed or regenerated. Start new correspondence in the CCC Consent / Accuracy / Collection campaign.';

const FROM_ADDRESS = {
  name: 'Credit Comeback Club',
  line1: '3088 Colorado Ave',
  line2: '',
  city: 'Grand Junction',
  state: 'CO',
  zip: '81504',
};

async function callLob(action, payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  const response = await fetch(LOB_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json();
  if (!response.ok) {
    const details = Array.isArray(data.issues) && data.issues.length ? ` ${data.issues.join(' ')}` : '';
    throw new Error((data.error || data.message || 'Lob request failed') + details);
  }
  return data;
}

function AddressField({ label, value, onChange }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full border border-border rounded-sm px-3 py-1.5 text-[12px] text-ink focus:outline-none focus:border-navy"
      />
    </div>
  );
}

function sha256Hex(buffer) {
  return crypto.subtle.digest('SHA-256', buffer).then((digest) =>
    [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join(''));
}

export default function LobMailer({ letter, furnisherAddress, onClose, onSent, onNext, batchRemaining = 0 }) {
  const isCurrentCccLetter = isCccDisputePhase(letter?.phase);
  const explicitMailService = letter?.mailService ?? letter?.mail_service ?? null;
  const wrongMailService = !!explicitMailService && explicitMailService !== USPS_FIRST_CLASS;
  const [step, setStep] = useState('confirm');
  const [toAddr, setToAddr] = useState(furnisherAddress || {
    name: letter?.furnisher || '', line1: '', line2: '', city: '', state: '', zip: '',
  });
  const [docs, setDocs] = useState([]);
  const [documentsLoaded, setDocumentsLoaded] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [selectedOtherDocIds, setSelectedOtherDocIds] = useState(() => new Set());

  useEffect(() => {
    setStep('confirm');
    setToAddr(furnisherAddress || {
      name: letter?.furnisher || '', line1: '', line2: '', city: '', state: '', zip: '',
    });
    setSending(false);
    setResult(null);
    setError(null);
    setVerifying(false);
    setVerified(false);
    setSelectedOtherDocIds(new Set());
  }, [letter?.id]);

  useEffect(() => {
    let active = true;
    setDocs([]);
    setDocumentsLoaded(false);
    if (!isCurrentCccLetter || !letter?.clientId) {
      setDocumentsLoaded(true);
      return () => { active = false; };
    }
    getDocuments(letter.clientName, letter.clientId)
      .then((rows) => { if (active) setDocs(rows || []); })
      .catch((loadError) => { if (active) setError(`Could not load client documents: ${loadError.message}`); })
      .finally(() => { if (active) setDocumentsLoaded(true); });
    return () => { active = false; };
  }, [isCurrentCccLetter, letter?.clientId, letter?.clientName]);

  const requiresIdentityDocuments = requiresCccR1IdentityDocuments(letter);
  const identitySnapshot = letter?.cccLetterIdentitySnapshot || {};
  const idDoc = docs.find((document) => document.id === identitySnapshot.identityDocumentId)
    || docs.find((document) => document.doc_type === 'id');
  const addressDoc = docs.find((document) => document.id === identitySnapshot.addressDocumentId)
    || docs.find((document) => document.doc_type === 'address');
  const identityDocumentIssues = requiresIdentityDocuments
    ? cccLetterIdentityDocumentIssues(identitySnapshot, docs)
    : [];
  const identityDocumentsMissing = identityDocumentIssues.length > 0;
  const screenshotManifest = Array.isArray(letter?.disputeScreenshotManifest)
    ? letter.disputeScreenshotManifest
    : [];
  const screenshotPolicy = resolveDisputeScreenshotPolicy({
    snapshot: letter?.disputeScreenshotPolicySnapshot,
    templateText: letter?.disputeTemplateSnapshot,
  });
  const screenshotManifestIssues = isCurrentCccLetter
    ? validateDisputeScreenshotManifest({
      accounts: letter?.disputeAccountSnapshot || [],
      manifest: screenshotManifest,
      policy: screenshotPolicy,
    })
    : [];
  const screenshotPacketMissing = screenshotManifestIssues.length > 0;
  const optionalDocs = docs.filter((document) => document.doc_type?.startsWith('other-'));

  const toggleOtherDoc = (id) => {
    setSelectedOtherDocIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 4) next.add(id);
      return next;
    });
  };

  const handleVerify = async () => {
    if (!isCurrentCccLetter || wrongMailService) {
      setError(RETIRED_MAIL_MESSAGE);
      return;
    }
    setVerifying(true);
    setError(null);
    try {
      const response = await callLob('verify_address', { address: toAddr });
      if (response.deliverability === 'undeliverable') {
        setError('Address appears undeliverable — please verify and correct it.');
      } else {
        setVerified(true);
        if (response.primary_line) {
          setToAddr((current) => ({
            ...current,
            line1: response.primary_line,
            line2: response.secondary_line || '',
            city: response.components?.city || current.city,
            state: response.components?.state || current.state,
            zip: response.components?.zip_code || current.zip,
          }));
        }
      }
    } catch (verifyError) {
      setError(`Address verification failed: ${verifyError.message}`);
    } finally {
      setVerifying(false);
    }
  };

  const handleSend = async () => {
    if (!isCurrentCccLetter) {
      setError(RETIRED_MAIL_MESSAGE);
      return;
    }
    if (wrongMailService) {
      setError('MAIL SERVICE BLOCKED — current CCC correspondence must use USPS First-Class Mail. Nothing was sent.');
      return;
    }
    if (!letter?.clientId) {
      setError('CLIENT ID MISSING — reconcile this letter to the exact client before mailing. Nothing was sent.');
      return;
    }
    if (!canMailLetter(letter)) {
      setError(isGenerationRunning(letter)
        ? 'LETTER GENERATION IS STILL RUNNING — nothing was sent.'
        : `LETTER NOT MAIL-READY — ${generationErrorMessage(letter)} Nothing was sent.`);
      return;
    }
    if (letter.enclosureParseBlocked) {
      setError('ENCLOSURE UNPARSED — MANUAL RECONCILIATION REQUIRED. Re-upload and review the enclosure before mailing. Nothing was sent.');
      return;
    }
    if (requiresIdentityDocuments && (!documentsLoaded || !idDoc || !addressDoc || identityDocumentsMissing)) {
      setError(!documentsLoaded
        ? 'R1 DOCUMENT CHECK IN PROGRESS — wait for the client document record to finish loading.'
        : `R1 DOCUMENTS REQUIRED OR CHANGED — ${identityDocumentIssues.join(' ')} Nothing was sent.`);
      return;
    }
    if (screenshotPacketMissing) {
      setError(`ACCOUNT SCREENSHOT PACKET INCOMPLETE — ${screenshotManifestIssues.join(' ')} Nothing was sent.`);
      return;
    }
    if (!verified) {
      setError('VERIFY THE MAILING ADDRESS FIRST — nothing was sent.');
      return;
    }

    setSending(true);
    setError(null);
    const tempPathsToClean = [];
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.id) throw new Error('Your staff session expired. Sign in again before mailing. Nothing was sent.');

      const scopedScreenshotIssues = validateDisputeScreenshotManifest({
        accounts: letter.disputeAccountSnapshot || [],
        manifest: screenshotManifest,
        policy: screenshotPolicy,
        userId: user.id,
        clientId: letter.clientId,
      });
      if (scopedScreenshotIssues.length) {
        throw new Error(`ACCOUNT SCREENSHOT PACKET INCOMPLETE — ${scopedScreenshotIssues.join(' ')} Nothing was sent.`);
      }

      const mailAssetUrls = new Set();
      const signedSourceMailImage = async (storagePath, bucket = 'documents') => {
        const { data, error: urlError } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 3600);
        if (urlError || !data?.signedUrl) throw urlError || new Error('Could not prepare a source-bound enclosure URL.');
        mailAssetUrls.add(data.signedUrl);
        return data.signedUrl;
      };

      const downloadVerifiedImage = async (document, heading, bucket = 'documents') => {
        const storagePath = document.storage_path || document.storagePath;
        const { data: blob, error: downloadError } = await supabase.storage.from(bucket).download(storagePath);
        if (downloadError || !blob) throw downloadError || new Error(`Could not read ${heading}.`);
        const mediaType = inferMediaType(document.file_name || document.fileName, blob.type || document.content_type || document.mediaType);
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mediaType)) {
          throw new Error(`${document.file_name || document.fileName || heading} must be JPG, PNG, or WebP before this CCC packet can be mailed. Nothing was sent.`);
        }
        const expectedSize = document.byte_size ?? document.size;
        if (expectedSize != null && blob.size !== Number(expectedSize)) {
          throw new Error(`${document.file_name || document.fileName || heading} no longer matches its reviewed file size. Nothing was sent.`);
        }
        const expectedSha = document.sha256;
        if (expectedSha && await sha256Hex(await blob.arrayBuffer()) !== expectedSha) {
          throw new Error(`${document.file_name || document.fileName || heading} failed its reviewed file fingerprint. Nothing was sent.`);
        }
        return { blob, mediaType, storagePath };
      };

      let enclosurePages = '';
      for (const screenshot of screenshotManifest) {
        const verifiedImage = await downloadVerifiedImage(screenshot, 'a required account screenshot', DISPUTE_SCREENSHOT_BUCKET);
        enclosurePages += renderCccImageExhibit({
          kind: 'screenshot',
          id: screenshot.id,
          heading: `Credit Report Exhibit — ${screenshot.furnisher || 'Account'} — ${screenshot.accountNumberMasked || 'account number not shown'}`,
          imageUrl: await signedSourceMailImage(verifiedImage.storagePath, DISPUTE_SCREENSHOT_BUCKET),
          screenshot: true,
        });
      }

      if (requiresIdentityDocuments) {
        for (const [document, kind, heading] of [
          [idDoc, 'identity-id', 'Enclosure — Government-Issued Photo ID'],
          [addressDoc, 'identity-address', 'Enclosure — Proof of Current Address'],
        ]) {
          const verifiedImage = await downloadVerifiedImage(document, heading);
          enclosurePages += renderCccImageExhibit({
            kind,
            id: document.id,
            heading,
            imageUrl: await signedSourceMailImage(verifiedImage.storagePath),
          });
        }
      }

      const attachmentManifest = [];
      let optionalPageCount = 0;
      for (const document of optionalDocs) {
        if (!selectedOtherDocIds.has(document.id)) continue;
        optionalPageCount += 1;
        if (optionalPageCount > 4) throw new Error('Optional supporting documents may contain at most 4 total pages.');
        const heading = `Enclosure — ${document.label || document.file_name}`;
        const verifiedImage = await downloadVerifiedImage(document, heading);
        if (verifiedImage.blob.size > 5 * 1024 * 1024) throw new Error(`${document.file_name} exceeds the 5 MB optional-document limit.`);
        enclosurePages += renderCccImageExhibit({
          kind: 'optional',
          id: document.id,
          heading,
          imageUrl: await signedSourceMailImage(verifiedImage.storagePath),
        });
        attachmentManifest.push({
          document_id: document.id,
          file_name: document.file_name,
          storage_path: document.storage_path,
          byte_size: verifiedImage.blob.size,
          page_count: 1,
        });
      }

      const canonicalLetterHtml = canonicalizeCccLetterHtml(letter.html);
      const letterSha256 = await sha256Hex(new TextEncoder().encode(
        cccLetterBindingInput(letter.id, canonicalLetterHtml),
      ));
      const finalHtml = assembleBoundCccMailpiece({
        letterId: letter.id,
        letterHtml: letter.html,
        letterSha256,
        enclosureHtml: enclosurePages,
      });
      const foreignImages = remoteImageSources(finalHtml).filter((url) => !mailAssetUrls.has(url));
      if (foreignImages.length) {
        throw new Error(`MAILPIECE CONTAINS NON-DURABLE IMAGE LINKS — remove or embed them before sending: ${foreignImages.slice(0, 5).join(', ')} Nothing was sent.`);
      }

      const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'unknown';
      const batchId = String(Date.now());
      const tempFileName = `${slug(letter.clientName)}-${letter.clientId}-${slug(letter.furnisher)}.html`;
      const tempPath = tempLetterPath(user.id, batchId, tempFileName);
      const htmlBlob = new Blob([finalHtml], { type: 'text/html;charset=utf-8' });
      const { error: uploadError } = await supabase.storage.from('documents').upload(tempPath, htmlBlob, {
        upsert: true,
        contentType: 'text/html;charset=utf-8',
      });
      if (uploadError) throw new Error(`Could not upload the letter for mailing: ${uploadError.message}`);
      tempPathsToClean.push(tempPath);
      const { data: urlData, error: urlError } = await supabase.storage.from('documents').createSignedUrl(tempPath, 3600);
      if (urlError || !urlData?.signedUrl) throw urlError || new Error('Could not prepare the mailpiece URL.');

      const response = await callLob('send_letter', {
        toAddress: toAddr,
        fromAddress: FROM_ADDRESS,
        remoteUrl: urlData.signedUrl,
        description: `${letter.clientName} — ${letter.furnisher} — ${letter.phase}${enclosurePages ? ' (with enclosures)' : ''}`,
        metadata: { letter_id: String(letter.id) },
        enclosureManifest: {
          kind: 'ccc_packet_v1',
          screenshot_storage_paths: screenshotManifest.map((item) => item.storagePath),
          identity_document_ids: requiresIdentityDocuments ? [idDoc.id, addressDoc.id] : [],
          identity_storage_paths: requiresIdentityDocuments ? [idDoc.storage_path, addressDoc.storage_path] : [],
          identity_document_sha256: requiresIdentityDocuments ? [idDoc.sha256, addressDoc.sha256] : [],
        },
        attachmentManifest,
      });

      const alreadyRecorded = response.duplicate && response.mail_submission_status === 'submitted';
      setResult(response);
      setStep('sent');

      let saveError = null;
      if (!alreadyRecorded) {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          try {
            await onSent({
              lobId: response.id,
              mailedDate: response.mailed_date || new Date().toISOString().slice(0, 10),
              trackingNumber: null,
              mailService: USPS_FIRST_CLASS,
              expectedDeliveryDate: response.expected_delivery_date || null,
            });
            saveError = null;
            break;
          } catch (persistError) {
            saveError = persistError;
            await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
          }
        }
      }
      if (saveError) {
        setError(`The letter WAS mailed (Lob ID ${response.id}), but saving the local mail record failed: ${saveError.message || saveError}. Do NOT resend.`);
      }

      if (!response.duplicate) {
        try {
          const { data: profiles } = await supabase.from('client_profiles')
            .select('email,full_name')
            .eq('client_id', letter.clientId)
            .limit(1);
          const profile = profiles?.[0];
          if (profile?.email) {
            const { data: { session } } = await supabase.auth.getSession();
            fetch('/.netlify/functions/send-lpoa', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
              },
              body: JSON.stringify({
                action: 'send_phase_notification',
                clientName: profile.full_name,
                clientEmail: profile.email,
                phase: 'ccc_dispute_mailed',
                details: `${letter.phase} campaign letter`,
                furnisher: letter.furnisher,
              }),
            }).catch((notificationError) => console.warn('CCC mail notification failed:', notificationError));
          }
        } catch (notificationError) {
          console.warn('CCC mail notification failed:', notificationError);
        }
      }
    } catch (sendError) {
      setError(sendError.message || 'Send failed.');
      if (tempPathsToClean.length) {
        supabase.storage.from('documents').remove(tempPathsToClean).catch((cleanupError) => {
          console.warn('Could not clean temporary mail assets:', cleanupError?.message || cleanupError);
        });
      }
    } finally {
      setSending(false);
    }
  };

  const retired = !isCurrentCccLetter || wrongMailService;
  const sendDisabled = sending || retired || !documentsLoaded || identityDocumentsMissing
    || screenshotPacketMissing || !verified || !toAddr.line1 || !toAddr.city
    || !toAddr.state || !toAddr.zip || letter?.enclosureParseBlocked;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded border border-border w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-navy rounded-t">
          <div>
            <div className="text-white text-[14px] font-medium ccc-display">{retired ? 'Historical Letter' : 'Send via Lob'}</div>
            <div className="text-gold text-[11px] uppercase tracking-wider mt-0.5">{letter?.furnisher} · {letter?.clientName}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Close mailer"><X size={18} strokeWidth={1.75} /></button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {retired ? (
            <div className="rounded border border-amber-200 bg-amber-50 p-4">
              <div className="text-[12px] font-bold uppercase tracking-wider text-amber-900">Read-only historical record</div>
              <p className="mt-2 text-[12px] leading-relaxed text-amber-800">{RETIRED_MAIL_MESSAGE}</p>
            </div>
          ) : step === 'confirm' ? (
            <div className="space-y-4">
              {letter?.enclosureParseBlocked && (
                <div className="rounded border-2 border-red-500 bg-red-50 p-3 text-[12px] text-red-700">
                  <strong className="block uppercase tracking-wider text-red-800">Blocked — manual review required</strong>
                  Re-upload and review the enclosure before mailing. Nothing was sent.
                </div>
              )}
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2 flex items-center gap-1.5"><MapPin size={11} strokeWidth={2} /> Sending To</div>
                <div className="space-y-2">
                  <AddressField label="Name / Entity" value={toAddr.name} onChange={(value) => { setToAddr((current) => ({ ...current, name: value })); setVerified(false); }} />
                  <AddressField label="Address Line 1" value={toAddr.line1} onChange={(value) => { setToAddr((current) => ({ ...current, line1: value })); setVerified(false); }} />
                  <AddressField label="Address Line 2 (optional)" value={toAddr.line2} onChange={(value) => { setToAddr((current) => ({ ...current, line2: value })); setVerified(false); }} />
                  <div className="grid grid-cols-3 gap-2">
                    <AddressField label="City" value={toAddr.city} onChange={(value) => { setToAddr((current) => ({ ...current, city: value })); setVerified(false); }} />
                    <AddressField label="State" value={toAddr.state} onChange={(value) => { setToAddr((current) => ({ ...current, state: value })); setVerified(false); }} />
                    <AddressField label="ZIP" value={toAddr.zip} onChange={(value) => { setToAddr((current) => ({ ...current, zip: value })); setVerified(false); }} />
                  </div>
                </div>
                {verified && <div className="flex items-center gap-1.5 text-[11px] text-green-700 mt-2"><CheckCircle size={12} strokeWidth={2} /> Address verified by USPS</div>}
              </div>

              <div className="border border-border rounded-sm p-3">
                <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Required packet</div>
                <div className="space-y-1.5 text-[12px]">
                  <div className="flex items-start gap-2"><CheckCircle size={12} className="text-green-600 mt-0.5" /><span>Approved CCC letter and required account screenshot exhibits</span></div>
                  {requiresIdentityDocuments && (
                    <>
                      <div className="flex items-start gap-2">{idDoc ? <CheckCircle size={12} className="text-green-600 mt-0.5" /> : <AlertCircle size={12} className="text-red-500 mt-0.5" />}<span className={idDoc ? '' : 'text-red-700'}>{idDoc ? `Government ID — ${idDoc.file_name}` : 'Required government ID is missing'}</span></div>
                      <div className="flex items-start gap-2">{addressDoc ? <CheckCircle size={12} className="text-green-600 mt-0.5" /> : <AlertCircle size={12} className="text-red-500 mt-0.5" />}<span className={addressDoc ? '' : 'text-red-700'}>{addressDoc ? `Proof of Address — ${addressDoc.file_name}` : 'Required proof of current address is missing'}</span></div>
                    </>
                  )}
                  {!requiresIdentityDocuments && <div className="text-[11px] text-ink-muted">ID and proof of address attach to CCC R1 only.</div>}
                </div>
                {optionalDocs.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-border">
                    <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-1.5">Optional supporting images</div>
                    <div className="space-y-1">{optionalDocs.map((document) => (
                      <label key={document.id} className="flex items-center gap-2 text-[12px] cursor-pointer">
                        <input type="checkbox" checked={selectedOtherDocIds.has(document.id)} onChange={() => toggleOtherDoc(document.id)} className="accent-navy" />
                        <span>{document.label || document.file_name}</span>
                      </label>
                    ))}</div>
                    <div className="text-[10px] text-ink-faint mt-1">Up to 4 JPG, PNG, or WebP pages; 5 MB each.</div>
                  </div>
                )}
              </div>

              <div className="border border-border rounded-sm p-3 bg-gray-50">
                <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-1">Sending From</div>
                <div className="text-[12px] text-ink">{FROM_ADDRESS.name}</div>
                <div className="text-[11px] text-ink-muted">{FROM_ADDRESS.line1}, {FROM_ADDRESS.city}, {FROM_ADDRESS.state} {FROM_ADDRESS.zip}</div>
              </div>
              <div className="border border-blue-200 rounded-sm p-3 bg-blue-50 text-[11px] text-blue-900 leading-relaxed">
                <strong>USPS First-Class Mail</strong> — Lob prints and mails one packet. CCC records the mailpiece status and expected delivery estimate; this service does not create a certified tracking number or signed receipt.
              </div>
              {error && <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>}
            </div>
          ) : result ? (
            <div className="text-center py-6">
              <CheckCircle size={36} className="text-green-600 mx-auto mb-3" strokeWidth={1.5} />
              <div className="text-[14px] text-ink font-medium ccc-display mb-1">{result.duplicate ? 'Already Submitted' : 'Letter Sent'}</div>
              <div className="text-[12px] text-ink-muted mb-4">{result.duplicate ? 'Lob already accepted this exact letter; no duplicate was created.' : 'Lob is printing and mailing the packet via USPS First-Class Mail.'}</div>
              <div className="border border-border rounded-sm p-4 text-left space-y-2">
                <div className="text-[11px]"><span className="text-ink-faint uppercase tracking-wider">Lob ID: </span><span className="text-ink font-medium">{result.id}</span></div>
                <div className="text-[11px]"><span className="text-ink-faint uppercase tracking-wider">Expected Delivery: </span><span className="text-ink">{result.expected_delivery_date ? new Date(`${result.expected_delivery_date}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'Pending Lob estimate'}</span></div>
                {result.url && <div className="text-[11px]"><span className="text-ink-faint uppercase tracking-wider">Mailpiece: </span><a href={result.url} target="_blank" rel="noopener noreferrer" className="text-navy hover:text-gold underline underline-offset-2">View the exact PDF mailed</a></div>}
              </div>
              {error && <div className="mt-4 text-[12px] text-left text-amber-800 bg-amber-50 border border-amber-300 rounded-sm px-3 py-2">{error}</div>}
            </div>
          ) : null}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <button onClick={step === 'sent' && batchRemaining > 0 ? onNext : onClose} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">{step === 'sent' ? (batchRemaining > 0 ? `Next Letter (${batchRemaining})` : 'Close') : retired ? 'Close' : 'Cancel'}</button>
          {!retired && step === 'confirm' && (
            <div className="flex items-center gap-3">
              {!verified && <span className="text-[10px] text-ink-faint">Verify the address to enable sending</span>}
              {!verified && <button onClick={handleVerify} disabled={verifying || !toAddr.line1 || !toAddr.city || !toAddr.state || !toAddr.zip} className="px-4 py-2 text-[11px] uppercase tracking-wider rounded-sm border border-navy text-navy hover:bg-navy hover:text-gold transition-colors disabled:opacity-40">{verifying ? 'Verifying…' : 'Verify Address'}</button>}
              <button onClick={handleSend} disabled={sendDisabled} title={identityDocumentsMissing ? 'Blocked: CCC R1 requires the exact verified ID and proof of address' : screenshotPacketMissing ? 'Blocked: required account screenshots are missing or invalid' : !verified ? 'Verify the address first' : undefined} className="flex items-center gap-2 px-5 py-2 text-[12px] uppercase tracking-wider rounded-sm transition-colors disabled:bg-gray-400 disabled:text-white" style={{ backgroundColor: sendDisabled ? undefined : '#1B2A4A', color: sendDisabled ? undefined : '#C9A84C' }}><Send size={13} strokeWidth={2} />{sending ? 'Sending…' : 'Send First Class'}</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
