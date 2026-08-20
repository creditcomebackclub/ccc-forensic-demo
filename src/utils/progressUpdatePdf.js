import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { clientCampaignLabel } from './clientCampaignCopy.js';

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
  amber: [146, 64, 14],
  softGreen: [232, 245, 239],
  softAmber: [252, 244, 230],
};

const PAGE_W = 612;
const PAGE_H = 792;
const M = 48;

export function monthLabel(dateStr) {
  if (!dateStr) return '';
  return new Date(String(dateStr) + (String(dateStr).includes('T') ? '' : 'T00:00:00'))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export function fmtDate(dateStr) {
  if (!dateStr) return '';
  return new Date(String(dateStr) + (String(dateStr).includes('T') ? '' : 'T00:00:00'))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function money(value) {
  return `$${Math.round(Number(value) || 0).toLocaleString('en-US')}`;
}

function slug(name) {
  return String(name || 'client')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'client';
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

function ensureSpace(doc, y, need = 80) {
  if (y + need < PAGE_H - 56) return y;
  doc.addPage();
  setColor(doc, C.cream, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  return 56;
}

function footer(doc, clientName, page, total) {
  if (page === 1) return;
  setColor(doc, C.line, true);
  doc.rect(M, 750, PAGE_W - M * 2, 1, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  setColor(doc, C.muted);
  doc.text('CREDIT COMEBACK CLUB  /  PROGRESS UPDATE', M, 770);
  doc.text(`${clientName}  /  ${page} OF ${total}`, PAGE_W - M, 770, { align: 'right' });
}

function metricCard(doc, x, y, width, label, value, accent = false) {
  setColor(doc, C.white, true);
  doc.roundedRect(x, y, width, 88, 5, 5, 'F');
  setColor(doc, accent ? C.gold : C.navy, true);
  doc.rect(x, y, 4, 88, 'F');
  doc.setFont('helvetica', 'bold');
  fitText(doc, value, width - 28, 22, 12);
  setColor(doc, C.navy);
  doc.text(String(value), x + 18, y + 38);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setCharSpace(0.8);
  setColor(doc, C.muted);
  doc.text(String(label).toUpperCase(), x + 18, y + 62);
  doc.setCharSpace(0);
}

function scoreTile(doc, x, y, width, bureau, score) {
  const old = score?.old;
  const next = score?.new;
  const delta = score?.delta;
  setColor(doc, C.navy, true);
  doc.roundedRect(x, y, width, 108, 6, 6, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setCharSpace(1.2);
  setColor(doc, C.gold);
  doc.text(String(bureau).toUpperCase(), x + 14, y + 22);
  doc.setCharSpace(0);
  doc.setFontSize(26);
  setColor(doc, C.white);
  doc.text(next != null ? String(next) : '-', x + 14, y + 56);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  setColor(doc, [180, 190, 210]);
  const prior = old != null ? String(old) : '-';
  doc.text(`Was ${prior}`, x + 14, y + 76);
  if (delta != null && delta !== 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setColor(doc, delta > 0 ? [120, 200, 150] : [240, 160, 140]);
    doc.text(`${delta > 0 ? '+' : ''}${delta}`, x + width - 14, y + 56, { align: 'right' });
  }
}

function sectionTitle(doc, y, title, color = C.navy) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  setColor(doc, color);
  doc.text(title, M, y);
  return y + 16;
}

function normalizeDiff(diff = {}) {
  return {
    deleted: Array.isArray(diff.deleted) ? diff.deleted : [],
    added: Array.isArray(diff.new) ? diff.new : (Array.isArray(diff.added) ? diff.added : []),
    changed: Array.isArray(diff.changed) ? diff.changed : [],
    scoreDeltas: diff.scoreDeltas || {},
    negativeCounts: diff.negativeCounts || null,
    totalDebtRemoved: Number(diff.totalDebtRemoved) || 0,
  };
}

function normalizePhaseProgress(items) {
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && (item.furnisher || item.label));
}

/**
 * Build a client-facing Progress Update PDF.
 * @param {{ clientName: string, fromReportDate?: string, toReportDate?: string, narrative: string, diff?: object, phaseProgress?: array }} input
 */
export function buildProgressUpdatePdf(input) {
  const clientName = String(input.clientName || 'Client');
  const narrative = String(input.narrative || '').trim();
  const diff = normalizeDiff(input.diff);
  const phaseProgress = normalizePhaseProgress(input.phaseProgress);
  const period = [monthLabel(input.fromReportDate), monthLabel(input.toReportDate)].filter(Boolean).join(' - ')
    || monthLabel(input.toReportDate)
    || 'Progress Update';
  const prepared = fmtDate(input.toReportDate) || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const deletedCount = diff.deleted.length;
  const addedCount = diff.added.length;
  const debtLabel = money(diff.totalDebtRemoved);
  const negBefore = diff.negativeCounts?.before;
  const negAfter = diff.negativeCounts?.after;
  const negLabel = (negBefore != null && negAfter != null)
    ? `${negBefore} -> ${negAfter}`
    : (negAfter != null ? String(negAfter) : '-');

  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });

  // Cover
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
  doc.setFontSize(16);
  setColor(doc, C.white);
  doc.text('YOUR MONTHLY', M, 240);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(42);
  doc.text('PROGRESS', M, 292);
  doc.text('UPDATE', M, 340);
  setColor(doc, C.gold, true);
  doc.rect(M, 368, 148, 3, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  setColor(doc, [207, 214, 226]);
  doc.text('A clear look at what changed since your last report review.', M, 404);
  doc.setFont('helvetica', 'bold');
  fitText(doc, clientName, 500, 24, 16);
  setColor(doc, C.white);
  doc.text(clientName, M, 620);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  setColor(doc, C.gold);
  doc.text(period.toUpperCase(), M, 648);
  doc.setFontSize(9);
  setColor(doc, [151, 163, 181]);
  doc.text(`PREPARED ${String(prepared).toUpperCase()}`, M, 676);
  doc.setFontSize(7.5);
  doc.text('PRIVATE & CONFIDENTIAL', M, 742);

  // Snapshot
  doc.addPage();
  setColor(doc, C.cream, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  setColor(doc, C.gold, true);
  doc.rect(M, 40, 34, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setCharSpace(1.6);
  setColor(doc, C.muted);
  doc.text('01  /  AT A GLANCE', M, 64);
  doc.setCharSpace(0);
  doc.setFontSize(26);
  setColor(doc, C.navy);
  doc.text('What moved this period', M, 98);

  const cardW = (PAGE_W - M * 2 - 24) / 3;
  metricCard(doc, M, 124, cardW, 'Accounts removed', String(deletedCount), deletedCount > 0);
  metricCard(doc, M + cardW + 12, 124, cardW, 'Reported debt cleared', debtLabel, deletedCount > 0);
  metricCard(doc, M + (cardW + 12) * 2, 124, cardW, 'Negatives on file', negLabel);

  const bureaus = ['equifax', 'experian', 'transunion'];
  const tileW = (PAGE_W - M * 2 - 20) / 3;
  bureaus.forEach((bureau, i) => {
    scoreTile(doc, M + i * (tileW + 10), 236, tileW, bureau, diff.scoreDeltas[bureau]);
  });

  let y = 372;
  y = sectionTitle(doc, y, 'Your update');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  setColor(doc, C.ink);
  doc.setLineHeightFactor(1.45);
  const lines = doc.splitTextToSize(narrative || 'No narrative drafted yet.', PAGE_W - M * 2);
  for (const line of lines) {
    y = ensureSpace(doc, y, 18);
    doc.text(line, M, y);
    y += 15;
  }
  doc.setLineHeightFactor(1.15);

  const hasAccounts = deletedCount + addedCount + diff.changed.length > 0;
  if (hasAccounts) {
    y = ensureSpace(doc, y + 28, 120);
    setColor(doc, C.gold, true);
    doc.rect(M, y, 28, 2.5, 'F');
    y += 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setCharSpace(1.4);
    setColor(doc, C.muted);
    doc.text('02  /  ACCOUNT MOVEMENT', M, y);
    doc.setCharSpace(0);
    y += 22;
    doc.setFontSize(22);
    setColor(doc, C.navy);
    doc.text('File changes we can confirm', M, y);
    y += 20;

    if (deletedCount) {
      y = ensureSpace(doc, y + 8, 70);
      y = sectionTitle(doc, y, 'Removed from your report', C.green);
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        head: [['Furnisher', 'Status', 'Balance']],
        body: diff.deleted.map((a) => [
          a.furnisher || '-',
          a.status || '-',
          a.balance != null ? money(a.balance) : '-',
        ]),
        theme: 'plain',
        headStyles: { fillColor: C.green, textColor: C.white, fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { textColor: C.ink, fontSize: 9.5 },
        alternateRowStyles: { fillColor: C.softGreen },
        styles: { cellPadding: 7 },
      });
      y = doc.lastAutoTable.finalY + 18;
    }

    if (addedCount) {
      y = ensureSpace(doc, y + 4, 70);
      y = sectionTitle(doc, y, 'New items on the report', C.amber);
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        head: [['Furnisher', 'Status', 'Balance']],
        body: diff.added.map((a) => [
          a.furnisher || '-',
          a.status || '-',
          a.balance != null ? money(a.balance) : '-',
        ]),
        theme: 'plain',
        headStyles: { fillColor: [180, 120, 40], textColor: C.white, fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { textColor: C.ink, fontSize: 9.5 },
        alternateRowStyles: { fillColor: C.softAmber },
        styles: { cellPadding: 7 },
      });
      y = doc.lastAutoTable.finalY + 18;
    }

    if (diff.changed.length) {
      y = ensureSpace(doc, y + 4, 70);
      y = sectionTitle(doc, y, 'Accounts that changed');
      autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        head: [['Furnisher', 'Balance', 'Status']],
        body: diff.changed.map((a) => {
          const balOld = a.oldBalance != null ? money(a.oldBalance) : '-';
          const balNew = a.newBalance != null ? money(a.newBalance) : '-';
          const stOld = a.oldStatus || '-';
          const stNew = a.newStatus || '-';
          return [
            a.furnisher || '-',
            balOld === balNew ? balNew : `${balOld} -> ${balNew}`,
            stOld === stNew ? stNew : `${stOld} -> ${stNew}`,
          ];
        }),
        theme: 'plain',
        headStyles: { fillColor: C.navy, textColor: C.gold, fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { textColor: C.ink, fontSize: 9.5 },
        alternateRowStyles: { fillColor: [255, 255, 255] },
        styles: { cellPadding: 7 },
      });
      y = doc.lastAutoTable.finalY + 18;
    }
  }

  if (phaseProgress.length) {
    y = ensureSpace(doc, y + 16, 120);
    setColor(doc, C.gold, true);
    doc.rect(M, y, 28, 2.5, 'F');
    y += 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setCharSpace(1.4);
    setColor(doc, C.muted);
    doc.text('03  /  CAMPAIGN STATUS', M, y);
    doc.setCharSpace(0);
    y += 22;
    doc.setFontSize(22);
    setColor(doc, C.navy);
    doc.text('Where each account stands', M, y);
    y += 16;
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Account', 'Detail', 'Track']],
      body: phaseProgress.slice(0, 18).map((item) => {
        const phaseRaw = item.phase;
        const phaseForLabel = /^phase\b/i.test(String(phaseRaw || ''))
          ? phaseRaw
          : `Phase ${phaseRaw}`;
        return [
          item.furnisher || '-',
          item.label || item.reportLabel || '-',
          clientCampaignLabel(phaseForLabel),
        ];
      }),
      theme: 'plain',
      headStyles: { fillColor: C.navy, textColor: C.gold, fontSize: 8, fontStyle: 'bold' },
      bodyStyles: { textColor: C.ink, fontSize: 9 },
      styles: { cellPadding: 6 },
    });
  }

  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    footer(doc, clientName, page, total);
  }

  return doc;
}

export function progressUpdateFilename({ clientName, toReportDate } = {}) {
  const date = toReportDate ? String(toReportDate).slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `ccc-progress-update-${slug(clientName)}-${date}.pdf`;
}

export function progressUpdatePdfBytes(input) {
  const doc = buildProgressUpdatePdf(input);
  const ab = doc.output('arraybuffer');
  return typeof Buffer !== 'undefined' ? Buffer.from(ab) : new Uint8Array(ab);
}

export function downloadProgressUpdatePdf(input) {
  const doc = buildProgressUpdatePdf(input);
  doc.save(progressUpdateFilename(input));
  return doc;
}

/** Shared snapshot numbers for studio + portal UI. */
export function progressSnapshotMetrics(diffInput) {
  const diff = normalizeDiff(diffInput);
  return {
    deletedCount: diff.deleted.length,
    addedCount: diff.added.length,
    changedCount: diff.changed.length,
    totalDebtRemoved: diff.totalDebtRemoved,
    negativeCounts: diff.negativeCounts,
    scoreDeltas: diff.scoreDeltas,
    deleted: diff.deleted,
    added: diff.added,
    changed: diff.changed,
  };
}
