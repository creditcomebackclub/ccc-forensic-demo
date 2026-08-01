import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { DEFAULT_PLAN_ID, PRICING_PLANS } from '../demoData';
import { useFieldwork } from '../state';
import Logo from '../components/Logo';

export default function Auth() {
  const { signUp } = useFieldwork();
  const navigate = useNavigate();
  const [name, setName] = useState('Alex Rivera');
  const [email, setEmail] = useState('alex@example.com');
  const [planId, setPlanId] = useState(DEFAULT_PLAN_ID);
  const [agreed, setAgreed] = useState(false);

  return (
    <div className="min-h-screen fw-atmosphere text-white">
      <div className="absolute inset-0 fw-grid-overlay pointer-events-none opacity-70" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
        <Link to="/" className="mb-10 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white">
          <ArrowLeft size={16} /> Back
        </Link>

        <Logo invert to={false} size={34} />
        <h1 className="fw-display mt-6 text-4xl font-bold leading-tight">Create your workspace</h1>
        <p className="mt-3 text-white/65">
          No card for the demo. Pick a plan, open the app, and walk a sample audit the way your real file would go.
        </p>

        <form
          className="mt-10 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!agreed) return;
            signUp(
              { name: name.trim() || 'Alex Rivera', email: email.trim() || 'alex@example.com' },
              planId,
            );
            navigate('/app');
          }}
        >
          <label className="block">
            <span className="fw-mono text-[11px] uppercase tracking-widest text-white/45">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-2 w-full rounded border border-white/15 bg-white/5 px-4 py-3 text-white outline-none ring-[var(--fw-signal)] focus:ring-1"
            />
          </label>
          <label className="block">
            <span className="fw-mono text-[11px] uppercase tracking-widest text-white/45">Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-2 w-full rounded border border-white/15 bg-white/5 px-4 py-3 text-white outline-none ring-[var(--fw-signal)] focus:ring-1"
            />
          </label>

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
                      <span className="ml-2 text-white/45">{p.mailCredits} credits</span>
                    </span>
                  </span>
                  <span className="fw-mono">${p.price}/mo</span>
                </label>
              ))}
            </div>
          </fieldset>

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

          <button type="submit" disabled={!agreed} className="fw-btn-primary mt-2 w-full text-base">
            Enter Fieldwork <ArrowRight size={18} />
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
