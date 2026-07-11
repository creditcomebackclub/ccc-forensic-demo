// Turning uploaded HTML/text credit reports into clean text for the audit
// model. Dependency-free so it can be unit-tested outside the browser.

// ~150k tokens of report text — leaves headroom for the system prompt and
// the JSON output inside a 200k-token context window
export const MAX_REPORT_CHARS = 600000;

// atob() alone mangles UTF-8 (José → JosÃ©); decode the bytes properly
export function decodeBase64Utf8(base64) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function decodeEntities(s) {
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(s, 'text/html');
      return doc.documentElement.textContent || s;
    } catch (e) { /* fall through to manual map */ }
  }
  const named = {
    nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'",
    ndash: '–', mdash: '—', hellip: '…', bull: '•', middot: '·',
    lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
    copy: '©', reg: '®', trade: '™', deg: '°', sect: '§', para: '¶',
    aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
    agrave: 'à', egrave: 'è', ntilde: 'ñ', ccedil: 'ç',
    auml: 'ä', euml: 'ë', iuml: 'ï', ouml: 'ö', uuml: 'ü',
    Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ',
  };
  return s
    .replace(/&([a-zA-Z]+);/g, (m, name) => named[name] ?? named[name.toLowerCase()] ?? m)
    .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/gi, '&');
}

// Strip markup down to the text the model actually needs. Monitoring-service
// exports are mostly CSS/JS bloat — stripping typically shrinks a 1MB file
// well under the cap and stops account data being lost to truncation.
export function htmlToText(html) {
  let s = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Cell boundaries become column separators — 3-bureau reports lean on
    // side-by-side EQ/TU/EXP table columns, and that structure must survive
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(tr|p|div|li|h[1-6]|table|thead|tbody|section|article|header|footer|ul|ol|dl|dt|dd)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  s = decodeEntities(s);
  return s
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\n[ \n]*/g, '\n')
    .trim();
}
