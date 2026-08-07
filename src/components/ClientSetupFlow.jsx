import React, { useState } from 'react';
import { supabase } from '../utils/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { Toaster, toast } from 'react-hot-toast';
import { Check, ChevronRight, Lock, UserCheck, FileText, PenTool } from 'lucide-react';
import { getSettings } from '../utils/settings';
import { getTierPricing, describeTierFee, resolveClientFeeText } from '../utils/pricing';
import {
  DOCUMENTS_BUCKET,
  FIRM_ASSETS_BUCKET,
  FIRM_ATTORNEY_SIG_PATH,
  buildLpoaSignatureRecord,
} from '../utils/storagePaths';
import { notifyStaff } from '../utils/notifyStaff';

async function loadAttorneySignatureDataUrl() {
  try {
    const { data, error } = await supabase.storage.from(FIRM_ASSETS_BUCKET).download(FIRM_ATTORNEY_SIG_PATH);
    if (error || !data) return null;
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(data);
    });
  } catch {
    return null;
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Server-side enrollment upload — bypasses brittle documents-bucket RLS. */
async function portalEnrollUpload(accessToken, { kind, dataBase64, contentType, fileName }) {
  const res = await fetch('/.netlify/functions/portal-enroll-upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ kind, dataBase64, contentType, fileName }),
  });
  let body = null;
  try { body = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    throw new Error((body && body.error) || `Upload failed (${res.status})`);
  }
  return body;
}

export default function ClientSetupFlow({ session, onComplete, initialStep = 'password', requireOnboarding = true }) {
  const [step, setStep] = useState(initialStep); // password | onboarding
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  const handleSetPassword = async () => {
    if (password.length < 8) { toast.error('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { toast.error('Passwords do not match.'); return; }
    setLoading(true);
    const toastId = toast.loading('Setting up your account...');
    try {
      const { error } = await supabase.auth.updateUser({ password, data: { password_set: true } });
      if (error) throw error;
      toast.success('Password created securely!', { id: toastId });
      if (requireOnboarding) {
        setStep('onboarding');
      } else {
        onComplete();
      }
    } catch (e) {
      toast.error(e.message || 'Could not set password', { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  if (step === 'password') {
    return (
      <div className="min-h-screen bg-gray-50/50 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] flex items-center justify-center p-6">
        <Toaster position="top-center" toastOptions={{ style: { fontSize: '13px', fontWeight: '500' } }} />
        <motion.div 
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}
          className="w-full max-w-sm">
          <div className="text-center mb-8">
            <img src="https://files.manuscdn.com/user_upload_by_module/session_file/104892940/PtGXuDEKgTJkOdRf.jpg" alt="CCC" 
              className="w-16 h-16 object-cover rounded-2xl mx-auto mb-4 shadow-[0_0_20px_rgba(251,191,36,0.3)] border-2 border-amber-400" />
            <h1 className="ccc-display text-2xl text-slate-900 font-bold mb-2">Welcome to Credit Comeback Club</h1>
            <p className="text-sm text-gray-500 leading-relaxed">Create a password to secure your account and access your client portal.</p>
          </div>
          <div className="bg-white/80 backdrop-blur-xl border border-gray-100 shadow-xl shadow-slate-200/50 rounded-2xl p-8 space-y-5">
            <div>
              <label className="text-xs uppercase tracking-[0.08em] text-gray-500 font-bold block mb-1.5 flex items-center gap-1.5"><Lock size={14} /> New Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:bg-white transition-all"
                onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()} />
            </div>
            <div>
              <label className="text-xs uppercase tracking-[0.08em] text-gray-500 font-bold block mb-1.5 flex items-center gap-1.5"><Lock size={14} /> Confirm Password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat password"
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:bg-white transition-all"
                onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()} />
            </div>
            <button onClick={handleSetPassword} disabled={loading}
              className="w-full py-3.5 mt-2 text-xs font-bold uppercase tracking-[0.08em] rounded-xl transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-70"
              style={{ backgroundColor: loading ? '#94a3b8' : '#0f172a', color: loading ? '#f1f5f9' : '#fbbf24' }}>
              {loading ? 'Setting up…' : 'Create Password'}
              {!loading && <ChevronRight size={16} strokeWidth={2.5} />}
            </button>
            <div className="pt-3 text-center">
              <button onClick={() => supabase.auth.signOut()} 
                className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest">
                Cancel & Sign Out
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (step === 'onboarding') {
    return <ClientOnboardingModal session={session} onComplete={onComplete} />;
  }

  return null;
}

function ClientOnboardingModal({ session, onComplete }) {
  const [step, setStep] = useState(1);
  const [idFile, setIdFile] = useState(null);
  const [addressFile, setAddressFile] = useState(null);
  const [signature, setSignature] = useState(null);
  const [loading, setLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [hasAudit, setHasAudit] = useState(false);
  const [settings, setSettings] = useState(null);
  const [billingTier, setBillingTier] = useState(null);
  const [monitoringService, setMonitoringService] = useState('Privacy Guard');
  const [serviceAgreement, setServiceAgreement] = useState({ mode: 'tier', feeText: null });
  const canvasRef = React.useRef(null);
  const isDrawing = React.useRef(false);

  React.useEffect(() => {
    async function loadData() {
      try {
        const s = await getSettings();
        setSettings(s);

        // Real fee schedule for the LPOA/agreement depends on which service
        // tier this client was actually assigned (set separately in the
        // Billing panel) — never a single flat number, since Standard/VIP/
        // Paid In Full have genuinely different real fees.
        const { data: cpRows } = await supabase.from('client_profiles').select('full_name,client_id').eq('user_id', session.user.id).limit(1);
        const clientProfile = cpRows && cpRows[0];
        if (clientProfile) {
          const auditQuery = clientProfile.client_id
            ? supabase.from('audits').select('id').eq('client_id', clientProfile.client_id).limit(1)
            : supabase.from('audits').select('id').eq('client_name', clientProfile.full_name).limit(1);
          const { data: auditRows, error: auditError } = await auditQuery;
          if (!auditError && auditRows?.length) setHasAudit(true);

          let clientRow = null;
          const agreementSelect = 'billing_tier,monitoring_service,service_agreement_mode,service_agreement_fee_text';
          const basicSelect = 'billing_tier,monitoring_service';
          const byId = !!clientProfile.client_id;
          let clientRes = byId
            ? await supabase.from('clients').select(agreementSelect).eq('id', clientProfile.client_id).limit(1)
            : await supabase.from('clients').select(agreementSelect).eq('name', clientProfile.full_name).limit(1);
          if (clientRes.error) {
            clientRes = byId
              ? await supabase.from('clients').select(basicSelect).eq('id', clientProfile.client_id).limit(1)
              : await supabase.from('clients').select(basicSelect).eq('name', clientProfile.full_name).limit(1);
          }
          clientRow = clientRes.data && clientRes.data[0];
          if (clientRow) {
            setBillingTier(clientRow.billing_tier || null);
            setMonitoringService(clientRow.monitoring_service || 'Privacy Guard');
            setServiceAgreement({
              mode: clientRow.service_agreement_mode || 'tier',
              feeText: clientRow.service_agreement_fee_text || null,
            });
          }
        }
      } catch (e) {
        console.error('Failed to load onboarding data:', e);
      }
    }
    loadData();
  }, [session]);

  // Real fee-schedule text: custom service agreement wins; otherwise the
  // assigned tier (or all three if staff hasn't set a tier yet).
  const tierPricing = settings ? getTierPricing(settings) : null;
  const feeScheduleLine = (() => {
    const custom = resolveClientFeeText(
      {
        serviceAgreementMode: serviceAgreement.mode,
        serviceAgreementFeeText: serviceAgreement.feeText,
        billingTier,
      },
      settings,
      { lpoaType: 'standard' }
    );
    if (serviceAgreement.mode === 'custom' && serviceAgreement.feeText) {
      return custom;
    }
    if (tierPricing && billingTier && tierPricing[billingTier]) {
      return `${billingTier} Plan: ${describeTierFee(billingTier, tierPricing)}`;
    }
    if (tierPricing) {
      return Object.keys(tierPricing).map((t) => `${t}: ${describeTierFee(t, tierPricing)}`).join(' ');
    }
    return '';
  })();
  const monitoringFeeAmount = settings?.pricing?.monitoringFee ?? 16;

  const startDraw = (e) => {
    isDrawing.current = true;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e) => {
    if (!isDrawing.current) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const y = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const stopDraw = () => {
    isDrawing.current = false;
    const canvas = canvasRef.current;
    if (canvas) setSignature(canvas.toDataURL('image/png'));
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignature(null);
  };

  const handleComplete = async () => {
    if (!signature) {
      toast.error('Please draw your signature in Step 3 before completing enrollment.');
      setStep(3);
      return;
    }
    setLoading(true);
    const toastId = toast.loading('Finalizing your enrollment...');
    const userId = session.user.id;
    const accessToken = session.access_token;

    // Helper to label errors with the step that failed
    const labeled = async (label, fn) => {
      try { return await fn(); }
      catch (e) { throw new Error(`${label}: ${e.message || e}`); }
    };

    try {
      // Signature / ID / address / LPOA go through portal-enroll-upload so we
      // don't depend on documents-bucket storage RLS from the browser session.
      // The function returns firm/client ids used for the rest of enrollment.
      const sigUpload = await labeled('Upload signature', () =>
        portalEnrollUpload(accessToken, {
          kind: 'signature',
          dataBase64: signature,
          contentType: 'image/png',
          fileName: 'signature.png',
        })
      );

      let docsClientId = sigUpload.clientId;
      let docsOwnerUserId = sigUpload.firmUserId;

      if (idFile) {
        const idData = await fileToBase64(idFile);
        await labeled('Upload ID', () =>
          portalEnrollUpload(accessToken, {
            kind: 'id',
            dataBase64: idData,
            contentType: idFile.type || 'image/jpeg',
            fileName: idFile.name,
          })
        );
      }
      if (addressFile) {
        const addrData = await fileToBase64(addressFile);
        await labeled('Upload address doc', () =>
          portalEnrollUpload(accessToken, {
            kind: 'address',
            dataBase64: addrData,
            contentType: addressFile.type || 'image/jpeg',
            fileName: addressFile.name,
          })
        );
      }

      if (!docsClientId || !docsOwnerUserId) {
        throw new Error(
          'Could not resolve your client record for enrollment documents. Contact Credit Comeback Club before finishing enrollment so your files are saved correctly.'
        );
      }

      // Always mark onboarding complete in DB — do this even if subsequent steps fail
      await labeled('Save enrollment record', () =>
        supabase.from('client_profiles').update({
          signature_data: null,
          signature_signed_at: new Date().toISOString(),
          agreement_signed_at: new Date().toISOString(),
          onboarding_complete: true,
          user_id: userId,
          client_id: docsClientId,
        }).eq('user_id', userId)
      );

      const { data: cp } = await supabase.from('client_profiles').select('full_name').eq('user_id', userId).single();
      const signedAt = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const clientFullName = (cp && cp.full_name) || session.user.email;
      const attorneySigDataUrl = await loadAttorneySignatureDataUrl();
      const attorneySigImg = attorneySigDataUrl
        ? '<img src="' + attorneySigDataUrl + '" style="max-height:56px;max-width:220px;" />'
        : '<span style="font-size:14px;font-weight:bold;">Christopher Holland</span>';

      // Embed the canvas signature data URL so the stored HTML is self-contained
      // (signed URLs expire; public client-docs URLs are being retired).
      const lpoaHtml = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'
        + 'body{font-family:Arial,sans-serif;font-size:12px;line-height:1.6;margin:0;padding:40px;color:#000;}'
        + '.header{background:#0f172a;color:#fbbf24;padding:20px 32px;margin:-40px -40px 32px;}'
        + '.header h1{margin:0;font-size:20px;}'
        + '.header p{margin:4px 0 0;font-size:11px;color:#fff;opacity:0.8;}'
        + 'h2{font-size:12px;background:#0f172a;color:#fff;padding:6px 12px;margin:24px -12px 12px;}'
        + 'ul{padding-left:20px;margin:8px 0;}'
        + 'li{margin:4px 0;}'
        + '.sig-block{margin-top:32px;padding-top:16px;border-top:1px solid #ddd;}'
        + '.sig-row{display:flex;gap:40px;margin-top:16px;}'
        + '.sig-col{flex:1;}'
        + '.sig-line{border-bottom:1px solid #000;margin-bottom:4px;min-height:60px;display:flex;align-items:flex-end;}'
        + '.sig-label{font-size:10px;color:#666;}'
        + '.footer{margin-top:40px;padding-top:12px;border-top:1px solid #eee;font-size:10px;color:#999;text-align:center;}'
        + '</style></head><body>'
        + '<div class="header"><h1>Credit Comeback Club — Limited Power of Attorney</h1><p>Credit Dispute Authorization | Executed ' + signedAt + '</p></div>'
        + '<h2>1. Parties</h2>'
        + '<p>This Limited Power of Attorney is executed between <strong>' + clientFullName + '</strong> ("Principal") and Credit Comeback Club, a DBA of Christopher Holland, Grand Junction, CO, 970-644-0063 ("Attorney-in-Fact").</p>'
        + '<h2>2. Grant of Authority</h2>'
        + '<p>Principal authorizes Credit Comeback Club to act exclusively for credit dispute activities, including:</p>'
        + '<ul><li>Prepare and submit dispute letters to data furnishers under 15 U.S.C. §1681s-2(b)</li>'
        + '<li>Prepare and submit dispute letters to Equifax, Experian, and TransUnion under 15 U.S.C. §1681i</li>'
        + '<li>Send certified mail on behalf of Principal for credit disputes</li>'
        + '<li>Receive and respond to furnisher and bureau correspondence</li>'
        + '<li>Submit CFPB, FTC, and state AG complaints for FCRA/FDCPA violations</li>'
        + '<li>Review credit reports and sign correspondence as "By: Credit Comeback Club, Authorized Representative"</li></ul>'
        + '<h2>3. Limitations</h2>'
        + '<p>This authorization does NOT grant authority to make financial decisions, access financial accounts, dispute accurate information, create a new credit identity, or settle legal claims without explicit written consent.</p>'
        + '<h2>4. Fee Structure</h2>'
        + '<p>' + feeScheduleLine + ' Credit monitoring (' + monitoringService + '): approx. $' + monitoringFeeAmount + '/month (Principal responsibility).</p>'
        + '<h2>5. No Guarantee</h2>'
        + '<p>No specific outcome is guaranteed. Results vary by credit profile and creditor response.</p>'
        + '<h2>6. Duration & Revocation</h2>'
        + '<p>Effective until written revocation, dispute completion, or agreement termination. To revoke: email creditcomebackclub@gmail.com with subject "LPOA REVOCATION — [Your Name]."</p>'
        + '<h2>7. ESIGN Disclosure</h2>'
        + '<p>This document was executed electronically. The drawn signature below constitutes a legally binding electronic signature under the ESIGN Act (15 U.S.C. §7001). Execution timestamp, IP address, and user agent are recorded.</p>'
        + '<div class="sig-block">'
        + '<div class="sig-row">'
        + '<div class="sig-col"><div class="sig-line"><img src="' + signature + '" style="max-height:56px;max-width:220px;" /></div><div class="sig-label">Principal Signature — ' + clientFullName + '</div><div class="sig-label">Date: ' + signedAt + '</div></div>'
        + '<div class="sig-col"><div class="sig-line">' + attorneySigImg + '</div><div class="sig-label">Christopher Holland — Attorney-in-Fact, Credit Comeback Club</div><div class="sig-label">Date: ' + signedAt + '</div></div>'
        + '</div></div>'
        + '<div class="footer">Credit Comeback Club | Grand Junction, CO | 970-644-0063 | creditcomebackclub.com | Executed under ESIGN Act 15 U.S.C. §7001</div>'
        + '</body></html>';

      // Hashed from the exact string about to be uploaded — lets anyone
      // later confirm the stored document hasn't been altered since signing.
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lpoaHtml));
      const documentHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');

      const documentPath = `${docsOwnerUserId}/${docsClientId}/lpoa/lpoa-signed.html`;
      let lpoaUploaded = false;
      try {
        const lpoaBlob = new Blob([lpoaHtml], { type: 'text/html' });
        const lpoaFile = new File([lpoaBlob], 'lpoa-signed.html', { type: 'text/html' });
        const lpoaData = await fileToBase64(lpoaFile);
        await labeled('Upload LPOA', () =>
          portalEnrollUpload(accessToken, {
            kind: 'lpoa',
            dataBase64: lpoaData,
            contentType: 'text/html',
            fileName: 'lpoa-signed.html',
          })
        );
        lpoaUploaded = true;
      } catch (lpoaUploadErr) {
        console.warn('LPOA upload failed (non-fatal):', lpoaUploadErr);
      }

      const signatureRecord = buildLpoaSignatureRecord({
        firmUserId: docsOwnerUserId,
        clientId: docsClientId,
        signedAt: new Date().toISOString(),
        method: 'Canvas drawn signature + ESIGN Act',
        documentHash,
      });

      if (lpoaUploaded) {
        await supabase.from('client_profiles').update({
          lpoa_url: null,
          lpoa_storage_bucket: DOCUMENTS_BUCKET,
          lpoa_storage_path: documentPath,
        }).eq('user_id', userId);
      }

      if (cp) {
        await supabase.from('clients').update({
          lpoa_signed: true,
          lpoa_signed_at: new Date().toISOString(),
          lpoa_signature_data: signatureRecord,
          lpoa_document_hash: documentHash,
        }).eq('id', docsClientId);
      }

      // Append-only audit trail entry (lpoa_audit_log) — captures a
      // server-observed IP/user-agent this client-side flow can't produce
      // itself, and unlike the update above, is never overwritten by a
      // later re-sign. Best-effort: the signature is already recorded on
      // the clients row by this point, so a logging failure here must not
      // block onboarding completion.
      try {
        await fetch('/.netlify/functions/record-lpoa-audit', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            documentHash,
            documentUrl: null,
            storageBucket: DOCUMENTS_BUCKET,
            storagePath: documentPath,
            signerName: clientFullName,
            lpoaType: 'standard',
          }),
        });
      } catch (auditErr) {
        console.warn('LPOA audit log entry failed (non-fatal):', auditErr);
      }

      // Staff alert — fire-and-forget; never blocks enrollment success UI
      notifyStaff('onboarding_complete');

      toast.success('Agreements signed securely!', { id: toastId });
      setStep(5);
    } catch (e) {
      console.error('[Enrollment] handleComplete failed:', e);
      toast.error(e.message || 'Could not complete setup', { id: toastId });
      setLoading(false);
    }
  };

  const steps = [
    { title: 'Government ID', icon: <UserCheck size={16} /> },
    { title: 'Proof of Address', icon: <FileText size={16} /> },
    { title: 'Your Signature', icon: <PenTool size={16} /> },
    { title: 'Review & Sign', icon: <Check size={16} /> },
    { title: 'Success', icon: <Check size={16} /> }
  ];

  return (
    <div className="min-h-screen bg-gray-50/50 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] flex items-center justify-center p-6">
      <Toaster position="top-center" toastOptions={{ style: { fontSize: '13px', fontWeight: '500' } }} />
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <img src="https://files.manuscdn.com/user_upload_by_module/session_file/104892940/PtGXuDEKgTJkOdRf.jpg" alt="CCC" 
            className="w-16 h-16 object-cover rounded-2xl mx-auto mb-4 shadow-[0_0_20px_rgba(251,191,36,0.3)] border-2 border-amber-400" />
          <h1 className="ccc-display text-2xl text-slate-900 font-bold mb-2">Complete Your Enrollment</h1>
          <p className="text-sm text-gray-500 font-medium">Step {step} of 4 — {steps[step - 1].title}</p>
        </div>

        {/* Progress bar */}
        <div className="flex gap-2 mb-8 px-4 max-w-lg mx-auto">
          {steps.map((s, i) => (
            <div key={i} className="flex-1">
              <div className={`h-2 rounded-full transition-all duration-300 ${i + 1 <= step ? 'bg-slate-900' : 'bg-gray-200'}`} />
              <div className={`text-[9px] uppercase tracking-wider font-bold mt-2 text-center transition-colors duration-300 ${i + 1 === step ? 'text-slate-900' : 'text-gray-400'}`}>
                {s.title}
              </div>
            </div>
          ))}
        </div>

        <div className="bg-white/80 backdrop-blur-xl border border-gray-100 shadow-xl shadow-slate-200/50 rounded-2xl p-8 relative overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3 }}
            >
              {/* Step 1 */}
              {step === 1 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <h2 className="text-lg font-bold text-slate-900 mb-2">Upload Government ID</h2>
                    <p className="text-sm text-gray-500 leading-relaxed max-w-sm mx-auto">Driver's license, passport, or state ID. Used to verify your identity on dispute letters sent to bureaus.</p>
                  </div>
                  <label className="block border-2 border-dashed border-gray-300 bg-gray-50/50 rounded-xl p-10 text-center cursor-pointer hover:border-amber-400 hover:bg-amber-50/20 transition-all">
                    {idFile ? (
                      <div className="text-sm text-green-600 font-bold flex items-center justify-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center"><Check size={16} /></div>
                        {idFile.name}
                      </div>
                    ) : (
                      <>
                        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-gray-100"><UserCheck size={20} className="text-amber-500" /></div>
                        <div className="text-sm font-semibold text-slate-900">Click to browse or drop file here</div>
                        <div className="text-xs text-gray-400 mt-2">Accepts JPG, PNG, or PDF</div>
                      </>
                    )}
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                      onChange={(e) => e.target.files[0] && setIdFile(e.target.files[0])} />
                  </label>
                  <div className="flex flex-col gap-3 pt-2">
                    <button onClick={() => setStep(2)} disabled={!idFile}
                      className="w-full py-3.5 text-xs font-bold uppercase tracking-[0.08em] rounded-xl transition-all shadow-md disabled:opacity-50 disabled:shadow-none"
                      style={{ backgroundColor: idFile ? '#0f172a' : '#cbd5e1', color: idFile ? '#fbbf24' : '#64748b' }}>
                      Continue to Step 2
                    </button>
                    <button onClick={() => setStep(2)} className="w-full text-xs font-semibold text-gray-400 hover:text-slate-900 uppercase tracking-wider py-2 transition-colors">
                      Skip for now
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2 */}
              {step === 2 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <h2 className="text-lg font-bold text-slate-900 mb-2">Upload Proof of Address</h2>
                    <p className="text-sm text-gray-500 leading-relaxed max-w-sm mx-auto">Utility bill, bank statement, or lease agreement dated within the last 90 days.</p>
                  </div>
                  <label className="block border-2 border-dashed border-gray-300 bg-gray-50/50 rounded-xl p-10 text-center cursor-pointer hover:border-amber-400 hover:bg-amber-50/20 transition-all">
                    {addressFile ? (
                      <div className="text-sm text-green-600 font-bold flex items-center justify-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center"><Check size={16} /></div>
                        {addressFile.name}
                      </div>
                    ) : (
                      <>
                        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-gray-100"><FileText size={20} className="text-amber-500" /></div>
                        <div className="text-sm font-semibold text-slate-900">Click to browse or drop file here</div>
                        <div className="text-xs text-gray-400 mt-2">Accepts JPG, PNG, or PDF</div>
                      </>
                    )}
                    <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                      onChange={(e) => e.target.files[0] && setAddressFile(e.target.files[0])} />
                  </label>
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setStep(1)} className="flex-1 py-3.5 text-xs font-bold uppercase tracking-[0.08em] rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-slate-900 transition-colors">
                      Back
                    </button>
                    <button onClick={() => setStep(3)} disabled={!addressFile}
                      className="flex-1 py-3.5 text-xs font-bold uppercase tracking-[0.08em] rounded-xl transition-all shadow-md disabled:opacity-50 disabled:shadow-none"
                      style={{ backgroundColor: addressFile ? '#0f172a' : '#cbd5e1', color: addressFile ? '#fbbf24' : '#64748b' }}>
                      Continue
                    </button>
                  </div>
                  <button onClick={() => setStep(3)} className="w-full text-xs font-semibold text-gray-400 hover:text-slate-900 uppercase tracking-wider py-2 transition-colors">
                    Skip for now
                  </button>
                </div>
              )}

              {/* Step 3 */}
              {step === 3 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <h2 className="text-lg font-bold text-slate-900 mb-2">Draw Your Signature</h2>
                    <p className="text-sm text-gray-500 leading-relaxed max-w-sm mx-auto">This signature will securely authorize dispute letters sent on your behalf.</p>
                  </div>
                  <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-inner">
                    <canvas ref={canvasRef} width={600} height={180}
                      className="block w-full touch-none cursor-crosshair bg-[url('https://www.transparenttextures.com/patterns/graphy.png')]"
                      onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                      onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw} />
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
                      <span className="text-[10px] text-gray-400 uppercase tracking-[0.1em] font-bold">Sign above the line</span>
                      <button onClick={clearSignature} className="text-[10px] font-bold text-red-500 hover:text-red-700 uppercase tracking-[0.1em] bg-red-50 px-3 py-1.5 rounded-md transition-colors">Clear</button>
                    </div>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setStep(2)} className="flex-1 py-3.5 text-xs font-bold uppercase tracking-[0.08em] rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-slate-900 transition-colors">
                      Back
                    </button>
                    <button onClick={() => setStep(4)} disabled={!signature}
                      className="flex-1 py-3.5 text-xs font-bold uppercase tracking-[0.08em] rounded-xl transition-all shadow-md disabled:opacity-50 disabled:shadow-none"
                      style={{ backgroundColor: signature ? '#0f172a' : '#cbd5e1', color: signature ? '#fbbf24' : '#64748b' }}>
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {/* Step 4 */}
              {step === 4 && (
                <div className="space-y-6">
                  <div className="text-center">
                    <h2 className="text-lg font-bold text-slate-900 mb-2">Review & Complete</h2>
                    <p className="text-sm text-gray-500 leading-relaxed mx-auto">By completing enrollment, you authorize Credit Comeback Club to dispute information on your behalf.</p>
                  </div>
                  
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${idFile ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'}`}>
                        {idFile ? <Check size={16} strokeWidth={2.5} /> : <div className="w-2 h-2 bg-amber-600 rounded-full" />}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900 uppercase tracking-wider">Government ID</div>
                        <div className="text-xs text-gray-500">{idFile ? idFile.name : 'Not uploaded (Will need later)'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${addressFile ? 'bg-green-100 text-green-600' : 'bg-amber-100 text-amber-600'}`}>
                        {addressFile ? <Check size={16} strokeWidth={2.5} /> : <div className="w-2 h-2 bg-amber-600 rounded-full" />}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900 uppercase tracking-wider">Proof of Address</div>
                        <div className="text-xs text-gray-500">{addressFile ? addressFile.name : 'Not uploaded (Will need later)'}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${signature ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                        {signature ? <Check size={16} strokeWidth={2.5} /> : <div className="text-red-600 font-bold">!</div>}
                      </div>
                      <div>
                        <div className="text-xs font-bold text-slate-900 uppercase tracking-wider">Signature</div>
                        <div className="text-xs text-gray-500">{signature ? 'Drawn securely' : 'Required to proceed'}</div>
                      </div>
                    </div>
                  </div>

                  <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                    <div className="bg-slate-900 px-4 py-3 flex items-center gap-2">
                      <FileText size={16} className="text-amber-400" />
                      <span className="text-xs uppercase tracking-[0.1em] text-amber-400 font-bold">Client Service Agreement</span>
                    </div>
                    <div className="p-5 max-h-48 overflow-y-auto text-xs text-gray-600 space-y-3 custom-scrollbar">
                      <p><strong className="text-slate-900">Services:</strong> Credit Comeback Club ("CCC") will analyze your Equifax, Experian, and TransUnion reports, identify inaccurate or unverifiable items, and prepare/submit direct furnisher dispute letters on your behalf.</p>
                      <p><strong className="text-slate-900">Fee Schedule:</strong></p>
                      <ul className="pl-4 space-y-1 text-gray-500">
                        <li>• {feeScheduleLine}</li>
                        <li>• <strong className="text-slate-700">Credit Monitoring ({monitoringService}):</strong> approx. ${monitoringFeeAmount}/mo (Maintained directly by client).</li>
                      </ul>
                      <p><strong className="text-slate-900">Billing:</strong> First Work Fee is due at enrollment before dispute work commences. Monthly fees are billed in advance on the anniversary of enrollment.</p>
                      <p><strong className="text-slate-900">No Guarantee:</strong> CCC makes no guarantee of specific outcomes. Results depend on individual credit profiles and creditor responses.</p>
                      <p><strong className="text-slate-900">Prohibited Practices:</strong> CCC does not provide legal advice, dispute accurate/verifiable information, or create new credit identities.</p>
                      <p><strong className="text-slate-900">CROA Compliance & Cancellation:</strong> This agreement complies with the Credit Repair Organizations Act. No advance fees are charged for work not yet performed. You have the right to cancel without penalty within 3 business days of signing.</p>
                      <p><strong className="text-slate-900">Contact:</strong> info@creditcomebackclub.com | 480-913-9172 | Grand Junction, CO 81501</p>
                    </div>
                  </div>

                  <label className="flex items-start gap-3 cursor-pointer p-4 rounded-xl border border-gray-200 bg-gray-50 hover:bg-amber-50/50 hover:border-amber-200 transition-colors">
                    <input type="checkbox" checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400" />
                    <span className="text-xs text-gray-600 leading-relaxed">
                      I have read and agree to the <strong className="text-slate-900">Client Service Agreement</strong> above. I have also received and reviewed the <a href="/croa-statement.html" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-semibold">Statement of Consumer Rights Under the Credit Repair Organizations Act</a>. I authorize Credit Comeback Club to dispute credit information on my behalf per the Limited Power of Attorney. I understand my electronic signature is legally binding under the ESIGN Act (15 U.S.C. §7001).
                    </span>
                  </label>

                  <div className="flex gap-3 pt-4">
                    <button onClick={() => setStep(3)} className="flex-1 py-3.5 text-xs font-bold uppercase tracking-[0.08em] rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-slate-900 transition-colors">
                      Back
                    </button>
                    <button onClick={handleComplete} disabled={loading || !agreedToTerms}
                      className="flex-1 py-3.5 text-xs font-bold uppercase tracking-[0.08em] rounded-xl transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-70 disabled:shadow-none"
                      style={{ backgroundColor: (loading || !agreedToTerms) ? '#94a3b8' : '#0f172a', color: (loading || !agreedToTerms) ? '#f1f5f9' : '#fbbf24' }}>
                      {loading ? 'Saving…' : 'Complete Enrollment'}
                      {!loading && <Check size={16} strokeWidth={2.5} />}
                    </button>
                  </div>
                </div>
              )}

              {/* Step 5 - Success */}
              {step === 5 && (
                <div className="space-y-6 text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-2 text-green-600">
                    <Check size={32} strokeWidth={3} />
                  </div>
                  <h2 className="text-xl font-bold text-slate-900">Enrollment Complete!</h2>
                  
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-left max-w-sm mx-auto shadow-sm">
                    {hasAudit ? (
                      <>
                        <h3 className="text-sm font-bold text-amber-800 uppercase tracking-wider mb-2 flex items-center gap-2">
                          <span className="bg-amber-200 text-amber-900 w-5 h-5 rounded-full flex items-center justify-center text-[10px]">1</span>
                          Audit Complete
                        </h3>
                        <p className="text-sm text-amber-900/80 leading-relaxed">
                          Your initial forensic audit has already been completed! Please log into the client portal now to view your full results, negative accounts identified, and dispute tracking.
                        </p>
                      </>
                    ) : (
                      <>
                        <h3 className="text-sm font-bold text-amber-800 uppercase tracking-wider mb-2 flex items-center gap-2">
                          <span className="bg-amber-200 text-amber-900 w-5 h-5 rounded-full flex items-center justify-center text-[10px]">1</span>
                          Next Step: Your Credit Report
                        </h3>
                        <p className="text-sm text-amber-900/80 leading-relaxed">
                          To begin your forensic audit, we need your credit report. Please log into the client portal now to upload your initial 3-bureau report or provide your SmartCredit credentials so we can pull it for you.
                        </p>
                      </>
                    )}
                  </div>

                  <button onClick={() => onComplete({ signatureUrl: signature })}
                    className="w-full py-4 mt-4 text-sm font-bold uppercase tracking-[0.08em] rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 bg-slate-900 text-amber-400 hover:bg-slate-800">
                    {hasAudit ? 'Enter Client Portal' : 'Go to Portal to Upload Report'}
                    <ChevronRight size={18} strokeWidth={2.5} />
                  </button>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
