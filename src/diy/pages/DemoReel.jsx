import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { FieldworkMark } from '../components/Logo';
import { DEMO_AUDIT } from '../demoData';
import { MAIL_PHASES } from '../mailEconomics';

/**
 * Apple Keynote–style full-bleed scenes for the marketing reel.
 * Capture via: node scripts/render-fieldwork-reel.mjs
 * Preview: /diy.html#/reel/0 … /reel/N
 */

const rise = {
  hidden: { opacity: 0, y: 28 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.9, delay: 0.15 + i * 0.12, ease: [0.22, 1, 0.36, 1] },
  }),
};

function SceneShell({ children, className = '', atmosphere = false }) {
  return (
    <div className={`relative flex h-full w-full overflow-hidden ${className}`}>
      {atmosphere ? (
        <>
          <div className="absolute inset-0 fw-atmosphere" />
          <div className="absolute inset-0 fw-grid-overlay opacity-45" />
        </>
      ) : null}
      <div className="relative z-10 flex h-full w-full flex-col">{children}</div>
    </div>
  );
}

const SCENES = [
  {
    id: 'logo',
    render: () => (
      <SceneShell atmosphere className="items-center justify-center text-white">
        <div className="flex flex-col items-center justify-center">
          <motion.div initial="hidden" animate="show" custom={0} variants={rise}>
            <FieldworkMark size={96} />
          </motion.div>
          <motion.div
            className="fw-display mt-10 text-7xl font-extrabold tracking-tight md:text-8xl"
            initial="hidden"
            animate="show"
            custom={1}
            variants={rise}
          >
            Fieldwork<span className="text-[var(--fw-signal)]">.</span>
          </motion.div>
        </div>
      </SceneShell>
    ),
  },
  {
    id: 'source',
    render: () => (
      <SceneShell atmosphere className="justify-end px-16 pb-28 text-white md:px-28">
        <motion.p
          className="fw-mono text-sm uppercase tracking-[0.38em] text-[var(--fw-signal)]"
          initial="hidden"
          animate="show"
          custom={0}
          variants={rise}
        >
          For people who&apos;ve already tried
        </motion.p>
        <motion.h1
          className="fw-display mt-7 max-w-5xl text-[clamp(3.8rem,9vw,7.5rem)] font-extrabold leading-[0.92]"
          initial="hidden"
          animate="show"
          custom={1}
          variants={rise}
        >
          Dispute at the
          <br />
          <span className="text-[var(--fw-signal)]">source.</span>
        </motion.h1>
      </SceneShell>
    ),
  },
  {
    id: 'pain',
    render: () => (
      <SceneShell className="justify-center bg-[var(--fw-paper)] px-16 text-[var(--fw-ink)] md:px-28">
        <motion.p
          className="fw-mono text-sm uppercase tracking-[0.3em] text-[var(--fw-sea)]"
          initial="hidden"
          animate="show"
          custom={0}
          variants={rise}
        >
          Sound familiar
        </motion.p>
        <motion.h2
          className="fw-display mt-7 max-w-4xl text-[clamp(2.8rem,6vw,5rem)] font-bold leading-[1.02]"
          initial="hidden"
          animate="show"
          custom={1}
          variants={rise}
        >
          The monthly charge kept coming.
          <br />
          The answers didn&apos;t.
        </motion.h2>
        <motion.p
          className="mt-10 max-w-2xl text-2xl leading-snug text-[var(--fw-muted)]"
          initial="hidden"
          animate="show"
          custom={2}
          variants={rise}
        >
          Black-box letters. Deletes that crawled back. DIY that ran out of gas.
        </motion.p>
      </SceneShell>
    ),
  },
  {
    id: 'audit-intro',
    render: () => (
      <SceneShell className="justify-center bg-[var(--fw-ink)] px-16 text-white md:px-28">
        <motion.p
          className="fw-mono text-sm uppercase tracking-[0.3em] text-[var(--fw-signal)]"
          initial="hidden"
          animate="show"
          custom={0}
          variants={rise}
        >
          The audit
        </motion.p>
        <motion.h2
          className="fw-display mt-7 max-w-4xl text-[clamp(2.8rem,6vw,5rem)] font-bold leading-[1.02]"
          initial="hidden"
          animate="show"
          custom={1}
          variants={rise}
        >
          A report that finally
          <br />
          tells you what to do.
        </motion.h2>
      </SceneShell>
    ),
  },
  {
    id: 'audit-ui',
    render: () => {
      const { summary, scoreSnapshot } = DEMO_AUDIT;
      return (
        <SceneShell className="items-center justify-center bg-[#061018] px-12 py-14">
          <motion.div
            className="w-full max-w-5xl border border-white/10 bg-[var(--fw-ink)]"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="border-b border-white/10 px-10 py-6">
              <div className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-signal)]">
                Forensic readout
              </div>
              <div className="fw-display mt-2 text-3xl font-bold text-white">
                Your file, field by field
              </div>
            </div>
            <div className="grid md:grid-cols-[1.35fr_1fr]">
              <div className="p-10 text-white">
                <div className="fw-mono text-[11px] uppercase tracking-wider text-white/40">Actionable</div>
                <div className="fw-display mt-3 text-7xl font-bold tracking-tight">
                  {summary.actionableAccounts}
                  <span className="text-3xl text-white/30"> / {summary.accountsReviewed}</span>
                </div>
                <p className="mt-3 text-lg text-white/55">furnisher-first dispute targets</p>
                <div className="mt-10 flex gap-12">
                  <div>
                    <div className="fw-mono text-[10px] uppercase text-white/40">Violations</div>
                    <div className="mt-1 text-3xl font-semibold">{summary.totalViolations}</div>
                  </div>
                  <div>
                    <div className="fw-mono text-[10px] uppercase text-white/40">Cross-bureau</div>
                    <div className="mt-1 text-3xl font-semibold">{summary.crossBureauConflicts}</div>
                  </div>
                </div>
              </div>
              <div className="border-t border-white/10 p-10 md:border-l md:border-t-0">
                <div className="fw-mono text-[11px] uppercase tracking-wider text-white/40">Score snapshot</div>
                <div className="mt-6 space-y-5 text-white">
                  {Object.entries(scoreSnapshot).map(([b, s]) => (
                    <div key={b} className="flex justify-between text-xl">
                      <span className="capitalize text-white/50">{b}</span>
                      <span className="fw-mono font-semibold">{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </SceneShell>
      );
    },
  },
  {
    id: 'finding',
    render: () => {
      const account = DEMO_AUDIT.accounts[0];
      const v = account.violations[0];
      return (
        <SceneShell className="items-center justify-center bg-[#061018] px-12 py-14">
          <motion.div
            className="w-full max-w-3xl border border-white/10 bg-[var(--fw-deep)] p-10 text-white"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.85, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-start justify-between gap-6 border-b border-white/10 pb-6">
              <div>
                <div className="fw-mono text-[11px] uppercase tracking-[0.22em] text-[var(--fw-signal)]">
                  Critical · Field {v.field}
                </div>
                <div className="fw-display mt-3 text-4xl font-bold leading-tight">{v.title}</div>
                <p className="mt-4 text-lg text-white/50">
                  {account.furnisher} · {account.accountMask}
                </p>
              </div>
              <div className="fw-mono shrink-0 text-sm text-white/40">{v.statute}</div>
            </div>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <div className="bg-black/30 px-5 py-4">
                <div className="fw-mono text-[10px] uppercase text-white/40">On your report</div>
                <div className="mt-2 text-xl">{v.reported}</div>
              </div>
              <div className="bg-[rgba(46,230,166,0.1)] px-5 py-4 ring-1 ring-[rgba(46,230,166,0.35)]">
                <div className="fw-mono text-[10px] uppercase text-[var(--fw-signal)]">What you challenge</div>
                <div className="mt-2 text-xl">{v.expected}</div>
              </div>
            </div>
          </motion.div>
        </SceneShell>
      );
    },
  },
  {
    id: 'phases',
    render: () => (
      <SceneShell className="justify-center bg-[var(--fw-paper)] px-14 text-[var(--fw-ink)] md:px-24">
        <motion.p
          className="fw-mono text-sm uppercase tracking-[0.3em] text-[var(--fw-sea)]"
          initial="hidden"
          animate="show"
          custom={0}
          variants={rise}
        >
          Certified mail
        </motion.p>
        <motion.h2
          className="fw-display mt-5 max-w-3xl text-[clamp(2.6rem,5vw,4.2rem)] font-bold leading-[1.02]"
          initial="hidden"
          animate="show"
          custom={1}
          variants={rise}
        >
          Real Lob packets.
          <br />
          One credit each.
        </motion.h2>
        <div className="mt-14 grid max-w-5xl gap-10 md:grid-cols-2">
          {Object.values(MAIL_PHASES).map((p, i) => (
            <motion.div
              key={p.id}
              initial="hidden"
              animate="show"
              custom={2 + i}
              variants={rise}
            >
              <div className="fw-mono text-[11px] uppercase tracking-wider text-[var(--fw-sea)]">{p.label}</div>
              <div className="fw-display mt-2 text-2xl font-bold">{p.title}</div>
              <ul className="mt-5 space-y-2.5 text-base text-[var(--fw-muted)]">
                {p.enclosures.map((e) => (
                  <li key={e.id} className="flex gap-2">
                    <span className="text-[var(--fw-signal-dim)]">▸</span>
                    <span>{e.name}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6 text-sm font-semibold">1 credit · {p.costHint}</div>
            </motion.div>
          ))}
        </div>
      </SceneShell>
    ),
  },
  {
    id: 'control',
    render: () => (
      <SceneShell atmosphere className="justify-center px-16 text-white md:px-28">
        <motion.p
          className="fw-mono text-sm uppercase tracking-[0.3em] text-[var(--fw-signal)]"
          initial="hidden"
          animate="show"
          custom={0}
          variants={rise}
        >
          You stay in control
        </motion.p>
        <motion.h2
          className="fw-display mt-7 max-w-4xl text-[clamp(3rem,6.5vw,5.5rem)] font-bold leading-[1.0]"
          initial="hidden"
          animate="show"
          custom={1}
          variants={rise}
        >
          You see the work.
          <br />
          You send the work.
        </motion.h2>
        <motion.p
          className="mt-10 max-w-xl text-2xl text-white/60"
          initial="hidden"
          animate="show"
          custom={2}
          variants={rise}
        >
          Your name on every letter. No agency “c/o.” No black box.
        </motion.p>
      </SceneShell>
    ),
  },
  {
    id: 'end',
    render: () => (
      <SceneShell atmosphere className="items-center justify-center text-white">
        <div className="flex flex-col items-center text-center">
          <motion.div initial="hidden" animate="show" custom={0} variants={rise}>
            <FieldworkMark size={80} />
          </motion.div>
          <motion.div
            className="fw-display mt-9 text-6xl font-extrabold md:text-7xl"
            initial="hidden"
            animate="show"
            custom={1}
            variants={rise}
          >
            Fieldwork<span className="text-[var(--fw-signal)]">.</span>
          </motion.div>
          <motion.p
            className="mt-7 text-2xl text-white/65"
            initial="hidden"
            animate="show"
            custom={2}
            variants={rise}
          >
            Dispute at the source.
          </motion.p>
          <motion.div
            className="mt-12 bg-[var(--fw-signal)] px-10 py-4 text-lg font-bold text-[var(--fw-ink)]"
            initial="hidden"
            animate="show"
            custom={3}
            variants={rise}
          >
            Try the demo
          </motion.div>
        </div>
      </SceneShell>
    ),
  },
];

export const REEL_SCENE_COUNT = SCENES.length;

export default function DemoReel() {
  const { sceneId } = useParams();
  const index = Math.min(Math.max(parseInt(sceneId || '0', 10) || 0, 0), SCENES.length - 1);
  const scene = SCENES[index];

  return (
    <div className="h-screen w-screen overflow-hidden bg-black" data-reel-scene={scene.id}>
      {scene.render()}
    </div>
  );
}
