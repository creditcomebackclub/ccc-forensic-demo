const BOUNDARY_PREFIX = 'CCC-MAILPIECE:V1';
const EXHIBIT_PREFIX = 'CCC-MAILPIECE-EXHIBIT:V1';
const SHA256_RE = /^[0-9a-f]{64}$/;
const UUID_RE_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const LETTER_UUID_RE = new RegExp(`^${UUID_RE_SOURCE}$`, 'i');
const SAVED_CCC_TEXT_ID_RE = new RegExp(
  `^[a-z0-9]+(?:-[a-z0-9]+)*__${UUID_RE_SOURCE}`
    + '__[a-z0-9]+(?:-[a-z0-9]+)*'
    + '__[a-z0-9]+(?:-[a-z0-9]+)*'
    + '__[0-9]{4}-[0-9]{2}-[0-9]{2}'
    + '(?:__revision-[0-9]{10,16})?$',
  'i',
);
const EXHIBIT_KINDS = new Set(['screenshot', 'identity-id', 'identity-address', 'optional']);

function text(value) {
  return String(value ?? '');
}

function safeLetterId(value) {
  const id = text(value).trim();
  // Consolidated packets use UUIDs. Campaign Studio's saveLetter contract
  // uses a deterministic text key that includes the exact client UUID:
  // client__client-uuid__recipient__account__YYYY-MM-DD[__revision-N].
  // Accept only those two persisted formats. In particular, do not broaden
  // this to arbitrary text: the client UUID is part of the physical packet's
  // immutable hash/boundary identity and the separators must remain inert.
  if (id.length > 512 || (!LETTER_UUID_RE.test(id) && !SAVED_CCC_TEXT_ID_RE.test(id))) {
    throw new Error('A canonical CCC letter id is required to bind the physical mailpiece.');
  }
  return id.toLowerCase();
}

function safeExhibitId(value) {
  const id = text(value).trim();
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(id)) throw new Error('CCC exhibit identifiers must use the saved safe identifier format.');
  return id;
}

function safeExhibitKind(value) {
  const kind = text(value).trim();
  if (!EXHIBIT_KINDS.has(kind)) throw new Error('The CCC mailpiece contains an unsupported exhibit kind.');
  return kind;
}

export function escapeCccMailpieceHtml(value) {
  return text(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function canonicalizeCccLetterHtml(value) {
  let html = text(value);
  if (!html.trim()) throw new Error('The saved CCC letter has no printable HTML.');
  if (html.includes(BOUNDARY_PREFIX) || html.includes(EXHIBIT_PREFIX)) {
    throw new Error('The saved CCC letter contains reserved physical-mail boundary markers.');
  }
  if (!/<meta[^>]+charset/i.test(html)) {
    if (/<head[^>]*>/i.test(html)) {
      html = html.replace(/<head[^>]*>/i, (match) => `${match}<meta charset="UTF-8">`);
    } else {
      html = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>${html}</body></html>`;
    }
  }
  if (!/<\/body\s*>/i.test(html)) throw new Error('The canonical CCC letter has no closing body boundary.');
  return html;
}

export function cccLetterBindingInput(letterId, canonicalLetterHtml) {
  return `${safeLetterId(letterId)}\u0000${text(canonicalLetterHtml)}`;
}

export function cccPacketBoundaryMarkers(letterId, sha256) {
  const id = safeLetterId(letterId);
  const digest = text(sha256).trim().toLowerCase();
  if (!SHA256_RE.test(digest)) throw new Error('A lowercase SHA-256 is required to bind the CCC mailpiece.');
  const stem = `<!--${BOUNDARY_PREFIX}:LETTER:${id}:SHA256:${digest}:ENCLOSURES:`;
  return Object.freeze({ start: `${stem}START-->`, end: `${stem}END-->` });
}

export function cccExhibitMarkers(kindValue, idValue) {
  const kind = safeExhibitKind(kindValue);
  const id = safeExhibitId(idValue);
  const stem = `<!--${EXHIBIT_PREFIX}:${kind}:${encodeURIComponent(id)}:`;
  return Object.freeze({ start: `${stem}START-->`, end: `${stem}END-->` });
}

export function renderCccImageExhibit({ kind, id, heading, imageUrl, screenshot = false }) {
  const markers = cccExhibitMarkers(kind, id);
  const url = text(imageUrl);
  if (!/^https:\/\/[^"'<>\s]+$/.test(url)) throw new Error('CCC exhibit images require one safe HTTPS signed URL.');
  const safeHeading = escapeCccMailpieceHtml(heading);
  const screenshotAttribute = screenshot ? ` data-ccc-screenshot-id="${escapeCccMailpieceHtml(id)}"` : '';
  const body = `<div${screenshotAttribute} style="page-break-before:always;padding:40px;font-family:Arial,sans-serif;filter:grayscale(100%);-webkit-filter:grayscale(100%);">`
    + `<div style="font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:#1B2A4A;font-weight:700;margin-bottom:12px;border-bottom:2px solid #1B2A4A;padding-bottom:8px;">${safeHeading}</div>`
    + `<img src="${url}" style="display:block;max-width:100%;max-height:850px;margin:0 auto;object-fit:contain;" />`
    + '</div>';
  return `${markers.start}${body}${markers.end}`;
}

export function assembleBoundCccMailpiece({ letterId, letterHtml, letterSha256, enclosureHtml = '' }) {
  const canonical = canonicalizeCccLetterHtml(letterHtml);
  const enclosure = text(enclosureHtml);
  if (enclosure.includes(BOUNDARY_PREFIX)) throw new Error('CCC enclosure HTML contains a reserved packet boundary marker.');
  const markers = cccPacketBoundaryMarkers(letterId, letterSha256);
  const closingMatches = [...canonical.matchAll(/<\/body\s*>/gi)];
  const closing = closingMatches.at(-1);
  if (!closing) throw new Error('The canonical CCC letter has no closing body boundary.');
  const index = closing.index;
  return canonical.slice(0, index) + markers.start + enclosure + markers.end + canonical.slice(index);
}

export function inspectBoundCccMailpiece({ letterId, storedLetterHtml, expectedSha256, uploadedHtml }) {
  const issues = [];
  let canonical;
  let markers;
  try {
    canonical = canonicalizeCccLetterHtml(storedLetterHtml);
    markers = cccPacketBoundaryMarkers(letterId, expectedSha256);
  } catch (error) {
    return { issues: [error.message], canonicalLetterHtml: '', enclosureHtml: '', reconstructedLetterHtml: '' };
  }
  const uploaded = text(uploadedHtml);
  const reservedCount = (uploaded.match(/<!--CCC-MAILPIECE:V1:/g) || []).length;
  const startCount = uploaded.split(markers.start).length - 1;
  const endCount = uploaded.split(markers.end).length - 1;
  if (reservedCount !== 2 || startCount !== 1 || endCount !== 1) {
    issues.push('The exact CCC enclosure boundary markers are missing, duplicated, or do not match the saved letter fingerprint.');
    return { issues, canonicalLetterHtml: canonical, enclosureHtml: '', reconstructedLetterHtml: '' };
  }
  const start = uploaded.indexOf(markers.start);
  const enclosureStart = start + markers.start.length;
  const end = uploaded.indexOf(markers.end, enclosureStart);
  if (start < 0 || end < enclosureStart) {
    issues.push('The CCC enclosure boundaries are out of order.');
    return { issues, canonicalLetterHtml: canonical, enclosureHtml: '', reconstructedLetterHtml: '' };
  }
  const reconstructed = uploaded.slice(0, start) + uploaded.slice(end + markers.end.length);
  if (reconstructed !== canonical) {
    issues.push('The uploaded CCC letter portion is not byte-for-byte identical to the saved reviewed letter.');
  }
  return {
    issues,
    canonicalLetterHtml: canonical,
    enclosureHtml: uploaded.slice(enclosureStart, end),
    reconstructedLetterHtml: reconstructed,
  };
}

export function parseCccExhibitSections(enclosureHtml) {
  const html = text(enclosureHtml);
  const issues = [];
  const sections = [];
  const markerRe = /<!--CCC-MAILPIECE-EXHIBIT:V1:([a-z-]+):([^:]+):(START|END)-->/g;
  const rawMarkerCount = (html.match(/<!--CCC-MAILPIECE-EXHIBIT:V1:/g) || []).length;
  let cursor = 0;
  let match;
  while ((match = markerRe.exec(html)) !== null) {
    if (html.slice(cursor, match.index).trim()) {
      issues.push('CCC enclosure HTML exists outside a bound exhibit section.');
    }
    if (match[3] !== 'START') {
      issues.push('A CCC exhibit end marker appears without its matching start marker.');
      cursor = markerRe.lastIndex;
      continue;
    }
    let id;
    try { id = decodeURIComponent(match[2]); }
    catch { id = ''; }
    const kind = match[1];
    let expectedEnd;
    try { expectedEnd = cccExhibitMarkers(kind, id).end; }
    catch (error) {
      issues.push(error.message);
      cursor = markerRe.lastIndex;
      continue;
    }
    const endIndex = html.indexOf(expectedEnd, markerRe.lastIndex);
    if (endIndex < 0) {
      issues.push('A CCC exhibit is missing its exact closing marker.');
      cursor = markerRe.lastIndex;
      continue;
    }
    const nested = html.slice(markerRe.lastIndex, endIndex).includes(`<!--${EXHIBIT_PREFIX}:`);
    if (nested) issues.push('CCC exhibit sections may not be nested.');
    sections.push({ kind, id, html: html.slice(markerRe.lastIndex, endIndex) });
    cursor = endIndex + expectedEnd.length;
    markerRe.lastIndex = cursor;
  }
  if (html.slice(cursor).trim()) issues.push('CCC enclosure HTML exists outside a bound exhibit section.');
  if (rawMarkerCount !== sections.length * 2) issues.push('CCC exhibit markers are malformed, duplicated, or unmatched.');
  const keys = sections.map((section) => `${section.kind}\u0000${section.id}`);
  if (new Set(keys).size !== keys.length) issues.push('A CCC exhibit is duplicated in the physical packet.');
  return { sections, issues: [...new Set(issues)] };
}

export function cccExhibitImageUrl(sectionHtml) {
  const html = text(sectionHtml);
  const matches = [...html.matchAll(/<img\b[^>]*\bsrc\s*=\s*["'](https:\/\/[^"'<>\s]+)["'][^>]*>/gi)];
  if (matches.length !== 1) throw new Error('Each CCC exhibit must contain exactly one HTTPS image.');
  return matches[0][1];
}

/**
 * Produce the stable, byte-sensitive identity used by the server's irreversible
 * mail claim. Supabase signed-URL tokens are intentionally excluded: the same
 * reviewed object gets a new token on a later retry, while its private path,
 * SHA-256, byte count, packet position, and surrounding HTML must stay exact.
 *
 * This function does not authorize an asset. The server first re-reads every
 * source and signed URL and proves its bytes; this only turns those proven
 * bindings into a deterministic claim input.
 */
export function canonicalizeCccMailpieceClaim(mailpieceHtml, assets = []) {
  let canonicalHtml = text(mailpieceHtml);
  const manifest = [];
  const seenUrls = new Set();
  const seenPaths = new Set();

  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index] || {};
    const sourceUrl = text(asset.sourceUrl);
    const bucket = text(asset.bucket).trim();
    const storagePath = text(asset.storagePath).trim();
    const sha256 = text(asset.sha256).trim().toLowerCase();
    const byteSize = Number(asset.byteSize);
    const kind = safeExhibitKind(asset.kind);
    const id = safeExhibitId(asset.id);
    if (!/^https:\/\/[^"'<>\s]+$/.test(sourceUrl)
      || !/^[a-z0-9][a-z0-9._-]{0,62}$/i.test(bucket)
      || !storagePath
      || /(?:^|\/)\.\.(?:\/|$)|\\|[\u0000-\u001f]/.test(storagePath)
      || !SHA256_RE.test(sha256)
      || !Number.isSafeInteger(byteSize)
      || byteSize < 1) {
      throw new Error('A verified CCC packet asset has an invalid claim identity.');
    }
    if (seenUrls.has(sourceUrl) || seenPaths.has(`${bucket}\u0000${storagePath}`)) {
      throw new Error('A verified CCC packet asset is duplicated in the claim identity.');
    }
    seenUrls.add(sourceUrl);
    seenPaths.add(`${bucket}\u0000${storagePath}`);
    if (canonicalHtml.split(sourceUrl).length - 1 !== 1) {
      throw new Error('A verified CCC packet asset is not present exactly once in the final mailpiece.');
    }

    const stableAssetMarker = `ccc-verified-asset:${index}:${encodeURIComponent(bucket)}:${encodeURIComponent(storagePath)}:${sha256}:${byteSize}`;
    canonicalHtml = canonicalHtml.replace(sourceUrl, stableAssetMarker);
    manifest.push({
      version: 1,
      order: index + 1,
      kind,
      id,
      bucket,
      storagePath,
      sha256,
      byteSize,
    });
  }

  return { canonicalHtml, manifest };
}

export const CCC_MAILPIECE_BOUNDARY_PREFIX = BOUNDARY_PREFIX;
export const CCC_MAILPIECE_EXHIBIT_PREFIX = EXHIBIT_PREFIX;
