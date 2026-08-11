import { getLetterContentSystemPrompt } from '../../src/prompts/letterPrompt.js';
import { buildPriorRoundEvidenceDigest } from '../../src/utils/roundEvidence.js';
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

async function loadPriorEvidence(db, letter) {
  const { data: links, error } = await db.from('letter_source_links')
    .select('source_letter_id,response_evidence_id,source_order')
    .eq('letter_id', letter.id)
    .order('source_order');
  if (error) throw error;
  if (Number(letter.round_number || 1) > 1 && !links?.length) {
    throw new Error('A later-round letter requires reviewed prior-letter evidence.');
  }
  const digests = [];
  for (const link of links || []) {
    const [{ data: source, error: sourceError }, { data: evidence, error: evidenceError }] = await Promise.all([
      db.from('letters').select('id,user_id,client_id,client_account_id,target_type,html,summary,mailed_date').eq('id', link.source_letter_id).maybeSingle(),
      db.from('response_evidence').select('id,firm_user_id,client_id,letter_id,evidence_kind,analysis,analysis_status,review_status').eq('id', link.response_evidence_id).maybeSingle(),
    ]);
    if (sourceError || evidenceError) throw sourceError || evidenceError;
    if (!source || source.user_id !== letter.user_id || source.client_id !== letter.client_id
        || source.client_account_id !== letter.client_account_id || !source.mailed_date
        || !evidence || evidence.firm_user_id !== letter.user_id || evidence.client_id !== letter.client_id
        || evidence.letter_id !== source.id
        || evidence.analysis_status !== 'analyzed' || evidence.review_status === 'not_reviewed') {
      throw new Error('A selected prior source is not mailed, analyzed, and reviewed.');
    }
    digests.push(buildPriorRoundEvidenceDigest({
      priorTargetType: source.target_type || 'furnisher',
      nextTargetType: letter.target_type,
      priorLetterHtml: source.html,
      priorLetterSummary: source.summary,
      analysis: evidence.analysis,
      evidenceKind: evidence.evidence_kind,
    }));
  }
  return digests;
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
  const [{ data: client, error: clientError }, account, priorEvidence, aggressiveness] = await Promise.all([
    db.from('clients').select('id,user_id,name,address,date_of_birth,current_employer,lpoa_signature_data').eq('id', letter.client_id).maybeSingle(),
    loadAccount(db, letter),
    loadPriorEvidence(db, letter),
    loadAggressiveness(db),
  ]);
  if (clientError) throw clientError;
  if (!client || client.user_id !== letter.user_id) throw new Error('The letter client could not be verified.');

  let route = null;
  if (letter.campaign_route_id) {
    const { data, error } = await db.from('campaign_letter_routes')
      .select('letter_style,custom_instructions,target_type,target_bureau,user_id,client_id,campaign_id,item_id')
      .eq('id', letter.campaign_route_id)
      .maybeSingle();
    if (error) throw error;
    if (data && (data.user_id !== letter.user_id || data.client_id !== letter.client_id
        || data.campaign_id !== letter.campaign_id || data.item_id !== letter.campaign_item_id
        || data.target_type !== letter.target_type || data.target_bureau !== letter.target_bureau)) {
      throw new Error('The linked campaign route does not belong to this letter.');
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
  const evidence = contextKind === 'cleanup'
    ? cleanupEvidence(letter.generation_context)
    : {
      account: {
        furnisher: account.furnisher,
        originalCreditor: account.originalCreditor || null,
        accountNumberMasked: account.accountNumberMasked || letter.account_id,
        type: account.type || letter.type || null,
        status: account.status || null,
        balance: account.balance ?? null,
        bureaus: account.bureaus || [],
        primaryViolation: account.primaryViolation || null,
        violations: account.violations || [],
        strategy: account.strategy || null,
      },
      priorEvidence,
    };
  const purpose = contextKind === 'cleanup'
    ? 'Draft only a CRA personal-information and selected-inquiry reinvestigation demand. Do not dispute any tradeline, balance, or payment history. Cite §1681e(b), §1681i, and §1681b only where supported; never claim fraud or no authorization unless explicitly recorded.'
    : letter.dispute_basis === 'FDCPA'
    ? 'Draft only the standalone FDCPA debt-validation sibling.'
    : letter.target_type === 'bureau'
      ? `Draft only one CRA dispute to ${target} under the correct §1681i framework.`
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

Use only the authoritative evidence above. Produce the structured content object now.`;

  return {
    client,
    account,
    priorEvidence,
    enclosures: enclosureManifest(letter, priorEvidence),
    aggressiveness,
    system: [{
      type: 'text',
      text: contextKind === 'cleanup'
        ? `You draft a concise, factual consumer-reporting-agency dispute concerning only the supplied inaccurate personal information and selected inquiry entries. Preserve each supplied inquiry category. A no-linked-account category means the file shows no linked tradeline; it does not prove the inquiry was unauthorized. A duplicate requires verification that each access was distinct; duplication alone does not prove lack of permissible purpose. A stale entry requires verification of its date, type, and accuracy; do not invent a universal two-year deletion rule. Consumer disclosure and monitoring entries must be framed as classification-verification requests. Do not dispute tradelines, allege identity theft, or invent facts.\n\n${getLetterContentSystemPrompt(aggressiveness, 'bureau', null)}`
        : getLetterContentSystemPrompt(aggressiveness, letter.target_type, letter.dispute_basis),
      cache_control: { type: 'ephemeral' },
    }],
    messages: [{ role: 'user', content: prompt }],
  };
}
