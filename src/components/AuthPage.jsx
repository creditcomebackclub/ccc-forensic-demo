import React, { useState } from 'react';
import { supabase } from '../utils/supabase';

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
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: name } },
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
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/logo.jpg" alt="Credit Comeback Club" className="w-24 h-24 mx-auto mb-4 object-contain rounded" />
          <h1 className="ccc-display text-2xl text-ink font-medium">Credit Comeback Club</h1>
          <p className="text-[11px] uppercase tracking-[0.18em] text-gold mt-1">Forensic Suite</p>
        </div>

        <div className="bg-white border border-border rounded p-7 shadow-sm">
          <div className="flex gap-0 mb-6 border border-border rounded-sm overflow-hidden">
            {['login', 'signup'].map((m) => (
              <button
                key={m}
                onClick={() => { setMode(m); setError(null); setSuccess(null); }}
                className="flex-1 py-2 text-[11px] uppercase tracking-wider transition-colors"
                style={{
                  backgroundColor: mode === m ? '#1B2A4A' : 'transparent',
                  color: mode === m ? '#C9A84C' : '#6B7280',
                }}
              >
                {m === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          {success && (
            <div className="mb-4 text-[12px] text-green-700 bg-green-50 border border-green-200 rounded-sm px-3 py-2">
              {success}
            </div>
          )}
          {error && (
            <div className="mb-4 text-[12px] text-red-700 bg-red-50 border border-red-200 rounded-sm px-3 py-2">
              {error}
            </div>
          )}

          <div className="space-y-3">
            {mode === 'signup' && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">Full Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="Chris Holland"
                  className="w-full border border-border rounded-sm px-3 py-2 text-[13px] text-ink focus:outline-none focus:border-navy"
                />
              </div>
            )}

            <div>
              <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={handleKey}
                placeholder="you@example.com"
                className="w-full border border-border rounded-sm px-3 py-2 text-[13px] text-ink focus:outline-none focus:border-navy"
              />
            </div>

            {mode !== 'reset' && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-ink-faint font-medium block mb-1">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKey}
                  placeholder="••••••••"
                  className="w-full border border-border rounded-sm px-3 py-2 text-[13px] text-ink focus:outline-none focus:border-navy"
                />
              </div>
            )}
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full mt-5 py-2.5 text-[12px] uppercase tracking-wider rounded-sm transition-colors"
            style={{
              backgroundColor: loading ? '#B5BBC9' : '#1B2A4A',
              color: '#C9A84C',
            }}
          >
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Email'}
          </button>

          {mode === 'login' && (
            <button
              onClick={() => { setMode('reset'); setError(null); setSuccess(null); }}
              className="w-full mt-3 text-[11px] text-ink-muted hover:text-ink text-center"
            >
              Forgot password?
            </button>
          )}
          {mode === 'reset' && (
            <button
              onClick={() => { setMode('login'); setError(null); }}
              className="w-full mt-3 text-[11px] text-ink-muted hover:text-ink text-center"
            >
              Back to sign in
            </button>
          )}
        </div>

        <p className="text-center text-[10px] text-ink-faint mt-6">
          Credit Comeback Club · Forensic Credit Audit Suite
        </p>
      </div>
    </div>
  );
}
