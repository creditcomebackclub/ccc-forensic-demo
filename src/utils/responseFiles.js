// Shared format contract for furnisher-response files. Three surfaces must
// agree on what's acceptable: the client portal upload (ClientPortal.jsx),
// the admin responses list (DocumentManager.jsx), and Phase 2 analysis
// (ResponseAnalyzer.jsx / api.js — PDFs go in `document` blocks, images in
// `image` blocks; anything else the API rejects).

export const ANALYZABLE_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
export const RESPONSE_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';

// PDF pages converted to JPEGs (for Lob exhibit embedding) carry this prefix.
// LobMailer picks them up by extension; the client-responses list filters
// them out so system artifacts don't show up as new uploads.
export const CONVERTED_PREFIX = 'converted_';

const EXT_TYPES = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

// Storage downloads can come back typeless or as application/octet-stream —
// fall back to the file extension before giving up.
export function inferMediaType(fileName, blobType) {
  if (blobType && blobType !== 'application/octet-stream') return blobType;
  const ext = String(fileName || '').split('.').pop().toLowerCase();
  return EXT_TYPES[ext] || '';
}

export function isAnalyzable(mediaType) {
  return ANALYZABLE_TYPES.includes(mediaType);
}

export const UNSUPPORTED_TYPE_MESSAGE =
  'This file format is not supported for analysis. Please upload a PDF, JPG, PNG, or WEBP.';

// Best-effort re-encode of an unsupported image (e.g. iPhone HEIC) to JPEG.
// Works where the browser can decode the source format (Safari decodes HEIC;
// Chrome does not) — callers must handle the null return.
export async function transcodeImageToJpeg(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) return null;
    const base = String(file.name || 'response').replace(/\.[^.]+$/, '');
    return new File([blob], base + '.jpg', { type: 'image/jpeg' });
  } catch (e) {
    return null;
  }
}

export const slugBase = (s) =>
  String(s || '').replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'response';
