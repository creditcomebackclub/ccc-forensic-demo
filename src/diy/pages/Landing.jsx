import { motion } from 'framer-motion';
import { ArrowRight, BadgeCheck, Crosshair, FileSearch, Mail, Shield } from 'lucide-react';
import { PRICING_PLANS } from '../demoData';

const fadeUp = {
  hidden: { opacity: 0, y: 22 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.08 * i, duration: 0.65, ease: [0.22, 1, 0.36, 1] },
  }),
};

export default function Landing({ onStart, onEnterApp }) {
  return (
    <div className="min-h-screen text-white">
      {/* HERO — one composition, brand-first, full-bleed atmosphere */}
      <section className="relative min-h-[100svh] overflow-hidden fw-atmosphere">
        <div className="absolute inset-0 fw-grid-overlay pointer-events-none" />
        <div className="absolute inset-0 fw-field-scan pointer-events-none" />

        {/* Animated scan accent */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden opacity-40">
          <div className="fw-scan-line absolute left-[12%] right-[12%] h-24 bg-gradient-to-b from-transparent via-[rgba(46,230,166,0.2)] to-transparent" />
        </div>

        <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 pt-6 md:px-8">
          <div className="fw-display text-2xl font-extrabold tracking-tight">
            Fieldwork<span className="text-[var(--fw-signal)]">.</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {onEnterApp && (
              <button type="button" onClick={onEnterApp} className="fw-btn-ghost !py-2 !px-3 text-sm">
                Open workspace
              </button>
            )}
            <button type="button" onClick={onStart} className="fw-btn-primary !py-2 !px-3 text-sm">
              Try the demo
            </button>
          </div>
        </header>

        <div className="relative z-10 mx-auto flex min-h-[calc(100svh-5rem)] max-w-6xl flex-col justify-end px-6 pb-16 pt-24 md:px-8 md:pb-20">
          <motion.p
            className="fw-mono mb-5 text-[11px] uppercase tracking-[0.28em] text-[var(--fw-signal)]"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={0}
          >
            Furnisher-first credit repair
          </motion.p>
          <motion.h1
            className="fw-display max-w-4xl text-[clamp(3.2rem,9vw,6.4rem)] font-extrabold text-white"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={1}
          >
            Dispute at the
            <br />
            <span className="text-[var(--fw-signal)]">source.</span>
          </motion.h1>
          <motion.p
            className="mt-6 max-w-xl text-lg leading-relaxed text-[rgba(232,238,242,0.78)] md:text-xl"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={2}
          >
            Upload your report. Get a Metro 2 / FCRA field audit. Choose disputes. Mail certified letters — without handing your case to an agency.
          </motion.p>
          <motion.div
            className="mt-10 flex flex-wrap items-center gap-4"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={3}
          >
            <button type="button" onClick={onStart} className="fw-btn-primary text-base">
              Run a sample audit <ArrowRight size={18} />
            </button>
            <a href="#method" className="fw-btn-ghost text-base">
              See the method
            </a>
          </motion.div>
        </div>
      </section>

      {/* METHOD */}
      <section id="method" className="bg-[var(--fw-paper)] px-6 py-24 text-[var(--fw-ink)] md:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Why furnishers first</p>
          <h2 className="fw-display mt-3 max-w-3xl text-4xl font-bold md:text-5xl">
            Bureaus repeat what furnishers report. So we start where the data is born.
          </h2>
          <p className="mt-5 max-w-2xl text-lg text-[var(--fw-muted)]">
            Fieldwork reads your credit file like a compliance forensic — Metro 2 field numbers, FCRA citations, cross-bureau conflicts — then builds letters aimed at the companies reporting the errors.
          </p>

          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {[
              {
                icon: FileSearch,
                title: 'Field-level audit',
                body: 'DOFD, Compliance Condition Codes, balances, status/PHP chronology — cited to Metro 2 and FCRA, not vague “inaccurate” fluff.',
              },
              {
                icon: Crosshair,
                title: 'You choose the fights',
                body: 'Pick the accounts worth disputing. Preview plain-English findings before anything is mailed. You’re the decision-maker.',
              },
              {
                icon: Mail,
                title: 'Certified mail, tracked',
                body: 'Generate furnisher letters, send via Lob certified mail, and watch delivery + response windows in one timeline.',
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="border-t border-[var(--fw-line)] pt-6">
                <Icon className="text-[var(--fw-sea)]" size={22} strokeWidth={1.75} />
                <h3 className="fw-display mt-4 text-2xl font-bold">{title}</h3>
                <p className="mt-3 leading-relaxed text-[var(--fw-muted)]">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AUDIT PREVIEW STRIP */}
      <section className="bg-[var(--fw-ink)] px-6 py-24 text-white md:px-8">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-signal)]">Audit preview</p>
            <h2 className="fw-display mt-3 text-4xl font-bold md:text-5xl">
              Sleek findings.
              <br />
              Serious citations.
            </h2>
            <p className="mt-5 text-lg text-[rgba(232,238,242,0.72)]">
              Every issue ties a Metro 2 field to a statute — so your letter isn’t a template rant. It’s a documented accuracy challenge.
            </p>
            <ul className="mt-8 space-y-3 text-[rgba(232,238,242,0.85)]">
              {[
                'Field 25 DOFD re-aging detection',
                'Field 20 XB / investigation hygiene',
                'Cross-bureau balance conflicts (§607(b))',
                'Past-due vs balance impossibilities',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <BadgeCheck className="mt-0.5 shrink-0 text-[var(--fw-signal)]" size={18} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-lg bg-[var(--fw-glow)] blur-2xl" />
            <div className="relative overflow-hidden rounded-lg border border-white/10 bg-[var(--fw-deep)] p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <div className="fw-mono text-[10px] uppercase tracking-widest text-[var(--fw-signal)]">Critical · Field 25</div>
                  <div className="fw-display mt-1 text-xl font-bold">DOFD appears re-aged</div>
                </div>
                <div className="fw-mono text-xs text-white/50">FCRA §623(a)(5)</div>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-white/70">
                Midland Credit Management · Collection · •••• 4821
              </p>
              <div className="mt-5 grid gap-3 text-sm">
                <div className="rounded border border-white/10 bg-black/20 px-3 py-2">
                  <div className="fw-mono text-[10px] uppercase text-white/40">Reported</div>
                  <div className="mt-1">DOFD 03/2023 (post-acquisition)</div>
                </div>
                <div className="rounded border border-[rgba(46,230,166,0.25)] bg-[rgba(46,230,166,0.06)] px-3 py-2">
                  <div className="fw-mono text-[10px] uppercase text-[var(--fw-signal)]">Challenge</div>
                  <div className="mt-1">Trace DOFD to original Synchrony delinquency</div>
                </div>
              </div>
              <div className="mt-5 flex items-center gap-2 text-xs text-white/50">
                <Shield size={14} className="text-[var(--fw-signal)]" />
                Furnisher-first letter ready · 30-day clock
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="bg-[var(--fw-paper)] px-6 py-24 text-[var(--fw-ink)] md:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Pricing</p>
          <h2 className="fw-display mt-3 text-4xl font-bold md:text-5xl">Software that earns its keep.</h2>
          <p className="mt-4 max-w-xl text-lg text-[var(--fw-muted)]">
            Agency retainers run $79–$149/mo and they own the playbook. Fieldwork puts the forensic workflow in your hands — demo billing is simulated.
          </p>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {PRICING_PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`flex flex-col border p-6 ${
                  plan.highlight
                    ? 'border-[var(--fw-ink)] bg-[var(--fw-ink)] text-white'
                    : 'border-[var(--fw-line)] bg-white'
                }`}
              >
                <div className="fw-mono text-[11px] uppercase tracking-widest opacity-60">{plan.name}</div>
                <div className="fw-display mt-3 text-5xl font-bold">
                  ${plan.price}
                  <span className="text-lg font-semibold opacity-60">/mo</span>
                </div>
                <p className={`mt-3 text-sm ${plan.highlight ? 'text-white/70' : 'text-[var(--fw-muted)]'}`}>{plan.blurb}</p>
                <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2">
                      <span className={plan.highlight ? 'text-[var(--fw-signal)]' : 'text-[var(--fw-sea)]'}>▸</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  onClick={onStart}
                  className={`mt-8 w-full ${plan.highlight ? 'fw-btn-primary' : 'fw-btn-ink'}`}
                >
                  {plan.cta}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[var(--fw-ink)] px-6 py-10 text-sm text-white/50 md:px-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="fw-display text-xl text-white">Fieldwork.</div>
            <p className="mt-2 max-w-md">
              Demo product concept from the CCC forensic engine. Not legal advice. You are responsible for the accuracy of disputes you send.
            </p>
          </div>
          <button type="button" onClick={onStart} className="fw-btn-primary self-start">
            Launch demo <ArrowRight size={16} />
          </button>
        </div>
      </footer>
    </div>
  );
}
