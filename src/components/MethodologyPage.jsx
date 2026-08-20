import React, { useState } from 'react';
import { AlertTriangle, ArrowRight, BookOpen, CheckCircle2, FileText, RefreshCw, Route, ShieldCheck } from 'lucide-react';
import { FLOW_LABELS, FLOW_SEQUENCES, REPO_SEQUENCE } from '../utils/disputeFlow.js';

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  cardShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
};

const SECTIONS = [
  { id: 'quick-start', label: 'Start Here', icon: Route },
  { id: 'r1-routing', label: 'Choose R1', icon: CheckCircle2 },
  { id: 'ladders', label: 'Round Ladders', icon: BookOpen },
  { id: 'letters', label: 'Write the Letter', icon: FileText },
  { id: 'results', label: 'Results & Next Round', icon: RefreshCw },
  { id: 'hard-stops', label: 'Hard Stops', icon: ShieldCheck },
];

const CORE_FLOWS = ['accuracy', 'collection', 'combo', 'consent', 'late_pay'];

const ROUTING_ROWS = [
  ['Late payments - 2 or fewer', 'Late Pay R1', '15 USC 1681a(d)(a)(2)(a)(i)'],
  ['Late payments - 3 or more', 'Accuracy R1', 'Factual Dispute'],
  ['Charge-off on multiple bureaus', 'Accuracy R1', 'Factual Dispute'],
  ['Charge-off on only one bureau', 'Consent R1', '15 USC 1681b(a)(2)'],
  ['Bankruptcy', 'Accuracy R1', 'Factual Dispute'],
  ['Collection', 'Collection R1', '15 USC 1692g'],
  ['Repossession', 'Collection R1 - repo path', '15 USC 1692g'],
  ['Accuracy and collection accounts together', 'Combo R1', 'Factual Dispute + 15 USC 1692g'],
];

function Table({ headers, rows }) {
  return (
    <div className="overflow-x-auto rounded-xl border" style={{ borderColor: T.border }}>
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-gray-50">
            {headers.map((header) => <th key={header} className="px-4 py-2.5 text-left text-[9px] font-bold uppercase tracking-wider" style={{ color: T.faint }}>{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={`${row[0]}-${rowIndex}`} className="border-t" style={{ borderColor: T.border }}>
              {row.map((cell, cellIndex) => <td key={cellIndex} className="px-4 py-3 align-top text-[12px] leading-relaxed" style={{ color: cellIndex === 1 ? T.navy : T.ink, fontWeight: cellIndex === 1 ? 650 : 400 }}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Callout({ tone = 'gold', children }) {
  const colors = tone === 'red'
    ? { border: '#FCA5A5', background: '#FEF2F2', text: '#991B1B' }
    : tone === 'green'
      ? { border: '#86EFAC', background: '#F0FDF4', text: '#166534' }
      : { border: '#E8D99E', background: '#FFFBEB', text: '#854D0E' };
  return <div className="rounded-xl border px-4 py-3 text-[12px] leading-relaxed" style={{ borderColor: colors.border, backgroundColor: colors.background, color: colors.text }}>{children}</div>;
}

function PageIntro({ title, children }) {
  return (
    <div className="mb-5">
      <h2 className="ccc-display text-[24px] font-medium" style={{ color: T.ink }}>{title}</h2>
      <p className="mt-1 max-w-3xl text-[13px] leading-relaxed" style={{ color: T.muted }}>{children}</p>
    </div>
  );
}

export default function MethodologyPage() {
  const [active, setActive] = useState('quick-start');

  return (
    <div className="mx-auto max-w-6xl" style={{ padding: '20px 32px 32px' }}>
      <div className="mb-5 flex items-center gap-3">
        <span className="inline-block h-8 w-1 rounded" style={{ background: T.gold }} />
        <div>
          <h1 className="ccc-display text-[22px] font-medium leading-tight" style={{ color: T.ink }}>CCC Dispute Method</h1>
          <p className="text-[11px]" style={{ color: T.muted }}>The team playbook for Consent, Accuracy, Collection, Combo, and Late Pay campaigns</p>
        </div>
      </div>

      <div className="flex gap-5">
        <nav className="w-56 shrink-0">
          <div className="sticky top-0 overflow-hidden rounded-xl border bg-white py-1.5" style={{ borderColor: T.border, boxShadow: T.cardShadow }}>
            {SECTIONS.map(({ id, label, icon: Icon }) => {
              const selected = active === id;
              return (
                <button key={id} onClick={() => setActive(id)} className="flex w-full items-center gap-2.5 border-l-2 px-4 py-3 text-left text-[12px] transition-colors" style={{ borderLeftColor: selected ? T.gold : 'transparent', background: selected ? '#F7F4EA' : 'transparent', color: selected ? T.navy : T.muted, fontWeight: selected ? 650 : 400 }}>
                  <Icon size={14} strokeWidth={1.8} /> {label}
                </button>
              );
            })}
          </div>
        </nav>

        <main className="min-w-0 flex-1 rounded-xl border bg-white p-7" style={{ borderColor: T.border, boxShadow: T.cardShadow }}>
          {active === 'quick-start' && <QuickStart />}
          {active === 'r1-routing' && <R1Routing />}
          {active === 'ladders' && <RoundLadders />}
          {active === 'letters' && <LetterStandards />}
          {active === 'results' && <ResultsAndVersions />}
          {active === 'hard-stops' && <HardStops />}
        </main>
      </div>
    </div>
  );
}

function QuickStart() {
  const steps = [
    ['1', 'Read the 3B report', 'List every negative account. Confirm the report name, account category, late-payment count, bureau coverage, and factual differences.'],
    ['2', 'Let CCC classify R1', 'The audit applies the fixed routing rules. A red review flag means the team must correct missing report facts before mailing.'],
    ['3', 'Build one letter per bureau', 'Use the recommended stored template. The fixed law and round language stays unchanged; the team writes the client story and exact facts.'],
    ['4', 'Mail and record the version', 'Record the exact template version and mailed date. R1 includes the required identity documents; screenshot letters must include the report images requested by the template.'],
    ['5', 'Read the updated report', 'Deleted is a win. Everything else gets its exact result recorded and advances according to its ladder.'],
    ['6', 'Repeat with a fresh version', 'Move surviving accounts to the next round. Review master wording every 90 days without changing the law assigned to the round.'],
  ];
  return (
    <div>
      <PageIntro title="The system in plain English">Read the report correctly, start each account on the right R1, send the stored law sequence, record the result, and climb one round at a time.</PageIntro>
      <div className="space-y-2.5">
        {steps.map(([number, title, detail]) => (
          <div key={number} className="flex gap-3 rounded-xl border p-4" style={{ borderColor: T.border }}>
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: T.navy, color: T.gold }}>{number}</div>
            <div><div className="text-[13px] font-semibold" style={{ color: T.ink }}>{title}</div><div className="mt-1 text-[11px] leading-relaxed" style={{ color: T.muted }}>{detail}</div></div>
          </div>
        ))}
      </div>
      <div className="mt-4"><Callout tone="green"><strong>The audit is the starting authority.</strong> Do not choose an R1 from memory. Open the client’s internal R1 panel, resolve any review flags, and use the flow shown for that bureau and account group.</Callout></div>
    </div>
  );
}

function R1Routing() {
  return (
    <div>
      <PageIntro title="Choose the correct R1">CCC classifies from account category, late-payment count, bureau coverage, and the file-level overrides below.</PageIntro>
      <Table headers={['What the report shows', 'Start here', 'R1 law']} rows={ROUTING_ROWS} />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Callout><strong>Student-loan override:</strong> when student loans are the only or majority negative account type, every negative account starts on Consent R1.</Callout>
        <Callout><strong>Mixed-late override:</strong> when one account contains separate late stretches on both sides of the threshold, use Late Pay for the file’s late-payment accounts.</Callout>
      </div>
      <div className="mt-3"><Callout tone="red"><strong>Stop when facts are missing.</strong> If the audit cannot identify the account category or late-payment count, do not guess and do not mail. Correct the classification first.</Callout></div>
    </div>
  );
}

function RoundLadders() {
  const [flow, setFlow] = useState('accuracy');
  const sequence = FLOW_SEQUENCES[flow] || [];
  return (
    <div>
      <PageIntro title="Follow the ladder in order">The law assigned to a round does not change. If an account survives, move it to the next rung and use a fresh version of that round’s template.</PageIntro>
      <div className="mb-4 flex flex-wrap gap-2">
        {CORE_FLOWS.map((code) => <button key={code} onClick={() => setFlow(code)} className="rounded-full border px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider" style={{ borderColor: flow === code ? T.navy : T.border, background: flow === code ? T.navy : '#fff', color: flow === code ? T.gold : T.muted }}>{FLOW_LABELS[code]}</button>)}
      </div>
      <div className="overflow-hidden rounded-xl border" style={{ borderColor: T.border }}>
        <div className="flex items-center justify-between px-4 py-3" style={{ background: T.navy, color: '#fff' }}><span className="text-[14px] font-semibold">{FLOW_LABELS[flow]}</span><span className="text-[10px] uppercase tracking-wider text-white/70">{sequence.length} steps</span></div>
        {sequence.map((law, index) => (
          <div key={`${flow}-${index}`} className="flex items-start gap-3 border-t px-4 py-3" style={{ borderColor: T.border }}>
            <span className="w-9 shrink-0 text-[10px] font-bold" style={{ color: T.gold }}>R{index + 1}</span>
            <span className="text-[12px]" style={{ color: T.ink }}>{law}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 space-y-3">
        <Callout><strong>Consent switch:</strong> after Consent R3, charge-offs and late pays move to Accuracy; collections move to Collection.</Callout>
        <Callout><strong>Late Pay switch:</strong> after Late Pay R2, surviving late-payment accounts move to Accuracy and the demand changes from the late transactions to the account.</Callout>
        <Callout><strong>Repo path:</strong> {REPO_SEQUENCE.join(' → ')}.</Callout>
        <Callout><strong>Direct collector letters:</strong> the direct-to-collector sequence starts only after the Collection bureau R1 has been sent. Those templates remain separately addressed and are not a substitute for the bureau letter.</Callout>
      </div>
    </div>
  );
}

function LetterStandards() {
  const moves = [
    ['Damages', 'One short paragraph about the client’s real, documented life impact. Different for every bureau.'],
    ['Facts', 'The stored round law and the exact account/report facts that make the issue apply. Do not rewrite the fixed statute sequence.'],
    ['Penalty', 'The consequence and deadline required by that template. Keep it tied to the round.'],
    ['Deletion list', 'Use the creditor name exactly as reported, the masked account number, and the exact deletion instruction.'],
    ['Consumer statement', 'A short what, why, and requested outcome. Every CRA letter ends with it.'],
  ];
  return (
    <div>
      <PageIntro title="Every letter uses five moves">The template supplies the fixed round argument. Curlys insert client and report data. The team personalizes only the approved human-written sections.</PageIntro>
      <div className="grid grid-cols-1 gap-2.5">
        {moves.map(([title, detail], index) => <div key={title} className="flex gap-3 rounded-xl border p-4" style={{ borderColor: T.border }}><span className="text-[11px] font-bold" style={{ color: T.gold }}>{index + 1}</span><div><div className="text-[13px] font-semibold" style={{ color: T.ink }}>{title}</div><div className="mt-1 text-[11px] leading-relaxed" style={{ color: T.muted }}>{detail}</div></div></div>)}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Callout><strong>Three bureaus means three different letters.</strong> Change the opening, damages, and bureau-specific factual detail. Do not send three copy-paste bodies.</Callout>
        <Callout><strong>Attachments:</strong> R1 needs government ID and proof of address. Upload report screenshots whenever the selected template contains the <code>{'{screenshots}'}</code> curly.</Callout>
      </div>
    </div>
  );
}

function ResultsAndVersions() {
  return (
    <div>
      <PageIntro title="Record the result, then decide the next rung">The tracker is the campaign memory. It must be complete enough to prove what was sent and to write the final-round history.</PageIntro>
      <Table headers={['Result', 'Meaning', 'Team action']} rows={[
        ['Deleted - win', 'The targeted account or late payment is gone from the updated report.', 'Save the proof and close that target.'],
        ['Verified', 'The bureau says the item remains verified.', 'Save the response/update and advance the surviving account.'],
        ['Updated, not deleted', 'Something changed, but the target remains.', 'Record exactly what changed before choosing the next round.'],
        ['No response', 'No usable response is documented by the review date.', 'Record the evidence; do not invent a response.'],
        ['Duplicate / recycled', 'The wording or version has already been used for this attempt.', 'Choose a fresh template version before mailing again.'],
      ]} />
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Callout tone="green"><strong>Save exact history:</strong> flow, round, law, template ID, version, bureau, covered accounts, mailed date, result date, outcome, and proof.</Callout>
        <Callout><strong>Quarterly template review:</strong> create a new version every 90 days. Prior letters keep their original snapshot; never overwrite a version that has history.</Callout>
      </div>
      <div className="mt-3"><Callout><strong>Final rounds use the history.</strong> Accuracy R12 and Collection R10 summarize the documented sequence. Write only what CCC can prove from saved letters, dates, report updates, and responses.</Callout></div>
    </div>
  );
}

function HardStops() {
  const stops = [
    'Never bypass the stored-template campaign builder with a free-generated letter.',
    'Never choose an R1 from an A/B/C label or a raw issue count.',
    'Never target a healthy account just because bureaus show harmless differences.',
    'Never guess an account category, late-payment count, bureau presence, date, balance, or client fact.',
    'Never change the law assigned to a round. New versions change the wording, not the sequence.',
    'Never rewrite fixed template law while personalizing damages or facts.',
    'Never send identical bureau letters or reuse a dead version when a fresh version is available.',
    'Never backdate a letter.',
    'Do not automatically file CFPB complaints as part of the CCC monthly loop.',
    'Never mark a deletion without an updated report or response that proves it.',
  ];
  return (
    <div>
      <PageIntro title="Hard stops">These rules protect clients, preserve the course sequence, and keep the tracker trustworthy.</PageIntro>
      <div className="space-y-2">
        {stops.map((stop) => <div key={stop} className="flex items-start gap-2.5 rounded-lg border border-red-100 bg-red-50 px-3.5 py-3 text-[12px] leading-relaxed text-red-900"><AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-600" />{stop}</div>)}
      </div>
      <div className="mt-4 flex items-center gap-2 text-[11px]" style={{ color: T.muted }}><ArrowRight size={13} /> When a hard stop is hit, pause the letter and resolve the data or template problem before proceeding.</div>
    </div>
  );
}
