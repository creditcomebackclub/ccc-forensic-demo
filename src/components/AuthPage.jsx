import React, { useState } from 'react';
import { supabase } from '../utils/supabase';
import { Shield } from 'lucide-react';

export default function AuthPage() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        // account_type marks explicit auditor signups — loadUser only creates
        // an auditor profile when this flag is present, never by inference
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name, account_type: 'auditor' } },
        });
        if (error) throw error;
        setSuccess('Account created — check your email to confirm, then sign in.');
        setMode('login');
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin,
        });
        if (error) throw error;
        setSuccess('Password reset email sent — check your inbox.');
        setMode('login');
      }
    } catch (e) {
      setError(e.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  const handleKey = (e) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div className="min-h-screen flex bg-white">
      
      {/* Left Side - Brand Hero */}
      <div className="hidden lg:flex lg:w-5/12 relative bg-[#081626] flex-col justify-between p-12 overflow-hidden border-r border-[#C9A84C]/20 shadow-2xl">
        {/* Background gradients */}
        <div className="absolute top-[-100px] right-[-100px] w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(240,180,41,0.08)_0%,transparent_68%)] pointer-events-none"></div>
        <div className="absolute bottom-[-80px] left-[-60px] w-[400px] h-[400px] bg-[radial-gradient(circle,rgba(240,180,41,0.04)_0%,transparent_68%)] pointer-events-none"></div>
        
        <div className="relative z-10 flex items-center gap-3">
          <img src="/logo.jpg" alt="CCC" className="w-12 h-12 object-contain rounded-lg shadow-lg border border-white/10" />
          <div>
            <div className="text-white text-[20px] font-bold ccc-display leading-tight">Credit Comeback Club</div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-[#C9A84C] font-semibold">Secure Portal</div>
          </div>
        </div>

        <div className="relative z-10 max-w-md">
          <h2 className="ccc-display text-4xl text-white font-bold leading-[1.15] mb-5">
            Your path to <span className="text-[#C9A84C]">financial freedom</span> starts here.
          </h2>
          <p className="text-[15px] text-white/60 leading-relaxed mb-10">
            Log in to track your dispute progress, review your forensic audit, and communicate directly with your team.
          </p>
          <div className="flex items-center gap-4 bg-white/5 border border-white/10 rounded-xl p-4 backdrop-blur-sm">
            <div className="w-12 h-12 rounded-full bg-[#C9A84C]/10 border border-[#C9A84C]/20 flex items-center justify-center flex-shrink-0">
               <Shield size={20} className="text-[#C9A84C]" />
            </div>
            <div>
              <div className="text-white font-medium text-[14px]">Bank-Level Security</div>
              <div className="text-[12px] text-white/50 mt-0.5">Your data is encrypted and strictly confidential.</div>
            </div>
          </div>
        </div>
        
        <div className="relative z-10 text-[11px] text-white/30">
          &copy; {new Date().getFullYear()} Credit Comeback Club, LLC. All rights reserved.
        </div>
      </div>

      {/* Right Side - Form */}
      <div className="w-full lg:w-7/12 flex items-center justify-center p-6 sm:p-12 bg-[#F5F9FD]">
        <div className="w-full max-w-[420px]">
          
          <div className="lg:hidden text-center mb-10">
            <img src="/logo.jpg" alt="Credit Comeback Club" className="w-20 h-20 mx-auto mb-4 object-contain rounded-xl shadow-md border border-gray-100" />
            <h1 className="ccc-display text-2xl text-ink font-bold">Credit Comeback Club</h1>
            <p className="text-[11px] uppercase tracking-[0.18em] text-[#C9A84C] mt-1 font-semibold">Secure Portal</p>
          </div>

          <div className="bg-white border border-border rounded-2xl p-8 sm:p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)]">
            <div className="mb-8">
              <h2 className="text-[22px] font-bold text-ink mb-2">
                {mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create an account' : 'Reset password'}
              </h2>
              <p className="text-[13px] text-ink-muted">
                {mode === 'login' ? 'Please enter your details to sign in.' : mode === 'signup' ? 'Enter your details below to get started.' : 'Enter your email and we will send you a reset link.'}
              </p>
            </div>

            {success && (
              <div className="mb-6 text-[13px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                {success}
              </div>
            )}
            {error && (
              <div className="mb-6 text-[13px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                {error}
              </div>
            )}

            <div className="space-y-4">
              {mode === 'signup' && (
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-ink-muted font-bold block mb-1.5">Full Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder="Chris Holland"
                    className="w-full border border-gray-200 rounded-lg px-4 py-3 text-[14px] text-ink focus:outline-none focus:border-[#C9A84C] focus:ring-1 focus:ring-[#C9A84C] transition-all bg-gray-50/50"
                  />
                </div>
              )}

              <div>
                <label className="text-[11px] uppercase tracking-wider text-ink-muted font-bold block mb-1.5">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="you@example.com"
                  className="w-full border border-gray-200 rounded-lg px-4 py-3 text-[14px] text-ink focus:outline-none focus:border-[#C9A84C] focus:ring-1 focus:ring-[#C9A84C] transition-all bg-gray-50/50"
                />
              </div>

              {mode !== 'reset' && (
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-ink-muted font-bold block mb-1.5">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={handleKey}
                    placeholder="••••••••"
                    className="w-full border border-gray-200 rounded-lg px-4 py-3 text-[14px] text-ink focus:outline-none focus:border-[#C9A84C] focus:ring-1 focus:ring-[#C9A84C] transition-all bg-gray-50/50"
                  />
                </div>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading}
              className="w-full mt-8 py-3.5 text-[14px] font-bold rounded-lg transition-all shadow-md hover:shadow-lg flex items-center justify-center"
              style={{
                backgroundColor: loading ? '#B5BBC9' : '#C9A84C',
                color: loading ? 'white' : '#0B1F3A',
                transform: loading ? 'none' : 'translateY(-1px)'
              }}
            >
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
            </button>

            <div className="mt-6 flex flex-col gap-3">
              {mode === 'login' && (
                <button
                  onClick={() => { setMode('reset'); setError(null); setSuccess(null); }}
                  className="text-[13px] text-ink-muted hover:text-[#C9A84C] text-center font-medium transition-colors"
                >
                  Forgot your password?
                </button>
              )}
              {mode === 'reset' && (
                <button
                  onClick={() => { setMode('login'); setError(null); }}
                  className="text-[13px] text-ink-muted hover:text-[#C9A84C] text-center font-medium transition-colors"
                >
                  &larr; Back to sign in
                </button>
              )}
              
              {/* Note: In this system, only clients log in. The 'signup' mode is strictly a backdoor for creating Auditor accounts, so we hide it behind a small subtle link if needed, or we can just leave it out of the main UI and rely on magic links. Since the previous UI had it, we'll keep it as a subtle link at the bottom */}
              <div className="mt-4 pt-4 border-t border-gray-100 text-center">
                 {mode === 'login' ? (
                   <button onClick={() => { setMode('signup'); setError(null); setSuccess(null); }} className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors">Team Signup</button>
                 ) : mode === 'signup' ? (
                   <button onClick={() => { setMode('login'); setError(null); setSuccess(null); }} className="text-[12px] text-gray-400 hover:text-gray-600 transition-colors">Back to Login</button>
                 ) : null}
              </div>
            </div>
          </div>
          
        </div>
      </div>
    </div>
  );
}
