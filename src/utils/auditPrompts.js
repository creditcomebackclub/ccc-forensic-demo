// Audit prompt builders + report-content assembly, shared between the client
// and the server-side background function. Dependency-light by design: only
// reportText.js (also dependency-free) so Netlify's bundler and the browser
// both consume it unchanged.
import { MAX_REPORT_CHARS, decodeBase64Utf8, htmlToText } from './reportText.js';

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

export function combinedAuditPrompt(t) {
  return `AUDIT_JSON_MODE\n\nToday is ${t}. Perform a full forensic Metro 2 and FCRA audit of the attached three-bureau credit report. Return the complete JSON object per the schema in your instructions. Identify every violation. Classify accounts A, B, or C. Rank into Batch 1 top 5 and Batch 2 remaining. Output JSON only. No prose. No code fences.\n\nIMPORTANT — MyFICO TEXT FORMAT PARSING RULES: If this report is in MyFICO plain text format, account data is presented in three columns (Equifax, TransUnion, Experian) separated by spaces. Dashes (–) mean the bureau does not report that field. For Balance fields formatted as "Balance – – $1,234" extract $1,234 as the balance. For fields showing three values like "Balance $1,200 $1,200 $1,234" extract the highest or most recent non-zero value. Never report $0 balance unless ALL three columns explicitly show $0. Account names are often split across multiple lines — reconstruct the full furnisher name from context.`;
}

export function singleBureauAuditPrompt(t, bureau) {
  return `AUDIT_JSON_MODE\n\nToday is ${t}. Bureau: ${bureau} only. Perform a forensic Metro 2 and FCRA audit. No cross-bureau comparisons possible. Return complete JSON per standard schema. JSON only.`;
}

export function bureauParsePrompt(t, bureau) {
  return `BUREAU_AUDIT_JSON_MODE\n\nToday is ${t}. Bureau: ${bureau}.\n\nParse this single-bureau credit report. Extract client info, score, every account, every hard inquiry, and every personal information variant (former addresses, name variants, former employers) shown in the report.\n\nFor accounts, extract: furnisher, account number (masked), type, status, balance, pastDue, lastPaymentDate, dofd, paymentHistory, remarks, Metro 2 violations (field, currentValue, expectedValue, reason), accountClassification (A/B/C).\n\nFor inquiries, extract every hard inquiry listed: furnisher name, date of inquiry, and type if stated (e.g. 'Individual', 'Joint', 'Promotional'). Do not omit any inquiry regardless of age.\n\nFor personal information, extract every former/alternate address, every name variant, and every former employer listed in the report's personal information or 'also known as' section.\n\nOutput JSON only:\n{"bureau":"${bureau}","client":{"name":"","address":"","score":0},"accounts":[{"furnisher":"","accountNumber":"","type":"","status":"","balance":0,"pastDue":0,"lastPaymentDate":"","dofd":"","paymentHistory":"","accountClassification":"A","violations":[{"field":"","currentValue":"","expectedValue":"","reason":""}]}],"inquiries":[{"furnisher":"","date":"","type":""}],"personalInfo":{"formerAddresses":[""],"nameVariants":[""],"formerEmployers":[""]}}`;
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
  };
}

export function mergeAuditPrompt(t, eqData, expData, tuData) {
  return `MERGE_AUDIT_JSON_MODE\n\nToday is ${t}.\n\nMerge these three bureau reports into a unified forensic audit. Match accounts across bureaus. Identify cross-bureau violations. Classify each account A/B/C. Rank top 5 as Batch 1, rest as Batch 2. Return complete audit JSON.\n\nData:\n${JSON.stringify({ equifax: trimBureau(eqData), experian: trimBureau(expData), transunion: trimBureau(tuData) }, null, 2)}\n\nJSON only.`;
}
