import { jsPDF } from 'jspdf';
import {
  accountBalance,
  blueprintStats,
  ensureSentence,
  money,
  openingMoveBullets,
  personalInfoLines,
} from './recoveryBlueprintData.js';

const NAVY = [11, 28, 51];
const NAVY_DEEP = [6, 18, 34];
const NAVY_MID = [18, 35, 58];
const GOLD = [196, 163, 90];
const GOLD_BRIGHT = [224, 194, 120];
const CREAM = [247, 243, 234];
const MIST = [232, 238, 245];
const STEEL = [90, 107, 125];
const INK = [18, 35, 58];
const WHITE = [255, 255, 255];

function slugName(s) {
  return String(s || 'client')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'client';
}

export function auditPdfFilename(audit) {
  const name = slugName((audit && audit.client && audit.client.name) || 'client');
  const date = (audit && audit.client && audit.client.reportDate) || new Date().toISOString().slice(0, 10);
  return `ccc-recovery-blueprint-${name}-${date}.pdf`;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function loadLogoDataUrl() {
  try {
    const resp = await fetch('/logo.jpg');
    if (resp.ok) {
      const blob = await resp.blob();
      const base64 = await blobToBase64(blob);
      return `data:image/jpeg;base64,${base64}`;
    }
  } catch (_) {
    /* browser-relative fetch fails in Node tests — fall through */
  }
  try {
    // Node / Vite SSR fallback for smoke tests
    const { readFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
    const buf = readFileSync(join(root, 'public/logo.jpg'));
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch (e) {
    console.warn('Could not load logo for PDF', e);
    return null;
  }
}

function pageSize(doc) {
  return {
    w: doc.internal.pageSize.getWidth(),
    h: doc.internal.pageSize.getHeight(),
  };
}

function fillPage(doc, rgb) {
  const { w, h } = pageSize(doc);
  doc.setFillColor(...rgb);
  doc.rect(0, 0, w, h, 'F');
}

function setFont(doc, style, size) {
  doc.setFont('helvetica', style);
  doc.setFontSize(size);
}

function drawWrapped(doc, text, x, y, maxWidth, lineHeight) {
  const lines = doc.splitTextToSize(String(text || ''), maxWidth);
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
}

function formatReportDate(raw) {
  if (!raw) return '';
  const d = new Date(`${raw}T12:00:00`);
  if (Number.isNaN(d.getTime())) return String(raw);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function locationFromAddress(address) {
  const s = String(address || '').trim();
  if (!s) return '';
  // Prefer "City, ST" from a US-style street address
  const m = s.match(/,\s*([^,]+,\s*[A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*$/);
  if (m) return m[1].replace(/\s+/g, ' ').trim();
  const parts = s.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join(', ');
  return s;
}

function firstName(full) {
  const n = String(full || '').trim();
  return n.split(/\s+/)[0] || 'there';
}

function drawBrandHeader(doc, logoDataUrl, opts = {}) {
  const margin = opts.margin || 54;
  const light = !!opts.light;
  let x = margin;
  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'JPEG', margin, 42, 40, 40);
      x = margin + 52;
    } catch (_) {
      /* ignore bad logo */
    }
  }
  setFont(doc, 'bold', 16);
  doc.setTextColor(...(light ? CREAM : NAVY));
  doc.text('Credit Comeback Club', x, 58);
  setFont(doc, 'normal', 8);
  doc.setTextColor(...GOLD);
  doc.text('FORENSIC CREDIT RECOVERY', x, 72);
}

function drawMetaRow(doc, items, y, opts = {}) {
  const margin = opts.margin || 54;
  const { w } = pageSize(doc);
  const usable = w - margin * 2;
  const col = usable / Math.max(items.length, 1);
  items.forEach((item, i) => {
    const x = margin + i * col;
    setFont(doc, 'normal', 8);
    doc.setTextColor(...GOLD);
    doc.text(String(item.label || '').toUpperCase(), x, y);
    setFont(doc, 'bold', 11);
    doc.setTextColor(...(opts.valueColor || CREAM));
    const lines = doc.splitTextToSize(String(item.value || '—'), col - 12);
    doc.text(lines[0] || '—', x, y + 16);
  });
}

function drawCoverPage(doc, audit, logoDataUrl, stats) {
  fillPage(doc, NAVY_DEEP);
  const { w, h } = pageSize(doc);
  // Soft gold wash (solid, slightly darker navy overlay — no opacity APIs)
  doc.setFillColor(20, 36, 58);
  doc.circle(w * 0.88, 20, 150, 'F');

  const margin = 54;
  drawBrandHeader(doc, logoDataUrl, { margin, light: true });

  const client = audit.client || {};
  const reportLabel = formatReportDate(client.reportDate) || 'Report on file';
  setFont(doc, 'normal', 9);
  doc.setTextColor(...GOLD_BRIGHT);
  doc.text(`PRIVATE CLIENT BLUEPRINT  ·  ${reportLabel.toUpperCase()}`, margin, 280);

  const name = client.name || 'Client';
  setFont(doc, 'bold', 36);
  doc.setTextColor(...CREAM);
  let y = 318;
  const nameLines = doc.splitTextToSize(`${name},`, w - margin * 2 - 20);
  doc.text(nameLines, margin, y);
  y += nameLines.length * 40;
  doc.text('your comeback', margin, y);
  y += 40;
  setFont(doc, 'bold', 36);
  doc.setTextColor(...GOLD_BRIGHT);
  doc.text('starts here.', margin, y);

  y += 36;
  setFont(doc, 'normal', 11);
  doc.setTextColor(247, 243, 234);
  const lead = 'We reviewed all three bureaus. We found where the file is wrong, where it is weak, and exactly where to strike first — so every month of work moves the needle on the accounts that matter most.';
  y = drawWrapped(doc, lead, margin, y, w - margin * 2 - 40, 16);

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.6);
  doc.line(margin, h - 88, w - margin, h - 88);

  const location = locationFromAddress(client.address);
  drawMetaRow(doc, [
    { label: 'Client', value: client.name || '—' },
    { label: 'Location', value: location || '—' },
    { label: 'File date', value: reportLabel || '—' },
    { label: 'Bureaus', value: 'EQ · EXP · TU' },
  ], h - 68, { margin, valueColor: CREAM });
}

function drawStakesPage(doc, audit, stats) {
  fillPage(doc, CREAM);
  const { w, h } = pageSize(doc);
  const margin = 54;

  setFont(doc, 'normal', 9);
  doc.setTextColor(...GOLD);
  doc.text('CREDIT COMEBACK CLUB', margin, 56);

  setFont(doc, 'bold', 28);
  doc.setTextColor(...NAVY);
  doc.text("What's sitting on", margin, 100);
  doc.text('your credit file.', margin, 134);

  setFont(doc, 'normal', 11);
  doc.setTextColor(...STEEL);
  const scannedBit = stats.scanned
    ? `Across Equifax, Experian, and TransUnion we scanned ${stats.scanned} tradelines and locked onto the ${stats.targeted} accounts`
    : `Across Equifax, Experian, and TransUnion we locked onto the ${stats.targeted} accounts`;
  const stakesLead = `${scannedBit} that are dragging your score — and your options — the hardest.`;
  drawWrapped(doc, stakesLead, margin, 168, w - margin * 2, 16);

  setFont(doc, 'bold', 54);
  doc.setTextColor(...NAVY);
  doc.text(money(stats.totalBalance), margin, 280);
  setFont(doc, 'normal', 10);
  doc.setTextColor(...STEEL);
  doc.text('IN TARGETED NEGATIVE BALANCES & COLLECTIONS', margin, 304);

  doc.setDrawColor(11, 28, 51);
  doc.setLineWidth(0.4);
  doc.line(margin, h - 140, w - margin, h - 140);

  const statsRow = [
    { n: String(stats.targeted), l: 'PRIORITY TARGETS' },
    { n: String(stats.violations), l: 'ACCURACY ISSUES FLAGGED' },
    { n: money(stats.batch1Balance), l: 'BATCH 1 STRIKE ZONE' },
  ];
  const col = (w - margin * 2) / 3;
  statsRow.forEach((s, i) => {
    const x = margin + i * col;
    setFont(doc, 'bold', 26);
    doc.setTextColor(...NAVY);
    doc.text(s.n, x, h - 100);
    setFont(doc, 'normal', 8);
    doc.setTextColor(...STEEL);
    doc.text(s.l, x, h - 80);
  });
}

function drawOpeningMovePage(doc, audit, stats) {
  fillPage(doc, NAVY);
  const { w, h } = pageSize(doc);
  const margin = 54;
  const om = stats.openingMove;

  setFont(doc, 'normal', 9);
  doc.setTextColor(...GOLD_BRIGHT);
  doc.text('THE OPENING MOVE', margin, 56);

  setFont(doc, 'bold', 26);
  doc.setTextColor(...CREAM);
  doc.text("We don't spray and pray.", margin, 96);
  doc.text('We open with power.', margin, 128);

  setFont(doc, 'normal', 11);
  doc.setTextColor(220, 214, 200);
  drawWrapped(
    doc,
    'Month one is built around the single account that gives you the best leverage: size, reporting strength, and clear accuracy pressure.',
    margin,
    158,
    w - margin * 2,
    15,
  );

  if (!om) {
    setFont(doc, 'normal', 12);
    doc.setTextColor(...CREAM);
    doc.text('No Batch 1 target was available on this file.', margin, 220);
    return;
  }

  // Gold accent bar
  doc.setFillColor(...GOLD);
  doc.rect(margin, 200, 3, Math.max(h - 270, 120), 'F');

  const contentX = margin + 22;
  const maxW = w - contentX - margin;

  setFont(doc, 'normal', 9);
  doc.setTextColor(...GOLD_BRIGHT);
  doc.text(String(om.furnisher || 'Target account').toUpperCase(), contentX, 220);

  setFont(doc, 'bold', 36);
  doc.setTextColor(...CREAM);
  doc.text(money(accountBalance(om)), contentX, 262);

  setFont(doc, 'normal', 11);
  doc.setTextColor(230, 224, 210);
  const why = `${ensureSentence(om.primaryViolation || om.status || 'Priority charge-off / collection on file')} This is the first letter we write — because correcting this account changes how every lender reads your file.`;
  let y = drawWrapped(doc, why, contentX, 292, maxW, 15);

  y += 14;
  const bullets = openingMoveBullets(om);
  const footerReserve = 70;

  const paintBullet = (b) => {
    const block = `${b.field}: ${b.text}`;
    setFont(doc, 'normal', 10);
    doc.setTextColor(...CREAM);
    const lines = doc.splitTextToSize(block, maxW - 14);
    const need = lines.length * 13 + 8;
    if (y + need > h - footerReserve) {
      // Continue on a new navy page — never truncate mid-sentence.
      doc.addPage();
      fillPage(doc, NAVY);
      doc.setFillColor(...GOLD);
      doc.rect(margin, 54, 3, h - 108, 'F');
      setFont(doc, 'normal', 9);
      doc.setTextColor(...GOLD_BRIGHT);
      doc.text('THE OPENING MOVE  ·  CONTINUED', margin + 22, 56);
      y = 84;
    }
    doc.setFillColor(...GOLD);
    doc.rect(contentX, y - 4, 5, 5, 'F');
    doc.text(lines, contentX + 14, y);
    y += need;
  };

  bullets.forEach(paintBullet);

  const others = (stats.batch1 || [])
    .filter((a) => a !== om)
    .map((a) => a.furnisher)
    .filter(Boolean);
  if (others.length) {
    if (y > h - 60) {
      doc.addPage();
      fillPage(doc, NAVY);
      y = 64;
    }
    doc.setDrawColor(...GOLD);
    doc.setLineWidth(0.5);
    doc.line(margin, Math.min(y + 8, h - 56), w - margin, Math.min(y + 8, h - 56));
    setFont(doc, 'normal', 9);
    doc.setTextColor(...GOLD_BRIGHT);
    const also = `Also in Batch 1: ${others.join(' · ')}`;
    drawWrapped(doc, also, margin, Math.min(y + 24, h - 40), w - margin * 2, 12);
  }
}

function drawPathPage(doc, audit, stats) {
  fillPage(doc, CREAM);
  const { w } = pageSize(doc);
  const margin = 54;

  setFont(doc, 'normal', 9);
  doc.setTextColor(...GOLD);
  doc.text('YOUR RECOVERY PATH', margin, 56);

  setFont(doc, 'bold', 28);
  doc.setTextColor(...NAVY);
  doc.text('A clear plan.', margin, 100);
  doc.text('Not a mystery box.', margin, 134);

  setFont(doc, 'normal', 11);
  doc.setTextColor(...STEEL);
  drawWrapped(
    doc,
    'You always know what we’re doing this month, why we’re doing it, and what “winning” looks like before we move to the next wave.',
    margin,
    168,
    w - margin * 2,
    15,
  );

  const pi = personalInfoLines(audit.personalInfo);
  const piNote = pi.length
    ? ' Personal-info cleanup is queued for name/address variants still floating on the file.'
    : '';

  const steps = [
    {
      n: '01',
      title: 'Forensic audit (done)',
      body: `Three-bureau disclosures pulled apart. ${stats.targeted} targets ranked. ${stats.violations} accuracy issues documented.${piNote}`,
    },
    {
      n: '02',
      title: 'Batch 1 — the heavy hitters',
      body: `Direct disputes on your highest-leverage accounts first — ${money(stats.batch1Balance)} in opening firepower across ${stats.batch1.length || 0} Batch 1 targets.`,
    },
    {
      n: '03',
      title: 'Batch 2 — clean the rest',
      body: `Remaining collections and charge-offs (${money(stats.batch2Balance)}) get sequenced after Batch 1 responses land — so we don’t dilute leverage or miss follow-up windows.`,
    },
    {
      n: '04',
      title: 'Rebuild & protect',
      body: 'As negatives fall, we guide positive tradeline strategy and watch for re-aging or reinsertion. The goal isn’t a temporary bump — it’s a file lenders trust.',
    },
  ];

  let y = 220;
  steps.forEach((step, idx) => {
    setFont(doc, 'bold', 18);
    doc.setTextColor(...GOLD);
    doc.text(step.n, margin, y);
    setFont(doc, 'bold', 13);
    doc.setTextColor(...NAVY);
    doc.text(step.title, margin + 48, y);
    setFont(doc, 'normal', 10);
    doc.setTextColor(...STEEL);
    y = drawWrapped(doc, ensureSentence(step.body), margin + 48, y + 18, w - margin * 2 - 48, 14);
    y += 28;
    if (idx < steps.length - 1) {
      doc.setDrawColor(...GOLD);
      doc.setLineWidth(0.5);
      doc.line(margin + 10, y - 18, margin + 10, y - 8);
    }
  });
}

function drawBatch1Page(doc, audit, stats) {
  fillPage(doc, MIST);
  const { w, h } = pageSize(doc);
  const margin = 54;

  setFont(doc, 'normal', 9);
  doc.setTextColor(...GOLD);
  doc.text('BATCH 1 STRIKE LIST', margin, 56);

  setFont(doc, 'bold', 28);
  doc.setTextColor(...NAVY);
  doc.text('Where month one goes.', margin, 100);

  setFont(doc, 'normal', 11);
  doc.setTextColor(...STEEL);
  let y = drawWrapped(
    doc,
    'These are the accounts we attack first. Every one has a documented reason — not a generic “this is negative” letter.',
    margin,
    130,
    w - margin * 2,
    15,
  );
  y += 18;

  const list = (stats.batch1.length ? stats.batch1 : stats.accounts)
    .slice()
    .sort((a, b) => accountBalance(b) - accountBalance(a));

  list.forEach((a) => {
    if (y > h - 90) return;
    doc.setDrawColor(11, 28, 51);
    doc.setLineWidth(0.3);
    doc.line(margin, y, w - margin, y);
    y += 18;

    setFont(doc, 'bold', 16);
    doc.setTextColor(...NAVY);
    doc.text(money(accountBalance(a)), margin, y + 4);

    setFont(doc, 'bold', 11);
    doc.text(String(a.furnisher || 'Account'), margin + 90, y);
    setFont(doc, 'normal', 9);
    doc.setTextColor(...STEEL);
    const meta = [a.status, (a.bureaus || []).join(', ')].filter(Boolean).join(' · ');
    const metaLines = doc.splitTextToSize(meta || 'Batch 1 target', w - margin * 2 - 170);
    doc.text(metaLines[0], margin + 90, y + 14);

    setFont(doc, 'bold', 8);
    doc.setTextColor(...NAVY);
    doc.text(Number(a.batch) === 1 ? 'BATCH 1' : `BATCH ${a.batch || 2}`, w - margin - 52, y + 4);

    y += 36;
  });

  if (stats.batch2Balance > 0) {
    setFont(doc, 'normal', 10);
    doc.setTextColor(...STEEL);
    drawWrapped(
      doc,
      ensureSentence(
        `Later wave includes remaining collections and charge-offs (${money(stats.batch2Balance)} combined) — queued so Batch 1 has room to work`,
      ),
      margin,
      Math.min(y + 12, h - 50),
      w - margin * 2,
      13,
    );
  }
}

function drawCtaPage(doc, audit, logoDataUrl) {
  fillPage(doc, NAVY_DEEP);
  const { w, h } = pageSize(doc);
  const margin = 54;
  const client = audit.client || {};

  doc.setFillColor(20, 36, 58);
  doc.circle(w * 0.5, -40, 200, 'F');

  setFont(doc, 'normal', 9);
  doc.setTextColor(...GOLD_BRIGHT);
  doc.text('READY WHEN YOU ARE', margin, 64);

  setFont(doc, 'bold', 30);
  doc.setTextColor(...CREAM);
  doc.text('Your file already has', margin, 110);
  doc.text('a battle plan.', margin, 146);
  setFont(doc, 'bold', 30);
  doc.setTextColor(...GOLD_BRIGHT);
  doc.text('Now it needs a team.', margin, 182);

  setFont(doc, 'normal', 11);
  doc.setTextColor(230, 224, 210);
  drawWrapped(
    doc,
    'Most people stare at a 200-page credit report and feel stuck. You don’t have to. We already know the Opening Move, the Batch 1 list, and the sequence that follows. The only decision left is whether we run it for you.',
    margin,
    220,
    w - margin * 2 - 20,
    16,
  );

  // CTA box
  doc.setDrawColor(...GOLD);
  doc.setLineWidth(1);
  doc.setFillColor(22, 38, 60);
  doc.roundedRect(margin, 310, w - margin * 2, 100, 4, 4, 'FD');
  doc.roundedRect(margin, 310, w - margin * 2, 100, 4, 4, 'S');

  setFont(doc, 'bold', 16);
  doc.setTextColor(...CREAM);
  doc.text('Start Month One — Batch 1 letters', margin + 22, 348);
  setFont(doc, 'normal', 10);
  doc.setTextColor(230, 224, 210);
  drawWrapped(
    doc,
    'We prepare and mail the opening disputes on your highest-leverage accounts, track bureau responses, and keep you in the loop every step. You focus on your life. We focus on the file.',
    margin + 22,
    370,
    w - margin * 2 - 44,
    14,
  );

  doc.setDrawColor(...GOLD);
  doc.setLineWidth(0.5);
  doc.line(margin, h - 110, w - margin, h - 110);

  if (logoDataUrl) {
    try {
      doc.addImage(logoDataUrl, 'JPEG', margin, h - 92, 28, 28);
    } catch (_) {
      /* ignore */
    }
  }
  setFont(doc, 'bold', 14);
  doc.setTextColor(...CREAM);
  doc.text('Credit Comeback Club', margin + (logoDataUrl ? 40 : 0), h - 80);
  setFont(doc, 'normal', 8);
  doc.setTextColor(...GOLD);
  doc.text('FORENSIC CREDIT RECOVERY', margin + (logoDataUrl ? 40 : 0), h - 66);

  setFont(doc, 'normal', 9);
  doc.setTextColor(200, 196, 184);
  const right = [
    `Prepared for ${client.name || 'Client'}`,
    client.reportDate ? `Report date ${formatReportDate(client.reportDate)}` : null,
    'creditcomebackclub.com',
  ].filter(Boolean);
  right.forEach((line, i) => {
    doc.text(line, w - margin, h - 84 + i * 12, { align: 'right' });
  });

  setFont(doc, 'normal', 7);
  doc.setTextColor(140, 148, 160);
  drawWrapped(
    doc,
    'This Recovery Blueprint is generated from your bureau disclosures for client presentation and campaign scoping. Results vary; credit repair companies cannot guarantee removal of accurate information. Production dispute letters are prepared separately in the CCC engine before mailing.',
    margin,
    h - 44,
    w - margin * 2,
    9,
  );
}

/**
 * Client-facing Recovery Blueprint PDF (standard audit deliverable).
 * Opening Move = highest-balance Batch 1 account; strategy/violation copy is never truncated mid-sentence.
 */
export async function buildAuditPdfDoc(audit) {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const logoDataUrl = await loadLogoDataUrl();
  const stats = blueprintStats(audit || {});

  drawCoverPage(doc, audit || {}, logoDataUrl, stats);
  doc.addPage();
  drawStakesPage(doc, audit || {}, stats);
  doc.addPage();
  drawOpeningMovePage(doc, audit || {}, stats);
  doc.addPage();
  drawPathPage(doc, audit || {}, stats);
  doc.addPage();
  drawBatch1Page(doc, audit || {}, stats);
  doc.addPage();
  drawCtaPage(doc, audit || {}, logoDataUrl);

  return doc;
}

/** @deprecated alias — same Blueprint builder */
export const buildRecoveryBlueprintPdf = buildAuditPdfDoc;

export function defaultRecoveryBlueprintEmail({ audit, openingMove } = {}) {
  const client = (audit && audit.client) || {};
  const stats = blueprintStats(audit || {});
  const om = openingMove || stats.openingMove;
  const name = firstName(client.name);
  const omLine = om
    ? `Your Opening Move is ${om.furnisher || 'your top Batch 1 account'} (${money(accountBalance(om))}) — that’s where Month One starts.`
    : 'Your Month One Batch 1 strike list is ready.';

  return `Hi ${name},

Your Credit Comeback Club Recovery Blueprint is ready.

We identified ${stats.targeted} priority accounts and ${stats.violations} accuracy issues across your file — about ${money(stats.totalBalance)} in targeted negatives, with ${money(stats.batch1Balance)} in the Batch 1 strike zone.

${omLine}

Your Recovery Blueprint PDF is attached. Review it, and reply when you’re ready for us to run Month One.

— Chris & the Credit Comeback Club Team
970-644-0063 | creditcomebackclub.com`;
}
