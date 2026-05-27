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
  const res = await fetch(LOB_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export default function LobMailer({ letter, furnisherAddress, onClose, onSent }) {
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
    setSending(true);
    setError(null);
    try {
      // Upload letter HTML to Supabase Storage and get signed URL for Lob
      const { data: { user } } = await supabase.auth.getUser();
      const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'unknown';
      const tempPath = user.id + '/temp-letters/' + slug(letter.clientName) + '-' + slug(letter.furnisher) + '-' + Date.now() + '.html';
      const htmlBlob = new Blob([letter.html], { type: 'text/html' });
      const { error: uploadErr } = await supabase.storage.from('documents').upload(tempPath, htmlBlob, { upsert: true });
      if (uploadErr) throw new Error('Could not upload letter for mailing: ' + uploadErr.message);
      const { data: urlData, error: urlErr } = await supabase.storage.from('documents').createSignedUrl(tempPath, 3600);
      if (urlErr) throw new Error('Could not get letter URL: ' + urlErr.message);
      const remoteUrl = urlData.signedUrl;

      const enclosures = [];
      if (idDoc) {
        const b64 = await getDocumentBase64(idDoc.storage_path);
        enclosures.push({ type: 'id', base64: b64, fileName: idDoc.file_name });
      }
      if (addressDoc) {
        const b64 = await getDocumentBase64(addressDoc.storage_path);
        enclosures.push({ type: 'address', base64: b64, fileName: addressDoc.file_name });
      }

      const res = await callLob('send_letter', {
        toAddress: toAddr,
        fromAddress: FROM_ADDRESS,
        remoteUrl,
        description: letter.clientName + ' — ' + letter.furnisher + ' — ' + letter.phase,
        enclosures,
      });

      setResult(res);
      setStep('sent');
      onSent({
        lobId: res.id,
        mailedDate: new Date().toISOString().slice(0, 10),
        trackingNumber: res.tracking_number || null,
      });
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
              <div className="text-[12px] text-ink-muted mb-4">Lob is printing and mailing your certified letter</div>
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
                  <span className="text-ink">3-5 business days</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <button onClick={onClose} className="text-[11px] uppercase tracking-wider text-ink-muted hover:text-ink">
            {step === 'sent' ? 'Close' : 'Cancel'}
          </button>
          {step === 'confirm' && (
            <div className="flex items-center gap-3">
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
              <button
                onClick={handleSend}
                disabled={sending || !toAddr.line1 || !toAddr.city || !toAddr.state || !toAddr.zip}
                className="flex items-center gap-2 px-5 py-2 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                style={{ backgroundColor: (sending || !toAddr.line1) ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C' }}
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
