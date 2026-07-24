import React, { useEffect, useState } from 'react';
import { X, Send, CheckCircle, AlertCircle, MapPin } from 'lucide-react';
import { getDocuments, getDocumentBase64 } from '../utils/documents';
import { supabase } from '../utils/supabase';

const LOB_FUNCTION_URL = '/.netlify/functions/lob';

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
    getDocuments(letter.clientName).then(setDocs).catch(console.error);
  }, [letter.clientName]);

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

      // Build enclosure pages — different for Phase 3 vs Phase 1
      let enclosurePages = '';
      const isPhase3 = letter.phase && letter.phase.startsWith('Phase 3');

      if (isPhase3) {
        // Phase 3 enclosures: Exhibit A (Phase 1 letter) + Exhibit B (furnisher response) + LPOA
        // Exhibit A — Phase 1 letter
        try {
          const { data: phase1Letters } = await supabase.from('letters')
            .select('html, saved_at')
            .eq('client_name', letter.clientName)
            .eq('furnisher', letter.furnisher)
            .ilike('phase', 'Phase 1%')
            .order('saved_at', { ascending: true })
            .limit(1);
          if (phase1Letters && phase1Letters.length > 0 && phase1Letters[0].html) {
            const p1Body = phase1Letters[0].html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            const p1Content = p1Body ? p1Body[1] : phase1Letters[0].html;
            enclosurePages += '<div style="page-break-before:always;padding:40px;font-family:Arial,sans-serif;font-size:12px;">'
              + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#1B2A4A;font-weight:700;margin-bottom:8px;border-bottom:2px solid #1B2A4A;padding-bottom:8px;">EXHIBIT A — Phase 1 Direct Furnisher Dispute Letter</div>'
              + p1Content + '</div>';
          }
        } catch(e) { console.warn('Could not fetch Phase 1 letter:', e); }

        // Exhibit B — furnisher response (from responses bucket)
        try {
          // Look up client user_id
          const { data: cp } = await supabase.from('client_profiles').select('user_id').eq('full_name', letter.clientName).limit(1);
          const clientUserId = cp && cp.length > 0 ? cp[0].user_id : null;
          if (clientUserId) {
            // Find response files for this letter
            const { data: phase1LetterRow } = await supabase.from('letters')
              .select('id')
              .eq('client_name', letter.clientName)
              .eq('furnisher', letter.furnisher)
              .ilike('phase', 'Phase 1%')
              .limit(1);
            if (phase1LetterRow && phase1LetterRow.length > 0) {
              const { data: responseFiles } = await supabase.storage.from('responses')
                .list(clientUserId + '/' + phase1LetterRow[0].id, { limit: 20, sortBy: { column: 'name', order: 'asc' } });
              if (responseFiles && responseFiles.length > 0) {
                const imgFiles = responseFiles.filter(f => /\.(jpg|jpeg|png)$/i.test(f.name));
                if (imgFiles.length > 0) {
                  let exhibitHtml = '<div style="page-break-before:always;padding:40px;font-family:Arial,sans-serif;">'
                    + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#1B2A4A;font-weight:700;margin-bottom:8px;border-bottom:2px solid #1B2A4A;padding-bottom:8px;">EXHIBIT B — Furnisher Response (' + letter.furnisher + ')</div>';
                  for (const imgFile of imgFiles) {
                    const respPath = clientUserId + '/' + phase1LetterRow[0].id + '/' + imgFile.name;
                    const { data: respUrl } = await supabase.storage.from('responses').createSignedUrl(respPath, 3600);
                    if (respUrl?.signedUrl) {
                      const respRes = await fetch(respUrl.signedUrl);
                      const respBlob = await respRes.blob();
                      const respB64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(',')[1]); r.readAsDataURL(respBlob); });
                      exhibitHtml += '<img src="data:image/jpeg;base64,' + respB64 + '" style="max-width:100%;display:block;margin-bottom:8px;" />';
                    }
                  }
                  exhibitHtml += '</div>';
                  enclosurePages += exhibitHtml;
                }
              }
            }
          }
        } catch(e) { console.warn('Could not fetch furnisher response:', e); }

        // LPOA still included for Phase 3
        try {
          const { data: clientMeta } = await supabase.from('clients').select('lpoa_signature_data').eq('name', letter.clientName).limit(1);
          if (clientMeta && clientMeta.length > 0 && clientMeta[0].lpoa_signature_data?.lpoaUrl) {
            const lpoaRes = await fetch(clientMeta[0].lpoa_signature_data.lpoaUrl);
            const lpoaHtml = await lpoaRes.text();
            const styleMatch = lpoaHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
            const lpoaStyle = styleMatch ? '<style>' + styleMatch[1] + '</style>' : '';
            const bodyMatch = lpoaHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            const lpoaBody = bodyMatch ? bodyMatch[1] : lpoaHtml;
            enclosurePages += '<div style="page-break-before:always;font-family:Arial,sans-serif;font-size:12px;">'
              + lpoaStyle
              + '<div style="padding:8px 40px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#666;margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:8px;">Enclosure — Limited Power of Attorney</div>'
              + lpoaBody + '</div>';
          }
        } catch(e) { console.warn('Could not fetch LPOA for Phase 3:', e); }

      } else {
        // Phase 1 enclosures: LPOA + ID + Address
        try {
          const { data: clientMeta } = await supabase.from('clients').select('lpoa_signature_data').eq('name', letter.clientName).limit(1);
          if (clientMeta && clientMeta.length > 0 && clientMeta[0].lpoa_signature_data && clientMeta[0].lpoa_signature_data.lpoaUrl) {
            const lpoaRes = await fetch(clientMeta[0].lpoa_signature_data.lpoaUrl);
            const lpoaHtml = await lpoaRes.text();
            const styleMatch = lpoaHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
            const lpoaStyle = styleMatch ? '<style>' + styleMatch[1] + '</style>' : '';
            const bodyMatch = lpoaHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
            const lpoaBody = bodyMatch ? bodyMatch[1] : lpoaHtml;
            enclosurePages += '<div style="page-break-before:always;font-family:Arial,sans-serif;font-size:12px;">'
              + lpoaStyle
              + '<div style="padding:8px 40px 0;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#666;margin-bottom:8px;border-bottom:1px solid #eee;padding-bottom:8px;">Enclosure 1 of ' + (idDoc ? (addressDoc ? '3' : '2') : '1') + ' — Limited Power of Attorney</div>'
              + lpoaBody + '</div>';
          }
        } catch(e) { console.warn('Could not fetch LPOA:', e); }

        if (idDoc) {
          const b64 = await getDocumentBase64(idDoc.storage_path);
          const isImg = idDoc.file_name && /.(jpg|jpeg|png)$/i.test(idDoc.file_name);
          enclosurePages += '<div style="page-break-before:always;padding:40px;font-family:Arial,sans-serif;filter:grayscale(100%);-webkit-filter:grayscale(100%);">'
            + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#666;margin-bottom:16px;border-bottom:1px solid #eee;padding-bottom:8px;">Enclosure — Government-Issued Photo ID</div>'
            + (isImg ? '<img src="data:image/' + (idDoc.file_name.endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + b64 + '" style="max-width:100%;max-height:700px;" />' : '<p>ID document attached (PDF format)</p>')
            + '</div>';
        }

        if (addressDoc) {
          const b64 = await getDocumentBase64(addressDoc.storage_path);
          const isImg = addressDoc.file_name && /.(jpg|jpeg|png)$/i.test(addressDoc.file_name);
          enclosurePages += '<div style="page-break-before:always;padding:40px;font-family:Arial,sans-serif;filter:grayscale(100%);-webkit-filter:grayscale(100%);">'
            + '<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#666;margin-bottom:16px;border-bottom:1px solid #eee;padding-bottom:8px;">Enclosure — Proof of Current Address</div>'
            + (isImg ? '<img src="data:image/' + (addressDoc.file_name.endsWith('.png') ? 'png' : 'jpeg') + ';base64,' + b64 + '" style="max-width:100%;max-height:700px;" />' : '<p>Address document attached (PDF format)</p>')
            + '</div>';
        }
      }

      // Merge letter HTML with enclosure pages, then upload once
      let finalHtml = letter.html;
      if (enclosurePages) {
        if (finalHtml.includes('</body>')) finalHtml = finalHtml.replace('</body>', enclosurePages + '</body>');
        else finalHtml += enclosurePages;
      }
      const tempPath = user.id + '/temp-letters/' + slug(letter.clientName) + '-' + slug(letter.furnisher) + '-' + Date.now() + '.html';
      const htmlBlob = new Blob([finalHtml], { type: 'text/html' });
      const { error: uploadErr } = await supabase.storage.from('documents').upload(tempPath, htmlBlob, { upsert: true });
      if (uploadErr) throw new Error('Could not upload letter for mailing: ' + uploadErr.message);
      const { data: urlData, error: urlErr } = await supabase.storage.from('documents').createSignedUrl(tempPath, 3600);
      if (urlErr || !urlData) throw new Error('Could not get letter URL' + (urlErr ? ': ' + urlErr.message : ''));

      const res = await callLob('send_letter', {
        toAddress: toAddr,
        fromAddress: FROM_ADDRESS,
        remoteUrl: urlData.signedUrl,
        description: letter.clientName + ' — ' + letter.furnisher + ' — ' + letter.phase + (enclosurePages ? ' (w/ enclosures)' : ''),
        // Retries of this same letter can never mail twice
        idempotencyKey: letter.id,
        // Lets the webhook match this letter even if saving lob_id fails below
        metadata: { letter_id: String(letter.id) },
      });

      // The letter IS mailed at this point — persist the record with retries,
      // and never let a save failure look like a send failure (resend = double postage)
      let saveErr = null;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await onSent({ lobId: res.id, mailedDate: new Date().toISOString().slice(0, 10), trackingNumber: res.tracking_number || null });
          saveErr = null;
          break;
        } catch (e) {
          saveErr = e;
          await new Promise((r) => setTimeout(r, attempt * 1000));
        }
      }

      setResult(res);
      setStep('sent');
      if (saveErr) {
        setError('The letter WAS mailed (Lob ID ' + res.id + '), but saving the mail record failed: '
          + (saveErr.message || saveErr) + '. Do NOT resend — note the Lob ID and set the mail date on the letter manually.');
      }

      // Fire phase notification (non-blocking)
      try {
        const { data: cp } = await supabase.from('client_profiles').select('email,full_name').ilike('full_name', letter.clientName).limit(1);
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
              phase: 'phase1_mailed',
              furnisher: letter.furnisher,
              trackingNumber: res.tracking_number || '',
            }),
          }).catch((e) => console.warn('Phase notification failed:', e));
        }
      } catch (e) { console.warn('Phase notification error:', e); }
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
                Enclosure Unparsed — Manual Reconciliation Required
              </div>
              <div className="text-[12px] text-red-700 mb-2">
                This letter's Phase 2 analysis could not reliably read an enclosed document (reversed/mirrored scan, misaligned rows, or an inconsistent date sequence). It may assert facts that are unverified or wrong. Sending is blocked until the enclosure is re-uploaded with a clean scan and re-analyzed.
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
              <div className="text-[14px] text-ink font-medium ccc-display mb-1">Letter Sent</div>
              <div className="text-[12px] text-ink-muted mb-4">Lob is printing and mailing your certified letter with return receipt</div>
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
