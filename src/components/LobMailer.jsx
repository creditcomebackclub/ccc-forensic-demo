import React, { useEffect, useState } from 'react';
import { X, Send, CheckCircle, AlertCircle, MapPin } from 'lucide-react';
import { getDocuments, getDocumentBase64 } from '../utils/documents';
import { listMailArtifacts } from '../utils/mailArtifacts';
import { inferMediaType } from '../utils/responseFiles';
import { supabase } from '../utils/supabase';

const LOB_FUNCTION_URL = '/.netlify/functions/lob';

// The standalone LPOA page's own decorative navy header (title + "Executed
// <date>") is redundant once embedded as an enclosure — our own "Enclosure
// X of Y — Limited Power of Attorney" banner already says what this page
// is. Stripping it isn't just cosmetic: that header block is tall enough
// (padding + line-height + margin) that leaving it in was pushing the
// LPOA just past one physical page in Lob's real rendering, spilling its
// last two lines onto an otherwise-blank extra page — confirmed by
// downloading and inspecting the actual mailed PDF for a real letter.
// Removing it reclaims comfortably more height than that overflow.
function stripLpoaHeader(lpoaBody) {
  return lpoaBody.replace(/<div class="header">[\s\S]*?<\/div>/i, '');
}

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
  const res = await fetch(LOB_FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || data.message || 'Lob request failed');
  return data;
}

function AddressField({ label, value, onChange }) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-border rounded-sm px-3 py-1.5 text-[12px] text-ink focus:outline-none focus:border-navy"
      />
    </div>
  );
}

export default function LobMailer({ letter, furnisherAddress, onClose, onSent, onNext, batchRemaining = 0 }) {
  const [step, setStep] = useState('confirm');
  const [toAddr, setToAddr] = useState(furnisherAddress || { name: letter.furnisher, line1: '', line2: '', city: '', state: '', zip: '' });
  const [docs, setDocs] = useState([]);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    getDocuments(letter.clientName, letter.clientId).then(setDocs).catch(console.error);
  }, [letter.clientName, letter.clientId]);

  const idDoc = docs.find((d) => d.doc_type === 'id');
  const addressDoc = docs.find((d) => d.doc_type === 'address');

  const handleVerify = async () => {
    setVerifying(true);
    setError(null);
    try {
      const res = await callLob('verify_address', { address: toAddr });
      if (res.deliverability === 'undeliverable') {
        setError('Address appears undeliverable — please verify and correct it');
      } else {
        setVerified(true);
        if (res.primary_line) {
          setToAddr((prev) => ({
            ...prev,
            line1: res.primary_line,
            line2: res.secondary_line || '',
            city: res.components?.city || prev.city,
            state: res.components?.state || prev.state,
            zip: res.components?.zip_code || prev.zip,
          }));
        }
      }
    } catch (e) {
      setError('Address verification failed: ' + e.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleSend = async () => {
    // Client-side guard mirrors the real, server-side block in lob.cjs
    // (which checks the DB row directly and cannot be bypassed) — this one
    // just avoids a wasted round-trip and gives an immediate, specific
    // error instead of a generic Lob failure.
    if (letter.enclosureParseBlocked) {
      setError('ENCLOSURE UNPARSED — MANUAL RECONCILIATION REQUIRED. This letter cannot be sent until the enclosure is re-uploaded and re-analyzed.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'unknown';

      // Lob prints HTML, not a multi-file attachment bundle. To include an
      // immutable PDF as evidence, render each original PDF page to an image
      // and embed it in the outgoing HTML. The archived source PDF remains
      // untouched in private storage for CFPB/AG portal uploads and audit.
      const blobToBase64 = (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const renderPdfBase64 = async (b64, heading) => {
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
        const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
        let html = '<div style="page-break-before:always;padding:40px;font-family:Arial,sans-serif;">'
          + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#1B2A4A;font-weight:700;margin-bottom:8px;border-bottom:2px solid #1B2A4A;padding-bottom:8px;">' + heading + '</div>';
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
          html += '<img src="' + canvas.toDataURL('image/jpeg', 0.9) + '" style="max-width:100%;display:block;margin-bottom:10px;" />';
        }
        return html + '</div>';
      };

      const renderPdfPages = async (storagePath, heading) =>
        renderPdfBase64(await getDocumentBase64(storagePath), heading);

      // Furnisher-response evidence is kept in the private `responses`
      // bucket, not the client documents bucket. Read it directly while a
      // staff member is sending the Phase 3 letter, then turn each original
      // PDF/image into print-ready Lob HTML. This keeps the response itself
      // in the mailed record rather than merely linking to a transient URL.
      const renderResponseFile = async (storagePath, fileName, heading) => {
        const { data, error: downloadError } = await supabase.storage
          .from('responses')
          .download(storagePath);
        if (downloadError || !data) throw downloadError || new Error('Response file could not be downloaded.');

        const b64 = await blobToBase64(data);
        const mediaType = inferMediaType(fileName, data.type);
        if (mediaType === 'application/pdf') return renderPdfBase64(b64, heading);
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(mediaType)) {
          throw new Error('Unsupported response evidence type: ' + (fileName || storagePath));
        }
        return '<div style="page-break-before:always;padding:40px;font-family:Arial,sans-serif;">'
          + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#1B2A4A;font-weight:700;margin-bottom:8px;border-bottom:2px solid #1B2A4A;padding-bottom:8px;">' + heading + '</div>'
          + '<img src="data:' + mediaType + ';base64,' + b64 + '" style="max-width:100%;display:block;margin-bottom:8px;" />'
          + '</div>';
      };

      const buildDocumentEnclosure = async (doc, heading) => {
        if (!doc) return '';
        const isImg = doc.file_name && /\.(jpg|jpeg|png)$/i.test(doc.file_name);
        if (!isImg) return renderPdfPages(doc.storage_path, heading);
        const b64 = await getDocumentBase64(doc.storage_path);
        const type = doc.file_name.toLowerCase().endsWith('.png') ? 'png' : 'jpeg';
        return '<div style="page-break-before:always;padding:40px;font-family:Arial,sans-serif;filter:grayscale(100%);-webkit-filter:grayscale(100%);">'
          + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#666;margin-bottom:16px;border-bottom:1px solid #eee;padding-bottom:8px;">' + heading + '</div>'
          + '<img src="data:image/' + type + ';base64,' + b64 + '" style="max-width:100%;max-height:700px;" />'
          + '</div>';
      };

      // Government ID + proof of address enclosure pages — shared by the
      // Phase 1 branch (always) and, conditionally, the Phase 3 branch
      // below (only when no Phase 1 letter was ever actually mailed, so
      // the bureau has no identity documentation from us on file at all).
      const buildIdAddressPages = async () => {
        let pages = '';
        pages += await buildDocumentEnclosure(idDoc, 'Enclosure — Government-Issued Photo ID');
        pages += await buildDocumentEnclosure(addressDoc, 'Enclosure — Proof of Current Address');
        return pages;
      };

      // Build enclosure pages — different for Phase 3 vs Phase 1
      let enclosurePages = '';
      const isPhase3 = letter.phase && letter.phase.startsWith('Phase 3');

      if (isPhase3) {
        // Phase 3 enclosures: Exhibit A (Phase 1 letter(s)) + Exhibit B (furnisher response(s)) + LPOA
        // A single bureau letter can legitimately cover more than one
        // original furnisher (grouped by which bureau each account
        // reports to) — letter.furnisher on a bureau-facing Phase 3 row
        // is the bureau itself, not any one of the furnishers it covers,
        // so fetch every Phase 1 letter for this client rather than
        // filtering by furnisher (that filter can never match). When the
        // Phase 3 row's own coveredFurnishers is populated, narrow down
        // to just those — it's the authoritative record of which
        // furnishers this specific bureau letter actually discusses.
        let allPhase1Letters = [];
        let phase1Letters = [];
        try {
          // clientId preferred — client_name alone can pull in another
          // same-named client's Phase 1 letters as exhibits.
          const phase1Query = letter.clientId
            ? supabase.from('letters').select('id, furnisher, html, saved_at, lob_id').eq('client_id', letter.clientId).ilike('phase', 'Phase 1%').order('saved_at', { ascending: true })
            : supabase.from('letters').select('id, furnisher, html, saved_at, lob_id').eq('client_name', letter.clientName).ilike('phase', 'Phase 1%').order('saved_at', { ascending: true });
          const { data } = await phase1Query;
          allPhase1Letters = data || [];
          phase1Letters = (letter.coveredFurnishers && letter.coveredFurnishers.length > 0)
            ? allPhase1Letters.filter((p1) => letter.coveredFurnishers.includes(p1.furnisher))
            : allPhase1Letters;
        } catch(e) { console.warn('Could not fetch Phase 1 letters:', e); }

        // Exhibit A — use the immutable Lob mailpiece whenever it was
        // archived. Historic mail without an artifact falls back to the
        // stored HTML so no existing case is blocked by this improvement.
        let artifactsByLetter = new Map();
        try {
          const artifacts = await listMailArtifacts(phase1Letters.map((p1) => p1.id));
          artifactsByLetter = new Map(artifacts
            .filter((artifact) => artifact.artifact_type === 'mailpiece_pdf')
            .map((artifact) => [artifact.letter_id, artifact]));
        } catch (e) { console.warn('Could not load archived Phase 1 mailpieces:', e); }
        for (const p1 of phase1Letters) {
          const mailpiece = artifactsByLetter.get(p1.id);
          if (mailpiece) {
            try {
              enclosurePages += await renderPdfPages(
                mailpiece.storage_path,
                'EXHIBIT A — Exact Lob Phase 1 Mailpiece (' + (p1.furnisher || 'Furnisher') + ')'
              );
              continue;
            } catch (e) { console.warn('Could not render archived Phase 1 mailpiece:', p1.id, e); }
          }
          if (!p1.html) continue;
          const p1Body = p1.html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
          const p1Content = p1Body ? p1Body[1] : p1.html;
          enclosurePages += '<div style="page-break-before:always;padding:40px;font-family:Arial,sans-serif;font-size:12px;">'
            + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#1B2A4A;font-weight:700;margin-bottom:8px;border-bottom:2px solid #1B2A4A;padding-bottom:8px;">EXHIBIT A — Phase 1 Direct Furnisher Dispute Letter (' + (p1.furnisher || 'Furnisher') + ')</div>'
            + p1Content + '</div>';
        }

        // Exhibit B — first use the durable response-evidence records. The
        // old application stored files directly under `<clientUserId>/<p1Id>`
        // without a DB record, so retain that folder scan as a migration
        // fallback. A persisted evidence row is deliberately fail-closed:
        // never send a Phase 3 packet that says an attached response exists
        // while silently omitting one of its original files.
        const p1Ids = phase1Letters.map((p1) => p1.id).filter(Boolean);
        const durableEvidenceByLetter = new Map();
        if (p1Ids.length > 0) {
          const { data: durableEvidence, error: durableEvidenceError } = await supabase
            .from('response_evidence')
            .select('id,letter_id,storage_bucket,storage_paths,file_names,received_at,created_at')
            .in('letter_id', p1Ids)
            .eq('response_kind', 'furnisher')
            .eq('upload_status', 'received')
            .order('received_at', { ascending: true });
          if (durableEvidenceError) throw durableEvidenceError;
          for (const record of durableEvidence || []) {
            const current = durableEvidenceByLetter.get(record.letter_id) || [];
            current.push(record);
            durableEvidenceByLetter.set(record.letter_id, current);
          }
        }

        for (const p1 of phase1Letters) {
          const responseHeading = 'EXHIBIT B — Furnisher Response (' + (p1.furnisher || letter.furnisher) + ')';
          const durableEvidence = durableEvidenceByLetter.get(p1.id) || [];
          for (const record of durableEvidence) {
            const paths = Array.isArray(record.storage_paths) ? record.storage_paths : [];
            const names = Array.isArray(record.file_names) ? record.file_names : [];
            if (record.storage_bucket !== 'responses' || paths.length === 0) {
              throw new Error('Received response evidence is incomplete for ' + (p1.furnisher || 'this furnisher') + '. Resolve it before mailing Phase 3.');
            }
            for (let index = 0; index < paths.length; index += 1) {
              const fileName = names[index] || String(paths[index]).split('/').pop();
              enclosurePages += await renderResponseFile(paths[index], fileName, responseHeading);
            }
          }
        }

        // Legacy response-folder fallback. It intentionally supports PDFs as
        // well as images so historic original responses are not reduced to a
        // converted JPEG-only attachment. Missing legacy files stay a
        // warning (they predate durable evidence), while durable records
        // above remain a hard stop if any expected file cannot be attached.
        try {
          const cpQuery = letter.clientId
            ? supabase.from('client_profiles').select('user_id').eq('client_id', letter.clientId).limit(1)
            : supabase.from('client_profiles').select('user_id').eq('full_name', letter.clientName).limit(1);
          const { data: cp } = await cpQuery;
          const clientUserId = cp && cp.length > 0 ? cp[0].user_id : null;
          if (clientUserId) {
            for (const p1 of phase1Letters) {
              const { data: responseFiles, error: legacyListError } = await supabase.storage.from('responses')
                .list(clientUserId + '/' + p1.id, { limit: 20, sortBy: { column: 'name', order: 'asc' } });
              if (legacyListError) throw legacyListError;
              for (const responseFile of responseFiles || []) {
                if (!/\.(pdf|jpg|jpeg|png|webp)$/i.test(responseFile.name)) continue;
                const responsePath = clientUserId + '/' + p1.id + '/' + responseFile.name;
                try {
                  enclosurePages += await renderResponseFile(
                    responsePath,
                    responseFile.name,
                    'EXHIBIT B — Legacy Furnisher Response (' + (p1.furnisher || letter.furnisher) + ')'
                  );
                } catch (e) {
                  console.warn('Could not render legacy furnisher response:', responsePath, e);
                }
              }
            }
          }
        } catch(e) { console.warn('Could not fetch legacy furnisher response(s):', e); }

        // LPOA still included for Phase 3
        try {
          const clientMetaQuery = letter.clientId
            ? supabase.from('clients').select('lpoa_signature_data').eq('id', letter.clientId).limit(1)
            : supabase.from('clients').select('lpoa_signature_data').eq('name', letter.clientName).limit(1);
          const { data: clientMeta } = await clientMetaQuery;
          if (clientMeta && clientMeta.length > 0 && clientMeta[0].lpoa_signature_data?.lpoaUrl) {
            const lpoaRes = await fetch(clientMeta[0].lpoa_signature_data.lpoaUrl);
            const lpoaHtml = await lpoaRes.text();
            const styleMatch = lpoaHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
            const lpoaStyle = styleMatch ? '<style>' + styleMatch[1] + '</style>' : '';
            const bodyMatch = lpoaHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            const lpoaBody = stripLpoaHeader(bodyMatch ? bodyMatch[1] : lpoaHtml);
            enclosurePages += '<div style="page-break-before:always;font-family:Arial,sans-serif;font-size:12px;">'
              + lpoaStyle
              + '<div style="padding:8px 40px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#666;margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:8px;">Enclosure — Limited Power of Attorney</div>'
              + lpoaBody + '</div>';
          }
        } catch(e) { console.warn('Could not fetch LPOA for Phase 3:', e); }

        // If no Phase 1 letter was ever actually transmitted through our
        // own Lob integration (lob_id — not mailed_date, which on a
        // migrated client can just be a historical annotation of a real
        // mailing sent through a different channel, e.g. Dispute Fox),
        // the bureau has never received identity verification from us at
        // all — include it directly rather than assuming it's on file.
        // Checked against every Phase 1 letter for the client (not just
        // the coveredFurnishers-narrowed subset above) since this is a
        // client-wide fact, not specific to this one bureau letter.
        const anyPhase1SentViaLob = allPhase1Letters.some((p1) => p1.lob_id);
        if (!anyPhase1SentViaLob) {
          enclosurePages += await buildIdAddressPages();
        }

      } else {
        // Phase 1 enclosures: LPOA + ID + Address
        try {
          const clientMetaQuery = letter.clientId
            ? supabase.from('clients').select('lpoa_signature_data').eq('id', letter.clientId).limit(1)
            : supabase.from('clients').select('lpoa_signature_data').eq('name', letter.clientName).limit(1);
          const { data: clientMeta } = await clientMetaQuery;
          if (clientMeta && clientMeta.length > 0 && clientMeta[0].lpoa_signature_data && clientMeta[0].lpoa_signature_data.lpoaUrl) {
            const lpoaRes = await fetch(clientMeta[0].lpoa_signature_data.lpoaUrl);
            const lpoaHtml = await lpoaRes.text();
            const styleMatch = lpoaHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
            const lpoaStyle = styleMatch ? '<style>' + styleMatch[1] + '</style>' : '';
            const bodyMatch = lpoaHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            const lpoaBody = stripLpoaHeader(bodyMatch ? bodyMatch[1] : lpoaHtml);
            enclosurePages += '<div style="page-break-before:always;font-family:Arial,sans-serif;font-size:12px;">'
              + lpoaStyle
              + '<div style="padding:8px 40px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#666;margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:8px;">Enclosure 1 of ' + (idDoc ? (addressDoc ? '3' : '2') : '1') + ' — Limited Power of Attorney</div>'
              + lpoaBody + '</div>';
          }
        } catch(e) { console.warn('Could not fetch LPOA:', e); }

        enclosurePages += await buildIdAddressPages();
      }

      // Merge letter HTML with enclosure pages, then upload once
      let finalHtml = letter.html;
      if (enclosurePages) {
        if (finalHtml.includes('</body>')) finalHtml = finalHtml.replace('</body>', enclosurePages + '</body>');
        else finalHtml += enclosurePages;
      }
      // Several stored letters are bare content fragments with no
      // <html>/<head> at all — with no charset declared anywhere, Lob's
      // PDF renderer has been guessing a single-byte encoding and garbling
      // every multi-byte UTF-8 character (—, §, ®) in the actual mailed
      // letter, even though the source text itself is stored correctly.
      if (!/<meta[^>]+charset/i.test(finalHtml)) {
        if (/<head[^>]*>/i.test(finalHtml)) {
          finalHtml = finalHtml.replace(/<head[^>]*>/i, (m) => m + '<meta charset="UTF-8">');
        } else {
          finalHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' + finalHtml + '</body></html>';
        }
      }
      // clientId (when known) alongside the readable slug — Date.now() already
      // makes an exact collision unlikely, but this is a temp path for a
      // physical-mail send, not worth leaving on name alone when the id is
      // sitting right there.
      const tempPath = user.id + '/temp-letters/' + slug(letter.clientName) + (letter.clientId ? '-' + letter.clientId : '') + '-' + slug(letter.furnisher) + '-' + Date.now() + '.html';
      const htmlBlob = new Blob([finalHtml], { type: 'text/html;charset=utf-8' });
      const { error: uploadErr } = await supabase.storage.from('documents').upload(tempPath, htmlBlob, { upsert: true, contentType: 'text/html;charset=utf-8' });
      if (uploadErr) throw new Error('Could not upload letter for mailing: ' + uploadErr.message);
      const { data: urlData, error: urlErr } = await supabase.storage.from('documents').createSignedUrl(tempPath, 3600);
      if (urlErr || !urlData) throw new Error('Could not get letter URL' + (urlErr ? ': ' + urlErr.message : ''));

      const res = await callLob('send_letter', {
        toAddress: toAddr,
        fromAddress: FROM_ADDRESS,
        remoteUrl: urlData.signedUrl,
        description: letter.clientName + ' — ' + letter.furnisher + ' — ' + letter.phase + (enclosurePages ? ' (w/ enclosures)' : ''),
        // The server creates and persists the idempotency key before it asks
        // Lob to print. A browser timestamp is unsafe: retrying after a
        // timeout would otherwise create a second physical letter.
        metadata: { letter_id: String(letter.id) },
      });

      // A duplicate response means Lob already accepted this exact durable
      // submission. Do not overwrite an existing delivered/mail date or send
      // the client a second "mailed" email. An accepted-but-unreconciled
      // record is the one exception: its local letter row still needs repair.
      const alreadyRecorded = res.duplicate && res.mail_submission_status === 'submitted';

      // The letter IS mailed at this point — persist the record with retries,
      // and never let a save failure look like a send failure (resend = double postage)
      let saveErr = null;
      if (!alreadyRecorded) {
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            await onSent({
              lobId: res.id,
              mailedDate: res.mailed_date || new Date().toISOString().slice(0, 10),
              trackingNumber: res.tracking_number || null,
            });
            saveErr = null;
            break;
          } catch (e) {
            saveErr = e;
            await new Promise((r) => setTimeout(r, attempt * 1000));
          }
        }
      }

      setResult(res);
      setStep('sent');
      if (saveErr) {
        setError('The letter WAS mailed (Lob ID ' + res.id + '), but saving the mail record failed: '
          + (saveErr.message || saveErr) + '. Do NOT resend — note the Lob ID and set the mail date on the letter manually.');
      }

      // Fire phase notification (non-blocking) only for a new physical
      // submission. clientId is preferred — the
      // ilike match here vs. exact-match elsewhere in the app was a known
      // inconsistency where a case-mismatched client could get this email
      // while other client_name-keyed reads (e.g. the portal) silently
      // returned nothing for them.
      if (!res.duplicate) {
        try {
          const notifyCpQuery = letter.clientId
            ? supabase.from('client_profiles').select('email,full_name').eq('client_id', letter.clientId).limit(1)
            : supabase.from('client_profiles').select('email,full_name').ilike('full_name', letter.clientName).limit(1);
          const { data: cp } = await notifyCpQuery;
          if (cp && cp.length > 0 && cp[0].email) {
            const { data: { session } } = await supabase.auth.getSession();
            const token = session?.access_token;
            fetch('/.netlify/functions/send-lpoa', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
              },
              body: JSON.stringify({
                action: 'send_phase_notification',
                clientName: cp[0].full_name,
                clientEmail: cp[0].email,
                // Pre-existing bug, independent of mail class: this was
                // hardcoded 'phase1_mailed' for every send, so a Phase 3
                // bureau letter's client email said "Your Phase 1 dispute
                // letter... mailed via Certified Mail" — wrong phase label
                // regardless of what actually mailed. isPhase3 above already
                // tracks this correctly for the enclosure logic.
                phase: isPhase3 ? 'phase3_mailed' : 'phase1_mailed',
                furnisher: letter.furnisher,
                trackingNumber: res.tracking_number || '',
              }),
            }).catch((e) => console.warn('Phase notification failed:', e));
          }
        } catch (e) { console.warn('Phase notification error:', e); }
      }
    } catch (e) {
      setError(e.message || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded border border-border w-full max-w-lg flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-navy rounded-t">
          <div>
            <div className="text-white text-[14px] font-medium ccc-display">Send via Lob</div>
            <div className="text-gold text-[11px] uppercase tracking-wider mt-0.5">{letter.furnisher} · {letter.clientName}</div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={18} strokeWidth={1.75} /></button>
        </div>

        <div className="flex-1 overflow-auto p-6">
          {letter.enclosureParseBlocked && (
            <div className="mb-4 p-3 rounded border-2 border-red-500 bg-red-50">
              <div className="text-[12px] font-bold text-red-800 uppercase tracking-wider mb-1">
                Blocked — Manual Review Required
              </div>
              <div className="text-[12px] text-red-700 mb-2">
                Phase 2 analysis flagged a problem with this letter — either an enclosed document that couldn't be reliably read (reversed/mirrored scan, misaligned rows, inconsistent dates), or a citation-lint failure in the generated letter text. It may assert facts that are unverified, wrong, or legally exposed. Sending is blocked until this is resolved and re-analyzed (re-upload a clean enclosure scan if that's the issue).
              </div>
              {letter.enclosureParseIssues && letter.enclosureParseIssues.length > 0 && (
                <ul className="text-[11px] text-red-700 list-disc pl-4 space-y-0.5">
                  {letter.enclosureParseIssues.map((issue, i) => <li key={i}>{issue}</li>)}
                </ul>
              )}
            </div>
          )}
          {step === 'confirm' && (
            <div className="space-y-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2 flex items-center gap-1.5">
                  <MapPin size={11} strokeWidth={2} /> Sending To
                </div>
                <div className="space-y-2">
                  <AddressField label="Name / Entity" value={toAddr.name} onChange={(v) => { setToAddr((p) => ({ ...p, name: v })); setVerified(false); }} />
                  <AddressField label="Address Line 1" value={toAddr.line1} onChange={(v) => { setToAddr((p) => ({ ...p, line1: v })); setVerified(false); }} />
                  <AddressField label="Address Line 2 (optional)" value={toAddr.line2} onChange={(v) => { setToAddr((p) => ({ ...p, line2: v })); setVerified(false); }} />
                  <div className="grid grid-cols-3 gap-2">
                    <AddressField label="City" value={toAddr.city} onChange={(v) => { setToAddr((p) => ({ ...p, city: v })); setVerified(false); }} />
                    <AddressField label="State" value={toAddr.state} onChange={(v) => { setToAddr((p) => ({ ...p, state: v })); setVerified(false); }} />
                    <AddressField label="ZIP" value={toAddr.zip} onChange={(v) => { setToAddr((p) => ({ ...p, zip: v })); setVerified(false); }} />
                  </div>
                </div>
                {verified && (
                  <div className="flex items-center gap-1.5 text-[11px] text-green-700 mt-2">
                    <CheckCircle size={12} strokeWidth={2} /> Address verified by USPS
                  </div>
                )}
              </div>

              <div className="border border-border rounded-sm p-3">
                <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2">Enclosures</div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 text-[12px]">
                    {idDoc
                      ? <><CheckCircle size={12} strokeWidth={2} className="text-green-600" /><span className="text-ink">Government ID — {idDoc.file_name}</span></>
                      : <><AlertCircle size={12} strokeWidth={2} className="text-amber-500" /><span className="text-ink-muted">No ID uploaded — upload in client Documents section</span></>}
                  </div>
                  <div className="flex items-center gap-2 text-[12px]">
                    {addressDoc
                      ? <><CheckCircle size={12} strokeWidth={2} className="text-green-600" /><span className="text-ink">Proof of Address — {addressDoc.file_name}</span></>
                      : <><AlertCircle size={12} strokeWidth={2} className="text-amber-500" /><span className="text-ink-muted">No proof of address — upload in client Documents section</span></>}
                  </div>
                </div>
              </div>

              <div className="border border-border rounded-sm p-3 bg-gray-50">
                <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-1">Sending From</div>
                <div className="text-[12px] text-ink">{FROM_ADDRESS.name}</div>
                <div className="text-[11px] text-ink-muted">{FROM_ADDRESS.line1}, {FROM_ADDRESS.city}, {FROM_ADDRESS.state} {FROM_ADDRESS.zip}</div>
              </div>

              <div className="border border-border rounded-sm p-3 bg-amber-50">
                <div className="text-[11px] text-amber-800 leading-relaxed">
                  <strong>USPS Certified Mail</strong> — Letter will be printed and mailed by Lob. Mail date and tracking number saved automatically. Verify address before sending.
                </div>
              </div>

              {error && (
                <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>
              )}
            </div>
          )}

          {step === 'sent' && result && (
            <div className="text-center py-6">
              <CheckCircle size={36} className="text-green-600 mx-auto mb-3" strokeWidth={1.5} />
              <div className="text-[14px] text-ink font-medium ccc-display mb-1">{result.duplicate ? 'Already Submitted' : 'Letter Sent'}</div>
              <div className="text-[12px] text-ink-muted mb-4">
                {result.duplicate
                  ? 'Lob had already accepted this letter. No additional mailpiece was created.'
                  : 'Lob is printing and mailing your certified letter with return receipt'}
              </div>
              <div className="border border-border rounded-sm p-4 text-left space-y-2">
                <div className="text-[11px]">
                  <span className="text-ink-faint uppercase tracking-wider">Lob ID: </span>
                  <span className="text-ink font-medium">{result.id}</span>
                </div>
                {result.tracking_number && (
                  <div className="text-[11px]">
                    <span className="text-ink-faint uppercase tracking-wider">Tracking: </span>
                    <span className="text-ink font-medium">{result.tracking_number}</span>
                  </div>
                )}
                <div className="text-[11px]">
                  <span className="text-ink-faint uppercase tracking-wider">Expected Delivery: </span>
                  <span className="text-ink">
                    {result.expected_delivery_date
                      ? new Date(result.expected_delivery_date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                      : '3-5 business days'}
                  </span>
                </div>
                {result.url && (
                  <div className="text-[11px]">
                    <span className="text-ink-faint uppercase tracking-wider">Proof: </span>
                    <a href={result.url} target="_blank" rel="noopener noreferrer" className="text-navy hover:text-gold underline underline-offset-2">
                      View the exact PDF that was mailed
                    </a>
                  </div>
                )}
              </div>
              {error && (
                <div className="mt-4 text-[12px] text-left text-amber-800 bg-amber-50 border border-amber-300 rounded-sm px-3 py-2">{error}</div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <button onClick={step === 'sent' && batchRemaining > 0 ? onNext : onClose} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">
            {step === 'sent' ? (batchRemaining > 0 ? `Next Letter (${batchRemaining})` : 'Close') : 'Cancel'}
          </button>
          {step === 'confirm' && (
            <div className="flex items-center gap-3">
              {!verified && (
                <span className="text-[10px] text-ink-faint">Verify the address to enable sending</span>
              )}
              {!verified && (
                <button
                  onClick={handleVerify}
                  disabled={verifying || !toAddr.line1 || !toAddr.city || !toAddr.state || !toAddr.zip}
                  className="px-4 py-2 text-[11px] uppercase tracking-wider rounded-sm border border-navy text-navy hover:bg-navy hover:text-gold transition-colors"
                  style={{ opacity: (!toAddr.line1 || verifying) ? 0.5 : 1 }}
                >
                  {verifying ? 'Verifying…' : 'Verify Address'}
                </button>
              )}
              {/* Address verification is a hard gate — methodology hard stop.
                  enclosureParseBlocked is a second, independent hard stop —
                  see the server-side check in lob.cjs, which is what
                  actually enforces this; disabling here is just so staff
                  aren't clicking a button that's guaranteed to fail. */}
              <button
                onClick={handleSend}
                disabled={sending || !verified || !toAddr.line1 || !toAddr.city || !toAddr.state || !toAddr.zip || letter.enclosureParseBlocked}
                title={letter.enclosureParseBlocked ? 'Blocked: enclosure could not be reliably parsed — re-upload and re-analyze first' : (!verified ? 'Verify the address first' : undefined)}
                className="flex items-center gap-2 px-5 py-2 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                style={{ backgroundColor: (sending || !verified || !toAddr.line1 || letter.enclosureParseBlocked) ? '#B5BBC9' : '#1B2A4A', color: (sending || !verified || !toAddr.line1 || letter.enclosureParseBlocked) ? '#FFFFFF' : '#C9A84C' }}
              >
                <Send size={13} strokeWidth={2} />
                {sending ? 'Sending…' : 'Send Certified Mail'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
