import React, { useState } from 'react';
import { Lock, Eye, EyeOff } from 'lucide-react';

const SECTIONS = [
  { id: 'doctrine', label: 'The Setup & Spike Doctrine' },
  { id: 'phases', label: 'The Three-Phase Pipeline' },
  { id: 'classification', label: 'Account Classification (A / B / C)' },
  { id: 'violations', label: 'Violation Catalog' },
  { id: 'metro2', label: 'Metro 2 Field & Status Reference' },
  { id: 'legal', label: 'Legal Framework' },
  { id: 'letters', label: 'Letter Standards' },
  { id: 'hardstops', label: 'Hard Stops — What We Never Do' },
  { id: 'patterns', label: 'Pattern Library & Furnisher Intel', internal: true },
  { id: 'glossary', label: 'Glossary' },
];

const T = {
  navy: '#1B2A4A',
  gold: '#C9A84C',
  border: '#E7EAF0',
  ink: '#111827',
  muted: '#6B7280',
  faint: '#9CA3AF',
  grid: '#EEF0F4',
  cardShadow: '0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.06)',
};

function Th({ children }) {
  return <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider font-medium" style={{ color: T.faint }}>{children}</th>;
}
function Td({ children }) {
  return <td className="px-3 py-2 align-top text-[12px] text-ink" style={{ borderTop: '1px solid ' + T.grid }}>{children}</td>;
}
function Table({ headers, rows }) {
  return (
    <div className="overflow-x-auto mb-4" style={{ border: '1px solid #EBEEF3', borderRadius: 10 }}>
      <table className="w-full border-collapse">
        <thead><tr style={{ background: '#FAFBFC' }}>{headers.map((h, i) => <Th key={i}>{h}</Th>)}</tr></thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri} className="bg-white">
              {r.map((c, ci) => <Td key={ci}>{c}</Td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function H({ children }) {
  return <h2 className="ccc-display text-2xl text-ink font-medium mb-2">{children}</h2>;
}
function Lead({ children }) {
  return <p className="text-[13px] text-ink-muted leading-relaxed mb-5 max-w-3xl">{children}</p>;
}
function Sub({ children }) {
  return <div className="text-[10px] uppercase tracking-wider text-ink-faint font-medium mb-2 mt-6">{children}</div>;
}
function Note({ children }) {
  return (
    <div className="text-[11px] text-ink-muted border-l-2 border-gold pl-3 py-1 my-4 max-w-3xl leading-relaxed">{children}</div>
  );
}
function PRA({ yes }) {
  return (
    <span
      className="inline-block text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-sm font-medium"
      style={{ backgroundColor: yes ? '#1B2A4A' : '#EDEDED', color: yes ? '#C9A84C' : '#6B7280' }}
    >
      {yes ? 'Private Right' : 'No Private Right'}
    </span>
  );
}

export default function MethodologyPage() {
  const [active, setActive] = useState('doctrine');
  const [internal, setInternal] = useState(false);

  const visibleSections = SECTIONS.filter((s) => !s.internal || internal);
  const current = visibleSections.find((s) => s.id === active) || visibleSections[0];

  return (
    <div className="max-w-6xl mx-auto" style={{ padding: '20px 32px 32px' }}>
      {/* Branded page header */}
      <div className="flex items-center justify-between gap-4 mb-5 flex-wrap">
        <div className="flex items-center gap-3">
          <span style={{ width: 4, height: 30, borderRadius: 2, background: T.gold, display: 'inline-block' }} />
          <div>
            <h1 className="ccc-display text-[22px] font-medium leading-tight" style={{ color: T.ink }}>Methodology</h1>
            <p className="text-[11px]" style={{ color: T.muted }}>
              The Setup &amp; Spike operating doctrine — framework, law, and forensic standards
            </p>
          </div>
        </div>
        <button
          onClick={() => setInternal((v) => !v)}
          className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-lg border bg-white transition-colors hover:border-navy"
          style={{ borderColor: internal ? T.navy : T.border, color: internal ? T.navy : T.muted, fontWeight: internal ? 600 : 400 }}
        >
          {internal ? <Eye size={13} strokeWidth={1.75} /> : <EyeOff size={13} strokeWidth={1.75} />}
          {internal ? 'Internal view' : 'Client-safe view'}
        </button>
      </div>

      <div className="flex gap-5">
        <nav className="w-64 shrink-0">
          <div className="bg-white overflow-hidden sticky top-0 py-1.5"
            style={{ borderRadius: 14, border: '1px solid ' + T.border, boxShadow: T.cardShadow }}>
            {visibleSections.map((s) => {
              const on = current.id === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  className="w-full text-left px-4 py-2.5 text-[12px] flex items-center gap-2 transition-colors"
                  style={{
                    color: on ? T.navy : '#5B6472',
                    backgroundColor: on ? '#F4F1E8' : 'transparent',
                    borderLeft: on ? '2px solid ' + T.gold : '2px solid transparent',
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  {s.internal && <Lock size={11} strokeWidth={2} />}
                  {s.label}
                </button>
              );
            })}
          </div>
          {!internal && (
            <div className="text-[10px] mt-3 px-1 leading-relaxed" style={{ color: T.faint }}>
              Pattern intelligence is hidden in client-safe view. Switch to Internal view when working privately.
            </div>
          )}
        </nav>

        <div className="flex-1 min-w-0 bg-white p-7"
          style={{ borderRadius: 14, border: '1px solid ' + T.border, boxShadow: T.cardShadow }}>
          {renderSection(current.id)}
        </div>
      </div>
    </div>
  );
}

function renderSection(id) {
  switch (id) {
    case 'doctrine': return <Doctrine />;
    case 'phases': return <Phases />;
    case 'classification': return <Classification />;
    case 'violations': return <Violations />;
    case 'metro2': return <Metro2 />;
    case 'legal': return <Legal />;
    case 'letters': return <Letters />;
    case 'hardstops': return <HardStops />;
    case 'patterns': return <Patterns />;
    case 'glossary': return <Glossary />;
    default: return null;
  }
}

function Doctrine() {
  return (
    <div>
      <H>The Setup & Spike Doctrine</H>
      <Lead>
        Credit Comeback Club disputes furnishers directly — not the bureaus. The entire strategy rests
        on a legal asymmetry most operators never exploit: a furnisher&apos;s duty under 15 U.S.C. §1681s-2(a)
        carries no private right of action, while the duty triggered under §1681s-2(b) does — with statutory
        and punitive damages available under §1681n.
      </Lead>
      <p className="text-[13px] text-ink leading-relaxed mb-4 max-w-3xl">
        Phase 1 is not designed to win on its own. It is designed to manufacture the evidentiary record — a
        documented, certified-mail direct dispute citing specific Metro 2 field violations and FCRA provisions —
        that makes a later §1681s-2(b) claim lethal. When a furnisher ignores that dispute or answers with a form
        letter, they have not closed the matter. They have created the inadequate-investigation record that the
        Spike is built on.
      </p>
      <Note>
        Core principle: a database match is not an investigation. Every furnisher response that fails to address the
        specific Metro 2 violation alleged is leverage, not a defense.
      </Note>
    </div>
  );
}

function Phases() {
  return (
    <div>
      <H>The Three-Phase Pipeline</H>
      <Lead>
        Every campaign moves through three phases in a fixed order. Phase 1 and Phase 3 are never sent
        simultaneously — the Phase 1 response, or the absence of one, is the leverage point the entire pipeline
        is built to create.
      </Lead>
      <Table
        headers={['Phase', 'Action', 'Statute', 'Purpose']}
        rows={[
          ['Phase 1 — Setup', 'Direct furnisher dispute, sent certified mail', '§1681s-2(a)', 'Build the evidentiary record. No private right of action here — this phase exists to document.'],
          ['Phase 2 — Analysis', 'Read the furnisher response against the original violations', 'Johnson v. MBNA standard', 'Classify the response: form letter, wrong framework, partial fix, or non-response. Each failure mode becomes Phase 3 fuel.'],
          ['Phase 3 — Spike', 'CRA-triggered dispute referencing the failed Phase 1 response', '§1681s-2(b)', 'Where the damages live. Statutory and punitive exposure under §1681n once the furnisher is on notice and the investigation was inadequate.'],
        ]}
      />
      <Note>
        Non-response is itself a violation. A furnisher that lets the 30-day window close has handed you an automatic
        §1681s-2(b) record. A form letter is evidence of inadequate reinvestigation under Johnson v. MBNA.
      </Note>
    </div>
  );
}

function Classification() {
  return (
    <div>
      <H>Account Classification</H>
      <Lead>
        Every targeted account is triaged into one of three types before any letter is built. The type determines
        the legal architecture of the dispute.
      </Lead>
      <Table
        headers={['Type', 'Definition', 'Phase 1 Strategy']}
        rows={[
          ['Type A', 'Original creditor, any derogatory status', '§1681s-2(a) direct dispute focused on the derogatory reporting'],
          ['Type B', 'Original creditor, paid or current', '§1681s-2(a) focused on status and date conflicts rather than the debt itself'],
          ['Type C', 'Third-party debt collector / debt buyer', 'Simultaneous §1692g(b) debt validation and §1681s-2(a) furnisher dispute — a dual-track that creates independent violation tracks'],
        ]}
      />
      <Note>
        Type C is where chain-of-title and K1 Segment failures live. A debt buyer that cannot produce validation
        and cannot document the original creditor is exposed on two independent fronts at once.
      </Note>
    </div>
  );
}

function Violations() {
  return (
    <div>
      <H>Violation Catalog</H>
      <Lead>
        The structural Metro 2 and FCRA violations CCC hunts on every report. Each is a documented, field-level
        defect — not an opinion about whether a debt is owed.
      </Lead>
      <Table
        headers={['Violation', 'What It Is', 'Hook']}
        rows={[
          ['Status 97 + Field 15 paradox', 'Charge-off status reporting an active monthly payment obligation', 'Metro 2; §1681s-2(a)(1)(A)'],
          ['Status 71 + balance', 'Account marked Settled while still reporting a balance over zero', '§1681s-2(a)(1)(A)'],
          ['Status 13 + past due', 'Account marked Paid while still reporting an amount past due', 'Metro 2 integrity failure'],
          ['Missing / re-aged DOFD', 'No Date of First Delinquency, or a DOFD set to the charge-off date to extend the 7-year clock', '§623(a)(5)'],
          ['Field 18 suppression', 'Zero or missing payment history on an active derogatory account', '§607(b); Metro 2 Field 18'],
          ['Field 17A / 18 paradox', 'Account status contradicts the payment history within the same report', '§607(b)'],
          ['Field 20 missing XB', 'No consumer-dispute notation after a dispute, or notation added without correcting the underlying error', '§1681s-2(a)(3); §1681n'],
          ['Cross-bureau conflict', 'Same account reports different balance, status, dates, account number, or entity name across bureaus', '§607(b)'],
          ['Post-sale continued furnishing', 'Furnisher sells the account to a debt buyer but keeps reporting under its own name', '§1681s-2(a)(1)(A)'],
          ['K1 Segment omission', 'Original creditor or assignee not disclosed on an assigned account', 'Metro 2 K1; §623'],
          ['Single-bureau asymmetry', 'Derogatory account present on one bureau, absent from the other two', '§607(b)'],
          ['Balance vs. past due', 'Amount past due reported higher than the total current balance — a mathematical impossibility', 'Metro 2 integrity failure'],
          ['Post-discharge balance', 'Balance over zero on a bankruptcy-discharged account', '11 U.S.C. §524'],
        ]}
      />
    </div>
  );
}

function Metro2() {
  return (
    <div>
      <H>Metro 2 Field & Status Reference</H>
      <Lead>
        The fields CCC targets most, and the Field 17A status codes that drive most paradox findings. This is the
        bureaus&apos; own data language — disputes framed at the field level are far harder to wave away than narrative
        complaints.
      </Lead>
      <Sub>Key Fields</Sub>
      <Table
        headers={['Field', 'Name', 'What To Watch']}
        rows={[
          ['17A', 'Account Status', 'The most-cited field; source of most status paradoxes'],
          ['18', 'Payment History Profile', '24-month grid; suppression or sequential resets are strong violations'],
          ['19', 'Special Comment', 'Not to be confused with Field 20'],
          ['20', 'Compliance Condition Code', 'Code XB = consumer disputes; required while a dispute is open'],
          ['21', 'Current Balance', 'Must be zero on a paid or settled account'],
          ['22', 'Amount Past Due', 'Must be zero on a paid or settled account; equal to Current Balance is normal on a collection account, not a violation'],
          ['23', 'Original Charge-off Amount', 'Inflation and post-payment misreporting'],
          ['25', 'Date of First Delinquency', 'Anchors the 7-year reporting clock; re-aging (an EARLIER true date) lives here — never argue a LATER true date, that extends the reporting window against the client'],
          ['K1 Segment', 'Original Creditor / Assignee', 'Required disclosure on sold or assigned accounts'],
        ]}
      />
      <Sub>Field 17A Status Codes</Sub>
      <Table
        headers={['Code', 'Meaning']}
        rows={[
          ['11', 'Current — account in good standing'],
          ['13', 'Paid, closed, zero balance'],
          ['71', 'Settled — paid less than full balance'],
          ['78', 'Charged off as a loss'],
          ['84', 'Unpaid, in collection'],
          ['93', 'Assigned to internal or external collections'],
          ['96', 'Merchandise repossessed'],
          ['97', 'Unpaid balance reported as a loss; not first time charged off'],
        ]}
      />
      <Note>
        Field references follow the CDIA Metro 2 Format as used in CCC&apos;s active disputes. Verify against the
        current CRRG edition before filing.
      </Note>
    </div>
  );
}

function Legal() {
  return (
    <div>
      <H>Legal Framework</H>
      <Lead>
        The authorities behind the pipeline. The single most important distinction in the entire model is which
        duties carry a private right of action — that is the line between building a record and recovering damages.
      </Lead>
      <Sub>Statutes &amp; Regulations</Sub>
      <Table
        headers={['Authority', 'Application', 'Right of Action']}
        rows={[
          ['15 U.S.C. §1681s-2(a)', 'Phase 1 direct furnisher disputes — duty to furnish accurate information', <PRA key="a" yes={false} />],
          ['15 U.S.C. §1681s-2(b)', 'Phase 3 CRA-triggered duty to conduct a reasonable investigation', <PRA key="b" yes={true} />],
          ['15 U.S.C. §1681n', 'Willful noncompliance — $100 to $1,000 per violation, plus punitive damages and attorney fees', <PRA key="n" yes={true} />],
          ['15 U.S.C. §1681o', 'Negligent noncompliance — actual damages plus attorney fees', <PRA key="o" yes={true} />],
          ['FCRA §607(b)', 'Maximum possible accuracy — the basis for cross-bureau conflict violations', '—'],
          ['FCRA §623(a)(5)', 'DOFD reporting obligation and the prohibition on re-aging', '—'],
          ['15 U.S.C. §1692g(b)', 'FDCPA debt validation — the second track for Type C collector accounts', <PRA key="g" yes={true} />],
          ['15 U.S.C. §1692e(8)', 'FDCPA — collector failure to note disputed status after Phase 1', <PRA key="e" yes={true} />],
          ['11 U.S.C. §524', 'Bankruptcy discharge injunction — zero-balance requirement post-discharge', <PRA key="524" yes={true} />],
          ['12 CFR §1022.43', 'Regulation V — the consumer right to dispute directly with a furnisher', '—'],
          ['12 CFR §1022.43(e)(4)', 'Requires the furnisher to review all relevant evidence the consumer provides', '—'],
        ]}
      />
      <Sub>Controlling Case Law</Sub>
      <Table
        headers={['Case', 'Holding', 'Why It Matters']}
        rows={[
          ['Johnson v. MBNA America Bank, 357 F.3d 426 (4th Cir. 2004)', 'A reasonable investigation requires more than parroting the existing database', 'The standard the entire Phase 2 analysis is measured against — a data match is not an investigation'],
          ['Seamans v. Temple University (3d Cir.)', 'Once on notice of a potentially meritorious dispute, a furnisher must flag the account as disputed', 'Failure to flag is itself a §1681s-2(b) violation; if willful, it opens §1681n exposure'],
        ]}
      />
    </div>
  );
}

function Letters() {
  return (
    <div>
      <H>Letter Standards</H>
      <Lead>
        Every CCC letter is forensic, not cookie-cutter. It is built from the specific violations on that account,
        on that report — never from a reused template.
      </Lead>
      <Sub>Tone Rules</Sub>
      <ul className="text-[13px] text-ink leading-relaxed space-y-1.5 mb-2 max-w-3xl list-disc pl-5">
        <li>Forensic and legal — every claim tied to a specific Metro 2 field number and FCRA citation.</li>
        <li>Demands, not requests. &quot;I demand,&quot; never &quot;I respectfully ask.&quot;</li>
        <li>No emotional narrative — no hardship story, no appeals to goodwill.</li>
        <li>No questions — statements and demands only.</li>
        <li>No threat to dispute with the bureaus inside a Phase 1 furnisher letter — that is not leverage at this stage.</li>
        <li>Signature block reads &quot;Consumer — All Rights Reserved.&quot; Sent certified mail, return receipt requested.</li>
      </ul>
      <Sub>Letter Anatomy</Sub>
      <p className="text-[13px] text-ink leading-relaxed mb-2 max-w-3xl">
        Date and addresses, RE line, a notice header stating this is a direct §1681s-2(b) dispute and not a
        bureau-forwarded e-OSCAR dispute, an account identification table, a Metro 2 violations table (field, what it
        reports, what it should report, why), the FCRA and FDCPA violations, the furnisher&apos;s legal obligations,
        numbered required corrections, a failure-to-comply section citing CFPB, state AG, and §1681n exposure, the
        documentation demand, and the signature block with certified-mail and enclosures notations.
      </p>
    </div>
  );
}

function HardStops() {
  return (
    <div>
      <H>Hard Stops — What We Never Do</H>
      <Lead>
        These are non-negotiable. They protect the integrity of the campaign and the client.
      </Lead>
      <ul className="text-[13px] text-ink leading-relaxed space-y-2 max-w-3xl list-disc pl-5">
        <li>Never dispute inquiries — accounts only.</li>
        <li>Never send a Phase 3 CRA dispute before a Phase 1 response exists or its window has closed.</li>
        <li>Never combine multiple accounts into one letter.</li>
        <li>Never run a furnisher dispute and a bureau dispute on the same account simultaneously.</li>
        <li>Never use goodwill or &quot;please remove&quot; language.</li>
        <li>Never build a letter on a placeholder or unconfirmed furnisher address — address verification is a hard gate.</li>
        <li>Never assume a letter was mailed until it is confirmed mailed.</li>
        <li>Never put CCC branding in a letter header, and never thank the furnisher.</li>
      </ul>
    </div>
  );
}

function Patterns() {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <Lock size={15} strokeWidth={2} className="text-ink-muted" />
        <span className="text-[10px] uppercase tracking-wider text-ink-muted font-medium">Internal Only — do not display to clients</span>
      </div>
      <H>Pattern Library &amp; Furnisher Intelligence</H>
      <Lead>
        Documented behavior from resolved cases. This is the most valuable operational asset in the practice — which
        violation types, arguments, and escalation approaches actually produce results against specific furnisher types.
      </Lead>
      <Sub>Furnisher Behavior</Sub>
      <Table
        headers={['Pattern', 'What Happens', 'Leverage']}
        rows={[
          ['Telecom documentation deficiency', 'Collectors of AT&T, Verizon, Cox debt cannot produce itemized original-creditor billing', 'Historically high deletion rate when challenged with itemized billing and K1 demands'],
          ['Post-sale continued furnishing', 'Furnisher sells a charged-off account but keeps reporting it; the response letter often admits the sale date', 'The admission becomes the primary Round 2 weapon — read responses for what they confirm, not what they deny'],
          ['Field 20 notation defense', 'Furnisher adds the consumer-disputes notation but never corrects the underlying inaccuracy', 'Continuing to report a known inaccuracy is willfulness evidence under §1681n'],
          ['Field 18 suppression cluster', 'Zero payment history reported on accounts with documented delinquency elsewhere', 'TransUnion is the most frequent suppressor in CCC cases — check TU first'],
          ['Debt buyers as a target class', 'New owner of record carries fresh K1 and validation obligations it often cannot meet', 'Any furnisher that sells and continues reporting is exposed; debt buyers are a rich, repeatable target'],
        ]}
      />
      <Note>
        Keep the living pattern cards in the project documents and update them after every resolved case. This tab
        holds the stable summary; the working library stays in your files until it earns its own database-backed section.
      </Note>
    </div>
  );
}

function Glossary() {
  const terms = [
    ['DOFD', 'Date of First Delinquency — the first missed payment that started the chain leading to charge-off; anchors the 7-year reporting clock.'],
    ['Re-aging', 'Illegally resetting the DOFD to a later date to extend how long a negative item can be reported.'],
    ['Metro 2 / CRRG', 'The Credit Reporting Resource Guide format that furnishers use to report to the bureaus.'],
    ['Furnisher', 'Any entity that reports account data to the credit bureaus — original creditors and debt collectors alike.'],
    ['CRA', 'Consumer Reporting Agency — Equifax, Experian, TransUnion.'],
    ['e-OSCAR', 'The automated system bureaus use to forward disputes to furnishers; a direct furnisher dispute deliberately bypasses it.'],
    ['K1 Segment', 'The Metro 2 segment identifying the original creditor on an assigned or sold account.'],
    ['Compliance Condition Code (XB)', 'The Field 20 code marking an account as disputed by the consumer.'],
    ['Private Right of Action', 'Whether a statute lets the consumer personally sue for damages — the dividing line of the whole strategy.'],
    ['Setup & Spike', 'CCC&apos;s name for the build-the-record-then-strike pipeline: Phase 1 documents, Phase 3 recovers.'],
  ];
  return (
    <div>
      <H>Glossary</H>
      <Lead>Plain-language definitions of the terms used throughout this doctrine.</Lead>
      <dl className="max-w-3xl space-y-3">
        {terms.map(([t, d]) => (
          <div key={t}>
            <dt className="text-[13px] text-ink font-medium">{t}</dt>
            <dd className="text-[12px] text-ink-muted leading-relaxed">{d}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
