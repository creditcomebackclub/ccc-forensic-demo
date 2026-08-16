import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { buildRecoveryBlueprintModel, recoveryBlueprintFilename } from './recoveryBlueprintModel.js';

const C = {
  navy: [11, 28, 51],
  navy2: [18, 38, 63],
  navyDeep: [7, 21, 37],
  gold: [201, 162, 39],
  goldSoft: [232, 212, 139],
  cream: [247, 244, 238],
  pale: [240, 244, 248],
  ink: [26, 35, 50],
  muted: [92, 107, 122],
  line: [217, 210, 197],
  white: [255, 255, 255],
  badge: [232, 238, 245],
  soft: [168, 184, 200],
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

function footerLight(doc, model, page, total) {
  setColor(doc, C.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('CREDIT COMEBACK CLUB  ·  PRIVATE CLIENT AUDIT', M, 770);
  doc.text(`${page} / ${total}`, PAGE_W - M, 770, { align: 'right' });
}

function footerDark(doc, model, page, total) {
  setColor(doc, [138, 155, 176]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('CREDIT COMEBACK CLUB  ·  PRIVATE CLIENT AUDIT', M, 770);
  doc.text(`${page} / ${total}`, PAGE_W - M, 770, { align: 'right' });
}

function scoreBand(score) {
  if (score == null || !Number.isFinite(Number(score))) return '—';
  const n = Number(score);
  if (n >= 800) return 'Exceptional';
  if (n >= 740) return 'Very Good';
  if (n >= 670) return 'Good';
  if (n >= 580) return 'Fair';
  return 'Poor';
}

function addCover(doc, model) {
  setColor(doc, C.navyDeep, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  setColor(doc, C.gold, true);
  doc.rect(0, PAGE_H - 3.5, PAGE_W, 3.5, 'F');

  setColor(doc, C.gold);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('CREDIT COMEBACK CLUB', M, 56);
  setColor(doc, [138, 155, 176]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('FORENSIC CREDIT RECOVERY', M, 70);

  setColor(doc, C.gold);
  doc.setFontSize(8);
  doc.text(`PRIVATE CLIENT AUDIT  ·  ${model.client.reportDateLabel.toUpperCase()}`, M, 130);

  setColor(doc, C.white);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(26);
  doc.text(model.client.name, M, 190);
  setColor(doc, C.gold);
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(22);
  doc.text('Forensic Credit Audit', M, 222);

  setColor(doc, C.soft);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Three-bureau disclosure analyzed for accuracy, leverage,', M, 260);
  doc.text('and the exact sequence that moves the needle first.', M, 276);

  const scoreEntries = [
    ['EQUIFAX', model.scores.equifax],
    ['EXPERIAN', model.scores.experian],
    ['TRANSUNION', model.scores.transunion],
  ];
  scoreEntries.forEach(([label, score], index) => {
    const x = M + index * 168;
    setColor(doc, C.navy2, true);
    doc.roundedRect(x, 310, 152, 78, 5, 5, 'F');
    setColor(doc, [138, 155, 176]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(label, x + 76, 332, { align: 'center' });
    setColor(doc, C.white);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(score == null ? '—' : String(score), x + 76, 360, { align: 'center' });
    setColor(doc, C.goldSoft);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(scoreBand(score), x + 76, 378, { align: 'center' });
  });

  setColor(doc, [138, 155, 176]);
  doc.setFontSize(9);
  if (model.scoreGap?.narrative) {
    const gapLines = doc.splitTextToSize(model.scoreGap.narrative, PAGE_W - M * 2).slice(0, 3);
    doc.text(gapLines, M, 420, { lineHeightFactor: 1.4 });
  } else {
    doc.text('Priority is the documented accuracy conflicts on the file.', M, 420);
  }

  setColor(doc, [42, 63, 85], true);
  doc.rect(M, 700, PAGE_W - M * 2, 1, 'F');
  setColor(doc, [138, 155, 176]);
  doc.setFontSize(7);
  doc.text('CLIENT', M, 720);
  doc.text('FILE DATE', M + 170, 720);
  doc.text('BUREAUS', M + 340, 720);
  setColor(doc, C.white);
  doc.setFontSize(9);
  doc.text(model.client.location || '—', M, 738);
  doc.text(model.client.reportDateLabel, M + 170, 738);
  doc.text('EQ · EXP · TU', M + 340, 738);
}

function addSnapshot(doc, model) {
  doc.addPage();
  setColor(doc, C.cream, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  setColor(doc, C.gold);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('EXECUTIVE SNAPSHOT', M, 48);

  setColor(doc, C.ink);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(24);
  doc.text("What's actually", M, 82);
  doc.text('moving the score.', M, 112);

  setColor(doc, C.muted);
  doc.setFontSize(10);
  doc.text("We don't list every negative. We isolate the accounts and accuracy failures", M, 142);
  doc.text('that create the score gap and the highest cost of credit.', M, 158);

  setColor(doc, C.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(42);
  doc.text(money(model.metrics.targetedNegativeBalance), M, 220);
  setColor(doc, C.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('TARGETED NEGATIVE BALANCES & COLLECTIONS', M, 240);

  const mets = [
    [String(model.metrics.priorityTargetCount), 'PRIORITY TARGETS'],
    [String(model.metrics.accuracyIssueCount), 'ACCURACY ISSUES'],
    [money(model.metrics.batch1StrikeZone), 'BATCH 1 ZONE'],
  ];
  mets.forEach(([value, label], index) => {
    const x = M + index * 170;
    setColor(doc, C.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    doc.text(value, x, 300);
    setColor(doc, C.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(label, x, 318);
  });

  setColor(doc, C.line, true);
  doc.rect(M, 340, PAGE_W - M * 2, 1, 'F');

  setColor(doc, C.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('THE GAP IN ONE SENTENCE', M, 368);
  setColor(doc, C.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  const gapText = model.scoreGap?.narrative
    || model.executiveSummary
    || 'Documented reporting issues on the highest-priority accounts are the primary drag on this file.';
  const gapLines = doc.splitTextToSize(gapText, PAGE_W - M * 2).slice(0, 4);
  doc.text(gapLines, M, 390, { lineHeightFactor: 1.45 });

  setColor(doc, C.navy, true);
  doc.roundedRect(M, 480, PAGE_W - M * 2, 110, 6, 6, 'F');
  setColor(doc, C.gold);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('WHAT THIS AUDIT GIVES YOU', M + 18, 510);
  setColor(doc, [197, 208, 220]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Ranked targets with reasons · Recommended routes (bureau / direct / FDCPA)', M + 18, 535);
  doc.text('Cross-bureau inconsistencies · Identity cleanup queue · Exact Batch 1 sequence', M + 18, 552);
  doc.text('No generic "dispute everything." Every line has a documented why.', M + 18, 569);
}

function addCostOfGap(doc, model) {
  doc.addPage();
  setColor(doc, C.cream, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  setColor(doc, C.gold);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('WHY THE GAP MATTERS', M, 48);

  setColor(doc, C.ink);
  doc.setFontSize(22);
  const pts = model.scoreGap?.points || 0;
  if (pts >= 15) {
    doc.text(`A ${pts}-point spread`, M, 84);
    doc.text('is not academic.', M, 112);
  } else {
    doc.text('Score alignment', M, 84);
    doc.text('does not mean clean.', M, 112);
  }

  setColor(doc, C.muted);
  doc.setFontSize(10);
  doc.text('Lenders pull different bureaus. The weaker read is the one that prices you higher —', M, 148);
  doc.text('on cars, insurance, and especially housing.', M, 164);

  setColor(doc, C.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('ILLUSTRATIVE AUTO LOAN — $28,500 / 60 MONTHS', M, 200);

  const cards = [
    { title: 'Mid-600s band', rate: '≈ 9–12%', pmt: '$590–$635', note: 'Higher payment' },
    { title: 'National avg ~680', rate: '≈ 6–7%', pmt: '$550–$565', note: 'Better' },
    { title: 'Mid-700s territory', rate: '≈ 4–5%', pmt: '$520–$535', note: 'Best pricing' },
  ];
  cards.forEach((card, index) => {
    const x = M + index * 168;
    setColor(doc, C.white, true);
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.8);
    doc.roundedRect(x, 220, 156, 130, 5, 5, 'FD');
    setColor(doc, C.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(card.title, x + 78, 245, { align: 'center' });
    setColor(doc, C.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(card.rate, x + 78, 275, { align: 'center' });
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.text(card.pmt, x + 78, 300, { align: 'center' });
    setColor(doc, C.muted);
    doc.setFontSize(7);
    doc.text('est. monthly', x + 78, 318, { align: 'center' });
    setColor(doc, index === 2 ? C.gold : C.muted);
    doc.setFontSize(7.5);
    doc.text(card.note, x + 78, 338, { align: 'center' });
  });

  setColor(doc, C.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Numbers are illustrative of rate bands, not a quote. Direction matters: the weaker bureau read is the expensive one.', M, 375);
  doc.text('Closing documented accuracy gaps is how we change that read.', M, 390);

  setColor(doc, C.navy, true);
  doc.roundedRect(M, 430, PAGE_W - M * 2, 120, 6, 6, 'F');
  setColor(doc, C.gold);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('MORTGAGE CONTEXT', M + 18, 460);
  setColor(doc, [197, 208, 220]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('On a $250k 30-year note, moving from a mid-600s rate band into the mid-700s', M + 18, 485);
  doc.text('territory is routinely five figures in lifetime interest — often more. That is why', M + 18, 502);
  doc.text('we treat the weaker bureau file as the primary battlefield, not a side project.', M + 18, 519);
  doc.text('We are not promising a score. We are removing the documented reasons it is suppressed.', M + 18, 536);
}

function addOpeningMove(doc, model) {
  doc.addPage();
  setColor(doc, C.navy, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  setColor(doc, C.gold);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('THE OPENING MOVE', M, 48);

  setColor(doc, C.white);
  doc.setFontSize(22);
  doc.text("We don't spray and pray.", M, 88);
  doc.text('We open with power.', M, 116);

  setColor(doc, C.soft);
  doc.setFontSize(9.5);
  doc.text('Month one is built around the single highest-leverage conflict on the file.', M, 148);

  const account = model.openingMove;
  if (!account) {
    setColor(doc, C.soft);
    doc.setFontSize(14);
    doc.text('No Batch 1 account was assigned in the reviewed audit.', M, 220);
    return;
  }

  setColor(doc, C.navy2, true);
  doc.roundedRect(M, 175, PAGE_W - M * 2, 280, 6, 6, 'F');
  setColor(doc, C.gold, true);
  doc.rect(M, 175, 4, 280, 'F');

  setColor(doc, C.gold);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  const headerLine = `${account.furnisher.toUpperCase()}  ·  ${account.status.toUpperCase()}  ·  ${account.bureauLabel.toUpperCase()}`;
  fitText(doc, headerLine, PAGE_W - M * 2 - 40, 8, 6);
  doc.text(headerLine, M + 18, 200);

  setColor(doc, C.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(32);
  doc.text(money(account.balance), M + 18, 245);

  setColor(doc, [197, 208, 220]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const whySource = account.primaryChallengeStatement || account.primaryViolation;
  const why = doc.splitTextToSize(whySource, PAGE_W - M * 2 - 40).slice(0, 4);
  doc.text(why, M + 18, 275, { lineHeightFactor: 1.4 });

  setColor(doc, C.goldSoft);
  doc.setFontSize(8);
  let y = 340;
  const bullets = [
    `Field pressure — ${account.violations[0]?.field || 'Account status / balance'} requires documented investigation`,
    `Route — ${account.routeLabel}`,
    `Why first — Highest priority on the reviewed audit${account.priorityScore ? ` (score ${account.priorityScore})` : ''}`,
  ];
  bullets.forEach((line) => {
    const wrapped = doc.splitTextToSize(`■  ${line}`, PAGE_W - M * 2 - 40).slice(0, 2);
    doc.text(wrapped, M + 18, y, { lineHeightFactor: 1.3 });
    y += 18 * wrapped.length;
  });

  setColor(doc, [138, 155, 176]);
  doc.setFontSize(8);
  const others = model.batch1Accounts.slice(1).map((item) => item.furnisher);
  const also = others.length
    ? `Also in Batch 1:  ${others.join('  ·  ')}`
    : 'This is the sole opening target for Batch 1.';
  const alsoLines = doc.splitTextToSize(also, PAGE_W - M * 2).slice(0, 2);
  doc.text(alsoLines, M, 500, { lineHeightFactor: 1.35 });
}

function addStrikeList(doc, model) {
  doc.addPage();
  setColor(doc, C.pale, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  setColor(doc, C.gold);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('PRIORITY TARGETS', M, 48);

  setColor(doc, C.ink);
  doc.setFontSize(22);
  doc.text('Ranked. Not random.', M, 84);

  setColor(doc, C.muted);
  doc.setFontSize(9.5);
  doc.text('Every account below has a documented reason and a recommended route.', M, 112);
  doc.text('This is the Batch 1 strike list that feeds the campaign engine.', M, 128);

  if (!model.batch1Accounts.length) {
    setColor(doc, C.ink);
    doc.setFontSize(13);
    doc.text('No Batch 1 accounts were assigned.', M, 200);
    return;
  }

  autoTable(doc, {
    startY: 150,
    margin: { left: M, right: M, bottom: 58 },
    head: [['Balance', 'Account', 'Why it matters', 'Route']],
    body: model.batch1Accounts.map((account) => [
      money(account.balance),
      account.furnisher,
      account.primaryChallengeStatement || account.primaryViolation,
      account.routeLabel,
    ]),
    theme: 'plain',
    headStyles: {
      fillColor: C.navy,
      textColor: C.white,
      fontStyle: 'bold',
      fontSize: 7.5,
      cellPadding: 7,
    },
    bodyStyles: {
      textColor: C.ink,
      fontSize: 8,
      cellPadding: 7,
      lineColor: C.line,
      lineWidth: { bottom: 0.4 },
      valign: 'top',
    },
    alternateRowStyles: { fillColor: [252, 251, 248] },
    columnStyles: {
      0: { cellWidth: 58, fontStyle: 'bold' },
      1: { cellWidth: 120, fontStyle: 'bold' },
      2: { cellWidth: 230 },
      3: { cellWidth: 88 },
    },
  });

  const finalY = doc.lastAutoTable?.finalY || 520;
  setColor(doc, C.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  const later = model.batch2Accounts.length
    ? `Later wave: ${model.batch2Accounts.map((a) => a.furnisher).slice(0, 4).join(' · ')}${model.batch2Accounts.length > 4 ? ' · …' : ''}`
    : 'Later wave sequenced after Batch 1 responses so leverage is preserved.';
  doc.text(later, M, Math.min(finalY + 28, 720));
}

function addForensicLayer(doc, model) {
  doc.addPage();
  setColor(doc, C.cream, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  setColor(doc, C.gold);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('FORENSIC LAYER', M, 48);

  setColor(doc, C.ink);
  doc.setFontSize(22);
  doc.text('Where the file', M, 84);
  doc.text('contradicts itself.', M, 112);

  setColor(doc, C.muted);
  doc.setFontSize(9.5);
  doc.text('These are not opinions. These are accuracy conflicts the bureaus and furnishers', M, 142);
  doc.text('are required to investigate when properly challenged.', M, 158);

  const issues = model.accuracyIssues.length
    ? model.accuracyIssues
    : [{ title: 'No discrete accuracy issues ranked', body: 'The reviewed audit did not surface authorized findings for the client packet.' }];

  let y = 185;
  issues.slice(0, 10).forEach((issue, index) => {
    if (y > 700) return;
    setColor(doc, C.gold);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(String(index + 1).padStart(2, '0'), M, y);
    setColor(doc, C.ink);
    doc.setFontSize(9);
    const title = doc.splitTextToSize(issue.title, PAGE_W - M * 2 - 36).slice(0, 1);
    doc.text(title, M + 28, y);
    setColor(doc, C.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    const body = doc.splitTextToSize(issue.body, PAGE_W - M * 2 - 36).slice(0, 2);
    doc.text(body, M + 28, y + 14, { lineHeightFactor: 1.3 });
    y += 14 + (body.length * 12) + 14;
  });
}

function addIdentity(doc, model) {
  doc.addPage();
  setColor(doc, C.cream, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  setColor(doc, C.gold);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('IDENTITY & FILE HYGIENE', M, 48);

  setColor(doc, C.ink);
  doc.setFontSize(22);
  doc.text('Clean the address', M, 84);
  doc.text('before the letters.', M, 112);

  setColor(doc, C.muted);
  doc.setFontSize(9.5);
  doc.text('Dispute letters fail quietly when the header data is wrong. We fix identity first.', M, 142);

  const flags = model.identity?.flags || [];
  flags.slice(0, 2).forEach((flag, index) => {
    const x = M + index * 250;
    setColor(doc, C.white, true);
    doc.setDrawColor(...C.line);
    doc.setLineWidth(0.8);
    doc.roundedRect(x, 170, 236, 120, 5, 5, 'FD');
    setColor(doc, C.ink);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(flag.title.toUpperCase(), x + 14, 198);
    setColor(doc, C.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const body = doc.splitTextToSize(flag.body, 208).slice(0, 5);
    doc.text(body, x + 14, 222, { lineHeightFactor: 1.4 });
  });

  setColor(doc, C.ink);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('INQUIRIES', M, 330);
  setColor(doc, C.muted);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Hard pulls are secondary to the tradeline conflicts above.', M, 352);
  doc.text('We do not open the campaign with inquiry disputes. We open with the accounts', M, 368);
  doc.text('that are actively pricing the file. Inquiry cleanup is sequenced later if needed.', M, 384);

  setColor(doc, C.navy, true);
  doc.roundedRect(M, 430, PAGE_W - M * 2, 110, 6, 6, 'F');
  setColor(doc, C.gold);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('OPERATING RULE', M + 18, 460);
  setColor(doc, [197, 208, 220]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('No new credit applications during active dispute cycles unless we specifically', M + 18, 485);
  doc.text('clear them. New hard pulls while we are cleaning the file add noise and can', M + 18, 502);
  doc.text('undercut the score recovery we are working to create.', M + 18, 519);
}

function addRecoveryPath(doc, model) {
  doc.addPage();
  setColor(doc, C.cream, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  setColor(doc, C.gold);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('THE PATH', M, 48);

  setColor(doc, C.ink);
  doc.setFontSize(22);
  doc.text('A clear plan.', M, 84);
  doc.text('Not a mystery box.', M, 112);

  model.recoveryPath.forEach((step, index) => {
    const y = 155 + index * 115;
    setColor(doc, C.gold);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(step.number, M, y);
    setColor(doc, C.ink);
    doc.setFontSize(11);
    doc.text(step.title, M + 42, y);
    setColor(doc, C.muted);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    const body = doc.splitTextToSize(step.body, PAGE_W - M * 2 - 42).slice(0, 4);
    doc.text(body, M + 42, y + 18, { lineHeightFactor: 1.4 });
    if (index < model.recoveryPath.length - 1) {
      setColor(doc, C.line, true);
      doc.rect(M + 8, y + 55, 1.2, 40, 'F');
    }
  });
}

function addClosing(doc, model) {
  doc.addPage();
  setColor(doc, C.navyDeep, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  setColor(doc, C.gold, true);
  doc.rect(0, PAGE_H - 3.5, PAGE_W, 3.5, 'F');

  setColor(doc, C.gold);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('READY WHEN YOU ARE', M, 56);

  setColor(doc, C.white);
  doc.setFontSize(22);
  doc.text('Your file already has', M, 100);
  setColor(doc, C.gold);
  doc.setFont('helvetica', 'italic');
  doc.text('a battle plan.', M, 130);
  setColor(doc, C.white);
  doc.setFont('helvetica', 'normal');
  doc.text('Now it needs a team.', M, 160);

  setColor(doc, C.soft);
  doc.setFontSize(10);
  doc.text('Most people stare at a tri-merge and feel stuck. You do not have to.', M, 200);
  doc.text('We already know the Opening Move, the Batch 1 list, the routes,', M, 218);
  doc.text('and the sequence that follows.', M, 236);

  doc.setDrawColor(...C.gold);
  doc.setLineWidth(1.2);
  doc.roundedRect(M, 280, PAGE_W - M * 2, 90, 4, 4, 'S');
  setColor(doc, C.white);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Start Month One — Batch 1 letters', M + 18, 315);
  setColor(doc, C.soft);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('We prepare and mail the opening disputes on the highest-leverage accounts,', M + 18, 338);
  doc.text('track bureau responses, and keep you in the loop. You focus on life. We focus on the file.', M + 18, 354);

  setColor(doc, C.gold);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('Credit Comeback Club', M, 620);
  setColor(doc, [138, 155, 176]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('FORENSIC CREDIT RECOVERY', M, 636);

  setColor(doc, [138, 155, 176]);
  doc.setFontSize(8);
  doc.text(`Prepared for ${model.client.name}`, PAGE_W - M, 620, { align: 'right' });
  doc.text(`Report date ${model.client.reportDate || '—'}`, PAGE_W - M, 636, { align: 'right' });
  doc.text('creditcomebackclub.com', PAGE_W - M, 652, { align: 'right' });

  setColor(doc, [107, 124, 144]);
  doc.setFontSize(6.5);
  const disc = doc.splitTextToSize(model.disclaimer, PAGE_W - M * 2).slice(0, 4);
  doc.text(disc, M, 700, { lineHeightFactor: 1.35 });
}

export function buildRecoveryBlueprintPdf(auditOrModel) {
  const model = auditOrModel?.templateVersion
    ? auditOrModel
    : buildRecoveryBlueprintModel(auditOrModel);
  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  doc.setProperties({
    title: `${model.client.name} Private Client Audit`,
    subject: 'Credit Comeback Club Private Client Audit',
    author: 'Credit Comeback Club',
    creator: model.templateVersion,
  });

  addCover(doc, model);
  addSnapshot(doc, model);
  addCostOfGap(doc, model);
  addOpeningMove(doc, model);
  addStrikeList(doc, model);
  addForensicLayer(doc, model);
  addIdentity(doc, model);
  addRecoveryPath(doc, model);
  addClosing(doc, model);

  const total = doc.getNumberOfPages();
  for (let page = 2; page <= total; page += 1) {
    doc.setPage(page);
    if (page === 4 || page === total) footerDark(doc, model, page, total);
    else footerLight(doc, model, page, total);
  }
  return doc;
}

export function recoveryBlueprintBlob(auditOrModel) {
  return buildRecoveryBlueprintPdf(auditOrModel).output('blob');
}

export { recoveryBlueprintFilename };
