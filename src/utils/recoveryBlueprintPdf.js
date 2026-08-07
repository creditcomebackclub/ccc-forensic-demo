import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { buildRecoveryBlueprintModel, recoveryBlueprintFilename } from './recoveryBlueprintModel.js';

const C = {
  navy: [18, 31, 56],
  navy2: [27, 42, 74],
  gold: [201, 168, 76],
  cream: [247, 244, 237],
  ink: [20, 27, 40],
  muted: [99, 107, 121],
  line: [223, 226, 232],
  white: [255, 255, 255],
  green: [34, 105, 82],
};

const PAGE_W = 612;
const PAGE_H = 792;
const M = 48;

function money(value) {
  return `$${Math.round(Number(value) || 0).toLocaleString('en-US')}`;
}

function setColor(doc, color, fill = false) {
  if (fill) doc.setFillColor(...color);
  else doc.setTextColor(...color);
}

function fitText(doc, text, maxWidth, startSize, minSize = 9) {
  let size = startSize;
  doc.setFontSize(size);
  while (size > minSize && doc.getTextWidth(String(text)) > maxWidth) {
    size -= 0.5;
    doc.setFontSize(size);
  }
  return size;
}

function pageHeader(doc, kicker, title, dark = false) {
  const bg = dark ? C.navy : C.cream;
  setColor(doc, bg, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  setColor(doc, C.gold, true);
  doc.rect(M, 40, 34, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setCharSpace(1.6);
  setColor(doc, dark ? C.gold : C.muted);
  doc.text(kicker.toUpperCase(), M, 64);
  doc.setCharSpace(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(27);
  setColor(doc, dark ? C.white : C.navy);
  doc.text(title, M, 105);
}

function footer(doc, model, page, total) {
  setColor(doc, C.line, true);
  doc.rect(M, 750, PAGE_W - M * 2, 1, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  setColor(doc, C.muted);
  doc.text('CREDIT COMEBACK CLUB  /  RECOVERY BLUEPRINT', M, 770);
  doc.text(`${model.client.name}  /  ${page} OF ${total}`, PAGE_W - M, 770, { align: 'right' });
}

function addCover(doc, model) {
  setColor(doc, C.navy, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  setColor(doc, C.gold, true);
  doc.circle(520, 90, 110, 'F');
  setColor(doc, C.navy2, true);
  doc.circle(520, 90, 82, 'F');
  setColor(doc, C.gold, true);
  doc.rect(M, 72, 54, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setCharSpace(2.2);
  setColor(doc, C.gold);
  doc.text('CREDIT COMEBACK CLUB', M, 106);
  doc.setCharSpace(0);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(18);
  setColor(doc, C.white);
  doc.text('YOUR PERSONAL', M, 232);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(46);
  doc.text('RECOVERY', M, 286);
  doc.text('BLUEPRINT', M, 336);
  setColor(doc, C.gold, true);
  doc.rect(M, 368, 172, 3, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  setColor(doc, [207, 214, 226]);
  doc.text('A forensic roadmap built from your three-bureau file.', M, 404);
  doc.setFont('helvetica', 'bold');
  fitText(doc, model.client.name, 500, 25, 17);
  setColor(doc, C.white);
  doc.text(model.client.name, M, 638);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  setColor(doc, C.gold);
  doc.text(`PREPARED ${model.client.reportDateLabel.toUpperCase()}`, M, 666);
  doc.setFontSize(7.5);
  setColor(doc, [151, 163, 181]);
  doc.text('PRIVATE & CONFIDENTIAL', M, 742);
  doc.text(model.templateVersion.toUpperCase(), PAGE_W - M, 742, { align: 'right' });
}

function metricCard(doc, x, y, width, label, value, accent = false) {
  setColor(doc, C.white, true);
  doc.roundedRect(x, y, width, 92, 5, 5, 'F');
  setColor(doc, accent ? C.gold : C.navy, true);
  doc.rect(x, y, 4, 92, 'F');
  doc.setFont('helvetica', 'bold');
  fitText(doc, value, width - 28, 22, 13);
  setColor(doc, C.navy);
  doc.text(String(value), x + 18, y + 39);
  doc.setFontSize(7.5);
  doc.setCharSpace(0.8);
  setColor(doc, C.muted);
  doc.text(label.toUpperCase(), x + 18, y + 66);
  doc.setCharSpace(0);
}

function addSnapshot(doc, model) {
  doc.addPage();
  pageHeader(doc, '01 / The file', 'Your file, at a glance');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  setColor(doc, C.muted);
  const summary = doc.splitTextToSize(model.executiveSummary, 500).slice(0, 4);
  doc.text(summary, M, 140, { lineHeightFactor: 1.45 });

  metricCard(doc, M, 218, 160, 'Priority targets', model.metrics.priorityTargetCount);
  metricCard(doc, 226, 218, 160, 'Accuracy issues', model.metrics.accuracyIssueCount);
  metricCard(doc, 404, 218, 160, 'Targeted balance', money(model.metrics.targetedNegativeBalance), true);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setColor(doc, C.navy);
  doc.text('CURRENT SCORE SNAPSHOT', M, 354);
  const scoreEntries = [
    ['EQUIFAX', model.scores.equifax],
    ['EXPERIAN', model.scores.experian],
    ['TRANSUNION', model.scores.transunion],
  ];
  scoreEntries.forEach(([label, score], index) => {
    const x = M + index * 172;
    setColor(doc, C.navy, true);
    doc.roundedRect(x, 374, 154, 78, 5, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(23);
    setColor(doc, C.white);
    doc.text(score == null ? '—' : String(score), x + 18, 410);
    doc.setFontSize(7);
    setColor(doc, C.gold);
    doc.text(label, x + 18, 434);
  });

  setColor(doc, C.navy, true);
  doc.roundedRect(M, 492, PAGE_W - M * 2, 142, 6, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setCharSpace(1.3);
  setColor(doc, C.gold);
  doc.text('BATCH 1 STRIKE ZONE', M + 24, 524);
  doc.setCharSpace(0);
  doc.setFontSize(33);
  setColor(doc, C.white);
  doc.text(money(model.metrics.batch1StrikeZone), M + 24, 570);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  setColor(doc, [198, 207, 221]);
  doc.text(`${model.batch1Accounts.length} account${model.batch1Accounts.length === 1 ? '' : 's'} selected for the opening campaign`, M + 24, 598);
}

function addOpeningMove(doc, model) {
  doc.addPage();
  pageHeader(doc, '02 / Priority', 'The opening move', true);
  const account = model.openingMove;
  if (!account) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(15);
    setColor(doc, [203, 211, 224]);
    doc.text('No Batch 1 account was assigned in the reviewed audit.', M, 180);
    return;
  }
  doc.setFont('helvetica', 'bold');
  fitText(doc, account.furnisher, 500, 34, 21);
  setColor(doc, C.white);
  doc.text(account.furnisher, M, 172);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  setColor(doc, C.gold);
  doc.text(`${money(account.balance)}  /  ${account.bureauLabel}`, M, 202);

  setColor(doc, C.navy2, true);
  doc.roundedRect(M, 242, PAGE_W - M * 2, 154, 6, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setColor(doc, C.gold);
  doc.text('WHY THIS ACCOUNT LEADS', M + 22, 272);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  setColor(doc, C.white);
  const why = doc.splitTextToSize(account.primaryViolation, PAGE_W - M * 2 - 44).slice(0, 5);
  doc.text(why, M + 22, 304, { lineHeightFactor: 1.45 });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setColor(doc, C.gold);
  doc.text('THE DOCUMENTED APPROACH', M, 452);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  setColor(doc, [218, 224, 234]);
  const strategy = doc.splitTextToSize(account.strategy, PAGE_W - M * 2).slice(0, 8);
  doc.text(strategy, M, 486, { lineHeightFactor: 1.55 });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setColor(doc, C.gold);
  doc.text('ALSO IN BATCH 1', M, 648);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  setColor(doc, C.white);
  const others = model.batch1Accounts.slice(1).map((item) => item.furnisher).join('  •  ') || 'This is the sole opening target.';
  const otherLines = doc.splitTextToSize(others, PAGE_W - M * 2).slice(0, 3);
  doc.text(otherLines, M, 674, { lineHeightFactor: 1.4 });
}

function addRecoveryPath(doc, model) {
  doc.addPage();
  pageHeader(doc, '03 / The system', 'Your four-step recovery path');
  model.recoveryPath.forEach((step, index) => {
    const y = 154 + index * 132;
    setColor(doc, index === 0 ? C.gold : C.navy, true);
    doc.circle(70, y + 26, 22, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    setColor(doc, index === 0 ? C.navy : C.gold);
    doc.text(step.number, 70, y + 30, { align: 'center' });
    doc.setFontSize(15);
    setColor(doc, C.navy);
    doc.text(step.title, 112, y + 17);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    setColor(doc, C.muted);
    const lines = doc.splitTextToSize(step.body, 430).slice(0, 4);
    doc.text(lines, 112, y + 42, { lineHeightFactor: 1.45 });
    if (index < model.recoveryPath.length - 1) {
      setColor(doc, C.line, true);
      doc.rect(70, y + 56, 1, 74, 'F');
    }
  });
}

function addStrikeList(doc, model) {
  doc.addPage();
  pageHeader(doc, '04 / Month one', 'The Batch 1 strike list');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  setColor(doc, C.muted);
  doc.text("These are the opening targets selected in the reviewed forensic audit, shown in original priority order.", M, 137);

  if (!model.batch1Accounts.length) {
    doc.setFontSize(13);
    setColor(doc, C.navy);
    doc.text('No Batch 1 accounts were assigned.', M, 200);
    return;
  }

  autoTable(doc, {
    startY: 166,
    margin: { left: M, right: M, bottom: 58 },
    head: [['Target', 'Balance', 'Bureau(s)', 'Primary documented issue']],
    body: model.batch1Accounts.map((account) => [
      account.furnisher,
      money(account.balance),
      account.bureauLabel,
      account.primaryViolation,
    ]),
    theme: 'plain',
    headStyles: { fillColor: C.navy, textColor: C.gold, fontStyle: 'bold', fontSize: 7.5, cellPadding: 8 },
    bodyStyles: { textColor: C.ink, fontSize: 8.2, cellPadding: 8, lineColor: C.line, lineWidth: { bottom: 0.5 } },
    alternateRowStyles: { fillColor: [252, 251, 248] },
    columnStyles: {
      0: { cellWidth: 122, fontStyle: 'bold' },
      1: { cellWidth: 66 },
      2: { cellWidth: 82 },
      3: { cellWidth: 246 },
    },
  });
}

function addClosing(doc, model) {
  doc.addPage();
  setColor(doc, C.navy, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  setColor(doc, C.gold, true);
  doc.rect(M, 66, 48, 4, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setCharSpace(1.8);
  setColor(doc, C.gold);
  doc.text('YOUR NEXT MOVE', M, 103);
  doc.setCharSpace(0);
  doc.setFontSize(38);
  setColor(doc, C.white);
  doc.text("Let's turn the", M, 198);
  doc.text('findings into action.', M, 242);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(13);
  setColor(doc, [207, 214, 226]);
  const intro = doc.splitTextToSize(
    `${model.client.firstName}, this Blueprint identifies the opening priorities. Your consultation is where we verify the file, answer your questions, and map the right next step for you.`,
    480,
  );
  doc.text(intro, M, 304, { lineHeightFactor: 1.55 });

  setColor(doc, C.gold, true);
  doc.roundedRect(M, 414, 242, 50, 5, 5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setColor(doc, C.navy);
  doc.text('REVIEW YOUR BLUEPRINT WITH US', M + 18, 445);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  setColor(doc, C.white);
  doc.text('970-644-0063', M, 510);
  doc.text('creditcomebackclub.com', M, 532);

  setColor(doc, C.navy2, true);
  doc.roundedRect(M, 592, PAGE_W - M * 2, 108, 5, 5, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  setColor(doc, C.gold);
  doc.text('IMPORTANT', M + 18, 618);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.3);
  setColor(doc, [190, 200, 216]);
  const disclaimer = doc.splitTextToSize(model.disclaimer, PAGE_W - M * 2 - 36);
  doc.text(disclaimer, M + 18, 640, { lineHeightFactor: 1.45 });
}

export function buildRecoveryBlueprintPdf(auditOrModel) {
  const model = auditOrModel?.templateVersion
    ? auditOrModel
    : buildRecoveryBlueprintModel(auditOrModel);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({
    title: `${model.client.name} Recovery Blueprint`,
    subject: 'Credit Comeback Club Recovery Blueprint',
    author: 'Credit Comeback Club',
    creator: model.templateVersion,
  });
  addCover(doc, model);
  addSnapshot(doc, model);
  addOpeningMove(doc, model);
  addRecoveryPath(doc, model);
  addStrikeList(doc, model);
  addClosing(doc, model);

  const total = doc.getNumberOfPages();
  for (let page = 2; page < total; page += 1) {
    doc.setPage(page);
    footer(doc, model, page, total);
  }
  return doc;
}

export function recoveryBlueprintBlob(auditOrModel) {
  return buildRecoveryBlueprintPdf(auditOrModel).output('blob');
}

export { recoveryBlueprintFilename };
