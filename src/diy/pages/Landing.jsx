import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, BadgeCheck, Crosshair, FileSearch, Mail, Shield } from 'lucide-react';
import { PRICING_PLANS, VALUE_PILLARS } from '../demoData';
import { useFieldwork } from '../state';
import { MarketingHeader, SiteFooter } from '../components/SiteChrome';

const fadeUp = {
  hidden: { opacity: 0, y: 22 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.08 * i, duration: 0.65, ease: [0.22, 1, 0.36, 1] },
  }),
};

export default function Landing() {
  const { user } = useFieldwork();

  return (
    <div className="min-h-screen text-white">
      {/* HERO */}
      <section className="relative min-h-[100svh] overflow-hidden fw-atmosphere">
        <div className="absolute inset-0 fw-grid-overlay pointer-events-none" />
        <div className="absolute inset-0 fw-field-scan pointer-events-none" />

        <div className="pointer-events-none absolute inset-x-0 top-0 h-full overflow-hidden opacity-40">
          <div className="fw-scan-line absolute left-[12%] right-[12%] h-24 bg-gradient-to-b from-transparent via-[rgba(46,230,166,0.2)] to-transparent" />
        </div>

        <MarketingHeader />

        <div className="relative z-10 mx-auto flex min-h-[calc(100svh-5rem)] max-w-6xl flex-col justify-end px-6 pb-16 pt-24 md:px-8 md:pb-20">
          <motion.p
            className="fw-mono mb-5 text-[11px] uppercase tracking-[0.28em] text-[var(--fw-signal)]"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={0}
          >
            For people who&apos;ve already tried
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
            You paid someone else to fix this. Or you tried alone and hit a wall. Fieldwork gives you the forensic readout and the certified letters — in your name, on your timeline.
          </motion.p>
          <motion.div
            className="mt-10 flex flex-wrap items-center gap-4"
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={3}
          >
            <Link to={user ? '/app' : '/signup'} className="fw-btn-primary text-base">
              {user ? 'Open workspace' : 'See what an audit looks like'} <ArrowRight size={18} />
            </Link>
            <a href="#demo" className="fw-btn-ghost text-base">
              Watch the demo
            </a>
          </motion.div>
        </div>
      </section>

      {/* PAIN / RECOGNITION — one job */}
      <section id="been-here" className="bg-[var(--fw-paper)] px-6 py-24 text-[var(--fw-ink)] md:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Sound familiar</p>
          <h2 className="fw-display mt-3 max-w-3xl text-4xl font-bold md:text-5xl">
            The monthly charge kept coming. The answers didn&apos;t.
          </h2>
          <p className="mt-5 max-w-2xl text-lg text-[var(--fw-muted)]">
            Most people who land here aren&apos;t new to credit repair. They&apos;re tired of the same loop.
          </p>

          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {[
              {
                title: 'Black-box letters',
                body: 'You paid $80–$150 a month and never really saw what went out — or why that account was chosen. Just “we’re working on it.”',
              },
              {
                title: 'Deletes that crawled back',
                body: 'Something vanished after a mass dispute… then reappeared once the furnisher verified. You paid for a temporary glitch.',
              },
              {
                title: 'DIY that ran out of gas',
                body: 'Templates. Guesswork. A stack of half-written letters. Accurate negatives don’t magically leave — and vague disputes don’t help the ones that should.',
              },
            ].map((item) => (
              <div key={item.title} className="border-t border-[var(--fw-line)] pt-6">
                <h3 className="fw-display text-2xl font-bold">{item.title}</h3>
                <p className="mt-3 leading-relaxed text-[var(--fw-muted)]">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRODUCT DEMO VIDEO */}
      <section id="demo" className="bg-[var(--fw-ink)] px-6 py-24 text-white md:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-signal)]">See it</p>
          <h2 className="fw-display mt-3 max-w-3xl text-4xl font-bold md:text-5xl">
            Watch a sample audit open.
          </h2>
          <p className="mt-5 max-w-2xl text-lg text-white/65">
            No pitch deck. The actual product — signup, sample report, furnisher-first findings.
          </p>

          <div className="relative mt-10 overflow-hidden rounded-lg border border-white/10 bg-black shadow-2xl">
            <video
              className="aspect-video w-full bg-black object-cover"
              controls
              playsInline
              preload="metadata"
              poster="/videos/fieldwork-demo-poster.jpg"
            >
              <source src="/videos/fieldwork-product-demo.mp4" type="video/mp4" />
              Your browser does not support the video tag.
            </video>
          </div>

          <div className="mt-8">
            <Link to={user ? '/app' : '/signup'} className="fw-btn-primary inline-flex">
              {user ? 'Open workspace' : 'Try it yourself'} <ArrowRight size={16} />
            </Link>
          </div>
        </div>
      </section>

      {/* WHAT CHANGES */}
      <section id="how" className="bg-white px-6 py-24 text-[var(--fw-ink)] md:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">What&apos;s different</p>
          <h2 className="fw-display mt-3 max-w-3xl text-4xl font-bold md:text-5xl">
            You see the work. You send the work.
          </h2>
          <p className="mt-5 max-w-2xl text-lg text-[var(--fw-muted)]">
            Fieldwork isn&apos;t another company “handling it.” It&apos;s the toolkit those companies never hand you — audit, selection, certified mail, tracking — with you as the sender of record.
          </p>

          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {VALUE_PILLARS.map((p, i) => (
              <div key={p.title} className="border-t border-[var(--fw-line)] pt-6">
                <div className="fw-mono text-[11px] uppercase tracking-[0.2em] text-[var(--fw-sea)]">
                  0{i + 1}
                </div>
                <h3 className="fw-display mt-3 text-2xl font-bold">{p.title}</h3>
                <p className="mt-3 leading-relaxed text-[var(--fw-muted)]">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* METHOD */}
      <section id="method" className="bg-[var(--fw-ink)] px-6 py-24 text-white md:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-signal)]">Why furnishers first</p>
          <h2 className="fw-display mt-3 max-w-3xl text-4xl font-bold md:text-5xl">
            Spamming the bureaus is how you got nowhere.
          </h2>
          <p className="mt-5 max-w-2xl text-lg text-white/65">
            Bureaus mostly repeat what furnishers report. Mass “not mine” letters hope someone misses a deadline. Fieldwork starts where the data is born — with field-level defects you can actually point to.
          </p>

          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {[
              {
                icon: FileSearch,
                title: 'Metro 2, not vibes',
                body: 'DOFD. Compliance codes. Balances that don’t match. Payment history that doesn’t add up. Cited to the field — and to the FCRA — so the letter isn’t empty.',
              },
              {
                icon: Crosshair,
                title: 'You pick what worth fighting',
                body: 'No mystery campaign. You see every finding, choose the accounts, and skip the ones that aren’t worth a stamp.',
              },
              {
                icon: Mail,
                title: 'Paper trail you own',
                body: 'Certified mail in your name. Tracking you can check. Response windows you can see. No more asking a portal what happened last month.',
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="border-t border-white/15 pt-6">
                <Icon className="text-[var(--fw-signal)]" size={22} strokeWidth={1.75} />
                <h3 className="fw-display mt-4 text-2xl font-bold">{title}</h3>
                <p className="mt-3 leading-relaxed text-white/60">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AUDIT PREVIEW */}
      <section className="bg-[var(--fw-paper)] px-6 py-24 text-[var(--fw-ink)] md:px-8">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">The audit</p>
            <h2 className="fw-display mt-3 text-4xl font-bold md:text-5xl">
              Finally, a report that tells you what to do.
            </h2>
            <p className="mt-5 text-lg text-[var(--fw-muted)]">
              Not a score tease. Not a checklist of “dispute everything.” A readout of what looks wrong on the file — and the language to challenge it.
            </p>
            <ul className="mt-8 space-y-3 text-[var(--fw-ink)]/85">
              {[
                'Dates that look re-aged after a debt sale',
                'Dispute codes that never cleared',
                'Balances that disagree across bureaus',
                'Numbers that can’t both be true',
              ].map((item) => (
                <li key={item} className="flex items-start gap-3">
                  <BadgeCheck className="mt-0.5 shrink-0 text-[var(--fw-signal-dim)]" size={18} />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-lg bg-[var(--fw-glow)] blur-2xl opacity-60" />
            <div className="relative overflow-hidden rounded-lg border border-[var(--fw-line)] bg-[var(--fw-ink)] p-6 text-white shadow-2xl">
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
                  <div className="fw-mono text-[10px] uppercase text-white/40">On your report</div>
                  <div className="mt-1">DOFD dated after the debt was sold</div>
                </div>
                <div className="rounded border border-[rgba(46,230,166,0.25)] bg-[rgba(46,230,166,0.06)] px-3 py-2">
                  <div className="fw-mono text-[10px] uppercase text-[var(--fw-signal)]">What you challenge</div>
                  <div className="mt-1">Trace that date to the original creditor</div>
                </div>
              </div>
              <div className="mt-5 flex items-center gap-2 text-xs text-white/50">
                <Shield size={14} className="text-[var(--fw-signal)]" />
                This is the kind of thing form letters never mention
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="bg-white px-6 py-24 text-[var(--fw-ink)] md:px-8">
        <div className="mx-auto max-w-6xl">
          <p className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-sea)]">Pricing</p>
          <h2 className="fw-display mt-3 text-4xl font-bold md:text-5xl">
            Less than another retainer.
            <br />
            More than another promise.
          </h2>
          <p className="mt-4 max-w-xl text-lg text-[var(--fw-muted)]">
            You&apos;re not funding a call center to send the same letter again. You&apos;re paying for the audit, the drafts, and the stamps — and you keep the file.
          </p>

          <div className="mt-12 grid gap-5 lg:grid-cols-3">
            {PRICING_PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`flex flex-col border p-6 ${
                  plan.highlight
                    ? 'border-[var(--fw-ink)] bg-[var(--fw-ink)] text-white'
                    : 'border-[var(--fw-line)] bg-[var(--fw-paper)]'
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
                <Link
                  to="/signup"
                  className={`mt-8 w-full text-center ${plan.highlight ? 'fw-btn-primary' : 'fw-btn-ink'}`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          <p className="mt-8 max-w-2xl text-sm text-[var(--fw-muted)]">
            Mail credits map to real Lob certified packets (~$12–15 each): Phase 1 is letter + ID docs; Phase 2 adds the response, return receipt, and prior letter. No score guarantees. Accurate negatives can stay.
          </p>
        </div>
      </section>

      <SiteFooter dark />
    </div>
  );
}
