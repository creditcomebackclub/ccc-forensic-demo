import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { buildRecoveryBlueprintModel, recoveryBlueprintFilename } from './recoveryBlueprintModel.js';

const C = {
  ink: [10, 15, 24],
  blue: [14, 165, 233],
  blueDark: [3, 105, 161],
  bluePale: [224, 242, 254],
  blueWash: [245, 251, 255],
  slate: [71, 85, 105],
  faint: [148, 163, 184],
  line: [203, 213, 225],
  white: [255, 255, 255],
};

const PAGE_W = 612;
const PAGE_H = 792;
const M = 46;

function setText(doc, color) {
  doc.setTextColor(...color);
}

function setFill(doc, color) {
  doc.setFillColor(...color);
}

function addBase(doc, eyebrow, title, subtitle = '') {
  setFill(doc, C.white);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  setFill(doc, C.bluePale);
  doc.rect(0, 0, PAGE_W, 12, 'F');
  setText(doc, C.blueDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(eyebrow.toUpperCase(), M, 52);
  setText(doc, C.ink);
  doc.setFontSize(24);
  doc.text(title, M, 88);
  if (subtitle) {
    setText(doc, C.slate);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(doc.splitTextToSize(subtitle, PAGE_W - (M * 2)), M, 111, { lineHeightFactor: 1.4 });
  }
}

function metricCard(doc, x, y, width, value, label) {
  setFill(doc, C.blueWash);
  doc.setDrawColor(...C.line);
  doc.roundedRect(x, y, width, 78, 8, 8, 'FD');
  setText(doc, C.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text(String(value), x + 14, y + 34);
  setText(doc, C.slate);
  doc.setFontSize(7);
  doc.text(label.toUpperCase(), x + 14, y + 56);
}

function scoreCard(doc, x, label, score) {
  setFill(doc, C.white);
  doc.setDrawColor(...C.line);
  doc.roundedRect(x, 330, 154, 92, 9, 9, 'FD');
  setText(doc, C.slate);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text(label.toUpperCase(), x + 77, 356, { align: 'center' });
  setText(doc, C.ink);
  doc.setFontSize(25);
  doc.text(score === null ? '-' : String(score), x + 77, 392, { align: 'center' });
}

function displayBalance(value) {
  return value === null ? 'Not extracted' : `$${Math.round(value).toLocaleString('en-US')}`;
}

function addCover(doc, model) {
  setFill(doc, C.white);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  setFill(doc, C.bluePale);
  doc.rect(0, 0, PAGE_W, 178, 'F');
  setFill(doc, C.blue);
  doc.rect(0, 0, 14, PAGE_H, 'F');

  setText(doc, C.blueDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('CREDIT COMEBACK CLUB', M, 58);
  setText(doc, C.slate);
  doc.setFontSize(7);
  doc.text('PRIVATE CLIENT RECOVERY BLUEPRINT', M, 76);

  setText(doc, C.ink);
  doc.setFontSize(31);
  const nameLines = doc.splitTextToSize(model.client.name, PAGE_W - (M * 2));
  doc.text(nameLines, M, 226, { lineHeightFactor: 1.1 });
  const titleY = 226 + nameLines.length * 35;
  setText(doc, C.blueDark);
  doc.setFontSize(22);
  doc.text('Your confirmed opening plan', M, titleY + 20);
  setText(doc, C.slate);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('Built from the saved three-bureau report review and deterministic CCC routing rules.', M, titleY + 48);

  scoreCard(doc, M, 'Equifax', model.scores.equifax);
  scoreCard(doc, M + 174, 'Experian', model.scores.experian);
  scoreCard(doc, M + 348, 'TransUnion', model.scores.transunion);

  setFill(doc, C.blueWash);
  doc.roundedRect(M, 458, PAGE_W - (M * 2), 122, 9, 9, 'F');
  setText(doc, C.blueDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('WHAT THIS DOCUMENT IS', M + 18, 486);
  setText(doc, C.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(doc.splitTextToSize(model.executiveSummary, PAGE_W - (M * 2) - 36), M + 18, 512, { lineHeightFactor: 1.45 });

  setText(doc, C.slate);
  doc.setFontSize(8);
  doc.text(`Report date  ${model.client.reportDateLabel}`, M, 674);
  doc.text(`Classification review  v${model.provenance.classificationReviewVersion}`, M, 692);
  doc.text(`Method  ${model.provenance.classificationMethodVersion}`, M, 710);
}

function addSnapshot(doc, model) {
  doc.addPage();
  addBase(doc, '01 · Confirmed file snapshot', 'What the reviewed report contains', 'Counts below come from the saved audit and confirmed routing review. Missing data stays labeled as missing.');
  const w = (PAGE_W - (M * 2) - 30) / 3;
  metricCard(doc, M, 157, w, model.metrics.accountsReviewed, 'Accounts reviewed');
  metricCard(doc, M + w + 15, 157, w, model.metrics.disputeEligibleAccounts, 'Routed accounts');
  metricCard(doc, M + (w + 15) * 2, 157, w, model.metrics.recommendedLetters, 'Opening letters');
  metricCard(doc, M, 255, w, model.metrics.routedAccountBureauPairs, 'Account/bureau routes');
  metricCard(doc, M + w + 15, 255, w, model.metrics.documentedFindings, 'Documented findings');
  metricCard(doc, M + (w + 15) * 2, 255, w, model.reportCoverage.complete ? '3 of 3' : 'Incomplete', '3B coverage');

  setFill(doc, C.bluePale);
  doc.roundedRect(M, 382, PAGE_W - (M * 2), 108, 8, 8, 'F');
  setText(doc, C.blueDark);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('SCORE OBSERVATION', M + 18, 410);
  setText(doc, C.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  const observation = model.scoreObservation
    ? `${model.scoreObservation.high.bureau} is ${model.scoreObservation.high.score}; ${model.scoreObservation.low.bureau} is ${model.scoreObservation.low.score}. The observed spread is ${model.scoreObservation.points} points.`
    : 'Fewer than two bureau scores were extracted, so no cross-bureau score comparison is shown.';
  doc.text(doc.splitTextToSize(observation, PAGE_W - (M * 2) - 36), M + 18, 438, { lineHeightFactor: 1.45 });

  setText(doc, C.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Coverage check', M, 544);
  setText(doc, C.slate);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Equifax reports: ${model.reportCoverage.counts.EQ}`, M, 570);
  doc.text(`Experian reports: ${model.reportCoverage.counts.EXP}`, M, 590);
  doc.text(`TransUnion reports: ${model.reportCoverage.counts.TU}`, M, 610);
}

function addR1Plan(doc, model) {
  doc.addPage();
  addBase(doc, '02 · Deterministic R1 routing', 'Exactly where this file starts', 'Each row is a separate recommended letter. CCC does not merge independent recommendations or let AI choose the flow.');
  autoTable(doc, {
    startY: 153,
    margin: { left: M, right: M, bottom: 60 },
    head: [['Bureau', 'Letter', 'Fixed opening law', 'Accounts']],
    body: model.recommendations.map((recommendation) => [
      recommendation.bureauName,
      `${recommendation.flowLabel} R${recommendation.round}`,
      recommendation.law,
      recommendation.accounts.map((account) => `${account.furnisher} ${account.accountNumberMasked}`).join('\n'),
    ]),
    theme: 'grid',
    headStyles: { fillColor: C.ink, textColor: C.white, fontSize: 7.5, cellPadding: 7 },
    bodyStyles: { textColor: C.ink, fontSize: 7.5, cellPadding: 7, lineColor: C.line, valign: 'top' },
    alternateRowStyles: { fillColor: C.blueWash },
    columnStyles: {
      0: { cellWidth: 68, fontStyle: 'bold' },
      1: { cellWidth: 100, fontStyle: 'bold', textColor: C.blueDark },
      2: { cellWidth: 156 },
      3: { cellWidth: 196 },
    },
  });
}

function accountRoutes(model, clientAccountId) {
  return model.recommendations
    .filter((recommendation) => recommendation.accountIds.includes(clientAccountId))
    .map((recommendation) => `${recommendation.bureauCode}: ${recommendation.flowLabel} R${recommendation.round}`)
    .join('\n');
}

function evidencePages(account) {
  const labels = [];
  for (const item of account.evidence || []) {
    if (!item.page) continue;
    const label = `${item.bureauCode || 'Report'} p.${item.page}`;
    if (!labels.includes(label)) labels.push(label);
  }
  return labels.length ? labels.join(', ') : 'No page citation saved';
}

function addAccounts(doc, model) {
  doc.addPage();
  addBase(doc, '03 · Account reconciliation', 'Every routed account, tied to its exact IDs', 'The masked number and report facts are displayed as extracted. Canonical IDs prevent one account from silently becoming another between rounds.');
  autoTable(doc, {
    startY: 153,
    margin: { left: M, right: M, bottom: 60 },
    head: [['Account', 'Report facts', 'Confirmed routes', 'Canonical account ID']],
    body: model.routedAccounts.map((account) => [
      `${account.furnisher}\n${account.accountNumberMasked}`,
      `${account.accountKind.replaceAll('_', ' ')}\n${account.status}\n${displayBalance(account.balance)}\n${evidencePages(account)}`,
      accountRoutes(model, account.clientAccountId),
      account.clientAccountId,
    ]),
    theme: 'grid',
    headStyles: { fillColor: C.ink, textColor: C.white, fontSize: 7.5, cellPadding: 7 },
    bodyStyles: { textColor: C.ink, fontSize: 7, cellPadding: 7, lineColor: C.line, valign: 'top', overflow: 'linebreak' },
    alternateRowStyles: { fillColor: C.blueWash },
    columnStyles: {
      0: { cellWidth: 118, fontStyle: 'bold' },
      1: { cellWidth: 108 },
      2: { cellWidth: 140 },
      3: { cellWidth: 154, font: 'courier', fontSize: 6.2 },
    },
  });
}

function addFindings(doc, model) {
  doc.addPage();
  addBase(doc, '04 · Documented report facts', 'What the report review actually found', 'This section reproduces saved findings only. It does not create a dispute fact when the source review did not document one.');
  if (!model.documentedFindings.length) {
    setFill(doc, C.blueWash);
    doc.roundedRect(M, 165, PAGE_W - (M * 2), 104, 8, 8, 'F');
    setText(doc, C.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('No discrete factual findings were saved for the routed accounts.', M + 18, 198);
    setText(doc, C.slate);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('The R1 classification remains based on the confirmed account category and bureau reporting facts.', M + 18, 224);
    return;
  }
  autoTable(doc, {
    startY: 153,
    margin: { left: M, right: M, bottom: 60 },
    head: [['Account', 'Field', 'Saved finding', 'Source']],
    body: model.documentedFindings.map((finding) => [
      finding.furnisher,
      finding.field,
      finding.issue,
      [finding.page ? `Page ${finding.page}` : '', finding.statute, finding.outcome].filter(Boolean).join('\n') || 'Saved audit',
    ]),
    theme: 'grid',
    headStyles: { fillColor: C.ink, textColor: C.white, fontSize: 7.5, cellPadding: 7 },
    bodyStyles: { textColor: C.ink, fontSize: 7.3, cellPadding: 7, lineColor: C.line, valign: 'top' },
    alternateRowStyles: { fillColor: C.blueWash },
    columnStyles: {
      0: { cellWidth: 112, fontStyle: 'bold' },
      1: { cellWidth: 90 },
      2: { cellWidth: 238 },
      3: { cellWidth: 80 },
    },
  });
}

function addNextSteps(doc, model) {
  doc.addPage();
  addBase(doc, '05 · Controlled execution', 'What happens next', 'The plan advances only from recorded outcomes. Unconfirmed Direct, Solo, or end-cycle rules stop for review.');
  let y = 162;
  model.nextSteps.forEach((step, index) => {
    setFill(doc, C.bluePale);
    doc.circle(M + 14, y - 4, 14, 'F');
    setText(doc, C.blueDark);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(String(index + 1), M + 14, y - 1, { align: 'center' });
    setText(doc, C.ink);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.2);
    const lines = doc.splitTextToSize(step, PAGE_W - (M * 2) - 48);
    doc.text(lines, M + 44, y, { lineHeightFactor: 1.4 });
    y += Math.max(62, lines.length * 14 + 28);
  });
}

function addProvenance(doc, model) {
  doc.addPage();
  addBase(doc, '06 · Audit trail', 'How this Blueprint can be verified', 'These identifiers tie the client document to the exact saved audit, review version, and deterministic rule set used to build the R1 plan.');
  const rows = [
    ['Audit ID', model.provenance.auditId],
    ['Client ID', model.provenance.clientId],
    ['Audit revision', model.provenance.auditRevision || 'Stored with the audit record'],
    ['Audit SHA-256', model.provenance.auditSha256 || 'Stored with the approved artifact'],
    ['Review version', String(model.provenance.classificationReviewVersion)],
    ['Review timestamp', model.provenance.classificationReviewedAt],
    ['Review method', model.provenance.classificationMethodVersion],
    ['Routes SHA-256', model.provenance.routesSha256],
    ['Routing snapshot SHA-256', model.provenance.routingSnapshotSha256],
    ['Rule authority', model.provenance.ruleAuthority],
  ];
  autoTable(doc, {
    startY: 156,
    margin: { left: M, right: M, bottom: 115 },
    body: rows,
    theme: 'grid',
    bodyStyles: { textColor: C.ink, fontSize: 7.2, cellPadding: 7, lineColor: C.line, valign: 'top' },
    alternateRowStyles: { fillColor: C.blueWash },
    columnStyles: {
      0: { cellWidth: 132, fontStyle: 'bold', textColor: C.blueDark },
      1: { cellWidth: 388, font: 'courier', fontSize: 6.5, overflow: 'linebreak' },
    },
  });
  const y = Math.min((doc.lastAutoTable?.finalY || 540) + 28, 650);
  setText(doc, C.slate);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.text(doc.splitTextToSize(model.disclaimer, PAGE_W - (M * 2)), M, y, { lineHeightFactor: 1.4 });
}

function addFooters(doc, model) {
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    setText(doc, C.faint);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.text('CREDIT COMEBACK CLUB · PRIVATE RECOVERY BLUEPRINT', M, PAGE_H - 22);
    doc.text(`Review v${model.provenance.classificationReviewVersion}  ·  ${page}/${total}`, PAGE_W - M, PAGE_H - 22, { align: 'right' });
  }
}

export function buildRecoveryBlueprintPdf(auditOrModel) {
  const model = auditOrModel?.templateVersion ? auditOrModel : buildRecoveryBlueprintModel(auditOrModel);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({
    title: `${model.client.name} Recovery Blueprint`,
    subject: 'Credit Comeback Club Recovery Blueprint',
    author: 'Credit Comeback Club',
    creator: model.templateVersion,
  });
  addCover(doc, model);
  addSnapshot(doc, model);
  addR1Plan(doc, model);
  addAccounts(doc, model);
  addFindings(doc, model);
  addNextSteps(doc, model);
  addProvenance(doc, model);
  addFooters(doc, model);
  return doc;
}

export function recoveryBlueprintBlob(auditOrModel) {
  return buildRecoveryBlueprintPdf(auditOrModel).output('blob');
}

export { recoveryBlueprintFilename };
