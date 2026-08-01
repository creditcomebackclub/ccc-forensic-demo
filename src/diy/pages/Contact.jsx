import { useState } from 'react';
import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import { SiteFooter } from '../components/SiteChrome';

export default function Contact() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [topic, setTopic] = useState('support');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  return (
    <div className="min-h-screen bg-[var(--fw-paper)] text-[var(--fw-ink)]">
      <div className="border-b border-[var(--fw-line)] bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5 md:px-8">
          <Logo size={28} />
          <Link to="/" className="text-sm font-semibold text-[var(--fw-sea)] hover:underline">
            Back to home
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-6 py-12 md:px-8 md:py-16">
        <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Contact</p>
        <h1 className="fw-display mt-3 text-4xl font-bold md:text-5xl">We’re here.</h1>
        <p className="mt-4 max-w-xl text-lg text-[var(--fw-muted)]">
          Product questions, billing, privacy requests, or CROA / cancellation notices. Enterprise-grade
          response paths — even while this build is still in demo.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Support', value: 'support@fieldwork.app' },
            { label: 'Privacy', value: 'privacy@fieldwork.app' },
            { label: 'Legal', value: 'legal@fieldwork.app' },
          ].map((row) => (
            <div key={row.label} className="rounded border border-[var(--fw-line)] bg-white px-4 py-3">
              <div className="fw-mono text-[10px] uppercase tracking-wider text-[var(--fw-muted)]">{row.label}</div>
              <div className="fw-mono mt-1 text-sm font-medium">{row.value}</div>
            </div>
          ))}
        </div>

        {sent ? (
          <div className="mt-10 rounded-lg border border-[rgba(22,158,111,0.25)] bg-[rgba(46,230,166,0.1)] px-5 py-6">
            <h2 className="fw-display text-2xl font-bold">Message recorded</h2>
            <p className="mt-2 text-[var(--fw-muted)]">
              In the demo, your message is saved locally and a mailto draft can be opened from your mail app.
              In production this hits our ticket queue.
            </p>
            <button type="button" className="fw-btn-ink mt-5" onClick={() => setSent(false)}>
              Send another
            </button>
          </div>
        ) : (
          <form
            className="mt-10 space-y-4 rounded-lg border border-[var(--fw-line)] bg-white p-6"
            onSubmit={(e) => {
              e.preventDefault();
              const payload = { name, email, topic, message, at: new Date().toISOString() };
              try {
                const prev = JSON.parse(localStorage.getItem('fieldwork-contact-demos') || '[]');
                localStorage.setItem('fieldwork-contact-demos', JSON.stringify([payload, ...prev].slice(0, 20)));
              } catch { /* ignore */ }
              const subject = encodeURIComponent(`[Fieldwork ${topic}] from ${name || 'user'}`);
              const body = encodeURIComponent(`${message}\n\n— ${name}\n${email}`);
              window.location.href = `mailto:support@fieldwork.app?subject=${subject}&body=${body}`;
              setSent(true);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">Name</span>
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="mt-1.5 w-full rounded border border-[var(--fw-line)] px-3 py-2.5 outline-none ring-[var(--fw-sea)] focus:ring-1"
                />
              </label>
              <label className="block">
                <span className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">Email</span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5 w-full rounded border border-[var(--fw-line)] px-3 py-2.5 outline-none ring-[var(--fw-sea)] focus:ring-1"
                />
              </label>
            </div>
            <label className="block">
              <span className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">Topic</span>
              <select
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                className="mt-1.5 w-full rounded border border-[var(--fw-line)] bg-white px-3 py-2.5 outline-none ring-[var(--fw-sea)] focus:ring-1"
              >
                <option value="support">Product support</option>
                <option value="billing">Billing / credits</option>
                <option value="privacy">Privacy request</option>
                <option value="croa">CROA / cancellation notice</option>
                <option value="press">Press / partnerships</option>
              </select>
            </label>
            <label className="block">
              <span className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-muted)]">Message</span>
              <textarea
                required
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="mt-1.5 w-full rounded border border-[var(--fw-line)] px-3 py-2.5 outline-none ring-[var(--fw-sea)] focus:ring-1"
              />
            </label>
            <p className="text-xs text-[var(--fw-muted)]">
              By sending, you agree we may use your contact details to respond. See our{' '}
              <Link to="/privacy" className="text-[var(--fw-sea)] hover:underline">Privacy Policy</Link>.
            </p>
            <button type="submit" className="fw-btn-ink">
              Send message
            </button>
          </form>
        )}
      </div>

      <SiteFooter dark />
    </div>
  );
}
