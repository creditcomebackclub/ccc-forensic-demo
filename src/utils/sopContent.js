import {
  CCC_TRANSITION_START_ROUND,
  FLOW_LABELS,
  FLOW_LETTER_ROUNDS,
  FLOW_SEQUENCES,
  REPO_SEQUENCE,
} from './disputeFlow.js';
import {
  CCC_METHOD_VERSION,
  COMBO_NATIVE_LAW_COVERAGE,
  CONCRETE_TEMPLATE_ALIASES,
} from './disputeState.js';
import { DISPUTE_SCREENSHOT_POLICIES } from './disputeScreenshots.js';

export const CCC_SOP_CONTROL = Object.freeze({
  id: 'CCC-SOP-2026.08.23-PHASE1',
  version: '2026.08.23.1',
  methodVersion: CCC_METHOD_VERSION,
  effectiveDate: '2026-08-23',
  status: 'Controlled staff standard · Phase 1',
  owner: 'Credit Comeback Club',
  changeSummary: Object.freeze([
    'Established one staff-facing source of truth for the complete lead-to-outcome lifecycle.',
    'Separated the free 3B audit and Credit Blueprint from authorized client dispute service.',
    'Bound training ladders, physical-template aliases, and screenshot requirements to live application constants.',
    'Documented the human-only and Claude-assisted letter-writing boundaries.',
    'Added role-based daily and weekly operating checklists plus explicit clarification holds.',
    'Retired First Work Fee from active pricing; set Standard to $149/month, VIP to $299/month, and Paid In Full to $849 while preserving historical agreement and ledger snapshots.',
  ]),
});

export const CCC_SOP_SOURCE_TIERS = Object.freeze([
  Object.freeze({
    rank: 1,
    id: 'TIER-COURSE',
    label: 'Skool flow documents and original course letters',
    rule: 'Primary authority for round order, assigned laws, switches, and the intended shape of each course letter.',
  }),
  Object.freeze({
    rank: 2,
    id: 'TIER-OWNER',
    label: 'Explicit CCC owner policies',
    rule: 'Controls CCC operating choices where the course allows discretion or the owner has expressly set a business rule.',
  }),
  Object.freeze({
    rank: 3,
    id: 'TIER-BOOKS',
    label: 'Supplemental books',
    rule: 'Training context only. Books may improve understanding and writing, but may not replace a course flow or owner-confirmed CCC rule.',
  }),
  Object.freeze({
    rank: 4,
    id: 'TIER-DERIVED',
    label: 'CCC templates and application code',
    rule: 'Derived implementation. It enforces the approved method but must be corrected when it conflicts with a higher authority.',
  }),
]);

export const CCC_SOP_SOURCES = Object.freeze([
  Object.freeze({ id: 'COURSE-FLOW-ACCURACY', tier: 1, title: 'Accuracy flow (2) (1).docx', scope: 'Accuracy ladder and switches', sha256: '3ce1fd6020183634d26f07d1b9d74be092be127b245e536d8ff148b5653d93fd' }),
  Object.freeze({ id: 'COURSE-FLOW-COLLECTION', tier: 1, title: 'COLLECTION FLOW UPDATED.docx', scope: 'Collection and repossession ladders', sha256: '3ed4eeb63dda586b17360fe0938b9cb71f06b6a0723c01f0ac71a98a08b5f05c' }),
  Object.freeze({ id: 'COURSE-FLOW-COMBO', tier: 1, title: 'Accuracy + Collection (combo) (2).docx', scope: 'Combo ladder and side-switch behavior', sha256: '1c426e2ca4c144036fae91d53112312ab17544b1e74a1d7f075a4f6d1d97b49b' }),
  Object.freeze({ id: 'COURSE-FLOW-CONSENT', tier: 1, title: 'Consent flow (2) (1).docx', scope: 'Consent ladder and post-R3 switches', sha256: 'e5c8e5de755c60245ce86db19a76bb8e9ea9eba8124fec125f59bec57e642fd2' }),
  Object.freeze({ id: 'COURSE-LETTERS-ORIGINAL', tier: 1, title: 'Original Skool course letter set', scope: 'Assigned round laws, course letter structure, and evidence prompts' }),
  Object.freeze({ id: 'COURSE-GROUP-NOTES', tier: 1, title: 'Skool classroom and group notes', scope: 'Course explanations, writing notes, and unresolved questions requiring confirmation' }),
  Object.freeze({ id: 'CCC-OWNER-POLICY-2026-08-20', tier: 2, title: 'CCC owner-confirmed operating policies', scope: 'Fresh R1 transition, seven-week versions, First Class mail, no routine CFPB follow-up, no LPOA/signature, and result tracking' }),
  Object.freeze({ id: 'CCC-OWNER-COMBO-2026-08-20', tier: 2, title: 'CCC owner-confirmed Combo side rule', scope: 'Surviving side continues at its next unused native law' }),
  Object.freeze({ id: 'BOOK-CREDIT-REPAIR', tier: 3, title: 'Credit Repair Book.txt', scope: 'Supplemental consumer-credit training' }),
  Object.freeze({ id: 'BOOK-WRITE-LETTERS', tier: 3, title: 'Write Repair Letters.txt', scope: 'Supplemental letter-writing training' }),
  Object.freeze({ id: 'CCC-CODE-FLOW', tier: 4, title: 'src/utils/disputeFlow.js', scope: 'Deterministic R1 routing and live law ladders' }),
  Object.freeze({ id: 'CCC-CODE-STATE', tier: 4, title: 'src/utils/disputeState.js', scope: 'Account-level transitions, switches, aliases, and review holds' }),
  Object.freeze({ id: 'CCC-CODE-SCREENSHOTS', tier: 4, title: 'src/utils/disputeScreenshots.js', scope: 'Evidence policies and exact account coverage' }),
  Object.freeze({ id: 'CCC-CODE-CAMPAIGN', tier: 4, title: 'DisputeCampaignStudio + rewrite-dispute-selection', scope: 'Template controls, human fields, and current AI boundary' }),
]);

const source = (...sourceIds) => Object.freeze(sourceIds);
const bullets = (heading, items, options = {}) => Object.freeze({ type: 'bullets', heading, items: Object.freeze(items), ...options });
const steps = (heading, items, options = {}) => Object.freeze({ type: 'steps', heading, items: Object.freeze(items), ...options });
const callout = (tone, heading, text) => Object.freeze({ type: 'callout', tone, heading, text });
const table = (heading, columns, rows, options = {}) => Object.freeze({
  type: 'table',
  heading,
  columns: Object.freeze(columns),
  rows: Object.freeze(rows.map((row) => Object.freeze(row))),
  ...options,
});

const CORE_FLOW_CODES = Object.freeze(['accuracy', 'collection', 'combo', 'consent', 'late_pay']);

export const CCC_SOP_FLOW_LADDERS = Object.freeze(CORE_FLOW_CODES.map((flow) => Object.freeze({
  flow,
  label: FLOW_LABELS[flow],
  rounds: Object.freeze(FLOW_SEQUENCES[flow].slice(0, FLOW_LETTER_ROUNDS[flow]).map((law, index) => Object.freeze({
    round: index + 1,
    law,
  }))),
  switchInstruction: FLOW_SEQUENCES[flow][FLOW_LETTER_ROUNDS[flow]] || null,
})));

export const CCC_SOP_TEMPLATE_ALIASES = Object.freeze(Object.entries(CONCRETE_TEMPLATE_ALIASES).map(([logical, physical]) => Object.freeze({
  logical,
  physical: `${physical.flow}:${physical.round}`,
})));

export const CCC_SOP_SCREENSHOT_POLICY_ROWS = Object.freeze(Object.entries(DISPUTE_SCREENSHOT_POLICIES).map(([code, policy]) => Object.freeze([
  code,
  policy.label,
  policy.required ? 'Required when selected template snapshots this policy' : 'Not required',
])));

export const CCC_SOP_PENDING_DECISIONS = Object.freeze([
  Object.freeze({
    id: 'PENDING-DIRECT-ELIGIBILITY',
    decision: 'Direct debt-verification eligibility',
    currentControl: 'Automatic Direct routing stays off. Do not infer eligibility from the presence of a collection or from a one-bureau account.',
    needed: 'Owner/course clarification pending: which solo or post-CRA collection cases qualify and what follows Direct R1.',
  }),
  Object.freeze({
    id: 'PENDING-END-OF-LADDER',
    decision: 'End-of-ladder restart policy',
    currentControl: 'The state engine has safe technical mappings for Collection/Combo cycles and Accuracy-to-Consent, but staff may not treat those mappings as settled course policy.',
    needed: 'Owner/course clarification pending before manually starting any new cycle after the final confirmed round.',
  }),
  Object.freeze({
    id: 'PENDING-SOLO-MEANING',
    decision: '“Solo collection” and Accuracy Solo meaning',
    currentControl: 'One-bureau reporting alone does not authorize a Direct letter or the Accuracy Solo bonus. Hold the special route unless the system presents an owner-approved step.',
    needed: 'Owner/course clarification pending on the exact trigger, recipient, and next state for each special case.',
  }),
]);

const r1Rows = Object.freeze([
  Object.freeze(['Collection', 'Collection R1', 'Normal collection path']),
  Object.freeze(['Repossession', 'Repo logical R1', 'Uses the Collection R1 physical template; repo state remains distinct']),
  Object.freeze(['Bankruptcy', 'Accuracy R1', 'Accuracy path']),
  Object.freeze(['Student loan', 'Consent R1', 'Student-loan majority override may move every negative account on the file to Consent R1']),
  Object.freeze(['Charge-off on one bureau', 'Consent R1', 'Requires a complete one-of-each 3B before bureau-solo coverage can be confirmed']),
  Object.freeze(['Charge-off on more than one bureau', 'Accuracy R1', 'Accuracy path']),
  Object.freeze(['Late payment: two or fewer confirmed markers', 'Late Pay R1', 'Bureau-level count and band must agree']),
  Object.freeze(['Late payment: three or more confirmed markers', 'Accuracy R1', 'Bureau-level count and band must agree']),
  Object.freeze(['Late payment: mixed stretches', 'Late Pay R1', 'File-level mixed-late override applies to late-payment accounts']),
  Object.freeze(['Accuracy + Collection on the same bureau', 'Combo R1', 'Only the covered Accuracy and Collection accounts are combined']),
]);

export const CCC_SOP_MODULES = Object.freeze([
  Object.freeze({
    id: 'governance',
    navLabel: 'Authority & version',
    title: 'Authority, version control, and conflicts',
    summary: 'Know which source wins, what this SOP version changed, and when work must stop for clarification.',
    keywords: Object.freeze(['authority', 'sources', 'version', 'change log', 'course', 'owner', 'books', 'conflict']),
    sourceIds: source('COURSE-FLOW-ACCURACY', 'COURSE-FLOW-COLLECTION', 'COURSE-FLOW-COMBO', 'COURSE-FLOW-CONSENT', 'COURSE-LETTERS-ORIGINAL', 'CCC-OWNER-POLICY-2026-08-20'),
    blocks: Object.freeze([
      callout('navy', 'Controlled source of truth', `Use ${CCC_SOP_CONTROL.id}, version ${CCC_SOP_CONTROL.version}, with method ${CCC_METHOD_VERSION}. Runtime holds still control whether a real client can advance.`),
      steps('Resolve a conflict in this order', CCC_SOP_SOURCE_TIERS.map((tier) => `${tier.label} — ${tier.rule}`)),
      bullets('Change summary', CCC_SOP_CONTROL.changeSummary),
      bullets('Conflict protocol', [
        'Stop the affected letter or transition; do not silently blend competing instructions.',
        'Record the exact source IDs and the client/account state involved.',
        'Escalate to the CCC owner. A confirmed change must update the canonical course note or owner policy, the application rule, its tests, and this SOP version together.',
        'Historical letters keep the method and template snapshots under which they were mailed.',
      ]),
    ]),
  }),
  Object.freeze({
    id: 'lead-to-client',
    navLabel: 'Lead → client',
    title: 'Free Recovery Blueprint versus client service',
    summary: 'The 3B audit and Recovery Blueprint happen before engagement; dispute work starts only after an authorized client lifecycle exists.',
    keywords: Object.freeze(['lead', 'blueprint', 'audit', 'consultation', 'client', 'service', 'billing']),
    sourceIds: source('CCC-OWNER-POLICY-2026-08-20', 'CCC-CODE-FLOW'),
    blocks: Object.freeze([
      table('Lifecycle boundary', ['Stage', 'What CCC may do', 'What CCC may not do'], [
        ['Lead / prospect', 'Collect consultation details and obtain the 3B report for the free audit and Recovery Blueprint.', 'Initialize a dispute campaign, mail a letter, or represent the lead as an active client.'],
        ['Blueprint delivered', 'Explain report findings, the proposed R1 starts, and the service option.', 'Treat the pre-client audit as authorization to perform dispute service.'],
        ['Converted client', 'Owner selects billing setup and the correct agreement, then starts secure onboarding.', 'Use a generic agreement or prices that differ from the saved billing setup.'],
        ['Authorized service', 'After the required agreement/authorization and onboarding gates are satisfied, initialize the saved deterministic R1 plan.', 'Skip an Operations hold or start from a historical round.'],
      ]),
      callout('gold', 'Fresh method boundary', `Every authorized campaign entering this method starts from a newly reviewed classification at R${CCC_TRANSITION_START_ROUND}. Historical letters remain evidence, not round credit.`),
    ]),
  }),
  Object.freeze({
    id: 'agreement-onboarding',
    navLabel: 'Agreement & onboarding',
    title: 'Agreement, disclosure, documents, and portal activation',
    summary: 'Use the secure onboarding wizard and verify the service authorization before initializing account tracks.',
    keywords: Object.freeze(['agreement', 'onboarding', 'disclosure', 'password', 'portal', 'documents', 'authorization']),
    sourceIds: source('CCC-OWNER-POLICY-2026-08-20'),
    blocks: Object.freeze([
      steps('Owner starts onboarding', [
        'Open the client billing setup and confirm the selected plan: Standard at $149 per month, VIP at $299 per month, or Paid In Full at $849. The active plans do not use a First Work Fee.',
        'Choose and save the current service agreement; verify that client name and pricing are populated from the saved records.',
        'Send the secure onboarding link. Do not send a retired authorization form.',
      ]),
      callout('gold', 'Opening invoice rule', 'For a new Standard or VIP agreement, the owner-created opening invoice is the first monthly payment only. For a new Paid In Full agreement, it is the $849 flat service price. Creating the invoice never charges a card automatically. Historical signed agreements and ledger entries keep their original terms.'),
      steps('Client completes one wizard', [
        'Create a portal password from the secure invitation.',
        'Review the required disclosure and sign the current service agreement.',
        'Upload a current government ID and proof of current address through the private document controls.',
        'Complete the remaining required access/report fields and confirm onboarding before portal access is granted.',
      ]),
      callout('red', 'Authorization hold', 'If CCC does not show active service authorization or an explicit grandfathered authorization, do not initialize R1 tracks. Escalate the record instead of repairing authorization by hand.'),
      callout('green', 'Letter signature rule', 'The current dispute letters do not require a client signature, and the retired LPOA is not part of the packet. The signed service agreement governs onboarding.'),
    ]),
  }),
  Object.freeze({
    id: 'deterministic-3b',
    navLabel: '3B QA',
    title: 'Deterministic 3B extraction and quality review',
    summary: 'AI may extract report facts; only deterministic CCC rules classify R1, and incomplete facts produce a review hold.',
    keywords: Object.freeze(['3B', 'report', 'deterministic', 'classification', 'qa', 'bureau', 'account', 'late count']),
    sourceIds: source('CCC-CODE-FLOW', 'CCC-CODE-STATE'),
    blocks: Object.freeze([
      steps('3B quality gate', [
        'Confirm the report belongs to the correct client and contains one current section for Equifax, Experian, and TransUnion.',
        'Match every negative account to its canonical client account and exact reported bureaus; never use furnisher-name fallback as identity.',
        'Confirm account category, bureau coverage, and any required late-payment count and band at the bureau level.',
        'Review the issue facts that will populate the letter. A missing category, coverage fact, count, or canonical ID is a hold—not a best guess.',
        'Save the reviewed classification snapshot before account tracks are initialized.',
      ]),
      callout('red', 'AI boundary', 'Claude does not choose a flow, an R1, a switch, or a next round. Classification and transitions are code-owned rules applied to confirmed report facts.'),
      bullets('Never infer', [
        'A missing account category from the creditor name alone.',
        'A one-bureau charge-off without a complete 3B coverage check.',
        'A late-payment threshold from prose when the bureau-level markers and count do not agree.',
        'A healthy tradeline as disputable merely because harmless bureau fields differ.',
      ]),
    ]),
  }),
  Object.freeze({
    id: 'r1-classification',
    navLabel: 'R1 classification',
    title: 'Review the exact R1 start',
    summary: 'The application classifies each account and bureau from confirmed facts, then groups compatible accounts into physical letters.',
    keywords: Object.freeze(['R1', 'accuracy', 'collection', 'combo', 'consent', 'late pay', 'repo', 'student loan']),
    sourceIds: source('COURSE-FLOW-ACCURACY', 'COURSE-FLOW-COLLECTION', 'COURSE-FLOW-COMBO', 'COURSE-FLOW-CONSENT', 'CCC-CODE-FLOW'),
    blocks: Object.freeze([
      table('Training summary — CCC output remains authoritative', ['Confirmed report fact', 'Logical R1', 'Control'], r1Rows),
      bullets('Before approval', [
        'Read the internal R1 instruction for every bureau and account group.',
        'Resolve every red review flag; staff may correct source facts, but may not hand-pick a preferred flow.',
        'Expect more than one letter to the same bureau when its accounts belong to separate logical groups.',
        'Confirm the saved classification review matches the exact audit used to initialize tracks.',
      ]),
      callout('gold', 'No model judgement', 'A model-generated recommendation is never enough to start a campaign. The deterministic account-track initialization is the controlling R1 decision.'),
    ]),
  }),
  Object.freeze({
    id: 'flows-switches',
    navLabel: 'Flows & switches',
    title: 'Round ladders, aliases, and switches',
    summary: 'Follow the assigned laws in order and preserve each account’s independent state when a group splits.',
    keywords: Object.freeze(['round', 'ladder', 'law', 'switch', 'repo', 'combo split', 'alias', 'sequence']),
    sourceIds: source('COURSE-FLOW-ACCURACY', 'COURSE-FLOW-COLLECTION', 'COURSE-FLOW-COMBO', 'COURSE-FLOW-CONSENT', 'COURSE-LETTERS-ORIGINAL', 'CCC-OWNER-COMBO-2026-08-20', 'CCC-CODE-FLOW', 'CCC-CODE-STATE'),
    blocks: Object.freeze([
      Object.freeze({ type: 'flowLadders', heading: 'Live law ladders', ladders: CCC_SOP_FLOW_LADDERS }),
      table('Logical step → physical template aliases', ['Logical step', 'Physical library step'], CCC_SOP_TEMPLATE_ALIASES.map((item) => [item.logical, item.physical])),
      table('Special tracks — do not infer eligibility', ['Track', 'Stored sequence', 'Operating status'], [
        [FLOW_LABELS.direct, FLOW_SEQUENCES.direct.map((law, index) => `R${index + 1}: ${law}`).join(' → '), 'Eligibility and automatic next state remain owner/course clarification pending.'],
        [FLOW_LABELS.accuracy_solo, FLOW_SEQUENCES.accuracy_solo.map((law, index) => `R${index + 1}: ${law}`).join(' → '), 'Exact trigger and next state remain owner/course clarification pending.'],
      ]),
      bullets('Confirmed switches', [
        'Consent: after R3, a surviving collection moves to Collection R1; a surviving charge-off or late-payment account moves to Accuracy R1. Any other account kind is held for review.',
        'Late Pay: after R2, a surviving late-payment account moves to Accuracy R1 and the target changes to the full account.',
        `Repossession: ${REPO_SEQUENCE.join(' → ')}. After logical Repo R3, the repossession moves to the approved Accuracy join state and companion collections continue at Collection R4.`,
        'Combo: if one side is deleted, the surviving side moves to its first unused native law based on the immutable Combo history; it does not copy the Combo round number.',
        'Accounts covered by one letter remain independent. A deleted/resolved account stops while surviving accounts continue on their own saved state.',
      ]),
      Object.freeze({
        type: 'details',
        heading: 'Combo native-law coverage used by the state engine',
        items: Object.freeze(Object.entries(COMBO_NATIVE_LAW_COVERAGE).map(([round, coverage]) => `Combo R${round}: ${Object.entries(coverage).map(([flow, nativeRound]) => `${FLOW_LABELS[flow]} R${nativeRound}`).join(' + ')}`)),
      }),
    ]),
  }),
  Object.freeze({
    id: 'template-library',
    navLabel: 'Templates & curlys',
    title: 'Template library, curlys, and immutable versions',
    summary: 'The library owns the fixed round argument; verified system values populate curlys, and every mailed letter retains its exact version snapshot.',
    keywords: Object.freeze(['template', 'library', 'curly', 'token', 'version', '49 days', 'seven weeks', 'law']),
    sourceIds: source('COURSE-LETTERS-ORIGINAL', 'CCC-OWNER-POLICY-2026-08-20', 'CCC-CODE-CAMPAIGN'),
    blocks: Object.freeze([
      bullets('Template controls', [
        'Select only the active physical template that matches the account track, round, audience, and bureau.',
        'CCC templates model the course structure and keep the law assigned to each round; they use original CCC wording rather than copying a dead course letter.',
        'The fixed law, citations, demand structure, and non-editable body are not rewritten during personalization.',
        'Automatic curlys must come from the verified client profile, letter-identity snapshot, bureau record, and confirmed report accounts. Correct the source record when a required value is missing.',
        'A bureau/CRA template contains exactly one editable Consumer Statement curly. Direct templates do not use a Consumer Statement.',
      ]),
      callout('green', 'Seven-week template review', 'Review master wording every 49 days and create a fresh version when required. Never overwrite or recycle a version that has mailing history; the prior letter keeps its exact saved snapshot.'),
      steps('Before saving a letter', [
        'Confirm the logical account state and the resolved physical template step.',
        'Confirm the template audience and bureau match the recipient.',
        'Resolve every missing or unknown curly token in its source record.',
        'Complete the required human fields and evidence uploads.',
        'Preview the rendered letter, then save the exact template version and automatic-value snapshot.',
      ]),
    ]),
  }),
  Object.freeze({
    id: 'letter-writing-ai',
    navLabel: 'Writing & AI editor',
    title: 'Damages, facts, penalties, and the AI editor',
    summary: 'Staff owns the client story and factual accuracy. Claude can suggest a narrow Damages rewrite but cannot classify or alter the fixed method.',
    keywords: Object.freeze(['damages', 'facts', 'penalty', 'consumer statement', 'Claude', 'AI editor', 'rewrite', 'story notes']),
    sourceIds: source('COURSE-LETTERS-ORIGINAL', 'COURSE-GROUP-NOTES', 'BOOK-WRITE-LETTERS', 'CCC-CODE-CAMPAIGN'),
    blocks: Object.freeze([
      table('Human-written sections', ['Section', 'Standard', 'Do not'], [
        ['Damages / client story', 'Use only the client’s confirmed experience: what happened, the practical consequence, the actual emotional impact described, and why correction matters. Make it bureau-specific.', 'Invent denials, dollar amounts, dates, diagnoses, quotes, or consequences.'],
        ['Facts / exact inaccuracies', 'State the exact account and bureau values that make the fixed round argument apply.', 'Change the template’s fixed legal facts, fill gaps from memory, or overstate what the report proves.'],
        ['Penalty / deadline', 'Write the round-specific consequence paragraph for this bureau within the template’s assigned theory.', 'Add a new statute, threat, penalty, or deadline that the stored round does not support.'],
        ['Consumer Statement', 'For CRA letters, write the editable what, why, and requested outcome in the client’s voice.', 'Add a Consumer Statement to a Direct letter or leave the required CRA field blank.'],
        ['Optional strengthener', 'Use only when its supporting client fact is confirmed.', 'Treat an optional statement as boilerplate.'],
      ]),
      callout('navy', 'Current editor boundary', 'The production editor is pinned to Claude Sonnet 5. It rewrites only text that staff highlights inside the Damages field, using the approved AI-safe story-note excerpt plus locked flow, round, and bureau context.'),
      steps('Use the AI editor safely', [
        'Write or select the exact Damages sentence or paragraph to improve.',
        'Save confirmed client story notes and remove names, SSNs, birth dates, account or ID numbers, contact details, addresses, passwords, exact dates, and medical/health information.',
        'Attest that the excerpt is AI-safe, then request the selected-text rewrite.',
        'Compare Original and Suggested replacement. Choose Use rewrite or Keep original; Claude never applies a change automatically.',
        'Re-read the complete letter for factual fidelity, tone, and bureau specificity before saving.',
      ]),
      callout('red', 'AI may never do these jobs', 'Claude never classifies R1, advances a round, chooses a law, rewrites the fixed template body, adds legal language, selects screenshots, or supplies an unsupported client fact.'),
    ]),
  }),
  Object.freeze({
    id: 'evidence-documents',
    navLabel: 'Documents & screenshots',
    title: 'ID, proof of address, and account screenshots',
    summary: 'Bind current identity documents and any required report images to the exact letter packet; staff—not Claude—reviews the evidence.',
    keywords: Object.freeze(['ID', 'proof of address', 'screenshots', 'evidence', 'exhibit', 'upload', 'crop']),
    sourceIds: source('COURSE-LETTERS-ORIGINAL', 'CCC-OWNER-POLICY-2026-08-20', 'CCC-CODE-SCREENSHOTS'),
    blocks: Object.freeze([
      steps('Identity documents', [
        'Confirm the client has a current government ID and proof of current address in the private Documents area.',
        'Review the actual files and confirm the typed letter name/address match them exactly.',
        'Bind the exact document IDs and integrity fingerprints to the letter identity snapshot.',
        'R1 packets require the current ID and proof of address. Replace expired or mismatched evidence before mailing.',
      ]),
      steps('Screenshot workflow', [
        'Read the selected template version’s saved screenshot policy and staff instructions.',
        'When required, a team member reviews and crops the current report image that proves the requested issue.',
        'Assign each upload to the exact canonical account; required policies need coverage for every account in that letter.',
        'Preview the exhibits. CCC appends the approved images to the mailing packet; Claude does not choose, crop, or approve them.',
      ]),
      table('Live screenshot policy registry', ['Policy code', 'Evidence target', 'Requirement'], CCC_SOP_SCREENSHOT_POLICY_ROWS),
      callout('red', 'Evidence hold', 'Do not mail when a required account image, identity document, account assignment, or integrity check is missing. Upload and review the exact evidence first.'),
    ]),
  }),
  Object.freeze({
    id: 'mailing',
    navLabel: 'Packet & mailing',
    title: 'Packet integrity and USPS First Class mailing',
    summary: 'Preview the exact stored letter and exhibits, send by First Class Mail, and preserve the database-to-mailpiece audit chain.',
    keywords: Object.freeze(['packet', 'mail', 'Lob', 'First Class', 'exhibits', 'address', 'signature']),
    sourceIds: source('CCC-OWNER-POLICY-2026-08-20', 'CCC-CODE-CAMPAIGN', 'CCC-CODE-SCREENSHOTS'),
    blocks: Object.freeze([
      steps('Final packet review', [
        'Open the saved letter—not a downloaded or locally edited substitute—and verify client, bureau, account group, logical round, and template version.',
        'Confirm required curlys rendered, the Consumer Statement is present on CRA letters, and no placeholder or editing instruction remains.',
        'Confirm the R1 identity documents and each policy-required account screenshot appear in the packet in the expected exhibit order.',
        'Verify the recipient bureau address and the CCC server-owned return address.',
        'Send through the CCC First Class action and record the provider mailpiece ID and submitted timestamp.',
      ]),
      callout('green', 'Current delivery standard', 'CCC dispute packets use USPS First Class Mail. Do not add certified service, a client signature, or an LPOA.'),
      callout('red', 'No packet substitution', 'The uploaded mailing bytes must be the exact packet reviewed and bound to the saved letter. Stop if the database letter, exhibits, recipient, or hash does not match.'),
    ]),
  }),
  Object.freeze({
    id: 'outcomes',
    navLabel: 'Outcomes & next state',
    title: 'Wins, fails, deletions, and account-level continuation',
    summary: 'Compare a post-mail report to the exact round target, record proof, and advance only unresolved account tracks.',
    keywords: Object.freeze(['outcome', 'win', 'fail', 'deletion', 'result', 'next round', 'consumer statement', 'proof']),
    sourceIds: source('COURSE-FLOW-ACCURACY', 'COURSE-FLOW-COLLECTION', 'COURSE-FLOW-COMBO', 'COURSE-FLOW-CONSENT', 'CCC-OWNER-POLICY-2026-08-20', 'CCC-CODE-STATE'),
    blocks: Object.freeze([
      steps('Review a result', [
        'Use a complete updated 3B saved after the provider submitted the mailing, or an exact response that proves the target.',
        'Compare each covered account to that round’s requested deletion, correction, late-payment removal, or statement target.',
        'Record target achieved, target remains, partially changed, or evidence missing for each account.',
        'Save the proof and mark a deletion only when the new report/response proves it.',
        'Apply the deterministic next state to unresolved tracks. Deleted or resolved accounts stop independently.',
      ]),
      callout('green', 'Letter win rule', 'Record the letter as a win when at least one covered account achieves the round target. Remaining accounts continue in sequence; they do not erase the letter win.'),
      callout('gold', 'Consumer Statement review', 'A partial, generic, or uncertain statement match is a manual hold. Do not auto-pass it and do not advance until a reviewer confirms what the report actually shows.'),
      bullets('Tracking discipline', [
        'Keep the exact mailed template version, mail timestamp, provider ID, account coverage, evidence, and outcome together.',
        'Dashboard deletion metrics come from proven deletion records, not from a staff estimate or a letter-level win alone.',
        'Never backdate a letter or result.',
        'Do not automatically file CFPB complaints as a seven-to-fourteen-day follow-up.',
      ]),
    ]),
  }),
  Object.freeze({
    id: 'operations',
    navLabel: 'Operations & holds',
    title: 'Operations Control Center and hard stops',
    summary: 'Operations tells the team what is ready, what R1 applies, and which exact prerequisite blocks the next action.',
    keywords: Object.freeze(['operations', 'queue', 'hold', 'readiness', 'review', 'blocker', 'campaign']),
    sourceIds: source('CCC-CODE-FLOW', 'CCC-CODE-STATE', 'CCC-CODE-SCREENSHOTS'),
    blocks: Object.freeze([
      table('Common queue or hold', ['State', 'Meaning', 'Team response'], [
        ['Classification review', 'Required 3B routing fact or reviewed snapshot is missing.', 'Correct and re-review the exact audit; never choose a flow manually.'],
        ['Service authorization', 'Agreement/grandfather authorization is absent or client is not active.', 'Resolve the client lifecycle; do not initialize tracks.'],
        ['Template readiness', 'No active exact physical template matches flow, round, audience, or bureau.', 'Correct the library/version; do not free-generate a replacement.'],
        ['Curly / identity hold', 'Required automatic value or bound identity evidence is missing.', 'Correct the source profile/documents and rebuild the preview.'],
        ['Screenshot hold', 'The saved template policy requires evidence not assigned to every covered account.', 'Upload, review, and assign the exact images.'],
        ['Outcome evidence', 'No complete post-mail report proves the result.', 'Save the updated report or exact response before recording/advancing.'],
        ['State review required', 'A switch, transition, or account kind has no confirmed rule.', 'Escalate; never force the next round.'],
      ]),
      bullets('Hard stops', [
        'Never bypass the stored-template campaign builder with a free-generated letter.',
        'Never change a law assigned to a round.',
        'Never merge separate flows merely to reduce the number of letters.',
        'Never mark a deletion, win, or next state without the required saved evidence.',
        'Never clear a hold by editing database state outside the approved workflow.',
      ]),
    ]),
  }),
  Object.freeze({
    id: 'privacy-security',
    navLabel: 'Privacy & security',
    title: 'Client privacy, access, and secure handling',
    summary: 'Use least privilege, private storage, and minimum necessary data throughout reports, documents, AI notes, mail, and future payments.',
    keywords: Object.freeze(['privacy', 'security', 'PII', 'SSN', 'documents', 'AI', 'card', 'access']),
    sourceIds: source('CCC-OWNER-POLICY-2026-08-20', 'CCC-CODE-SCREENSHOTS', 'CCC-CODE-CAMPAIGN'),
    blocks: Object.freeze([
      bullets('Required handling', [
        'Access only clients assigned to your role and only the data needed for the current task.',
        'Keep 3B reports, IDs, proof of address, screenshots, agreements, and story notes in CCC private storage—not email threads or personal folders.',
        'Never paste SSNs, birth dates, addresses, contact details, account/ID numbers, credentials, exact dates, or health information into AI-safe story notes.',
        'Do not put monitoring credentials, unmasked identifiers, or client documents in logs, support messages, or screenshots used for training.',
        'Future payment methods must use the payment gateway’s hosted/tokenized controls. CCC staff must never store raw card numbers or CVC values.',
        'Use the saved audit trail for profile corrections, agreement state, template versions, mailpieces, and outcomes.',
      ]),
      callout('red', 'Suspected exposure', 'Stop the task, preserve the audit trail, and notify the CCC owner immediately. Do not copy, forward, or “test” exposed client data.'),
    ]),
  }),
  Object.freeze({
    id: 'checklists',
    navLabel: 'Team checklists',
    title: 'Role-based daily and weekly checklists',
    summary: 'Use these operator checklists as the minimum cadence; an Operations hold always takes priority over speed.',
    keywords: Object.freeze(['checklist', 'daily', 'weekly', 'owner', 'admin', 'auditor', 'operations', 'mail']),
    sourceIds: source('CCC-OWNER-POLICY-2026-08-20', 'CCC-CODE-FLOW', 'CCC-CODE-STATE', 'CCC-CODE-SCREENSHOTS'),
    blocks: Object.freeze([
      Object.freeze({
        type: 'checklists',
        heading: 'Daily',
        groups: Object.freeze([
          Object.freeze({ role: 'Owner / Admin', items: Object.freeze([
            'Review new leads, consultation handoffs, completed Blueprints, and clients awaiting billing/agreement setup.',
            'Review Operations holds, authorization exceptions, classification corrections, and unresolved owner decisions.',
            'Review due outcomes, deletion proofs, billing exceptions, and privacy/security alerts.',
          ]) }),
          Object.freeze({ role: 'Auditor / Analyst', items: Object.freeze([
            'Process assigned 3B reports and resolve every deterministic QA flag before R1 approval.',
            'Review the exact R1 instruction with account/bureau coverage and save the classification snapshot.',
            'Write confirmed report facts and flag any unclear account identity, type, coverage, or late-payment pattern.',
          ]) }),
          Object.freeze({ role: 'Campaign / Mail Operator', items: Object.freeze([
            'Open only Operations-ready work and confirm state, physical template, version, bureau, and account group.',
            'Complete human sections, curlys, identity documents, Consumer Statement, and policy-required screenshots.',
            'Preview the exact packet, send First Class, and verify provider ID/submitted timestamp were recorded.',
          ]) }),
          Object.freeze({ role: 'Outcome Reviewer', items: Object.freeze([
            'Match each updated 3B/response to mail submitted time and exact covered account target.',
            'Record account-level outcomes, proof-backed deletions, letter wins, and deterministic next states.',
            'Hold partial Consumer Statements, missing evidence, or unconfirmed switches for manual review.',
          ]) }),
        ]),
      }),
      Object.freeze({
        type: 'checklists',
        heading: 'Weekly',
        groups: Object.freeze([
          Object.freeze({ role: 'Owner / Admin', items: Object.freeze([
            'Review queue aging, blocked authorizations, overdue evidence, unmailed ready letters, and unresolved outcomes.',
            'Audit a sample from 3B classification through packet and result for complete snapshots and least-privilege handling.',
            'Review pending owner/course questions and publish confirmed changes through the source/version protocol.',
          ]) }),
          Object.freeze({ role: 'Method / Template Owner', items: Object.freeze([
            'Review templates approaching the 49-day wording threshold and create new versions without overwriting history.',
            'Check active flow/round/audience/bureau coverage and unresolved required-curly or screenshot-policy failures.',
            'Reconcile any application behavior that conflicts with a higher-authority source before new work proceeds.',
          ]) }),
          Object.freeze({ role: 'Team Lead', items: Object.freeze([
            'Coach from evidence-backed examples: classification holds, strong client stories, exact screenshots, packet QA, and account-level outcomes.',
            'Review repeated errors and update training only through a new controlled SOP version.',
            'Confirm no routine complaint escalation, certified-mail habit, signature step, or retired authorization document has returned to active work.',
          ]) }),
        ]),
      }),
    ]),
  }),
  Object.freeze({
    id: 'pending-decisions',
    navLabel: 'Clarification holds',
    title: 'Owner/course clarification pending',
    summary: 'These direct, restart, and solo decisions are intentionally not filled with assumptions.',
    keywords: Object.freeze(['pending', 'clarification', 'direct', 'restart', 'solo', 'debt verification', 'hold']),
    sourceIds: source('COURSE-GROUP-NOTES', 'CCC-CODE-STATE'),
    blocks: Object.freeze([
      table('Do not improvise', ['Decision', 'Current control', 'Clarification needed'], CCC_SOP_PENDING_DECISIONS.map((item) => [item.decision, item.currentControl, item.needed])),
      callout('red', 'No local workaround', 'When one of these cases appears, preserve the current account state and escalate with the source report, bureau, account kind, prior mailed step, and exact question. Do not choose the next letter from memory.'),
    ]),
  }),
]);

const SOURCE_BY_ID = new Map(CCC_SOP_SOURCES.map((item) => [item.id, item]));

export function sopSourceById(id) {
  return SOURCE_BY_ID.get(id) || null;
}

function searchableText(module) {
  return JSON.stringify(module).replace(/[{}\[\]"]/g, ' ').toLowerCase();
}

export function searchSopModules(query = '') {
  const terms = String(query || '').toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return CCC_SOP_MODULES;
  return CCC_SOP_MODULES.filter((module) => {
    const haystack = searchableText(module);
    return terms.every((term) => haystack.includes(term));
  });
}
