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

// ---------------------------------------------------------------------------
// Multi-page response batches. A furnisher response photographed as several
// separate images (one per page) must be analyzed as ONE document, not one
// per page. Files in a batch share a name: response_<batchId>_p<NN>.<ext>.
// Files uploaded before this convention existed have no _p suffix — they're
// treated as their own single-page batch so nothing breaks retroactively.
// ---------------------------------------------------------------------------

const BATCH_FILE_RE = /^response_(\d+)_p(\d+)\.[^.]+$/i;

// A batch is either a single PDF or one-or-more images — never mixed, so
// page order and content-block type stay unambiguous.
export function validateBatch(files) {
  const pdfCount = files.filter((f) => f.type === 'application/pdf').length;
  if (pdfCount > 0 && files.length > 1) {
    return 'A response can be a single PDF, or one or more photos — not both together in the same upload.';
  }
  return null;
}

export function buildBatchPaths(basePath, files) {
  const batchId = Date.now();
  return files.map((f, i) => {
    const ext = (String(f.name || '').split('.').pop() || 'jpg').toLowerCase();
    const page = String(i + 1).padStart(2, '0');
    return { file: f, path: `${basePath}/response_${batchId}_p${page}.${ext}` };
  });
}

export async function uploadResponseBatch(supabase, basePath, files) {
  const entries = buildBatchPaths(basePath, files);
  for (const { file, path } of entries) {
    const { error } = await supabase.storage.from('responses').upload(path, file, { upsert: true });
    if (error) throw error;
  }
  return entries.map((e) => e.path);
}

// Groups a letter folder's files into logical response batches — every page
// of a multi-photo upload collapses into one entry so the admin list shows
// (and analyzes) one row per response, not one row per page.
export function groupResponseFiles(files) {
  const groups = new Map();
  for (const f of files) {
    const m = f.name.match(BATCH_FILE_RE);
    const key = m ? m[1] : f.name;
    const page = m ? parseInt(m[2], 10) : 1;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...f, page });
  }
  return Array.from(groups.values()).map((group) => {
    group.sort((a, b) => a.page - b.page);
    const createdAt = group.reduce(
      (earliest, f) => (!earliest || (f.created_at && f.created_at < earliest) ? f.created_at : earliest),
      null
    );
    return { files: group, createdAt };
  });
}
