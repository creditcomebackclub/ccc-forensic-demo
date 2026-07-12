// Builds a real, on-brand PDF summary of a forensic audit — used by the
// "Download PDF" button and shared as the email attachment for "Email Audit
// to Client" so both features produce byte-identical output.
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const NAVY = [27, 42, 74];
const GOLD = [201, 168, 76];
const INK = [17, 24, 39];
const MUTED = [107, 114, 128];

function slugName(s) {
  return String(s || 'client')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'client';
}

export function auditPdfFilename(audit) {
  const name = slugName((audit && audit.client && audit.client.name) || 'client');
  const date = (audit && audit.client && audit.client.reportDate) || new Date().toISOString().slice(0, 10);
  return `ccc-forensic-audit-${name}-${date}.pdf`;
}

export function buildAuditPdfDoc(audit) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = 0;

  const client = audit.client || {};
  const scores = audit.scores || {};
  const accounts = audit.accounts || [];
  const preparedDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // Header band
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 74, 'F');
  doc.setTextColor(...GOLD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Credit Comeback Club Forensic Audit', margin, 34);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Prepared: ${preparedDate}`, margin, 52);
  y = 100;

  // Client info
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(client.name || 'Client', margin, y);
  y += 16;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  if (client.address) { doc.text(client.address, margin, y); y += 14; }
  doc.text(`Accounts Targeted: ${audit.accountsTargeted || 0}   |   Total Violations: ${audit.totalViolations || 0}`, margin, y);
  y += 26;

  // Scores row
  const bureaus = [['Equifax', scores.equifax], ['Experian', scores.experian], ['TransUnion', scores.transunion]];
  const colWidth = (pageWidth - margin * 2) / 3;
  bureaus.forEach(([label, score], i) => {
    const x = margin + i * colWidth;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...NAVY);
    doc.text(String(score ?? '—'), x, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x, y + 13);
  });
  y += 36;

  // Executive summary
  if (audit.executiveSummary) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text('EXECUTIVE SUMMARY', margin, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(audit.executiveSummary, pageWidth - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 13 + 16;
  }

  // Accounts table
  if (accounts.length) {
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Furnisher', 'Type', 'Status', 'Balance', 'Violations', 'Batch']],
      body: accounts.map((a) => [
        a.furnisher || '',
        a.type || '-',
        a.status || '-',
        a.balance ? `$${Number(a.balance).toLocaleString()}` : '-',
        String((a.violations && a.violations.length) || 0),
        `Batch ${a.batch || 2}`,
      ]),
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 9 },
      bodyStyles: { fontSize: 9, textColor: INK },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { cellPadding: 5 },
    });
    y = doc.lastAutoTable.finalY + 24;
  }

  // Battle plan — one row per account, condensed
  if (accounts.length) {
    if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...NAVY);
    doc.text('Your Dispute Battle Plan', margin, y);
    y += 18;

    accounts.forEach((a) => {
      const planLines = doc.splitTextToSize(
        `${a.furnisher || 'Furnisher'} (Batch ${a.batch || 2}, ${a.type === 'C' ? 'Collector' : 'Type ' + (a.type || 'B')}): ${a.primaryViolation || 'Violations identified in this report.'}`,
        pageWidth - margin * 2
      );
      if (y + planLines.length * 13 > doc.internal.pageSize.getHeight() - 60) { doc.addPage(); y = margin; }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      doc.text(planLines, margin, y);
      y += planLines.length * 13 + 10;
    });
  }

  // Footer on every page
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const h = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text('Credit Comeback Club | 3088 Colorado Ave, Grand Junction, CO 81504 | 970-644-0063', margin, h - 24);
  }

  return doc;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
