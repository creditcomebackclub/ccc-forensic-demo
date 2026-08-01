/** Demo audit payload — furnisher-first Metro 2 / FCRA findings for the DIY product tour. */

export const DEMO_USER = {
  name: 'Alex Rivera',
  email: 'alex@example.com',
  address: {
    line1: '1842 Canyon Crest Dr',
    city: 'Grand Junction',
    state: 'CO',
    zip: '81507',
  },
};

export const DEMO_AUDIT = {
  id: 'audit_demo_001',
  generatedAt: '2026-08-01T14:22:00Z',
  reportSource: 'Sample 3-bureau combined report',
  scoreSnapshot: { experian: 614, equifax: 601, transunion: 608 },
  summary: {
    accountsReviewed: 18,
    actionableAccounts: 5,
    totalViolations: 11,
    crossBureauConflicts: 3,
    furnisherFirst: true,
  },
  methodologyNote:
    'Fieldwork audits Metro 2 base-segment fields against FCRA accuracy duties — then aims your first dispute at the furnisher (the source), not the bureaus.',
  accounts: [
    {
      id: 'acc_midland',
      furnisher: 'Midland Credit Management',
      originalCreditor: 'Synchrony Bank / Amazon Store Card',
      accountMask: '•••• 4821',
      type: 'Collection',
      balance: 1842,
      status: 'Open collection',
      bureaus: ['Experian', 'Equifax', 'TransUnion'],
      priority: 'high',
      typeLabel: 'Type A — Debt buyer / collection',
      whyFurnisherFirst:
        'The furnisher controls Metro 2 reporting. Fixing Field 25 / Field 20 at the source forces bureau updates downstream — bureau-only disputes often bounce as “verified.”',
      violations: [
        {
          id: 'v1',
          code: 'DOFD_NOT_TRACED_TO_ORIGINAL_CREDITOR',
          field: '25',
          fieldName: 'FCRA Compliance / Date of First Delinquency',
          statute: 'FCRA §623(a)(5)',
          severity: 'critical',
          title: 'DOFD appears re-aged at acquisition',
          plain:
            'The Date of First Delinquency should trace to the first delinquency with the original creditor that led to sale/placement — not a date derived from the debt buyer’s servicing file.',
          reported: 'DOFD reported as 03/2023 (post-acquisition)',
          expected: 'DOFD tied to original Synchrony delinquency chronology',
        },
        {
          id: 'v2',
          code: 'XB_RETENTION_POLICY_DEMAND',
          field: '20',
          fieldName: 'Compliance Condition Code',
          statute: 'Reg V, 12 C.F.R. §1022.42',
          severity: 'high',
          title: 'XB retained without clear policy trail',
          plain:
            'If XB is retained after an FDCPA-framed dispute, the furnisher should be able to produce the written retention policy. Demand it — don’t let a stale XB sit unchallenged.',
          reported: 'XB still present on all three bureaus',
          expected: 'XR/XH after investigation, or policy production',
        },
      ],
    },
    {
      id: 'acc_capital',
      furnisher: 'Capital One',
      originalCreditor: 'Capital One',
      accountMask: '•••• 9033',
      type: 'Revolving',
      balance: 4205,
      status: 'Charge-off',
      bureaus: ['Experian', 'TransUnion'],
      priority: 'high',
      typeLabel: 'Type B — Original creditor',
      whyFurnisherFirst:
        'Cross-bureau balance and status conflicts mean at least one file is wrong. The furnisher must reconcile maximum possible accuracy under §607(b) / §623.',
      violations: [
        {
          id: 'v3',
          code: 'CROSS_BUREAU_BALANCE_CONFLICT',
          field: '21',
          fieldName: 'Current Balance',
          statute: 'FCRA §607(b)',
          severity: 'critical',
          title: 'Balance disagrees across bureaus',
          plain:
            'Experian shows $4,205; TransUnion shows $3,980. Same account, same furnisher — both cannot be maximally accurate.',
          reported: 'EX $4,205 · TU $3,980 · EQ not reporting',
          expected: 'Identical current balance across reporting CRAs',
        },
        {
          id: 'v4',
          code: 'STATUS_HISTORY_INCONSISTENCY',
          field: '17A',
          fieldName: 'Account Status',
          statute: 'FCRA §623(a)(1)',
          severity: 'high',
          title: 'Charge-off status timing conflict',
          plain:
            'Payment History Profile and Account Status disagree on when the account entered charge-off staging — a classic Metro 2 integrity miss.',
          reported: 'Status 97 with PHP suggesting earlier 84 window mismatch',
          expected: 'Status / PHP / DOFD chronology aligned',
        },
      ],
    },
    {
      id: 'acc_portfolio',
      furnisher: 'Portfolio Recovery Associates',
      originalCreditor: 'Citibank',
      accountMask: '•••• 1170',
      type: 'Collection',
      balance: 967,
      status: 'Open collection',
      bureaus: ['Equifax', 'TransUnion'],
      priority: 'medium',
      typeLabel: 'Type A — Debt buyer / collection',
      whyFurnisherFirst:
        'Debt buyers frequently inherit incomplete Metro 2 packets. Your dispute cites the exact fields they must correct or delete.',
      violations: [
        {
          id: 'v5',
          code: 'ORIGINAL_CREDITOR_NAME_GAP',
          field: '9',
          fieldName: 'Account Type / identity continuity',
          statute: 'FCRA §623(a)(8)',
          severity: 'medium',
          title: 'Original creditor identity incomplete',
          plain:
            'Consumer-facing original creditor labeling is incomplete on Equifax relative to TransUnion — weakens your ability to verify the debt chain.',
          reported: 'EQ: “Citi” · TU: “Citibank N.A. / Costco Anywhere”',
          expected: 'Consistent original creditor identity',
        },
        {
          id: 'v6',
          code: 'AMOUNT_PAST_DUE_VS_BALANCE',
          field: '22',
          fieldName: 'Amount Past Due',
          statute: 'FCRA §623(a)(1)',
          severity: 'medium',
          title: 'Past-due exceeds current balance',
          plain:
            'Amount Past Due is reported higher than Current Balance — a structural Metro 2 impossibility that should force correction.',
          reported: 'Past due $1,102 · Balance $967',
          expected: 'Past due ≤ current balance (or zero if settled/paid)',
        },
      ],
    },
    {
      id: 'acc_wells',
      furnisher: 'Wells Fargo Auto',
      originalCreditor: 'Wells Fargo Auto',
      accountMask: '•••• 5542',
      type: 'Installment',
      balance: 0,
      status: 'Paid / closed was late',
      bureaus: ['Experian', 'Equifax', 'TransUnion'],
      priority: 'medium',
      typeLabel: 'Type B — Original creditor',
      whyFurnisherFirst:
        'Closed accounts still damage scores via history. If Date of Last Payment and PHP disagree, the furnisher owns the fix.',
      violations: [
        {
          id: 'v7',
          code: 'DATE_LAST_PAYMENT_MISMATCH',
          field: '27',
          fieldName: 'Date of Last Payment',
          statute: 'FCRA §623(a)(1)',
          severity: 'medium',
          title: 'Last payment date conflicts with history',
          plain:
            'Field 27 does not align with the late markers in the Payment History Profile across two bureaus.',
          reported: 'Last payment 11/2022 · PHP late markers through 02/2023',
          expected: 'Chronology consistent across Field 18 / 27',
        },
      ],
    },
    {
      id: 'acc_inquiry',
      furnisher: 'OneMain Financial',
      originalCreditor: 'OneMain Financial',
      accountMask: 'Inquiry',
      type: 'Hard inquiry',
      balance: null,
      status: 'Hard pull · 01/2026',
      bureaus: ['Experian'],
      priority: 'low',
      typeLabel: 'Inquiry review',
      whyFurnisherFirst:
        'Unauthorized or mismatched inquiries are a furnisher/CRA hybrid issue — we still start with a precise, documented challenge instead of a vague “remove everything” letter.',
      violations: [
        {
          id: 'v8',
          code: 'INQUIRY_PERMISSIBLE_PURPOSE_QUESTION',
          field: 'N/A',
          fieldName: 'Inquiry / permissible purpose',
          statute: 'FCRA §604',
          severity: 'low',
          title: 'Permissible purpose not recognized by you',
          plain:
            'You don’t recall authorizing this pull. A clean dispute asks the furnisher to validate permissible purpose or request deletion.',
          reported: 'Hard inquiry dated 01/14/2026 · Experian only',
          expected: 'Validated purpose or deletion',
        },
      ],
    },
  ],
};

export const PRICING_PLANS = [
  {
    id: 'starter',
    name: 'Starter',
    price: 29,
    mailCredits: 3,
    blurb: 'One audit cycle and your first certified letters.',
    features: ['Full Metro 2 / FCRA audit', '3 certified letters / mo', 'Furnisher-first letter studio', 'Delivery tracking'],
    cta: 'Start Starter',
    highlight: false,
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 59,
    mailCredits: 12,
    blurb: 'For active campaigns — response analysis included.',
    features: ['Everything in Starter', '12 certified letters / mo', 'Response analyzer', 'Cross-bureau conflict map', 'Priority letter queue'],
    cta: 'Go Pro',
    highlight: true,
  },
  {
    id: 'unlimited',
    name: 'Campaign',
    price: 99,
    mailCredits: 30,
    blurb: 'Heavy hitters running multi-furnisher waves.',
    features: ['Unlimited audits', '30 certified letters / mo', 'Phase-ready escalations toolkit', 'Exportable evidence pack'],
    cta: 'Run Campaign',
    highlight: false,
  },
];

export const DEFAULT_PLAN_ID = 'pro';

export const ANALYZE_STEPS = [
  'Reading bureau segments…',
  'Mapping Metro 2 base fields…',
  'Checking DOFD / CCC / balance integrity…',
  'Surfacing furnisher-first dispute targets…',
];

export const DEMO_DOCUMENTS = [
  { id: 'doc_id', name: 'Drivers_License_front.pdf', kind: 'Photo ID', uploadedAt: '2026-07-28T16:00:00Z' },
  { id: 'doc_addr', name: 'Utility_bill_July2026.pdf', kind: 'Proof of address', uploadedAt: '2026-07-28T16:02:00Z' },
  { id: 'doc_report', name: 'PrivacyGuard_3bureau_sample.pdf', kind: 'Credit report', uploadedAt: '2026-08-01T14:20:00Z' },
];

/** How Fieldwork works as a standalone service (product architecture copy). */
export const STANDALONE_PILLARS = [
  {
    title: 'Consumer SaaS, not an agency desk',
    body: 'You subscribe, upload, decide, and mail in your own name. No LPOA. Fieldwork is the forensic toolkit — you stay the sender of record.',
  },
  {
    title: 'Sealed off from CCC ops',
    body: 'Own fieldwork_* database tables, own FIELDWORK_* API keys, own Stripe. The agency Forensic Suite — clients, LPOA, Lob, Claude — is never billed or written by DIY traffic.',
  },
  {
    title: 'Campaigns you can run yourself',
    body: 'Each wave is a campaign: audit → select → certified mail → 30-day clocks → response upload. Upgrade plans when you need more mail credits or response analysis.',
  },
];
