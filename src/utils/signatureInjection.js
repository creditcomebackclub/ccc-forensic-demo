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
