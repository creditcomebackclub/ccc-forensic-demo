import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { DEFAULT_PLAN_ID, PRICING_PLANS } from '../demoData';
import { useFieldwork } from '../state';
import Logo from '../components/Logo';
import { fieldworkCloudEnabled } from '../supabase';

export default function Auth() {
  const { signUp, signIn } = useFieldwork();
  const navigate = useNavigate();
  const [mode, setMode] = useState('signup'); // signup | signin
  const [name, setName] = useState('Alex Rivera');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [planId, setPlanId] = useState(DEFAULT_PLAN_ID);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (mode === 'signup' && !agreed) return;
    setBusy(true);
    try {
      if (mode === 'signin') {
        await signIn({
          email: email.trim(),
          password,
        });
      } else {
        await signUp(
          {
            name: name.trim() || 'Subscriber',
            email: email.trim(),
            password,
          },
          planId,
        );
      }
      navigate('/app');
    } catch (err) {
      setError(err?.message || 'Could not enter Fieldwork');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen fw-atmosphere text-white">
      <div className="absolute inset-0 fw-grid-overlay pointer-events-none opacity-70" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
        <Link to="/" className="mb-10 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white">
          <ArrowLeft size={16} /> Back
        </Link>

        <Logo invert to={false} size={34} />
        <h1 className="fw-display mt-6 text-4xl font-bold leading-tight">
          {mode === 'signin' ? 'Welcome back' : 'Create your workspace'}
        </h1>
        <p className="mt-3 text-white/65">
          {fieldworkCloudEnabled
            ? mode === 'signin'
              ? 'Sign in with the email and password for your Fieldwork account.'
              : 'Create a Fieldwork account. Your subscriber data stays in the Fieldwork workspace.'
            : 'No card for the demo. Pick a plan, open the app, and walk a sample audit the way your real file would go.'}
        </p>

        <div className="mt-6 flex gap-2 text-sm">
          <button
            type="button"
            onClick={() => { setMode('signup'); setError(''); }}
            className={`rounded px-3 py-1.5 font-semibold ${mode === 'signup' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white'}`}
          >
            Sign up
          </button>
          <button
            type="button"
            onClick={() => { setMode('signin'); setError(''); }}
            className={`rounded px-3 py-1.5 font-semibold ${mode === 'signin' ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white'}`}
          >
            Sign in
          </button>
        </div>

        <form className="mt-8 space-y-5" onSubmit={onSubmit}>
          {mode === 'signup' && (
            <label className="block">
              <span className="fw-mono text-[11px] uppercase tracking-widest text-white/45">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-2 w-full rounded border border-white/15 bg-white/5 px-4 py-3 text-white outline-none ring-[var(--fw-signal)] focus:ring-1"
                autoComplete="name"
              />
            </label>
          )}
          <label className="block">
            <span className="fw-mono text-[11px] uppercase tracking-widest text-white/45">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="mt-2 w-full rounded border border-white/15 bg-white/5 px-4 py-3 text-white outline-none ring-[var(--fw-signal)] focus:ring-1"
              autoComplete="email"
            />
          </label>

          {(fieldworkCloudEnabled || mode === 'signin') && (
            <label className="block">
              <span className="fw-mono text-[11px] uppercase tracking-widest text-white/45">Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required={fieldworkCloudEnabled || mode === 'signin'}
                minLength={6}
                className="mt-2 w-full rounded border border-white/15 bg-white/5 px-4 py-3 text-white outline-none ring-[var(--fw-signal)] focus:ring-1"
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              />
            </label>
          )}

          {mode === 'signup' && (
            <fieldset>
              <legend className="fw-mono text-[11px] uppercase tracking-widest text-white/45">Plan</legend>
              <div className="mt-2 grid gap-2">
                {PRICING_PLANS.map((p) => (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-center justify-between rounded border px-3 py-3 text-sm transition ${
                      planId === p.id
                        ? 'border-[var(--fw-signal)] bg-[rgba(46,230,166,0.08)]'
                        : 'border-white/15 bg-white/5'
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <input
                        type="radio"
                        name="plan"
                        checked={planId === p.id}
                        onChange={() => setPlanId(p.id)}
                        className="accent-[var(--fw-signal)]"
                      />
                      <span>
                        <span className="font-semibold">{p.name}</span>
                        <span className="ml-2 text-white/45">
                          {p.auditCredits} audits · {p.mailCredits} mail
                        </span>
                      </span>
                    </span>
                    <span className="fw-mono">${p.price}/mo</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {mode === 'signup' && (
            <label className="flex cursor-pointer items-start gap-3 rounded border border-white/15 bg-white/5 px-3 py-3 text-xs leading-relaxed text-white/70">
              <input
                type="checkbox"
                className="fw-check mt-0.5 !border-white/30"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                required
              />
              <span>
                I agree to the{' '}
                <Link to="/terms" className="text-[var(--fw-signal)] hover:underline">Terms of Service</Link>
                {' '}and{' '}
                <Link to="/privacy" className="text-[var(--fw-signal)] hover:underline">Privacy Policy</Link>
                , and I have received the{' '}
                <Link to="/croa" className="text-[var(--fw-signal)] hover:underline">Statement of Consumer Rights (CROA)</Link>.
                I understand Fieldwork is not legal advice and does not guarantee deletions or score increases.
              </span>
            </label>
          )}

          {error && (
            <p className="rounded border border-red-400/40 bg-red-500/10 px-3 py-2 text-sm text-red-100">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || (mode === 'signup' && !agreed)}
            className="fw-btn-primary mt-2 w-full text-base disabled:opacity-50"
          >
            {busy ? 'Working…' : mode === 'signin' ? 'Sign in' : 'Enter Fieldwork'} <ArrowRight size={18} />
          </button>
        </form>

        <p className="mt-8 text-xs leading-relaxed text-white/40">
          You remain the sender of record on every letter. Questions?{' '}
          <Link to="/contact" className="text-white/70 hover:underline">Contact us</Link>.
        </p>
      </div>
    </div>
  );
}
