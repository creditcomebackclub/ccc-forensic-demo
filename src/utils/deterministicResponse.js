export const DETERMINISTIC_RESPONSE_SCHEMA_VERSION = 'deterministic-response-v1';

const FIELD_LABELS = {
  '8': 'Portfolio Type', '9': 'Account Type', '10': 'Date Opened',
  '15': 'Scheduled Monthly Payment Amount', '17A': 'Account Status',
  '18': 'Payment History Profile', '19': 'Special Comment',
  '20': 'Compliance Condition Code', '21': 'Current Balance',
  '22': 'Amount Past Due', '23': 'Original Charge-off Amount',
  '24': 'Billing Date', '25': 'Date of First Delinquency',
  '26': 'Date Closed', '27': 'Date of Last Payment',
};

const actionWords = /\b(investigate|correct|update|delete|remove|provide|produce|confirm|explain|verify|reinvestigate|report)\b/i;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#39;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function fieldsInText(value) {
  const text = cleanText(value);
  const out = new Set();
  for (const match of text.matchAll(/\bfield\s*(17A|\d{1,2})\b/gi)) out.add(match[1].toUpperCase());
  for (const [number, label] of Object.entries(FIELD_LABELS)) {
    if (new RegExp(`\\b${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) out.add(number);
  }
  if (/\bDOFD\b|date of first delinquency/i.test(text)) out.add('25');
  return [...out];
}

function demandCategory(text) {
  const value = cleanText(text).toLowerCase();
  if (/document|record|agreement|statement|ledger|transaction history|procedure description/.test(value)) return 'DOCUMENTS';
  if (/delete|remove/.test(value)) return 'DELETE';
  if (/correct|update|report/.test(value)) return 'CORRECT';
  if (/explain|identify|describe/.test(value)) return 'EXPLAIN';
  return 'INVESTIGATE';
}

export function extractDeterministicDemands(priorLetterText) {
  const text = cleanText(priorLetterText);
  const segments = text.split(/(?<=[.!?;])\s+|\s+(?=\d+[.)]\s+)/).map(cleanText).filter(Boolean);
  const demands = [];
  const seen = new Set();
  for (const segment of segments) {
    if (!actionWords.test(segment)) continue;
    const normalized = segment.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    demands.push({
      id: `D${String(demands.length + 1).padStart(3, '0')}`,
      text: segment.slice(0, 1000),
      fields: fieldsInText(segment),
      category: demandCategory(segment),
    });
    if (demands.length >= 60) break;
  }
  return demands;
}

export function extractDemandsFromLetterHtml(html) {
  const table = String(html || '').match(/<table\b[^>]*class=["'][^"']*demands-table[^"']*["'][^>]*>([\s\S]*?)<\/table>/i);
  if (!table) return extractDeterministicDemands(decodeHtml(html));
  const demands = [];
  for (const row of table[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)];
    if (cells.length < 2) continue;
    const text = cleanText(decodeHtml(cells[cells.length - 1][1]));
    if (!text) continue;
    demands.push({
      id: `D${String(demands.length + 1).padStart(3, '0')}`,
      text,
      fields: fieldsInText(text),
      category: demandCategory(text),
    });
  }
  return demands.length ? demands : extractDeterministicDemands(decodeHtml(html));
}

function demandList(value) {
  return Array.isArray(value) ? value : extractDeterministicDemands(value);
}

function claimMatchesDemand(claim, demand) {
  if (demand.category === 'DOCUMENTS') return claim.type === 'DOCUMENTS_PROVIDED';
  if (demand.category === 'DELETE') return claim.type === 'DELETION_STATED';
  if (demand.category === 'CORRECT' && !['CORRECTION_STATED', 'DELETION_STATED'].includes(claim.type)) return false;
  if (demand.category === 'EXPLAIN' && claim.type !== 'EXPLANATION_PROVIDED') return false;
  const field = cleanText(claim.fieldNumber).toUpperCase();
  const statement = cleanText(claim.statement).toLowerCase();
  const claimFields = new Set([...(field ? [field] : []), ...fieldsInText(statement)]);
  if (demand.fields.some((number) => claimFields.has(number))) return true;
  if (demand.category === 'CORRECT') return claim.type === 'CORRECTION_STATED' || claim.type === 'DELETION_STATED';
  if (demand.category === 'EXPLAIN') return claim.type === 'EXPLANATION_PROVIDED';
  const important = demand.text.toLowerCase().match(/\b[a-z][a-z-]{5,}\b/g) || [];
  return important.some((word) => statement.includes(word));
}

function evaluateDemand(demand, claims) {
  const matching = claims.filter((claim) => claimMatchesDemand(claim, demand));
  const admitted = matching.find((claim) => claim.type === 'ADMISSION');
  if (admitted) return { outcome: 'ADMITTED', claims: matching };
  const substantive = matching.find((claim) => ['CORRECTION_STATED', 'DELETION_STATED', 'EXPLANATION_PROVIDED'].includes(claim.type));
  if (substantive) return { outcome: 'ADDRESSED', claims: matching };
  if (matching.length || claims.some((claim) => claim.type === 'GENERIC_VERIFICATION')) {
    return { outcome: 'PARTIALLY_ADDRESSED', claims: matching };
  }
  return { outcome: 'IGNORED', claims: [] };
}

function evidenceNote(result) {
  if (!result.claims.length) return 'No extracted response statement matched this demand.';
  const refs = result.claims.map((claim) => `${claim.page ? `p. ${claim.page}: ` : ''}${cleanText(claim.statement)}`);
  return refs.join(' | ').slice(0, 1500);
}

function overallClassification(demandAnalysis, extraction) {
  if (!demandAnalysis.length) return 'INSUFFICIENT_EVIDENCE';
  if (extraction.documentQuality?.enclosureLegible === false) return 'INSUFFICIENT_EVIDENCE';
  const claims = extraction.claims || [];
  if (claims.some((claim) => claim.type === 'CRA_DISPUTE_FRAMEWORK_STATED')) return 'WRONG_FRAMEWORK';
  const outcomes = demandAnalysis.map((row) => row.outcome);
  const addressed = outcomes.filter((value) => value === 'ADDRESSED' || value === 'ADMITTED').length;
  const unresolved = outcomes.filter((value) => value === 'IGNORED' || value === 'PARTIALLY_ADDRESSED').length;
  if (addressed && !unresolved) return 'ADEQUATE';
  if (addressed) return 'PARTIAL_FIX';
  if ((extraction.providedDocumentTypes || []).length || claims.some((claim) => claim.type === 'DOCUMENTS_PROVIDED')) return 'STATEMENT_COPY';
  return 'FORM_LETTER';
}

function summaryFor(classification, demandAnalysis) {
  const counts = demandAnalysis.reduce((out, row) => {
    out[row.outcome] = (out[row.outcome] || 0) + 1;
    return out;
  }, {});
  const prefix = {
    INSUFFICIENT_EVIDENCE: 'The response could not be reliably evaluated because material content was unreadable or incomplete.',
    WRONG_FRAMEWORK: 'The response contains a procedural rejection or request for additional information instead of a merits resolution.',
    ADEQUATE: 'Every extracted demand received a matching substantive response statement.',
    PARTIAL_FIX: 'The response states that it addressed some demands while others remain unmatched or only generically answered.',
    STATEMENT_COPY: 'The response supplied documents but did not contain a matching substantive statement for the identified demands.',
    FORM_LETTER: 'The response did not contain a substantive statement matching the identified demands.',
  }[classification];
  return `${prefix} Deterministic ledger: ${counts.ADDRESSED || 0} addressed, ${counts.ADMITTED || 0} admitted, ${counts.PARTIALLY_ADDRESSED || 0} partial, and ${counts.IGNORED || 0} unmatched.`;
}

export function buildNonResponseAnalysis(priorLetterText, metadata = {}) {
  const demands = demandList(priorLetterText);
  return {
    schemaVersion: DETERMINISTIC_RESPONSE_SCHEMA_VERSION,
    evaluationMode: 'deterministic',
    classification: 'NON_RESPONSE',
    summary: 'No response was recorded within the stored response window. Silence is preserved as evidence but is not treated as an automatic legal violation.',
    demandAnalysis: demands.map((demand) => ({
      demandId: demand.id, demand: demand.text, outcome: 'IGNORED',
      field: demand.fields.length ? `Fields ${demand.fields.join('/')}` : null,
      notes: 'No response was recorded for comparison.', ruleId: 'NO_RESPONSE_DEMAND_UNANSWERED',
    })),
    admissions: [],
    phase3Leverage: 'A reviewed non-response record exists; any later round must use the correct target-specific legal framework and the original supported findings.',
    documentQuality: { enclosureLegible: true, issues: [] },
    extractedEvidence: { kind: 'non_response', ...metadata },
  };
}

export function evaluateFurnisherResponse(priorLetterText, extraction) {
  const demands = demandList(priorLetterText);
  const claims = Array.isArray(extraction?.claims) ? extraction.claims : [];
  const demandAnalysis = demands.map((demand) => {
    const result = evaluateDemand(demand, claims);
    return {
      demandId: demand.id,
      demand: demand.text,
      field: demand.fields.length ? `Fields ${demand.fields.join('/')}` : null,
      outcome: result.outcome,
      notes: evidenceNote(result),
      ruleId: `DEMAND_${result.outcome}`,
      evidenceRefs: result.claims.map((claim) => ({ page: claim.page, statement: claim.statement })),
    };
  });
  const classification = overallClassification(demandAnalysis, extraction);
  return {
    schemaVersion: DETERMINISTIC_RESPONSE_SCHEMA_VERSION,
    evaluationMode: 'deterministic',
    classification,
    summary: summaryFor(classification, demandAnalysis),
    demandAnalysis,
    admissions: claims.filter((claim) => claim.type === 'ADMISSION').map((claim) => claim.statement),
    phase3Leverage: classification === 'ADEQUATE'
      ? 'No unresolved deterministic demand match was identified; staff should verify any claimed correction on a later report.'
      : 'Use only unresolved demand rows and their evidence references after staff review; claimed corrections remain unverified until a later report confirms them.',
    documentQuality: extraction.documentQuality || { enclosureLegible: false, issues: ['Document quality was not extracted.'] },
    extractedEvidence: extraction,
  };
}

export function evaluateBureauResponse(priorLetterText, extraction) {
  const furnisherShape = evaluateFurnisherResponse(priorLetterText, extraction);
  const claims = extraction?.claims || [];
  let classification = 'VERIFIED_WITHOUT_SUBSTANCE';
  if (!furnisherShape.demandAnalysis.length || extraction?.documentQuality?.enclosureLegible === false) classification = 'INSUFFICIENT_EVIDENCE';
  else if (claims.some((claim) => claim.type === 'PROCEDURAL_REJECTION' || claim.type === 'REQUEST_FOR_INFORMATION')) classification = 'PROCEDURAL_OR_STALLED';
  else if (claims.some((claim) => claim.type === 'DELETION_STATED' || claim.type === 'CORRECTION_STATED')) {
    const unresolved = furnisherShape.demandAnalysis.some((row) => ['IGNORED', 'PARTIALLY_ADDRESSED'].includes(row.outcome));
    classification = unresolved ? 'PARTIAL_CORRECTION' : 'DELETED_OR_CORRECTED';
  }
  const reportedChanges = claims
    .filter((claim) => claim.type === 'DELETION_STATED' || claim.type === 'CORRECTION_STATED')
    .map((claim) => `${claim.statement} (claimed action; verify on a later report)`);
  return {
    schemaVersion: DETERMINISTIC_RESPONSE_SCHEMA_VERSION,
    evaluationMode: 'deterministic',
    classification,
    summary: `${furnisherShape.summary} Any deletion or correction is recorded as a claimed action until a later report verifies it.`,
    issueAnalysis: furnisherShape.demandAnalysis.map((row) => ({
      issueId: row.demandId,
      issue: row.demand,
      field: row.field,
      outcome: row.outcome === 'ADMITTED' ? 'ADDRESSED' : row.outcome,
      notes: row.notes,
      ruleId: row.ruleId,
      evidenceRefs: row.evidenceRefs,
    })),
    reportedChanges,
    keyFindings: claims.map((claim) => claim.statement),
    recommendedNextAction: classification === 'INSUFFICIENT_EVIDENCE'
      ? 'needs_documents'
      : (classification === 'DELETED_OR_CORRECTED' ? 'resolved' : 'follow_up'),
    documentQuality: extraction.documentQuality || { enclosureLegible: false, issues: ['Document quality was not extracted.'] },
    extractedEvidence: extraction,
  };
}
