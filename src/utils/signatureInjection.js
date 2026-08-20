function escapeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Physical mail is rendered by Lob from the HTML we hand it, at a moment we do
// not control. Anything the page has to fetch over the network at that moment
// is a way for a letter to print wrong or not print at all: public Storage
// URLs die the day a bucket is made private (this is what retired every
// pre-reorg LPOA's signature images), and signed URLs die on their own clock.
const IMG_TAG_RE = /<img\b[^>]*>/gi;
const SRC_ATTRIBUTE_RE = /(\bsrc\s*=\s*)(["'])([\s\S]*?)\2/i;
const DATA_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

// The firm's attorney-in-fact signature. Legacy LPOAs hardcoded the public
// client-docs URL; the canonical object now lives at firm/attorney-signature.png.
const ATTORNEY_SIGNATURE_URL_RE = /chris[_-]signature|attorney[_-]signature|\/Christopher(?:%20|\+|\s)Holland\//i;
// The client's own drawn signature — legacy `{authUid}/signature.png`, canonical
// `documents/{firm}/{clientId}/lpoa/signature.png`.
const CLIENT_SIGNATURE_URL_RE = /\bsignature\.(?:png|jpe?g|webp)(?:[?#]|$)/i;

function decodeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

/**
 * Every http(s) image source in the document, in document order, decoded to
 * the URL the renderer will actually request.
 */
export function remoteImageSources(html) {
  const sources = [];
  for (const tag of String(html || '').match(IMG_TAG_RE) || []) {
    const src = decodeHtmlAttribute(tag.match(SRC_ATTRIBUTE_RE)?.[3] || '');
    if (/^https?:/i.test(src)) sources.push(src);
  }
  return sources;
}

/**
 * Which signature a retired link was pointing at. The two are never
 * interchangeable: printing the client's drawn signature over the
 * attorney-in-fact line would misrepresent who executed the document.
 */
export function classifyRemoteSignatureUrl(url) {
  const value = String(url || '');
  if (ATTORNEY_SIGNATURE_URL_RE.test(value)) return 'attorney';
  if (CLIENT_SIGNATURE_URL_RE.test(value)) return 'client';
  return 'unknown';
}

/**
 * Replace retired remote signature links with canonical embedded images, and
 * fail closed on any other remote image. An enclosure that silently prints a
 * blank signature line is worse than a send that refuses to happen.
 */
export function embedRemoteSignatureImages(html, {
  clientSignatureDataUrl = null,
  attorneySignatureDataUrl = null,
  context = 'mail enclosure',
} = {}) {
  const source = String(html || '');
  if (!source) return source;
  const remotes = remoteImageSources(source);
  if (remotes.length === 0) return source;

  const replacements = new Map();
  for (const url of remotes) {
    if (replacements.has(url)) continue;
    const kind = classifyRemoteSignatureUrl(url);
    if (kind === 'client') {
      if (!DATA_IMAGE_RE.test(String(clientSignatureDataUrl || ''))) {
        throw new Error(`A ${context} uses a retired signature link and no canonical embedded signature is available. Nothing was sent.`);
      }
      replacements.set(url, clientSignatureDataUrl);
    } else if (kind === 'attorney') {
      if (!DATA_IMAGE_RE.test(String(attorneySignatureDataUrl || ''))) {
        throw new Error(`A ${context} uses a retired attorney-signature link and the canonical attorney signature could not be embedded. Nothing was sent.`);
      }
      replacements.set(url, attorneySignatureDataUrl);
    } else {
      throw new Error(`A ${context} points at a remote image that will not reliably render in physical mail (${url}). Embed it before sending. Nothing was sent.`);
    }
  }

  return source.replace(IMG_TAG_RE, (tag) => {
    const src = decodeHtmlAttribute(tag.match(SRC_ATTRIBUTE_RE)?.[3] || '');
    const replacement = replacements.get(src);
    if (!replacement) return tag;
    return tag.replace(SRC_ATTRIBUTE_RE, (match, prefix, quote) => prefix + quote + escapeHtmlAttribute(replacement) + quote);
  });
}

export function injectSignatureImage(html, signatureUrl, printedName) {
  const source = String(html || '');
  if (!source || !signatureUrl) return source;
  if (hasInjectedSignature(source, signatureUrl)) {
    return source;
  }

  const image = `<img data-ccc-signature="true" src="${escapeHtmlAttribute(signatureUrl)}" alt="Client signature" style="max-height:60px;max-width:220px;display:block;margin:8px 0 6px;" />`;
  if (/_{3,}/.test(source)) return source.replace(/_{3,}/, image);

  // New generated letters have a required, machine-addressable signature
  // block. Insert there instead of relying on the model's capitalization of
  // the printed client name.
  const signatureBlockOpen = /(<[^>]+class=["'][^"']*\bsignature-block\b[^"']*["'][^>]*>)/i;
  if (signatureBlockOpen.test(source)) return source.replace(signatureBlockOpen, `$1${image}`);

  // Follow-up drafts created before the signature-format rule sometimes omit
  // the underscore placeholder. Insert before the LAST printed-name
  // occurrence so the address block at the top is never modified.
  const name = String(printedName || '').trim();
  if (!name) return source;
  const nameIndex = source.lastIndexOf(name);
  if (nameIndex < 0) return source;
  return source.slice(0, nameIndex) + image + source.slice(nameIndex);
}

export function hasInjectedSignature(html, signatureUrl) {
  const source = String(html || '');
  return /data-ccc-signature\s*=\s*["']true["']/i.test(source)
    || (!!signatureUrl && source.includes(String(signatureUrl)));
}

export function embeddedSignatureSource(html) {
  const tag = String(html || '').match(/<img\b[^>]*data-ccc-signature\s*=\s*["']true["'][^>]*>/i)?.[0] || '';
  return tag.match(/\bsrc\s*=\s*["'](data:image\/[a-z0-9.+-]+;base64,[^"']+)["']/i)?.[1] || null;
}

export function embedCanonicalSignatureInHistoricalHtml(html, signatureDataUrl, attorneySignatureDataUrl = null) {
  return embedRemoteSignatureImages(html, {
    clientSignatureDataUrl: signatureDataUrl,
    attorneySignatureDataUrl,
    context: 'historical enclosure',
  });
}
