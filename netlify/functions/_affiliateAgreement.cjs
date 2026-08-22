const crypto = require('crypto');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

const TEMPLATE_VERSION = 'ccc-affiliate-agreement-v1-draft';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n[ \t]+/g, '\n').replace(/\n\s*\n\s*\n/g, '\n\n').trim();
}

function wrapText(font, text, size, width) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= width || !line) line = candidate;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

async function buildSignedAgreementPdf({ agreement, signerName, signedAt, ipAddress }) {
  const evidenceDate = new Date(signedAt);
  if (Number.isNaN(evidenceDate.getTime())) throw new Error('A valid server signing timestamp is required');
  // pdf-lib otherwise writes the current wall clock into CreationDate and
  // ModDate. Freeze all generated metadata to the signing claim so an exact
  // retry produces the same immutable bytes and content hash.
  const pdf = await PDFDocument.create({ updateMetadata: false });
  pdf.setCreator('Credit Comeback Club');
  pdf.setProducer('Credit Comeback Club');
  pdf.setCreationDate(evidenceDate);
  pdf.setModificationDate(evidenceDate);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 54;
  const pageWidth = 612;
  const pageHeight = 792;
  const contentWidth = pageWidth - margin * 2;
  let page;
  let y;
  const addPage = () => {
    page = pdf.addPage([pageWidth, pageHeight]);
    y = pageHeight - margin;
    page.drawText('CREDIT COMEBACK CLUB', { x: margin, y, size: 12, font: bold, color: rgb(0.11, 0.16, 0.29) });
    y -= 26;
  };
  const addLines = (text, { size = 10, font = regular, gap = 4, color = rgb(0.08, 0.1, 0.14) } = {}) => {
    for (const paragraph of String(text || '').split(/\n+/)) {
      const lines = wrapText(font, paragraph, size, contentWidth);
      for (const line of lines) {
        if (y < margin + 30) addPage();
        page.drawText(line, { x: margin, y, size, font, color });
        y -= size + gap;
      }
      y -= 5;
    }
  };
  addPage();
  addLines(agreement.document_snapshot?.title || 'Affiliate Partner Agreement', { size: 18, font: bold, gap: 7 });
  addLines(`Agreement ID: ${agreement.id}\nTemplate version: ${agreement.template_version}\nPrepared for: ${agreement.applicant_snapshot?.name || ''} (${agreement.applicant_snapshot?.email || ''})`, { size: 9, color: rgb(0.35, 0.38, 0.45) });
  addLines('AGREEMENT TERMS', { size: 11, font: bold });
  addLines(stripHtml(agreement.document_snapshot?.bodyHtml));
  addLines('COMPENSATION TERMS', { size: 11, font: bold });
  addLines(`Commission rate: ${Math.round(Number(agreement.compensation_snapshot?.commissionRate || 0) * 10000) / 100}%\n${agreement.compensation_snapshot?.compensationTerms || ''}`);
  addLines('ELECTRONIC ACCEPTANCE', { size: 11, font: bold });
  addLines(`Electronically signed by: ${signerName}\nSigned at: ${signedAt}\nIP address: ${ipAddress || 'Unavailable'}\nThe signer accepted the frozen agreement, compensation terms, and use of electronic records and signatures.`);
  const bytes = Buffer.from(await pdf.save());
  return { bytes, hash: sha256(bytes) };
}

module.exports = { TEMPLATE_VERSION, sha256, stripHtml, buildSignedAgreementPdf };
