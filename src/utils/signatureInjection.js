function escapeHtmlAttribute(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
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

export function embedCanonicalSignatureInHistoricalHtml(html, signatureDataUrl) {
  const source = String(html || '');
  const remoteSignature = /(<img\b[^>]*\bsrc\s*=\s*["'])https?:\/\/[^"']*\/signature\.png(?:\?[^"']*)?(["'][^>]*>)/gi;
  if (!remoteSignature.test(source)) return source;
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(String(signatureDataUrl || ''))) {
    throw new Error('A historical enclosure uses a retired signature link and no canonical embedded signature is available. Nothing was sent.');
  }
  remoteSignature.lastIndex = 0;
  return source.replace(remoteSignature, `$1${escapeHtmlAttribute(signatureDataUrl)}$2`);
}
