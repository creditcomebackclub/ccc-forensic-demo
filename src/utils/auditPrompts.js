// Audit prompt builders + report-content assembly, shared between the client
// and the server-side background function. Dependency-light by design: only
// reportText.js (also dependency-free) so Netlify's bundler and the browser
// both consume it unchanged.
import { MAX_REPORT_CHARS, decodeBase64Utf8, htmlToText } from './reportText.js';
import { bureauExtractionPrompt, combinedExtractionPrompt } from '../prompts/extractionPrompts.js';

export const todayLong = () =>
  new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

// Turn an uploaded report (base64 + media type) into message content blocks.
// HTML/text is decoded + stripped locally; PDFs ride as document blocks.
// Throws a user-visible error instead of ever truncating silently.
export function buildReportContent(base64, label, mediaType) {
  if (mediaType && (mediaType.includes('html') || mediaType.includes('text'))) {
    let text = null;
    try {
      text = decodeBase64Utf8(base64);
      if (mediaType.includes('html')) text = htmlToText(text);
    } catch (e) {
      text = null; /* undecodable — fall back to the PDF path below */
    }
    if (text !== null) {
      if (text.length > MAX_REPORT_CHARS) {
        throw new Error(
          'This report is still ' + Math.round(text.length / 1000) + 'k characters of text after cleanup — too large to audit in one pass (limit '
          + Math.round(MAX_REPORT_CHARS / 1000) + 'k). Split it into per-bureau files and use Individual mode, or export a smaller report.'
        );
      }
      return [
        { type: 'text', text: 'CREDIT REPORT CONTENT (HTML/TEXT FORMAT):\n\n' + text },
        { type: 'text', text: label },
      ];
    }
  }
  return [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
    { type: 'text', text: label },
  ];
}

function chunkNoteForAudit(chunkMeta) {
  if (!chunkMeta || chunkMeta.chunkCount <= 1) return '';
  return `\n\nCHUNK NOTE: This PDF is pages ${chunkMeta.startPage}–${chunkMeta.endPage} of ${chunkMeta.totalPages} (part ${chunkMeta.index + 1}/${chunkMeta.chunkCount}). Extract every account, inquiry, and personal-info item visible in THESE pages only. Do not invent content from missing pages. Later chunks will be merged.`;
}

export function combinedAuditPrompt(t, chunkMeta = null) {
  return combinedExtractionPrompt(chunkMeta);
}

export function singleBureauAuditPrompt(t, bureau, chunkMeta = null) {
  return bureauExtractionPrompt(bureau, chunkMeta);
}

export function bureauParsePrompt(t, bureau, chunkMeta = null) {
  return bureauExtractionPrompt(bureau, chunkMeta);
}

export function trimBureau(data) {
  if (!data) return null;
  return {
    bureau: data.bureau,
    client: data.client,
    accounts: (data.accounts || []).map((a) => ({
      furnisher: a.furnisher,
      accountNumber: a.accountNumber,
      status: a.status,
      balance: a.balance,
      pastDue: a.pastDue,
      lastPaymentDate: a.lastPaymentDate,
      dofd: a.dofd,
      paymentHistory: a.paymentHistory,
      accountClassification: a.accountClassification,
      violations: a.violations,
    })),
    inquiries: data.inquiries || [],
    personalInfo: data.personalInfo || { formerAddresses: [], nameVariants: [], formerEmployers: [] },
  };
}

// Second-pass enrichment for the Retention Build 1a diff engine (see
// ACCOUNT_ENRICHMENT_SCHEMA) — re-examines the same report(s) for 4 fields
// per already-identified account, since they didn't fit in the main
// AUDIT_SCHEMA call without dropping inquiries or personalInfo.
export function accountEnrichmentPrompt(t, accounts) {
  const accountList = (accounts || [])
    .map((a) => `- id=${a.id}: ${a.furnisher} ${a.accountNumberMasked || ''}`.trim())
    .join('\n');
  return `ACCOUNT_ENRICHMENT_JSON_MODE\n\nToday is ${t}. You already extracted these accounts from the attached credit report(s):\n\n${accountList}\n\nFor EACH account id listed above, look at the attached report(s) again and extract exactly these 4 fields:\n- paymentRating: current payment status if the report shows one distinct from Account Status, e.g. 'Current' or '90 days late', or null\n- dateOfFirstDelinquency: Field 25 DOFD as YYYY-MM-DD if reported, else null\n- remarks: any remarks/comments text the bureau shows for this account, or null\n- disputeFlag: true if Field 20 (Compliance Condition Code) shows the account as consumer-disputed (e.g. code XB), else false\n\nReturn exactly one entry per account id listed above, using the EXACT same id values — do not invent accounts, do not omit any listed id. JSON only.`;
}

export function mergeAuditPrompt(t, eqData, expData, tuData) {
  return `MODEL MERGE DISABLED. Preserve these bureau extractions as data only; deterministicAudit.js must perform matching and evaluation.\n${JSON.stringify({ equifax: trimBureau(eqData), experian: trimBureau(expData), transunion: trimBureau(tuData) })}`;
}
