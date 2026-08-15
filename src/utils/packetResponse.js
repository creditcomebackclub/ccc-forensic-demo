import {
  buildNonResponseAnalysis,
  evaluateBureauResponse,
  evaluateFurnisherResponse,
  extractDemandsFromLetterHtml,
} from './deterministicResponse.js';

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function accountRefForCoverage(coverageOrder) {
  return `acct-${Number(coverageOrder)}`;
}

export function extractPacketAccountHtml(html, accountRef) {
  const ref = escapeRegex(accountRef);
  const sections = [...String(html || '').matchAll(new RegExp(
    `<section\\b[^>]*data-account-ref=["']${ref}["'][^>]*>[\\s\\S]*?<\\/section>`, 'gi',
  ))].map((match) => match[0]);
  const rows = [...String(html || '').matchAll(new RegExp(
    `<tr\\b[^>]*data-account-ref=["']${ref}["'][^>]*>[\\s\\S]*?<\\/tr>`, 'gi',
  ))].map((match) => match[0]);
  if (!sections.length && !rows.length) return '';
  return `${sections.join('\n')}<table class="demands-table"><tbody>${rows.join('\n')}</tbody></table>`;
}

function maskedSuffixForRef(html, accountRef) {
  const ref = escapeRegex(accountRef);
  const source = String(html || '');
  const opening = new RegExp(
    `<div\\b[^>]*class=["'][^"']*account-card(?:\\s[^"']*)?["'][^>]*data-account-ref=["']${ref}["'][^>]*>`, 'i',
  ).exec(source);
  if (!opening) return '';
  const afterOpening = source.slice(opening.index + opening[0].length);
  // Account cards contain nested divs, so a non-greedy `</div>` stops before
  // the masked number. The next account-scoped top-level element is a stable
  // boundary regardless of those nested tags.
  const nextScoped = /<(?:div|section)\b[^>]*\bdata-account-ref=["'][^"']+["'][^>]*>/i.exec(afterOpening);
  const cardBody = nextScoped ? afterOpening.slice(0, nextScoped.index) : afterOpening.slice(0, 1600);
  const text = cardBody.replace(/<[^>]+>/g, ' ');
  const masked = text.match(/Masked account:\s*([^\s<]+)/i)?.[1] || '';
  return masked.replace(/[^a-z0-9]/gi, '').slice(-4).toLowerCase();
}

function extractionForAccount(extraction, suffix) {
  const claims = Array.isArray(extraction?.claims) ? extraction.claims : [];
  return {
    ...(extraction || {}),
    // In a multi-account packet an unscoped statement cannot safely resolve
    // any one account. It remains visible in the packet-level extraction but
    // is excluded from account disposition until a suffix ties it down.
    claims: suffix ? claims.filter((claim) => {
      const claimSuffix = String(claim?.accountSuffix || '').replace(/[^a-z0-9]/gi, '').slice(-4).toLowerCase();
      return claimSuffix && claimSuffix === suffix;
    }) : [],
  };
}

function dispositionFor(analysis, kind) {
  const classification = analysis?.classification;
  if (classification === 'NON_RESPONSE') return { disposition: 'no_response', nextAction: 'next_round' };
  if (kind === 'bureau') {
    if (classification === 'DELETED_OR_CORRECTED') return { disposition: 'corrected_deleted', nextAction: 'resolved' };
    if (classification === 'PARTIAL_CORRECTION') return { disposition: 'partial', nextAction: 'next_round' };
    if (classification === 'INSUFFICIENT_EVIDENCE') return { disposition: 'needs_documents', nextAction: 'needs_documents' };
    if (classification === 'VERIFIED_WITHOUT_SUBSTANCE') return { disposition: 'verified', nextAction: 'next_round' };
    return { disposition: 'follow_up_eligible', nextAction: 'next_round' };
  }
  if (classification === 'ADEQUATE') return { disposition: 'verified', nextAction: 'next_round' };
  if (classification === 'PARTIAL_FIX' || classification === 'STATEMENT_COPY') return { disposition: 'partial', nextAction: 'next_round' };
  if (classification === 'INSUFFICIENT_EVIDENCE') return { disposition: 'needs_documents', nextAction: 'needs_documents' };
  return { disposition: 'follow_up_eligible', nextAction: 'next_round' };
}

function citedPages(analysis) {
  const rows = analysis?.issueAnalysis || analysis?.demandAnalysis || [];
  return [...new Set(rows.flatMap((row) => row?.evidenceRefs || [])
    .map((ref) => Number(ref?.page)).filter(Number.isFinite))].sort((a, b) => a - b);
}

export function assessPacketAccount({ letterHtml, coverageOrder, responseKind, extraction, nonResponse = false, metadata = {} }) {
  const accountRef = accountRefForCoverage(coverageOrder);
  const accountHtml = extractPacketAccountHtml(letterHtml, accountRef);
  const demands = extractDemandsFromLetterHtml(accountHtml);
  const scopedExtraction = extractionForAccount(extraction, maskedSuffixForRef(letterHtml, accountRef));
  const analysis = nonResponse
    ? buildNonResponseAnalysis(demands, metadata)
    : responseKind === 'bureau'
      ? evaluateBureauResponse(demands, scopedExtraction)
      : evaluateFurnisherResponse(demands, scopedExtraction);
  const proposed = dispositionFor(analysis, responseKind);
  return {
    accountRef,
    analysis: { ...analysis, accountRef },
    citedPages: citedPages(analysis),
    proposedDisposition: proposed.disposition,
    proposedNextAction: proposed.nextAction,
  };
}
