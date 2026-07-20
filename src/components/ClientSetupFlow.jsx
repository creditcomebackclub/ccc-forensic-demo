import React, { useState } from 'react';
import { supabase } from '../utils/supabase';
import { motion, AnimatePresence } from 'framer-motion';
import { Toaster, toast } from 'react-hot-toast';
import { Check, ChevronRight, Lock, UserCheck, FileText, PenTool } from 'lucide-react';

export default function ClientSetupFlow({ session, onComplete, initialStep = 'password' }) {
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
      setStep('onboarding');
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
    if (!signature) {
      toast.error('Please draw your signature in Step 3 before completing enrollment.');
      setStep(3);
      return;
    }
    setLoading(true);
    const toastId = toast.loading('Finalizing your enrollment...');
    const userId = session.user.id;
    try {
      let sigUrl = null;
      if (signature) {
        sigUrl = await uploadSignature(signature, `${userId}/signature.png`);
      }
      if (idFile) await uploadFile(idFile, `${userId}/id.${idFile.name.split('.').pop()}`);
      if (addressFile) await uploadFile(addressFile, `${userId}/address.${addressFile.name.split('.').pop()}`);

      const userEmail = session.user.email;
      await supabase.from('client_profiles').update({
        signature_data: sigUrl,
        signature_signed_at: new Date().toISOString(),
        agreement_signed_at: new Date().toISOString(),
        onboarding_complete: true,
        user_id: userId,
      }).eq('email', userEmail);

      const { data: cp } = await supabase.from('client_profiles').select('full_name').eq('email', session.user.email).single();
      const signedAt = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
      const clientFullName = (cp && cp.full_name) || session.user.email;

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
        + '<p>This Limited Power of Attorney is executed between <strong>' + clientFullName + '</strong> ("Principal") and Credit Comeback Club, a DBA of Christopher Holland, 3088 Colorado Ave, Grand Junction, CO 81504, 970-644-0063 ("Attorney-in-Fact").</p>'
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
        + '<p>First Work Fee: $49 after audit delivery. Per-delete: Type A $125/bureau, Type B $75/bureau, Type C $150/bureau, Public Record $175/bureau. ScoreFusion monitoring: $16/month (Principal responsibility). No deletion = no charge.</p>'
        + '<h2>5. No Guarantee</h2>'
        + '<p>No specific outcome is guaranteed. Results vary by credit profile and creditor response.</p>'
        + '<h2>6. Duration & Revocation</h2>'
        + '<p>Effective until written revocation, dispute completion, or agreement termination. To revoke: email creditcomebackclub@gmail.com with subject "LPOA REVOCATION — [Your Name]."</p>'
        + '<h2>7. ESIGN Disclosure</h2>'
        + '<p>This document was executed electronically. The drawn signature below constitutes a legally binding electronic signature under the ESIGN Act (15 U.S.C. §7001). Execution timestamp, IP address, and user agent are recorded.</p>'
        + '<div class="sig-block">'
        + '<div class="sig-row">'
        + '<div class="sig-col"><div class="sig-line">' + (sigUrl ? '<img src="' + sigUrl + '" style="max-height:56px;max-width:220px;" />' : '') + '</div><div class="sig-label">Principal Signature — ' + clientFullName + '</div><div class="sig-label">Date: ' + signedAt + '</div></div>'
        + '<div class="sig-col"><div class="sig-line"><img src="https://mlsbdmewxocgweotcdud.supabase.co/storage/v1/object/public/client-docs/standalone/Christopher%20Holland/chris_signature.png" style="max-height:56px;max-width:220px;" /></div><div class="sig-label">Christopher Holland — Attorney-in-Fact, Credit Comeback Club</div><div class="sig-label">Date: ' + signedAt + '</div></div>'
        + '</div></div>'
        + '<div class="footer">Credit Comeback Club | 3088 Colorado Ave, Grand Junction, CO 81504 | 970-644-0063 | creditcomebackclub.com | Executed under ESIGN Act 15 U.S.C. §7001</div>'
        + '</body></html>';

      const lpoaBlob = new Blob([lpoaHtml], { type: 'text/html' });
      const lpoaFile = new File([lpoaBlob], 'lpoa-signed.html', { type: 'text/html' });
      const { error: lpoaErr } = await supabase.storage.from('client-docs').upload(userId + '/lpoa-signed.html', lpoaFile, { upsert: true });
      let lpoaUrl = null;
      if (!lpoaErr) {
        const { data: lpoaData } = supabase.storage.from('client-docs').getPublicUrl(userId + '/lpoa-signed.html');
        lpoaUrl = lpoaData.publicUrl;
      }

      if (lpoaUrl) {
        await supabase.from('client_profiles').update({ lpoa_url: lpoaUrl }).eq('email', session.user.email);
      }

      if (cp) {
        await supabase.from('clients').update({
          lpoa_signed: true,
          lpoa_signed_at: new Date().toISOString(),
          lpoa_signature_data: { signatureUrl: sigUrl, lpoaUrl, signedAt: new Date().toISOString(), method: 'Canvas drawn signature + ESIGN Act' },
        }).eq('name', cp.full_name);
      }

      toast.success('Enrollment Complete! Entering Portal...', { id: toastId });
      setTimeout(() => onComplete({ signatureUrl: sigUrl }), 1500);
    } catch (e) {
      toast.error(e.message || 'Could not complete setup', { id: toastId });
      setLoading(false);
    }
  };

  const steps = [
    { title: 'Government ID', icon: <UserCheck size={16} /> },
    { title: 'Proof of Address', icon: <FileText size={16} /> },
    { title: 'Your Signature', icon: <PenTool size={16} /> },
    { title: 'Review & Sign', icon: <Check size={16} /> }
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
                      <p><strong className="text-slate-900">Services:</strong> Credit Comeback Club ("CCC") will perform a forensic Metro 2 and FCRA audit of your credit reports and prepare direct furnisher dispute letters on your behalf.</p>
                      <p><strong className="text-slate-900">Fee Schedule (Pay-Per-Delete):</strong></p>
                      <ul className="pl-4 space-y-1 text-gray-500">
                        <li>• First Work Fee: $49 (due after audit delivery)</li>
                        <li>• Type A deletion: $125 per bureau</li>
                        <li>• Type B deletion: $75 per bureau</li>
                        <li>• Type C deletion: $150 per bureau</li>
                        <li>• Public Record deletion: $175 per bureau</li>
                        <li>• No deletion = no charge.</li>
                      </ul>
                      <p><strong className="text-slate-900">Credit Monitoring:</strong> ScoreFusion monitoring at $16/month is the client's direct responsibility.</p>
                      <p><strong className="text-slate-900">No Guarantee:</strong> CCC makes no guarantee of specific outcomes. Results vary by credit profile and creditor response.</p>
                      <p><strong className="text-slate-900">Prohibited Practices:</strong> CCC does not dispute accurate information or create new credit identities.</p>
                      <p><strong className="text-slate-900">CROA Compliance:</strong> This agreement complies with the Credit Repair Organizations Act (15 U.S.C. §1679 et seq.). You have the right to cancel within 3 business days of signing.</p>
                      <p><strong className="text-slate-900">Contact:</strong> 3088 Colorado Ave, Grand Junction, CO 81504 | 970-644-0063</p>
                    </div>
                  </div>

                  <label className="flex items-start gap-3 cursor-pointer p-4 rounded-xl border border-gray-200 bg-gray-50 hover:bg-amber-50/50 hover:border-amber-200 transition-colors">
                    <input type="checkbox" checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)}
                      className="mt-1 w-4 h-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400" />
                    <span className="text-xs text-gray-600 leading-relaxed">
                      I have read and agree to the <strong className="text-slate-900">Client Service Agreement</strong> above. I authorize Credit Comeback Club to dispute credit information on my behalf per the Limited Power of Attorney. I understand my electronic signature is legally binding under the ESIGN Act (15 U.S.C. §7001).
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
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
