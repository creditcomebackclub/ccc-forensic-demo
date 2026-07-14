import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const NAVY = [27, 42, 74];
const GOLD = [201, 168, 76];
const INK = [17, 24, 39];
const MUTED = [107, 114, 128];
const FAINT = [156, 163, 175];
const GRID = [238, 240, 244];

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

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export async function buildAuditPdfDoc(audit) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 48;
  let y = 0;

  let logoDataUrl = null;
  try {
    const resp = await fetch('/logo.jpg');
    if (resp.ok) {
      const blob = await resp.blob();
      const base64 = await blobToBase64(blob);
      logoDataUrl = 'data:image/jpeg;base64,' + base64;
    }
  } catch (e) {
    console.warn('Could not load logo for PDF', e);
  }

  const client = audit.client || {};
  const scores = audit.scores || {};
  const accounts = audit.accounts || [];
  const inquiries = audit.inquiries || [];
  const personalInfo = audit.personalInfo || {};
  const preparedDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // --- 1. Header Band ---
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageWidth, 84, 'F');
  
  if (logoDataUrl) {
    // 40x40 logo, nicely rounded if it was PNG, but we'll just draw it
    doc.addImage(logoDataUrl, 'JPEG', margin, 22, 40, 40);
  }
  
  const textStartX = logoDataUrl ? margin + 56 : margin;
  
  doc.setTextColor(...GOLD);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Credit Comeback Club Forensic Audit', textStartX, 42);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Prepared: ${preparedDate}`, textStartX, 60);
  y = 114;

  // --- 2. Client Info & Executive Summary Side-by-Side ---
  doc.setTextColor(...INK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(client.name || 'Client', margin, y);
  
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...MUTED);
  y += 18;
  if (client.address) { doc.text(client.address, margin, y); y += 14; }
  doc.text(`Accounts Targeted: ${audit.accountsTargeted || 0}   |   Total Violations: ${audit.totalViolations || 0}`, margin, y);
  y += 24;

  // Draw Scores
  doc.setFillColor(...GRID);
  doc.rect(margin, y, pageWidth - (margin * 2), 60, 'F');
  const bureaus = [['Equifax', scores.equifax], ['Experian', scores.experian], ['TransUnion', scores.transunion]];
  const colWidth = (pageWidth - margin * 2) / 3;
  bureaus.forEach(([label, score], i) => {
    const x = margin + i * colWidth + 24;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.setTextColor(...NAVY);
    doc.text(String(score ?? '—'), x, y + 30);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(label.toUpperCase(), x, y + 46);
  });
  y += 84;

  // Executive summary
  if (audit.executiveSummary) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...NAVY);
    doc.text('EXECUTIVE SUMMARY', margin, y);
    y += 14;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(audit.executiveSummary, pageWidth - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 14 + 20;
  }

  // --- 3. Personal Information Discrepancies ---
  // personalInfo has keys like names, addresses, employers which are arrays of strings
  const hasPersonalInfo = personalInfo.names?.length > 0 || personalInfo.addresses?.length > 0;
  if (hasPersonalInfo) {
    if (y > doc.internal.pageSize.getHeight() - 100) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...NAVY);
    doc.text('PERSONAL INFORMATION VARIANCES', margin, y);
    y += 12;

    const piData = [];
    if (personalInfo.names && personalInfo.names.length) piData.push(['Name Variations', personalInfo.names.join(', ')]);
    if (personalInfo.addresses && personalInfo.addresses.length) piData.push(['Address Variations', personalInfo.addresses.join(' | ')]);
    if (personalInfo.employers && personalInfo.employers.length) piData.push(['Employers', personalInfo.employers.join(', ')]);

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      body: piData,
      theme: 'plain',
      styles: { cellPadding: 4, fontSize: 9, textColor: INK },
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 120 } }
    });
    y = doc.lastAutoTable.finalY + 24;
  }

  // --- 4. Accounts Table ---
  if (accounts.length) {
    if (y > doc.internal.pageSize.getHeight() - 150) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...NAVY);
    doc.text('TARGETED ACCOUNTS (METRO 2 VIOLATIONS)', margin, y);
    y += 8;
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
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 9, textColor: INK },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { cellPadding: 6 },
    });
    y = doc.lastAutoTable.finalY + 24;
  }

  // --- 5. Inquiries Table ---
  if (inquiries.length) {
    if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...NAVY);
    doc.text('UNAUTHORIZED INQUIRIES', margin, y);
    y += 8;
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Creditor', 'Date', 'Bureau(s)']],
      body: inquiries.map((iq) => [
        iq.creditor || '',
        iq.date || '-',
        (iq.bureau || []).join(', ') || '-',
      ]),
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 9, fontStyle: 'bold' },
      bodyStyles: { fontSize: 9, textColor: INK },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      styles: { cellPadding: 6 },
    });
    y = doc.lastAutoTable.finalY + 24;
  }

  // --- 6. Battle Plan (Detailed Layout) ---
  if (accounts.length) {
    if (y > doc.internal.pageSize.getHeight() - 120) { doc.addPage(); y = margin; }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(...GOLD);
    doc.text('Your Dispute Battle Plan', margin, y);
    y += 24;

    accounts.forEach((a) => {
      // Check space before drawing block
      if (y > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); y = margin; }

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...NAVY);
      doc.text(`${a.furnisher || 'Furnisher'} (Batch ${a.batch || 2})`, margin, y);
      y += 14;

      const details = [];
      if (a.furnisherAddress) details.push(`Address: ${a.furnisherAddress}`);
      if (a.addressStatus) details.push(`Verification: ${a.addressStatus}`);
      if (a.primaryViolation) details.push(`Core Violation: ${a.primaryViolation}`);
      if (a.strategy) details.push(`Action Plan: ${a.strategy}`);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);

      details.forEach(det => {
        const lines = doc.splitTextToSize(`• ${det}`, pageWidth - margin * 2);
        if (y + lines.length * 13 > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); y = margin; }
        doc.text(lines, margin + 4, y);
        y += lines.length * 13 + 4;
      });
      y += 12;
    });
  }

  // --- 7. Footer on every page ---
  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const h = doc.internal.pageSize.getHeight();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(`Credit Comeback Club | 3088 Colorado Ave, Grand Junction, CO 81504 | 970-644-0063 | Page ${i} of ${pageCount}`, margin, h - 24);
  }

  return doc;
}
