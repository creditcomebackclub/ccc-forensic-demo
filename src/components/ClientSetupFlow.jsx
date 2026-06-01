import React, { useState } from 'react';
import { supabase } from '../utils/supabase';

export default function ClientSetupFlow({ session, onComplete }) {
  const [step, setStep] = useState('password'); // password | onboarding
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSetPassword = async () => {
    setError(null);
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setStep('onboarding');
    } catch (e) {
      setError(e.message || 'Could not set password');
    } finally {
      setLoading(false);
    }
  };

  if (step === 'password') {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <img src="/logo.jpg" alt="CCC" className="w-12 h-12 object-contain rounded mx-auto mb-4" onError={(e) => e.target.style.display='none'} />
            <h1 className="ccc-display text-2xl text-ink font-medium">Welcome to Credit Comeback Club</h1>
            <p className="text-[12px] text-ink-muted mt-2">Create a password to secure your account.</p>
          </div>
          <div className="bg-white border border-border rounded p-6 space-y-4">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">New Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy"
                onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()} />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">Confirm Password</label>
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                placeholder="Repeat password"
                className="w-full border border-border rounded-sm px-3 py-2 text-[13px] focus:outline-none focus:border-navy"
                onKeyDown={(e) => e.key === 'Enter' && handleSetPassword()} />
            </div>
            {error && <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>}
            <button onClick={handleSetPassword} disabled={loading}
              className="w-full py-2.5 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
              style={{ backgroundColor: loading ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C' }}>
              {loading ? 'Setting up…' : 'Create Password & Continue →'}
            </button>
          </div>
        </div>
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
  const [error, setError] = useState(null);
  const canvasRef = React.useRef(null);
  const isDrawing = React.useRef(false);

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
    ctx.strokeStyle = '#1B2A4A';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  const stopDraw = () => {
    isDrawing.current = false;
    const canvas = canvasRef.current;
    setSignature(canvas.toDataURL('image/png'));
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setSignature(null);
  };

  const uploadFile = async (file, path) => {
    const { error } = await supabase.storage.from('client-docs').upload(path, file, { upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('client-docs').getPublicUrl(path);
    return data.publicUrl;
  };

  const uploadSignature = async (dataUrl, path) => {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], 'signature.png', { type: 'image/png' });
    return uploadFile(file, path);
  };

  const handleComplete = async () => {
    setLoading(true);
    setError(null);
    const userId = session.user.id;
    try {
      let sigUrl = null;
      if (signature) {
        sigUrl = await uploadSignature(signature, `${userId}/signature.png`);
      }
      if (idFile) await uploadFile(idFile, `${userId}/id.${idFile.name.split('.').pop()}`);
      if (addressFile) await uploadFile(addressFile, `${userId}/address.${addressFile.name.split('.').pop()}`);

      // Update client_profiles — use email as key since user_id may not be linked yet
      const userEmail = session.user.email;
      await supabase.from('client_profiles').update({
        signature_data: sigUrl,
        signature_signed_at: new Date().toISOString(),
        agreement_signed_at: new Date().toISOString(),
        onboarding_complete: true,
        user_id: userId,
      }).eq('email', userEmail);

      // Update clients table with signature data
      const { data: cp } = await supabase.from('client_profiles').select('full_name').eq('email', session.user.email).single();
      if (cp) {
        await supabase.from('clients').update({
          lpoa_signed: true,
          lpoa_signed_at: new Date().toISOString(),
          lpoa_signature_data: { signatureUrl: sigUrl, signedAt: new Date().toISOString(), method: 'Canvas drawn signature' },
        }).eq('name', cp.full_name);
      }

      onComplete({ signatureUrl: sigUrl });
    } catch (e) {
      setError(e.message || 'Could not complete setup');
    } finally {
      setLoading(false);
    }
  };

  const steps = ['Government ID', 'Proof of Address', 'Your Signature', 'Review & Sign'];

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-lg">
        <div className="text-center mb-6">
          <img src="/logo.jpg" alt="CCC" className="w-10 h-10 object-contain rounded mx-auto mb-3" onError={(e) => e.target.style.display='none'} />
          <h1 className="ccc-display text-xl text-ink font-medium">Complete Your Enrollment</h1>
          <p className="text-[12px] text-ink-muted mt-1">Step {step} of {steps.length} — {steps[step - 1]}</p>
        </div>

        {/* Progress bar */}
        <div className="flex gap-1 mb-6">
          {steps.map((_, i) => (
            <div key={i} className="h-1 flex-1 rounded-full transition-colors"
              style={{ backgroundColor: i < step ? '#1B2A4A' : '#E5E7EB' }} />
          ))}
        </div>

        <div className="bg-white border border-border rounded p-6">

          {/* Step 1 — Government ID */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-[14px] font-medium text-ink mb-1">Upload Government ID</h2>
                <p className="text-[12px] text-ink-muted">Driver's license, passport, or state ID. Used to verify your identity on dispute letters.</p>
              </div>
              <label className="block border-2 border-dashed border-border rounded-sm p-8 text-center cursor-pointer hover:border-navy transition-colors">
                {idFile ? (
                  <div className="text-[13px] text-green-600 font-medium">✓ {idFile.name}</div>
                ) : (
                  <>
                    <div className="text-[13px] text-ink-muted">Drop file or click to browse</div>
                    <div className="text-[11px] text-ink-faint mt-1">JPG, PNG, or PDF</div>
                  </>
                )}
                <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                  onChange={(e) => e.target.files[0] && setIdFile(e.target.files[0])} />
              </label>
              <button onClick={() => setStep(2)} disabled={!idFile}
                className="w-full py-2.5 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                style={{ backgroundColor: idFile ? '#1B2A4A' : '#B5BBC9', color: '#C9A84C' }}>
                Continue →
              </button>
              <button onClick={() => setStep(2)} className="w-full text-[11px] text-ink-muted hover:text-ink text-center py-1">
                Skip for now
              </button>
            </div>
          )}

          {/* Step 2 — Proof of Address */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-[14px] font-medium text-ink mb-1">Upload Proof of Address</h2>
                <p className="text-[12px] text-ink-muted">Utility bill, bank statement, or lease agreement dated within 90 days.</p>
              </div>
              <label className="block border-2 border-dashed border-border rounded-sm p-8 text-center cursor-pointer hover:border-navy transition-colors">
                {addressFile ? (
                  <div className="text-[13px] text-green-600 font-medium">✓ {addressFile.name}</div>
                ) : (
                  <>
                    <div className="text-[13px] text-ink-muted">Drop file or click to browse</div>
                    <div className="text-[11px] text-ink-faint mt-1">JPG, PNG, or PDF</div>
                  </>
                )}
                <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                  onChange={(e) => e.target.files[0] && setAddressFile(e.target.files[0])} />
              </label>
              <div className="flex gap-2">
                <button onClick={() => setStep(1)} className="flex-1 py-2.5 text-[12px] uppercase tracking-wider rounded-sm border border-border text-ink-muted hover:text-ink transition-colors">
                  ← Back
                </button>
                <button onClick={() => setStep(3)} disabled={!addressFile}
                  className="flex-1 py-2.5 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                  style={{ backgroundColor: addressFile ? '#1B2A4A' : '#B5BBC9', color: '#C9A84C' }}>
                  Continue →
                </button>
              </div>
              <button onClick={() => setStep(3)} className="w-full text-[11px] text-ink-muted hover:text-ink text-center py-1">
                Skip for now
              </button>
            </div>
          )}

          {/* Step 3 — Signature */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-[14px] font-medium text-ink mb-1">Draw Your Signature</h2>
                <p className="text-[12px] text-ink-muted">This signature will appear on all dispute letters sent on your behalf.</p>
              </div>
              <div className="border border-border rounded-sm overflow-hidden">
                <canvas ref={canvasRef} width={460} height={140}
                  className="block w-full touch-none bg-gray-50 cursor-crosshair"
                  onMouseDown={startDraw} onMouseMove={draw} onMouseUp={stopDraw} onMouseLeave={stopDraw}
                  onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={stopDraw} />
                <div className="flex items-center justify-between px-3 py-1.5 border-t border-border bg-white">
                  <span className="text-[10px] text-ink-faint uppercase tracking-wider">Sign above</span>
                  <button onClick={clearSignature} className="text-[10px] text-ink-muted hover:text-red-600 uppercase tracking-wider">Clear</button>
                </div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setStep(2)} className="flex-1 py-2.5 text-[12px] uppercase tracking-wider rounded-sm border border-border text-ink-muted hover:text-ink transition-colors">
                  ← Back
                </button>
                <button onClick={() => setStep(4)} disabled={!signature}
                  className="flex-1 py-2.5 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                  style={{ backgroundColor: signature ? '#1B2A4A' : '#B5BBC9', color: '#C9A84C' }}>
                  Continue →
                </button>
              </div>
              <button onClick={() => setStep(4)} className="w-full text-[11px] text-ink-muted hover:text-ink text-center py-1">
                Skip for now
              </button>
            </div>
          )}

          {/* Step 4 — Review & Sign */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h2 className="text-[14px] font-medium text-ink mb-1">Review & Complete Enrollment</h2>
                <p className="text-[12px] text-ink-muted">By completing enrollment you authorize Credit Comeback Club to dispute credit information on your behalf per the Limited Power of Attorney.</p>
              </div>
              <div className="bg-gray-50 border border-border rounded-sm p-3 space-y-1.5 text-[12px]">
                <div className="flex items-center gap-2">
                  <span className={idFile ? 'text-green-600' : 'text-amber-600'}>{idFile ? '✓' : '○'}</span>
                  <span className="text-ink">{idFile ? `Government ID: ${idFile.name}` : 'Government ID: Not uploaded'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={addressFile ? 'text-green-600' : 'text-amber-600'}>{addressFile ? '✓' : '○'}</span>
                  <span className="text-ink">{addressFile ? `Proof of Address: ${addressFile.name}` : 'Proof of Address: Not uploaded'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={signature ? 'text-green-600' : 'text-amber-600'}>{signature ? '✓' : '○'}</span>
                  <span className="text-ink">{signature ? 'Signature: Drawn' : 'Signature: Not drawn'}</span>
                </div>
              </div>
              <div className="bg-amber-50 border border-amber-200 rounded-sm p-3 text-[11px] text-amber-800">
                By clicking Complete Enrollment, you authorize Credit Comeback Club to act as your representative for credit dispute purposes per the LPOA. Your electronic authorization is valid under the ESIGN Act (15 U.S.C. §7001).
              </div>
              {error && <div className="text-[12px] text-red-600 bg-red-50 border border-red-200 rounded-sm px-3 py-2">{error}</div>}
              <div className="flex gap-2">
                <button onClick={() => setStep(3)} className="flex-1 py-2.5 text-[12px] uppercase tracking-wider rounded-sm border border-border text-ink-muted hover:text-ink transition-colors">
                  ← Back
                </button>
                <button onClick={handleComplete} disabled={loading}
                  className="flex-1 py-2.5 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
                  style={{ backgroundColor: loading ? '#B5BBC9' : '#1B2A4A', color: '#C9A84C' }}>
                  {loading ? 'Saving…' : '✓ Complete Enrollment'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
