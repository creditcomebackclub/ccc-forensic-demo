import { Link } from 'react-router-dom';
import Logo from '../components/Logo';
import { SiteFooter } from '../components/SiteChrome';

export default function About() {
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

      <article className="mx-auto max-w-3xl px-6 py-12 md:px-8 md:py-16">
        <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">About</p>
        <h1 className="fw-display mt-3 text-4xl font-bold md:text-5xl">
          Built for people who got tired of the black box.
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-[var(--fw-muted)]">
          Fieldwork exists because credit repair too often means paying monthly for silence — form letters
          you never see, “wins” that bounce back, and a playbook that stays locked behind an agency login.
        </p>

        <div className="mt-10 space-y-5 text-[15px] leading-relaxed text-[var(--fw-ink)]/85">
          <p>
            We’re building software for consumers who want to repair their own credit the serious way:
            start with the furnisher, cite real Metro 2 / FCRA issues, mail certified disputes in their own
            name, and keep the paper trail.
          </p>
          <p>
            The product is informed by operators who have run furnisher-first forensic campaigns in the
            field — the same discipline behind careful field numbering, DOFD scrutiny, and documented
            letters — packaged so you don’t need to hire a firm to touch the work.
          </p>

          <h2 className="fw-display !mt-12 text-2xl font-bold text-[var(--fw-ink)]">What we believe</h2>
          <ul className="list-disc space-y-2 pl-5">
            <li>You should see the audit before anything is mailed.</li>
            <li>You should choose every fight.</li>
            <li>Accurate negatives aren’t “erased” by software — and anyone who promises that is selling fantasy.</li>
            <li>Compliance and clarity beat hype. Always.</li>
          </ul>

          <h2 className="fw-display !mt-12 text-2xl font-bold text-[var(--fw-ink)]">How we’re organized</h2>
          <p>
            Fieldwork is its own software company. Your subscriber data, billing, and mail credits live in
            Fieldwork’s systems — built for self-serve DIY, not a done-for-you agency desk.
          </p>

          <h2 className="fw-display !mt-12 text-2xl font-bold text-[var(--fw-ink)]">Talk to us</h2>
          <p>
            Questions about the product, partnerships, or compliance packaging:{' '}
            <Link to="/contact" className="font-semibold text-[var(--fw-sea)] hover:underline">Contact</Link>
            {' '}·{' '}
            <Link to="/croa" className="font-semibold text-[var(--fw-sea)] hover:underline">CROA rights</Link>
            {' '}·{' '}
            <Link to="/privacy" className="font-semibold text-[var(--fw-sea)] hover:underline">Privacy</Link>.
          </p>
        </div>
      </article>

      <SiteFooter dark />
    </div>
  );
}
