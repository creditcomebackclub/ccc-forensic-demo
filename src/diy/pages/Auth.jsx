import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

export default function Auth({ onBack, onContinue }) {
  const [name, setName] = useState('Alex Rivera');
  const [email, setEmail] = useState('alex@example.com');

  return (
    <div className="min-h-screen fw-atmosphere text-white">
      <div className="absolute inset-0 fw-grid-overlay pointer-events-none opacity-70" />
      <div className="relative z-10 mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
        <button type="button" onClick={onBack} className="mb-10 inline-flex items-center gap-2 text-sm text-white/60 hover:text-white">
          <ArrowLeft size={16} /> Back
        </button>

        <div className="fw-display text-3xl font-bold">
          Fieldwork<span className="text-[var(--fw-signal)]">.</span>
        </div>
        <h1 className="fw-display mt-6 text-4xl font-bold leading-tight">Create your workspace</h1>
        <p className="mt-3 text-white/65">
          Demo mode — no password, no card. Jump straight into a sample Metro 2 audit.
        </p>

        <form
          className="mt-10 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            onContinue({ name: name.trim() || 'Alex Rivera', email: email.trim() || 'alex@example.com' });
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

          <button type="submit" className="fw-btn-primary mt-4 w-full text-base">
            Enter Fieldwork <ArrowRight size={18} />
          </button>
        </form>

        <p className="mt-8 text-xs leading-relaxed text-white/40">
          By continuing you acknowledge this is a product demo. Fieldwork does not provide legal advice. Consumers may dispute inaccurate information under the FCRA; you remain the sender of record.
        </p>
      </div>
    </div>
  );
}
