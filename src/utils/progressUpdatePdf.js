import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const C = {
  navy: [18, 31, 56],
  gold: [201, 168, 76],
  cream: [247, 244, 237],
  ink: [20, 27, 40],
  muted: [99, 107, 121],
  line: [223, 226, 232],
  white: [255, 255, 255],
  green: [34, 105, 82],
  amber: [146, 64, 14],
};

const PAGE_W = 612;
const PAGE_H = 792;
const M = 48;

function monthLabel(dateStr) {
  if (!dateStr) return '';
  return new Date(String(dateStr) + (String(dateStr).includes('T') ? '' : 'T00:00:00'))
    .toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function fmtDate(dateStr) {
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

function ensureSpace(doc, y, need = 80) {
  if (y + need < PAGE_H - 56) return y;
  doc.addPage();
  setColor(doc, C.cream, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');
  return 56;
}

function footer(doc, clientName, page, total) {
  setColor(doc, C.line, true);
  doc.rect(M, 750, PAGE_W - M * 2, 1, 'F');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  setColor(doc, C.muted);
  doc.text('CREDIT COMEBACK CLUB  /  PROGRESS UPDATE', M, 770);
  doc.text(`${clientName}  /  ${page} OF ${total}`, PAGE_W - M, 770, { align: 'right' });
}

/**
 * Build a client-facing Progress Update PDF from the studio draft.
 * @param {{ clientName: string, fromReportDate?: string, toReportDate?: string, narrative: string, diff?: object }} input
 */
export function buildProgressUpdatePdf(input) {
  const clientName = String(input.clientName || 'Client');
  const narrative = String(input.narrative || '').trim();
  const diff = input.diff || {};
  const deleted = Array.isArray(diff.deleted) ? diff.deleted : [];
  const added = Array.isArray(diff.new) ? diff.new : [];
  const deltas = Object.entries(diff.scoreDeltas || {}).filter(([, s]) => s && s.delta != null);
  const period = [monthLabel(input.fromReportDate), monthLabel(input.toReportDate)].filter(Boolean).join(' → ')
    || monthLabel(input.toReportDate)
    || 'Progress Update';

  const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
  setColor(doc, C.cream, true);
  doc.rect(0, 0, PAGE_W, PAGE_H, 'F');

  // Header band
  setColor(doc, C.navy, true);
  doc.rect(0, 0, PAGE_W, 132, 'F');
  setColor(doc, C.gold, true);
  doc.rect(M, 36, 40, 3, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setCharSpace(1.8);
  setColor(doc, C.gold);
  doc.text('CREDIT COMEBACK CLUB', M, 58);
  doc.setCharSpace(0);
  doc.setFontSize(24);
  setColor(doc, C.white);
  doc.text('Your Progress Update', M, 90);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  setColor(doc, C.gold);
  doc.text(`${clientName}  ·  ${period}`, M, 114);

  let y = 168;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setColor(doc, C.navy);
  doc.text('What changed since your last review', M, y);
  y += 18;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  setColor(doc, C.ink);
  const lines = doc.splitTextToSize(narrative || 'No narrative drafted yet.', PAGE_W - M * 2);
  for (const line of lines) {
    y = ensureSpace(doc, y, 18);
    doc.text(line, M, y);
    y += 15;
  }

  if (deltas.length) {
    y = ensureSpace(doc, y + 18, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setColor(doc, C.navy);
    doc.text('Score moves', M, y);
    y += 12;
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Bureau', 'Change']],
      body: deltas.map(([bureau, s]) => [
        String(bureau).replace(/^\w/, (c) => c.toUpperCase()),
        `${s.delta > 0 ? '+' : ''}${s.delta}`,
      ]),
      theme: 'plain',
      headStyles: { fillColor: C.navy, textColor: C.white, fontSize: 9 },
      bodyStyles: { textColor: C.ink, fontSize: 10 },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      styles: { cellPadding: 6 },
    });
    y = doc.lastAutoTable.finalY + 16;
  }

  if (deleted.length) {
    y = ensureSpace(doc, y + 8, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setColor(doc, C.green);
    doc.text('Accounts removed', M, y);
    y += 12;
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Furnisher', 'Balance']],
      body: deleted.map((a) => [a.furnisher || '—', a.balance != null ? money(a.balance) : '—']),
      theme: 'plain',
      headStyles: { fillColor: C.green, textColor: C.white, fontSize: 9 },
      bodyStyles: { textColor: C.ink, fontSize: 10 },
      styles: { cellPadding: 6 },
    });
    y = doc.lastAutoTable.finalY + 16;
  }

  if (added.length) {
    y = ensureSpace(doc, y + 8, 60);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setColor(doc, C.amber);
    doc.text('New items on the report', M, y);
    y += 12;
    autoTable(doc, {
      startY: y,
      margin: { left: M, right: M },
      head: [['Furnisher', 'Balance']],
      body: added.map((a) => [a.furnisher || '—', a.balance != null ? money(a.balance) : '—']),
      theme: 'plain',
      headStyles: { fillColor: [180, 120, 40], textColor: C.white, fontSize: 9 },
      bodyStyles: { textColor: C.ink, fontSize: 10 },
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

export function downloadProgressUpdatePdf(input) {
  const doc = buildProgressUpdatePdf(input);
  doc.save(progressUpdateFilename(input));
  return doc;
}

export { monthLabel, fmtDate };
