import { getLetterContentSystemPrompt } from '../../src/prompts/letterPrompt.js';
import { buildPriorRoundEvidenceDigest } from '../../src/utils/roundEvidence.js';
import { extractPacketAccountHtml } from '../../src/utils/packetResponse.js';
import { normalizeFurnisher } from '../../src/utils/diffEngine.js';

const BUREAU_LABEL = { equifax: 'Equifax', experian: 'Experian', transunion: 'TransUnion' };
const STYLE = {
  forensic: 'Use the established forensic strategy. Preserve every supported Metro 2/FCRA issue and omit unsupported claims.',
  metro2_accuracy: 'Emphasize supported Metro 2 data-integrity conflicts and recipient-specific FCRA duties.',
  direct_furnisher: 'Use a direct-furnisher dispute strategy under Regulation V and the correct direct-dispute provisions.',
  debt_validation: 'Use a standalone FDCPA debt-validation strategy only where the stored dispute basis is FDCPA.',
  procedural_request: 'Focus on the documented investigation procedure and unresolved evidence without overstating document-production rights.',
  custom: 'Apply the stored staff strategy only where supported by the audit and reviewed evidence.',
};

function safeText(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

async function loadAggressiveness(db) {
  try {
    const { data } = await db.storage.from('client-docs').download('admin/settings.json');
    const value = data ? JSON.parse(await data.text())?.disputes?.defaultAggressiveness : null;
    return value === 'Standard' ? 'Standard' : 'Aggressive';
  } catch (_) {
    return 'Aggressive';
  }
}

async function latestAuditAccount(db, letter) {
  if (!letter.client_id || !letter.client_account_id) return null;
  const { data, error } = await db.from('audits')
    .select('audit')
    .eq('user_id', letter.user_id)
    .eq('client_id', letter.client_id)
    .order('saved_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0]?.audit?.accounts?.find((item) => item.clientAccountId === letter.client_account_id) || null;
}

async function loadAccount(db, letter) {
  let account = null;
  if (letter.campaign_item_id) {
    const { data, error } = await db.from('campaign_items')
      .select('snapshot,item_kind,client_account_id,user_id,client_id,campaign_id')
      .eq('id', letter.campaign_item_id)
      .maybeSingle();
    if (error) throw error;
    if (data && (data.user_id !== letter.user_id || data.client_id !== letter.client_id
        || data.client_account_id !== letter.client_account_id || data.campaign_id !== letter.campaign_id)) {
      throw new Error('The linked campaign item does not belong to this letter.');
    }
    if (data?.item_kind === 'account') account = data.snapshot || null;
  }
  account ||= await latestAuditAccount(db, letter);
  account ||= letter.generation_context?.accountSnapshot || null;
  if (!account && letter.letter_kind !== 'personal_info_cleanup' && letter.generation_context?.kind !== 'cleanup') {
    throw new Error('The linked account is not present in the current audit. Reconcile it before regenerating.');
  }
  account ||= {
    furnisher: letter.furnisher,
    accountNumberMasked: letter.account_id,
    violations: [],
  };

  if (!account.furnisherAddress && letter.target_type === 'furnisher') {
    const key = normalizeFurnisher(account.furnisher || letter.furnisher);
    const { data } = await db.from('furnisher_addresses')
      .select('display_name,address_line1,address_line2,city,state,zip')
      .eq('user_id', letter.user_id)
      .eq('furnisher_key', key)
      .maybeSingle();
    if (data) account = {
      ...account,
      furnisherAddress: {
        name: data.display_name,
        line1: data.address_line1,
        line2: data.address_line2,
        city: data.city,
        state: data.state,
        zip: data.zip,
      },
    };
  }
  return account;
}

async function loadCoveredAccounts(db, letter) {
  if (Number(letter.packet_version || 1) !== 2) {
    const account = await loadAccount(db, letter);
    return [{
      accountRef: 'account-1', account, campaignItemId: letter.campaign_item_id,
      clientAccountId: letter.client_account_id, disputeRoundId: letter.round_id,
      roundNumber: letter.round_number || 1,
    }];
  }
  const { data: coverage, error } = await db.from('letter_account_coverage')
    .select('id,user_id,client_id,campaign_id,campaign_route_id,campaign_item_id,client_account_id,dispute_round_id,coverage_order,frozen_findings,expected_recipient')
    .eq('letter_id', letter.id).order('coverage_order');
  if (error) throw error;
  if (!coverage?.length || coverage.length > 5) throw new Error('The packet has invalid account coverage.');
  const itemIds = coverage.map((entry) => entry.campaign_item_id);
  const roundIds = coverage.map((entry) => entry.dispute_round_id);
  const [{ data: items, error: itemError }, { data: rounds, error: roundError }] = await Promise.all([
    db.from('campaign_items').select('id,user_id,client_id,campaign_id,client_account_id,item_kind,snapshot').in('id', itemIds),
    db.from('dispute_rounds').select('id,client_account_id,round_number,target_type,campaign_id').in('id', roundIds),
  ]);
  if (itemError || roundError) throw itemError || roundError;
  const itemById = new Map((items || []).map((item) => [item.id, item]));
  const roundById = new Map((rounds || []).map((round) => [round.id, round]));
  return coverage.map((entry, index) => {
    const item = itemById.get(entry.campaign_item_id);
    const round = roundById.get(entry.dispute_round_id);
    if (entry.user_id !== letter.user_id || entry.client_id !== letter.client_id
        || entry.campaign_id !== letter.campaign_id || entry.campaign_route_id !== letter.campaign_route_id
        || !item || item.item_kind !== 'account' || item.client_account_id !== entry.client_account_id
        || item.campaign_id !== letter.campaign_id || item.user_id !== letter.user_id
        || !round || round.client_account_id !== entry.client_account_id
        || round.campaign_id !== letter.campaign_id || round.target_type !== letter.target_type) {
      throw new Error('The packet coverage does not match its frozen campaign account and round.');
    }
    const account = {
      ...(item.snapshot || {}),
      findings: entry.frozen_findings || [],
      violations: (entry.frozen_findings || []).filter((finding) => finding?.outcome === 'FLAG'),
    };
    return {
      accountRef: `acct-${index + 1}`,
      coverageId: entry.id,
      campaignItemId: entry.campaign_item_id,
      clientAccountId: entry.client_account_id,
      disputeRoundId: entry.dispute_round_id,
      roundNumber: round.round_number,
      expectedRecipient: entry.expected_recipient,
      account,
    };
  });
}

async function loadPriorEvidence(db, letter, coveredAccounts) {
  const { data: links, error } = await db.from('letter_source_links')
    .select('source_letter_id,response_evidence_id,source_order,campaign_item_ids')
    .eq('letter_id', letter.id)
    .order('source_order');
  if (error) throw error;
  const byRef = new Map(coveredAccounts.map((entry) => [entry.accountRef, []]));
  for (const link of links || []) {
    const [{ data: source, error: sourceError }, { data: evidence, error: evidenceError }] = await Promise.all([
      db.from('letters').select('id,user_id,client_id,client_account_id,target_type,html,summary,mailed_date,packet_version').eq('id', link.source_letter_id).maybeSingle(),
      db.from('response_evidence').select('id,firm_user_id,client_id,letter_id,evidence_kind,analysis,analysis_status,review_status').eq('id', link.response_evidence_id).maybeSingle(),
    ]);
    if (sourceError || evidenceError) throw sourceError || evidenceError;
    if (!source || source.user_id !== letter.user_id || source.client_id !== letter.client_id || !source.mailed_date
        || !evidence || evidence.firm_user_id !== letter.user_id || evidence.client_id !== letter.client_id
        || evidence.letter_id !== source.id
        || evidence.analysis_status !== 'analyzed' || evidence.review_status === 'not_reviewed') {
      throw new Error('A selected prior source is not mailed, analyzed, and reviewed.');
    }
    const scopedItems = new Set(link.campaign_item_ids || []);
    const sourceCoverageResult = await db.from('letter_account_coverage')
      .select('id,client_account_id,coverage_order').eq('letter_id', source.id);
    if (sourceCoverageResult.error && !/letter_account_coverage/i.test(sourceCoverageResult.error.message || '')) throw sourceCoverageResult.error;
    const sourceAccountIds = new Set((sourceCoverageResult.data || []).map((entry) => entry.client_account_id));
    if (source.client_account_id) sourceAccountIds.add(source.client_account_id);
    const coverageById = new Map((sourceCoverageResult.data || []).map((entry) => [entry.id, entry]));
    const assessmentByAccount = new Map();
    if (Number(source.packet_version || 1) === 2) {
      const { data: assessments, error: assessmentError } = await db.from('response_evidence_account_assessment')
        .select('coverage_id,client_account_id,analysis,cited_pages,review_status,next_action')
        .eq('response_evidence_id', evidence.id);
      if (assessmentError) throw assessmentError;
      for (const assessment of assessments || []) {
        const sourceCoverage = coverageById.get(assessment.coverage_id);
        if (sourceCoverage?.client_account_id === assessment.client_account_id) {
          assessmentByAccount.set(assessment.client_account_id, assessment);
        }
      }
    }
    for (const covered of coveredAccounts) {
      if (Number(letter.packet_version || 1) === 2 && !scopedItems.has(covered.campaignItemId)) continue;
      if (!sourceAccountIds.has(covered.clientAccountId)) throw new Error('Prior evidence is scoped to the wrong covered account.');
      const accountAssessment = Number(source.packet_version || 1) === 2
        ? assessmentByAccount.get(covered.clientAccountId) : null;
      if (Number(source.packet_version || 1) === 2 && (
        accountAssessment?.review_status !== 'reviewed'
        || !['next_round', 'escalate'].includes(accountAssessment?.next_action)
      )) {
        throw new Error('Packet prior evidence is not reviewed and follow-up eligible for this covered account.');
      }
      const sourceCoverage = Number(source.packet_version || 1) === 2
        ? (sourceCoverageResult.data || []).find((entry) => entry.client_account_id === covered.clientAccountId)
        : null;
      const scopedPriorLetterHtml = sourceCoverage
        ? extractPacketAccountHtml(source.html, `acct-${sourceCoverage.coverage_order}`)
        : source.html;
      if (Number(source.packet_version || 1) === 2 && !scopedPriorLetterHtml) {
        throw new Error('Packet prior evidence is missing its account-scoped letter section.');
      }
      byRef.get(covered.accountRef).push(buildPriorRoundEvidenceDigest({
        priorTargetType: source.target_type || 'furnisher',
        nextTargetType: letter.target_type,
        priorLetterHtml: scopedPriorLetterHtml,
        priorLetterSummary: source.summary,
        analysis: accountAssessment
          ? { ...(accountAssessment.analysis || {}), accountCitedPages: accountAssessment.cited_pages || [] }
          : evidence.analysis,
        evidenceKind: evidence.evidence_kind,
      }));
    }
  }
  for (const covered of coveredAccounts) {
    if (Number(covered.roundNumber || 1) > 1 && !byRef.get(covered.accountRef)?.length) {
      throw new Error(`Later-round packet account ${covered.accountRef} requires reviewed prior-letter evidence.`);
    }
  }
  return byRef;
}

function cleanupEvidence(context) {
  return {
    personalInfo: context?.personalInfo || null,
    inquiries: Array.isArray(context?.inquiries) ? context.inquiries.slice(0, 40) : [],
    keepOnFile: context?.keepOnFile || null,
  };
}

function enclosureManifest(letter, priorEvidence) {
  if (letter.letter_kind === 'personal_info_cleanup' || letter.generation_context?.kind === 'cleanup') {
    return ['Government-Issued Photo ID', 'Proof of Current Address'];
  }
  if (priorEvidence.length) {
    return ['Exhibit A: Prior Dispute Letter', 'Exhibit B: Reviewed Response Evidence', 'Exhibit C: Limited Power of Attorney'];
  }
  return ['Government-Issued Photo ID', 'Proof of Current Address', 'Limited Power of Attorney'];
}

export async function buildStoredLetterContext(db, letter) {
  const [{ data: client, error: clientError }, coveredAccounts, aggressiveness] = await Promise.all([
    db.from('clients').select('id,user_id,name,address,date_of_birth,current_employer,lpoa_signature_data').eq('id', letter.client_id).maybeSingle(),
    loadCoveredAccounts(db, letter),
    loadAggressiveness(db),
  ]);
  if (clientError) throw clientError;
  if (!client || client.user_id !== letter.user_id) throw new Error('The letter client could not be verified.');
  const priorEvidenceByRef = await loadPriorEvidence(db, letter, coveredAccounts);
  const priorEvidence = [...priorEvidenceByRef.values()].flat();
  const account = coveredAccounts[0].account;

  let route = null;
  if (letter.campaign_route_id) {
    const { data, error } = await db.from('campaign_letter_routes')
      .select('letter_style,custom_instructions,target_type,target_bureau,user_id,client_id,campaign_id,item_id,item_ids,dispute_basis,recipient_key')
      .eq('id', letter.campaign_route_id)
      .maybeSingle();
    if (error) throw error;
    if (data && (data.user_id !== letter.user_id || data.client_id !== letter.client_id
        || data.campaign_id !== letter.campaign_id || data.item_id !== letter.campaign_item_id
        || data.target_type !== letter.target_type || data.target_bureau !== letter.target_bureau
        || (Number(letter.packet_version || 1) === 2 && data.dispute_basis !== letter.dispute_basis))) {
      throw new Error('The linked campaign route does not belong to this letter.');
    }
    if (data && Number(letter.packet_version || 1) === 2) {
      const expectedItems = new Set(coveredAccounts.map((entry) => entry.campaignItemId));
      const routeItems = new Set(data.item_ids?.length ? data.item_ids : [data.item_id]);
      if (expectedItems.size !== routeItems.size || [...expectedItems].some((id) => !routeItems.has(id))) {
        throw new Error('The reviewed packet route no longer matches its coverage records.');
      }
    }
    route = data;
  }
  const target = letter.target_type === 'bureau'
    ? BUREAU_LABEL[String(letter.target_bureau || '').toLowerCase()]
    : account.furnisher || letter.furnisher;
  if (!target) throw new Error('The stored letter has no verified recipient.');

  const contextKind = letter.generation_context?.kind || (letter.letter_kind === 'personal_info_cleanup' ? 'cleanup' : 'account_dispute');
  const style = route?.letter_style || letter.generation_style || 'forensic';
  const staffInstructions = safeText(route?.custom_instructions || letter.generation_context?.staffInstructions);
  const evidenceAccounts = coveredAccounts.map((covered) => ({
    accountRef: covered.accountRef,
    furnisher: covered.account.furnisher,
    originalCreditor: covered.account.originalCreditor || null,
    accountNumberMasked: covered.account.accountNumberMasked || null,
    type: covered.account.type || null,
    status: covered.account.status || null,
    balance: covered.account.balance ?? null,
    bureaus: covered.account.bureaus || [],
    deterministicFindings: (covered.account.findings || [])
      .filter((finding) => finding.outcome === 'FLAG')
      .map((finding) => ({
        ruleId: finding.ruleId, field: finding.field, issue: finding.issue,
        currentlyReports: finding.currentlyReports, shouldReport: finding.shouldReport,
        source: finding.source, evidenceRefs: finding.evidenceRefs || [],
      })),
    strategy: covered.account.strategy || null,
    priorEvidence: priorEvidenceByRef.get(covered.accountRef) || [],
  }));
  const packetMode = Number(letter.packet_version || 1) === 2;
  const evidence = contextKind === 'cleanup'
    ? cleanupEvidence(letter.generation_context)
    : packetMode ? { accounts: evidenceAccounts } : {
      account: {
        furnisher: account.furnisher,
        originalCreditor: account.originalCreditor || null,
        accountNumberMasked: account.accountNumberMasked || letter.account_id,
        type: account.type || letter.type || null,
        status: account.status || null,
        balance: account.balance ?? null,
        bureaus: account.bureaus || [],
        primaryViolation: account.primaryViolation || null,
        violations: (account.violations || []).filter((finding) => !finding.outcome || finding.outcome === 'FLAG'),
        deterministicFindings: (account.findings || [])
          .filter((finding) => finding.outcome === 'FLAG')
          .map((finding) => ({
            ruleId: finding.ruleId,
            field: finding.field,
            issue: finding.issue,
            currentlyReports: finding.currentlyReports,
            shouldReport: finding.shouldReport,
            source: finding.source,
            evidenceRefs: finding.evidenceRefs || [],
          })),
        strategy: account.strategy || null,
      },
      priorEvidence: priorEvidenceByRef.get(coveredAccounts[0].accountRef) || [],
    };
  const purpose = contextKind === 'cleanup'
    ? 'Draft only a CRA personal-information and selected-inquiry reinvestigation demand. Do not dispute any tradeline, balance, or payment history. Cite §1681e(b), §1681i, and §1681b only where supported; never claim fraud or no authorization unless explicitly recorded.'
    : letter.dispute_basis === 'FDCPA'
    ? 'Draft only the standalone FDCPA debt-validation sibling.'
    : letter.target_type === 'bureau'
      ? `Draft only one CRA dispute packet to ${target} under the correct §1681i framework${packetMode ? ` covering exactly ${coveredAccounts.length} separately identified accounts` : ''}.`
      : 'Draft only the direct furnisher dispute under Regulation V and the applicable FCRA provisions.';
  const prompt = `Today is ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
Letter ID: ${letter.id}
Round: ${letter.round_number || 1}
Recipient type: ${letter.target_type}
Explicit recipient: ${target}
Purpose: ${purpose}
Strategy: ${STYLE[style] || STYLE.forensic}${staffInstructions ? `\nStored staff strategy: ${staffInstructions}` : ''}

Authoritative server-loaded evidence:
${JSON.stringify(evidence, null, 2)}

Use only the authoritative evidence above. When deterministicFindings is present, it is the complete authorized issue set: do not create, delete, reclassify, prioritize, or correct a finding.${packetMode ? ` This is one authorized consolidated packet. The accounts[] references are opaque and mandatory: create distinct sections for every accountRef, keep every factual claim and Metro 2 citation inside that account's sections, and prefix every demand with its exact [accountRef]. Do not move facts, fields, amounts, dates, account numbers, or prior evidence between accounts.` : ''} Produce the structured content object now.`;

  const baseSystem = contextKind === 'cleanup'
    ? `You draft a concise, factual consumer-reporting-agency dispute concerning only the supplied inaccurate personal information and selected inquiry entries. Preserve each supplied inquiry category. A no-linked-account category means the file shows no linked tradeline; it does not prove the inquiry was unauthorized. A duplicate requires verification that each access was distinct; duplication alone does not prove lack of permissible purpose. A stale entry requires verification of its date, type, and accuracy; do not invent a universal two-year deletion rule. Consumer disclosure and monitoring entries must be framed as classification-verification requests. Do not dispute tradelines, allege identity theft, or invent facts.\n\n${getLetterContentSystemPrompt(aggressiveness, 'bureau', null)}`
    : getLetterContentSystemPrompt(aggressiveness, letter.target_type, letter.dispute_basis);
  const packetOverride = packetMode
    ? '\n\n# SERVER-AUTHORIZED CONSOLIDATED PACKET OVERRIDE\nThis request is the explicit exception to any earlier instruction prohibiting grouped accounts. Grouping is authorized only for the supplied accounts[] and recipient. Do not introduce any other account. Every section and every demand must retain its exact accountRef as instructed.'
    : '';

  return {
    client,
    account,
    accounts: coveredAccounts,
    priorEvidence,
    enclosures: enclosureManifest(letter, priorEvidence),
    aggressiveness,
    system: [{
      type: 'text',
      text: baseSystem + packetOverride,
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{ role: 'user', content: prompt }],
  };
}
