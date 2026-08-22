import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toaster, toast } from 'react-hot-toast';
import { Check, ChevronRight, FileText, Lock, PenTool, ShieldCheck, UserCheck } from 'lucide-react';
import { supabase } from '../utils/supabase';
import { notifyStaff } from '../utils/notifyStaff';

const CCC_PHONE = '970-644-0063';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function sanitizeDisclosurePresentationHtml(value) {
  const withoutActivePresentation = String(value || '')
    .replace(/<(style|script)\b[^>]*>[\s\S]*?(?:<\/\1\s*>|$)/gi, '')
    .replace(/<link\b[^>]*>/gi, '');
  return withoutActivePresentation.replace(/<[^>]*>/g, (tag) => {
    const match = tag.match(/^<\s*(\/?)\s*(h[1-6]|p|br|strong|em|ul|ol|li)\b[^>]*>$/i);
    if (!match) return '';
    const closing = match[1] === '/';
    const name = match[2].toLowerCase();
    if (name === 'br') return '<br>';
    return `<${closing ? '/' : ''}${name}>`;
  });
}

async function portalEnrollUpload(accessToken, { kind, dataBase64, contentType, fileName }) {
  const response = await fetch('/.netlify/functions/portal-enroll-upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ kind, dataBase64, contentType, fileName }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Upload failed (${response.status})`);
  return body;
}

async function portalAgreementRequest(accessToken, payload) {
  const response = await fetch('/.netlify/functions/portal-service-agreement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Agreement request failed (${response.status})`);
  return body;
}

export default function ClientSetupFlow({ session, onComplete, initialStep = 'password', requireOnboarding = true }) {
  const [step, setStep] = useState(initialStep);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSetPassword = async () => {
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      toast.error('Passwords do not match.');
      return;
    }
    setLoading(true);
    const toastId = toast.loading('Setting up your account...');
    try {
      const { error } = await supabase.auth.updateUser({ password, data: { password_set: true } });
      if (error) throw error;
      toast.success('Password created securely!', { id: toastId });
      if (requireOnboarding) setStep('onboarding');
      else onComplete();
    } catch (error) {
      toast.error(error.message || 'Could not set password', { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  if (step === 'password') {
    return (
      <div className="min-h-screen bg-gray-50/50 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] flex items-center justify-center p-6">
        <Toaster position="top-center" toastOptions={{ style: { fontSize: '13px', fontWeight: '500' } }} />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="w-full max-w-sm">
          <BrandHeader title="Welcome to Credit Comeback Club" subtitle="Create a password to secure your account and access your client portal." />
          <div className="bg-white/80 backdrop-blur-xl border border-gray-100 shadow-xl shadow-slate-200/50 rounded-2xl p-8 space-y-5">
            <PasswordField label="New Password" value={password} onChange={setPassword} placeholder="At least 8 characters" onEnter={handleSetPassword} />
            <PasswordField label="Confirm Password" value={confirm} onChange={setConfirm} placeholder="Repeat password" onEnter={handleSetPassword} />
            <button
              onClick={handleSetPassword} disabled={loading}
              className="w-full py-3.5 mt-2 text-xs font-bold uppercase tracking-[0.08em] rounded-xl transition-all shadow-md flex items-center justify-center gap-2 disabled:opacity-70"
              style={{ backgroundColor: loading ? '#94a3b8' : '#0f172a', color: loading ? '#f1f5f9' : '#fbbf24' }}
            >
              {loading ? 'Setting up…' : 'Create Password'}
              {!loading && <ChevronRight size={16} strokeWidth={2.5} />}
            </button>
            <div className="pt-3 text-center">
              <button onClick={() => supabase.auth.signOut()} className="text-[11px] text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest">
                Cancel & Sign Out
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  if (step === 'onboarding') return <ClientOnboardingModal session={session} onComplete={onComplete} />;
  return null;
}

function ClientOnboardingModal({ session, onComplete }) {
  const [step, setStep] = useState(1);
  const [agreement, setAgreement] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loadingAgreement, setLoadingAgreement] = useState(true);
  const [idFile, setIdFile] = useState(null);
  const [addressFile, setAddressFile] = useState(null);
  const [signature, setSignature] = useState(null);
  const [loading, setLoading] = useState(false);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [cancellationAccepted, setCancellationAccepted] = useState(false);
  const [disclosureOpened, setDisclosureOpened] = useState(false);
  const [disclosureAccepted, setDisclosureAccepted] = useState(false);
  const [electronicAccepted, setElectronicAccepted] = useState(false);
  const [signedDocuments, setSignedDocuments] = useState(null);
  const canvasRef = React.useRef(null);
  const drawingRef = React.useRef(false);
  const inkRef = React.useRef(false);
  const completionRef = React.useRef(false);

  const loadAgreement = React.useCallback(async () => {
    setLoadingAgreement(true);
    setLoadError(null);
    try {
      const body = await portalAgreementRequest(session.access_token, { action: 'load' });
      if (body.completed) {
        setStep(6);
        return;
      }
      if (!body.agreement?.signingAllowed) throw new Error(body.agreement?.blockedReason || 'Your agreement is not ready to sign yet.');
      setAgreement(body.agreement);
    } catch (error) {
      setLoadError(error.message || 'Could not load your prepared Client Service Agreement.');
    } finally {
      setLoadingAgreement(false);
    }
  }, [session.access_token]);

  React.useEffect(() => { loadAgreement(); }, [loadAgreement]);

  const canvasPoint = (event) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const source = event.touches ? event.touches[0] : event;
    return {
      x: (source.clientX - rect.left) * (canvas.width / rect.width),
      y: (source.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const startDraw = (event) => {
    drawingRef.current = true;
    inkRef.current = false;
    const context = canvasRef.current.getContext('2d');
    const point = canvasPoint(event);
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const draw = (event) => {
    if (!drawingRef.current) return;
    event.preventDefault();
    const context = canvasRef.current.getContext('2d');
    const point = canvasPoint(event);
    context.lineTo(point.x, point.y);
    context.strokeStyle = '#0f172a';
    context.lineWidth = 2.5;
    context.lineCap = 'round';
    context.stroke();
    inkRef.current = true;
  };

  const stopDraw = () => {
    drawingRef.current = false;
    if (inkRef.current && canvasRef.current) setSignature(canvasRef.current.toDataURL('image/png'));
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    inkRef.current = false;
    setSignature(null);
  };

  const handleComplete = async () => {
    if (completionRef.current) return;
    if (!agreement || !agreementAccepted || !cancellationAccepted || !disclosureAccepted || !electronicAccepted) {
      toast.error('Review and accept all required documents before signing.');
      return;
    }
    if (!idFile || !addressFile) {
      toast.error('Government ID and proof of address are required.');
      return;
    }
    if (!signature) {
      toast.error('Draw your signature before completing enrollment.');
      return;
    }

    completionRef.current = true;
    setLoading(true);
    const toastId = toast.loading('Signing and securing your enrollment packet...');
    try {
      const idUpload = await portalEnrollUpload(session.access_token, {
        kind: 'id',
        dataBase64: await fileToBase64(idFile),
        contentType: idFile.type || 'application/octet-stream',
        fileName: idFile.name,
      });
      const addressUpload = await portalEnrollUpload(session.access_token, {
        kind: 'address',
        dataBase64: await fileToBase64(addressFile),
        contentType: addressFile.type || 'application/octet-stream',
        fileName: addressFile.name,
      });
      if (!idUpload.clientId || idUpload.clientId !== addressUpload.clientId
        || !idUpload.firmUserId || idUpload.firmUserId !== addressUpload.firmUserId) {
        throw new Error('The required documents did not resolve to the same client record. Contact Credit Comeback Club.');
      }

      const completed = await portalAgreementRequest(session.access_token, {
        action: 'sign',
        agreementId: agreement.id,
        templateVersion: agreement.templateVersion,
        hashes: agreement.hashes,
        acknowledgements: {
          service_agreement: agreementAccepted,
          consumer_rights_disclosure: disclosureAccepted,
          cancellation_notices_received: cancellationAccepted,
          electronic_records: electronicAccepted,
        },
        signatureData: signature,
      });
      setSignedDocuments(completed.documents || null);
      notifyStaff('onboarding_complete');
      toast.success('Enrollment completed securely!', { id: toastId });
      setStep(6);
    } catch (error) {
      console.error('[Enrollment] completion failed:', error);
      toast.error(error.message || 'Could not complete setup', { id: toastId });
    } finally {
      completionRef.current = false;
      setLoading(false);
    }
  };

  const steps = ['Agreement', 'Your Rights', 'Government ID', 'Proof of Address', 'Sign', 'Complete'];
  if (loadingAgreement && step !== 6) return <EnrollmentStatus title="Loading your prepared agreement…" />;
  if (loadError && step !== 6) {
    return <EnrollmentStatus title="Enrollment is not ready" message={loadError} actionLabel="Try Again" onAction={loadAgreement} />;
  }

  return (
    <div className="min-h-screen bg-gray-50/50 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] flex items-center justify-center p-6">
      <Toaster position="top-center" toastOptions={{ style: { fontSize: '13px', fontWeight: '500' } }} />
      <div className="w-full max-w-3xl">
        <BrandHeader
          title="Complete Your Enrollment"
          subtitle={step === 6 ? 'Enrollment complete' : `Step ${step} of 5 — ${steps[step - 1]}`}
        />
        <p className="text-xs text-gray-400 -mt-6 mb-6 text-center">Credit Comeback Club · {CCC_PHONE}</p>

        <div className="flex gap-2 mb-8 px-4 max-w-2xl mx-auto">
          {steps.map((title, index) => (
            <div key={title} className="flex-1">
              <div className={`h-2 rounded-full transition-all duration-300 ${index + 1 <= step ? 'bg-slate-900' : 'bg-gray-200'}`} />
              <div className={`text-[9px] uppercase tracking-wider font-bold mt-2 text-center ${index + 1 === step ? 'text-slate-900' : 'text-gray-400'}`}>{title}</div>
            </div>
          ))}
        </div>

        <div className="bg-white/90 backdrop-blur-xl border border-gray-100 shadow-xl shadow-slate-200/50 rounded-2xl p-8 relative overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
              {step === 1 && (
                <WizardSection title={`Review Your ${agreement?.title || 'Client Service Agreement'}`} description={`Prepared for ${agreement?.clientName || 'you'} using the plan selected by Credit Comeback Club.`}>
                  <PlanSummary plan={agreement?.plan} />
                  <AgreementDocument title="Client Service Agreement" html={agreement?.serviceAgreementHtml} height={430} />
                  {agreement?.cancellationNoticeHtml && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                      <strong>Notice of Cancellation:</strong> Two completed copies of the notice shown in this agreement packet will be retained with your signed documents. Your exact cancellation deadline is calculated when you sign.
                    </div>
                  )}
                  <Acknowledgement checked={agreementAccepted} onChange={setAgreementAccepted}>
                    I have read and agree to this exact Client Service Agreement, selected plan, fee terms, and cancellation terms.
                  </Acknowledgement>
                  <Acknowledgement checked={cancellationAccepted} onChange={setCancellationAccepted}>
                    I acknowledge that my completed packet will provide two copies of the Notice of Cancellation and state my exact cancellation deadline.
                  </Acknowledgement>
                  <NextButton disabled={!agreementAccepted || !cancellationAccepted} onClick={() => setStep(2)}>Continue to Consumer Rights</NextButton>
                </WizardSection>
              )}

              {step === 2 && (
                <WizardSection title="Consumer Credit File Rights" description="This disclosure is provided separately from your Client Service Agreement.">
                  {!disclosureOpened ? (
                    <button onClick={() => setDisclosureOpened(true)} className="w-full rounded-xl border-2 border-slate-900 bg-slate-50 p-6 text-sm font-bold text-slate-900 hover:bg-slate-100">
                      Open Separate Consumer Rights Disclosure
                    </button>
                  ) : (
                    <AgreementDocument title={agreement?.consumerDisclosureTitle || 'Consumer Rights Disclosure'} html={agreement?.consumerDisclosureHtml} height={430} disclosure />
                  )}
                  <Acknowledgement checked={disclosureAccepted} onChange={setDisclosureAccepted} disabled={!disclosureOpened}>
                    I acknowledge that I opened and received this separate Consumer Credit File Rights disclosure before signing the Client Service Agreement.
                  </Acknowledgement>
                  <WizardButtons back={() => setStep(1)} next={() => setStep(3)} nextDisabled={!disclosureOpened || !disclosureAccepted} />
                </WizardSection>
              )}

              {step === 3 && (
                <WizardSection title="Upload Government ID" description="Driver’s license, passport, or state ID. This required document verifies your identity for your account work.">
                  <FilePicker file={idFile} onFile={setIdFile} icon={<UserCheck size={20} className="text-amber-500" />} />
                  <WizardButtons back={() => setStep(2)} next={() => setStep(4)} nextDisabled={!idFile} />
                </WizardSection>
              )}

              {step === 4 && (
                <WizardSection title="Upload Proof of Address" description="Upload a current utility bill, bank statement, lease agreement, or other proof of your present address. This document is required.">
                  <FilePicker file={addressFile} onFile={setAddressFile} icon={<FileText size={20} className="text-amber-500" />} />
                  <WizardButtons back={() => setStep(3)} next={() => setStep(5)} nextDisabled={!addressFile} />
                </WizardSection>
              )}

              {step === 5 && (
                <WizardSection title="Sign and Complete" description={`Your signature applies to the exact prepared agreement and separate disclosure shown above for ${agreement?.clientName || 'you'}.`}>
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
                    <DocumentRow title="Client Service Agreement" detail={`${agreement?.templateVersion} · ${agreement?.plan?.label || 'Selected plan'}`} />
                    <DocumentRow title="Consumer Rights Disclosure" detail="Opened and acknowledged separately" ok={disclosureAccepted} />
                    <DocumentRow title="Government ID" detail={idFile?.name || 'Required'} ok={Boolean(idFile)} />
                    <DocumentRow title="Proof of Address" detail={addressFile?.name || 'Required'} ok={Boolean(addressFile)} />
                  </div>
                  <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-inner">
                    <canvas
                      ref={canvasRef} width={600} height={180}
                      className="block w-full touch-none cursor-crosshair bg-[url('https://www.transparenttextures.com/patterns/graphy.png')]"
                      onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                      onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw}
                    />
                    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
                      <span className="text-[10px] text-gray-400 uppercase tracking-[0.1em] font-bold">Draw your signature above</span>
                      <button onClick={clearSignature} className="text-[10px] font-bold text-red-500 hover:text-red-700 uppercase tracking-[0.1em] bg-red-50 px-3 py-1.5 rounded-md">Clear</button>
                    </div>
                  </div>
                  <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4 text-sm font-bold text-amber-950">
                    You may cancel this contract without penalty or obligation at any time before midnight of the third business day after the date you sign it. Your completed packet includes two copies of the Notice of Cancellation.
                  </div>
                  <Acknowledgement checked={electronicAccepted} onChange={setElectronicAccepted}>
                    I consent to electronic records and signatures and understand that this drawn signature is applied to the documents identified above.
                  </Acknowledgement>
                  <div className="flex gap-3 pt-2">
                    <button onClick={() => setStep(4)} disabled={loading} className="flex-1 py-3.5 text-xs font-bold uppercase tracking-[0.08em] rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-60">Back</button>
                    <button
                      onClick={handleComplete}
                      disabled={loading || !signature || !electronicAccepted || !agreementAccepted || !cancellationAccepted || !disclosureAccepted || !idFile || !addressFile}
                      className="flex-1 py-3.5 text-xs font-bold uppercase tracking-[0.08em] rounded-xl shadow-md flex items-center justify-center gap-2 disabled:opacity-60"
                      style={{ backgroundColor: '#0f172a', color: '#fbbf24' }}
                    >
                      {loading ? 'Securing…' : 'Sign & Complete'}
                      {!loading && <PenTool size={16} />}
                    </button>
                  </div>
                </WizardSection>
              )}

              {step === 6 && (
                <div className="space-y-6 text-center">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto text-green-600"><Check size={32} strokeWidth={3} /></div>
                  <h2 className="text-xl font-bold text-slate-900">Enrollment Complete!</h2>
                  <p className="text-sm text-gray-600 leading-relaxed max-w-md mx-auto">Your signed Client Service Agreement, separate Consumer Rights disclosure, two-copy Notice of Cancellation, government ID, and proof of address were secured with your client record.</p>
                  {signedDocuments && (
                    <div className="grid gap-2 sm:grid-cols-3 text-left">
                      <DocumentDownload document={signedDocuments.agreement} label="Agreement" />
                      <DocumentDownload document={signedDocuments.disclosure} label="Consumer Rights" />
                      <DocumentDownload document={signedDocuments.cancellation} label="Cancellation (2 copies)" />
                    </div>
                  )}
                  <button onClick={() => onComplete({ agreementSigned: true, documentsUploaded: true })} className="w-full py-4 text-sm font-bold uppercase tracking-[0.08em] rounded-xl shadow-lg flex items-center justify-center gap-2 bg-slate-900 text-amber-400 hover:bg-slate-800">
                    Enter Client Portal <ChevronRight size={18} strokeWidth={2.5} />
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

function BrandHeader({ title, subtitle }) {
  return (
    <div className="text-center mb-8">
      <img src="https://files.manuscdn.com/user_upload_by_module/session_file/104892940/PtGXuDEKgTJkOdRf.jpg" alt="CCC" className="w-16 h-16 object-cover rounded-2xl mx-auto mb-4 shadow-[0_0_20px_rgba(251,191,36,0.3)] border-2 border-amber-400" />
      <h1 className="ccc-display text-2xl text-slate-900 font-bold mb-2">{title}</h1>
      <p className="text-sm text-gray-500 leading-relaxed">{subtitle}</p>
    </div>
  );
}

function PasswordField({ label, value, onChange, placeholder, onEnter }) {
  return (
    <div>
      <label className="text-xs uppercase tracking-[0.08em] text-gray-500 font-bold mb-1.5 flex items-center gap-1.5"><Lock size={14} /> {label}</label>
      <input type="password" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 focus:bg-white transition-all" onKeyDown={(event) => event.key === 'Enter' && onEnter()} />
    </div>
  );
}

function EnrollmentStatus({ title, message, actionLabel, onAction }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl p-8 text-center shadow-xl">
        <ShieldCheck size={34} className="mx-auto mb-4 text-slate-700" />
        <h1 className="text-xl font-bold text-slate-900 mb-2">{title}</h1>
        {message && <p className="text-sm text-gray-600 leading-relaxed mb-5">{message}</p>}
        {onAction && <button onClick={onAction} className="px-5 py-3 rounded-xl bg-slate-900 text-amber-400 text-xs font-bold uppercase tracking-wider">{actionLabel}</button>}
        <p className="text-xs text-gray-400 mt-5">Credit Comeback Club · {CCC_PHONE}</p>
      </div>
    </div>
  );
}

function WizardSection({ title, description, children }) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-bold text-slate-900 mb-2">{title}</h2>
        <p className="text-sm text-gray-500 leading-relaxed max-w-xl mx-auto">{description}</p>
      </div>
      {children}
    </div>
  );
}

function PlanSummary({ plan }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 grid gap-3 sm:grid-cols-3 text-sm">
      <div><div className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Selected plan</div><div className="font-bold text-slate-900">{plan?.label || '—'}</div></div>
      <div><div className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Service term</div><div className="font-medium text-slate-800">{plan?.serviceTerm || '—'}</div></div>
      <div><div className="text-[10px] uppercase tracking-wider font-bold text-gray-500">Exact fee snapshot</div><div className="font-medium text-slate-800">{plan?.feeText || '—'}</div></div>
    </div>
  );
}

function AgreementDocument({ title, html, height = 400, disclosure = false }) {
  const rawHtml = String(html || '');
  const documentHtml = disclosure
    ? `<div class="ccc-statutory-disclosure">${sanitizeDisclosurePresentationHtml(rawHtml)}</div>`
    : rawHtml;
  const disclosureStyle = disclosure
    ? '.ccc-statutory-disclosure,.ccc-statutory-disclosure *{font-size:14px!important;font-weight:700!important}'
    : '';
  const source = `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;color:#1f2937;font-size:13px;line-height:1.6;margin:0;padding:20px}h1,h2,h3{color:#0f172a}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d1d5db;padding:7px;text-align:left}${disclosureStyle}</style></head><body>${documentHtml}</body></html>`;
  return <iframe title={title} sandbox="" srcDoc={source} className="w-full rounded-xl border border-gray-200 bg-white" style={{ height }} />;
}

function Acknowledgement({ checked, onChange, disabled = false, children }) {
  return (
    <label className={`flex items-start gap-3 p-4 rounded-xl border transition-colors ${disabled ? 'cursor-not-allowed border-gray-200 bg-gray-100 opacity-60' : 'cursor-pointer border-gray-200 bg-gray-50 hover:border-amber-200 hover:bg-amber-50/50'}`}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} className="mt-1 w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400" />
      <span className="text-xs text-gray-700 leading-relaxed">{children}</span>
    </label>
  );
}

function NextButton({ disabled, onClick, children }) {
  return (
    <button onClick={onClick} disabled={disabled} className="w-full py-3.5 text-xs font-bold uppercase tracking-[0.08em] rounded-xl shadow-md disabled:opacity-50 disabled:shadow-none" style={{ backgroundColor: disabled ? '#cbd5e1' : '#0f172a', color: disabled ? '#64748b' : '#fbbf24' }}>
      {children}
    </button>
  );
}

function WizardButtons({ back, next, nextDisabled }) {
  return (
    <div className="flex gap-3 pt-2">
      <button onClick={back} className="flex-1 py-3.5 text-xs font-bold uppercase tracking-[0.08em] rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">Back</button>
      <button onClick={next} disabled={nextDisabled} className="flex-1 py-3.5 text-xs font-bold uppercase tracking-[0.08em] rounded-xl shadow-md disabled:opacity-50" style={{ backgroundColor: nextDisabled ? '#cbd5e1' : '#0f172a', color: nextDisabled ? '#64748b' : '#fbbf24' }}>Continue</button>
    </div>
  );
}

function FilePicker({ file, onFile, icon }) {
  return (
    <label className="block border-2 border-dashed border-gray-300 bg-gray-50/50 rounded-xl p-10 text-center cursor-pointer hover:border-amber-400 hover:bg-amber-50/20 transition-all">
      {file ? (
        <div className="text-sm text-green-600 font-bold flex items-center justify-center gap-2"><div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center"><Check size={16} /></div>{file.name}</div>
      ) : (
        <><div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm border border-gray-100">{icon}</div><div className="text-sm font-semibold text-slate-900">Click to browse or drop file here</div><div className="text-xs text-gray-400 mt-2">Required · JPG, PNG, WebP, or PDF · max 4 MB</div></>
      )}
      <input type="file" accept=".jpg,.jpeg,.png,.webp,.pdf" className="hidden" onChange={(event) => event.target.files[0] && onFile(event.target.files[0])} />
    </label>
  );
}

function DocumentRow({ title, detail, ok = true }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center ${ok ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>{ok ? <Check size={16} strokeWidth={2.5} /> : <span className="font-bold">!</span>}</div>
      <div><div className="text-xs font-bold text-slate-900 uppercase tracking-wider">{title}</div><div className="text-xs text-gray-500">{detail}</div></div>
    </div>
  );
}

function DocumentDownload({ document, label }) {
  if (!document?.dataBase64 || !document?.contentType || !document?.fileName) return null;
  return (
    <a
      href={`data:${document.contentType};base64,${document.dataBase64}`}
      download={document.fileName}
      className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-800 hover:border-amber-300 hover:bg-amber-50"
    >
      <FileText size={16} className="mb-2 text-amber-600" />
      Download {label}
    </a>
  );
}
