import { Link } from 'react-router-dom';
import Logo from './Logo';
import { SectionLink } from './SectionLink';
import { useFieldwork } from '../state';

const FOOTER_COLS = [
  {
    title: 'Product',
    links: [
      { section: 'demo', label: 'Watch demo' },
      { section: 'how', label: 'How it works' },
      { section: 'pricing', label: 'Pricing' },
      { to: '/demo', label: 'Try the product' },
      { to: '/signup', label: 'Get started' },
      { to: '/login', label: 'Log in' },
    ],
  },
  {
    title: 'Company',
    links: [
      { to: '/about', label: 'About' },
      { to: '/contact', label: 'Contact' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { to: '/terms', label: 'Terms of Service' },
      { to: '/privacy', label: 'Privacy Policy' },
      { to: '/croa', label: 'CROA Consumer Rights' },
    ],
  },
];

export function MarketingHeader() {
  const { user } = useFieldwork();
  return (
    <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 pt-6 md:px-8">
      <Logo invert size={32} />
      <nav className="flex items-center gap-4 text-sm">
        <Link to="/about" className="hidden text-white/65 hover:text-white sm:inline">About</Link>
        <SectionLink section="pricing" className="hidden text-white/65 hover:text-white md:inline">
          Pricing
        </SectionLink>
        <SectionLink section="how" className="hidden text-white/65 hover:text-white lg:inline">
          How it works
        </SectionLink>
        <Link to="/contact" className="hidden text-white/65 hover:text-white sm:inline">Contact</Link>
        {user && !user.guest ? (
          <Link to="/app" className="fw-btn-primary !py-2 !px-3 text-sm">Open app</Link>
        ) : (
          <>
            <Link to="/demo" className="hidden text-white/80 hover:text-white md:inline">
              Try the product
            </Link>
            <Link to="/login" className="hidden text-white/80 hover:text-white sm:inline">
              Log in
            </Link>
            <Link to="/signup" className="fw-btn-primary !py-2 !px-3 text-sm">Get started</Link>
          </>
        )}
      </nav>
    </header>
  );
}

export function SiteFooter({ dark = true }) {
  const wrap = dark
    ? 'border-t border-white/10 bg-[var(--fw-ink)] text-white/50'
    : 'border-t border-[var(--fw-line)] bg-[var(--fw-paper)] text-[var(--fw-muted)]';

  return (
    <footer className={`${wrap} px-6 py-14 text-sm md:px-8`}>
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 md:grid-cols-[1.2fr_repeat(3,1fr)]">
          <div>
            <Logo invert={dark} to="/" size={28} />
            <p className={`mt-4 max-w-sm leading-relaxed ${dark ? 'text-white/45' : ''}`}>
              DIY credit-repair software. You choose every dispute and remain the sender of record.
              Not legal advice. Not a credit repair organization sales pitch in disguise — read our disclosures.
            </p>
          </div>
          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <div className={`fw-mono text-[10px] uppercase tracking-[0.2em] ${dark ? 'text-white/35' : 'text-[var(--fw-sea)]'}`}>
                {col.title}
              </div>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    {link.section ? (
                      <SectionLink
                        section={link.section}
                        className={dark ? 'text-white/70 hover:text-white' : 'hover:text-[var(--fw-ink)]'}
                      >
                        {link.label}
                      </SectionLink>
                    ) : (
                      <Link
                        to={link.to}
                        className={dark ? 'text-white/70 hover:text-white' : 'hover:text-[var(--fw-ink)]'}
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className={`mt-12 flex flex-col gap-3 border-t pt-6 text-xs md:flex-row md:items-center md:justify-between ${dark ? 'border-white/10' : 'border-[var(--fw-line)]'}`}>
          <p>© {new Date().getFullYear()} Fieldwork. All rights reserved.</p>
          <p className="max-w-xl md:text-right">
            <Link to="/croa" className={dark ? 'text-[var(--fw-signal)] hover:underline' : 'text-[var(--fw-sea)] hover:underline'}>
              Statement of Consumer Rights (CROA)
            </Link>
            {' · '}
            <Link to="/privacy" className="hover:underline">Privacy</Link>
            {' · '}
            <Link to="/terms" className="hover:underline">Terms</Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

export function LegalShell({ title, eyebrow = 'Legal', children }) {
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
        <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">{eyebrow}</p>
        <h1 className="fw-display mt-3 text-4xl font-bold md:text-5xl">{title}</h1>
        <div className="legal-prose mt-10 space-y-5 text-[15px] leading-relaxed text-[var(--fw-ink)]/85">
          {children}
        </div>
      </article>
      <SiteFooter dark />
    </div>
  );
}
