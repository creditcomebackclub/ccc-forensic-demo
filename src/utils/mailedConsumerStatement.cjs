const crypto = require('crypto');

const MAX_MAILPIECE_HTML_BYTES = 4 * 1024 * 1024;
const MAX_CONSUMER_STATEMENT_BYTES = 32 * 1024;
const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
  'param', 'source', 'track', 'wbr',
]);
const BLOCK_ELEMENTS = new Set([
  'address', 'article', 'aside', 'blockquote', 'dd', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3',
  'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav', 'ol', 'p', 'pre',
  'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const ENTITY_VALUES = Object.freeze({
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
});

function mailpieceByteLength(value) {
  return Buffer.byteLength(String(value || ''), 'utf8');
}

function findTagEnd(html, start) {
  let quote = null;
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '>') return index;
  }
  return -1;
}

function parseTag(html, start) {
  if (html.startsWith('<!--', start)) {
    const end = html.indexOf('-->', start + 4);
    if (end < 0) throw new Error('The mailed HTML contains an unterminated comment.');
    return { kind: 'comment', start, end: end + 2 };
  }

  const end = findTagEnd(html, start);
  if (end < 0) throw new Error('The mailed HTML contains an unterminated tag.');
  let cursor = start + 1;
  while (/\s/.test(html[cursor] || '')) cursor += 1;
  if (html[cursor] === '!' || html[cursor] === '?') {
    return { kind: 'declaration', start, end };
  }

  let closing = false;
  if (html[cursor] === '/') {
    closing = true;
    cursor += 1;
    while (/\s/.test(html[cursor] || '')) cursor += 1;
  }
  const nameStart = cursor;
  while (/[A-Za-z0-9:_-]/.test(html[cursor] || '')) cursor += 1;
  if (cursor === nameStart) throw new Error('The mailed HTML contains an invalid tag.');
  const name = html.slice(nameStart, cursor).toLowerCase();
  const attributes = [];

  if (!closing) {
    while (cursor < end) {
      while (/\s/.test(html[cursor] || '')) cursor += 1;
      if (cursor >= end || html[cursor] === '/') break;
      const attributeStart = cursor;
      while (cursor < end && !/[\s=/>]/.test(html[cursor])) cursor += 1;
      if (cursor === attributeStart) throw new Error('The mailed HTML contains an invalid attribute.');
      const attributeName = html.slice(attributeStart, cursor).toLowerCase();
      while (/\s/.test(html[cursor] || '')) cursor += 1;
      let value = '';
      if (html[cursor] === '=') {
        cursor += 1;
        while (/\s/.test(html[cursor] || '')) cursor += 1;
        const quote = html[cursor];
        if (quote === '"' || quote === "'") {
          cursor += 1;
          const valueStart = cursor;
          while (cursor < end && html[cursor] !== quote) cursor += 1;
          if (cursor >= end) throw new Error('The mailed HTML contains an unterminated attribute value.');
          value = html.slice(valueStart, cursor);
          cursor += 1;
        } else {
          const valueStart = cursor;
          while (cursor < end && !/[\s>]/.test(html[cursor])) cursor += 1;
          value = html.slice(valueStart, cursor);
        }
      }
      attributes.push({ name: attributeName, value });
    }
  }

  const selfClosing = !closing && /\/\s*>$/.test(html.slice(start, end + 1));
  return { kind: closing ? 'close' : 'open', start, end, name, attributes, selfClosing };
}

function markedConsumerStatementInnerHtml(html) {
  let cursor = 0;
  let markedCount = 0;
  let marked = null;
  let markedDepth = 0;

  while (cursor < html.length) {
    const tagStart = html.indexOf('<', cursor);
    if (tagStart < 0) break;
    const tag = parseTag(html, tagStart);
    cursor = tag.end + 1;
    if (tag.kind !== 'open' && tag.kind !== 'close') continue;

    if (tag.kind === 'open') {
      const sectionAttributes = tag.attributes.filter((attribute) => attribute.name === 'data-ccc-section');
      if (sectionAttributes.length > 1) {
        throw new Error('The mailed HTML contains a duplicate data-ccc-section attribute.');
      }
      if (sectionAttributes[0]?.value === 'consumer_statement') {
        markedCount += 1;
        if (!marked) {
          if (tag.selfClosing || VOID_ELEMENTS.has(tag.name)) {
            throw new Error('The mailed Consumer Statement section cannot be self-closing.');
          }
          marked = { tagName: tag.name, innerStart: tag.end + 1, innerEnd: null };
          markedDepth = 1;
          continue;
        }
      }
      if (marked && marked.innerEnd === null && tag.name === marked.tagName
          && !tag.selfClosing && !VOID_ELEMENTS.has(tag.name)) {
        markedDepth += 1;
      }
    } else if (marked && marked.innerEnd === null && tag.name === marked.tagName) {
      markedDepth -= 1;
      if (markedDepth === 0) marked.innerEnd = tag.start;
    }
  }

  if (markedCount === 0) return { count: 0, innerHtml: null };
  if (markedCount !== 1) return { count: markedCount, innerHtml: null };
  if (!marked || marked.innerEnd === null || markedDepth !== 0) {
    throw new Error('The mailed Consumer Statement section is not closed correctly.');
  }
  return { count: 1, innerHtml: html.slice(marked.innerStart, marked.innerEnd) };
}

function decodeEntity(entity) {
  const body = entity.slice(1, -1);
  if (body[0] === '#') {
    const hexadecimal = body[1]?.toLowerCase() === 'x';
    const digits = body.slice(hexadecimal ? 2 : 1);
    const validDigits = hexadecimal ? /^[0-9a-f]+$/i.test(digits) : /^\d+$/.test(digits);
    if (!validDigits) return entity;
    const value = Number.parseInt(digits, hexadecimal ? 16 : 10);
    if (!Number.isInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) {
      return '\ufffd';
    }
    return String.fromCodePoint(value);
  }
  return Object.prototype.hasOwnProperty.call(ENTITY_VALUES, body.toLowerCase())
    ? ENTITY_VALUES[body.toLowerCase()]
    : entity;
}

function decodeHtmlEntities(value) {
  return String(value || '').replace(/&(?:#\d+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi, decodeEntity);
}

function visibleTextFromHtml(innerHtml) {
  let cursor = 0;
  const output = [];
  let suppressedTag = null;
  let suppressedDepth = 0;

  while (cursor < innerHtml.length) {
    const tagStart = innerHtml.indexOf('<', cursor);
    if (tagStart < 0) {
      if (!suppressedTag) output.push({ kind: 'text', value: innerHtml.slice(cursor) });
      break;
    }
    if (!suppressedTag) output.push({ kind: 'text', value: innerHtml.slice(cursor, tagStart) });
    const tag = parseTag(innerHtml, tagStart);
    cursor = tag.end + 1;
    if (tag.kind !== 'open' && tag.kind !== 'close') continue;

    if (suppressedTag) {
      if (tag.name === suppressedTag && tag.kind === 'open' && !tag.selfClosing) suppressedDepth += 1;
      if (tag.name === suppressedTag && tag.kind === 'close') {
        suppressedDepth -= 1;
        if (suppressedDepth === 0) suppressedTag = null;
      }
      continue;
    }
    if (tag.kind === 'open' && (tag.name === 'script' || tag.name === 'style')) {
      suppressedTag = tag.name;
      suppressedDepth = 1;
      continue;
    }
    if (tag.name === 'br' || BLOCK_ELEMENTS.has(tag.name)) output.push({ kind: 'break' });
  }

  return output.map((part) => {
    if (part.kind === 'break') return '\n';
    // The renderer uses white-space: normal, so whitespace inside a text node
    // collapses visually. BR and block elements above remain explicit breaks.
    return decodeHtmlEntities(part.value).replace(/[\u00a0\s]+/g, ' ');
  }).join('')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function containsMissingConsumerStatementToken(innerHtml) {
  let cursor = 0;
  while (cursor < innerHtml.length) {
    const tagStart = innerHtml.indexOf('<', cursor);
    if (tagStart < 0) return false;
    const tag = parseTag(innerHtml, tagStart);
    cursor = tag.end + 1;
    if (tag.kind === 'open' && tag.attributes.some((attribute) => (
      attribute.name === 'data-missing-token' && attribute.value === 'consumer_statement'
    ))) return true;
  }
  return false;
}

function authoredStatementBody(sectionText) {
  const heading = sectionText.match(/^consumer\s+statement\s*:\s*/i);
  if (!heading) throw new Error('The mailed Consumer Statement section is missing its fixed heading.');
  return sectionText.slice(heading[0].length).trim();
}

function mailedConsumerStatementEvidence(htmlValue, audience) {
  const html = String(htmlValue || '');
  if (!['cra', 'direct'].includes(audience)) {
    throw new Error('The mailed Consumer Statement audience must be CRA or direct.');
  }
  if (!html || mailpieceByteLength(html) > MAX_MAILPIECE_HTML_BYTES) {
    throw new Error(`The mailed HTML must be nonempty and no larger than ${MAX_MAILPIECE_HTML_BYTES} bytes.`);
  }

  const section = markedConsumerStatementInnerHtml(html);
  if (audience === 'direct') {
    if (section.count !== 0) {
      throw new Error('Direct CCC letters cannot contain a Consumer Statement section.');
    }
    return null;
  }
  if (section.count !== 1) {
    throw new Error(section.count === 0
      ? 'CCC bureau/CRA letters must contain one Consumer Statement section.'
      : 'CCC bureau/CRA letters must contain exactly one Consumer Statement section.');
  }
  if (containsMissingConsumerStatementToken(section.innerHtml)) {
    throw new Error('The mailed Consumer Statement still contains an unresolved template token.');
  }

  const text = authoredStatementBody(visibleTextFromHtml(section.innerHtml));
  const textBytes = mailpieceByteLength(text);
  if (!text || textBytes > MAX_CONSUMER_STATEMENT_BYTES) {
    throw new Error(`The mailed Consumer Statement body must be nonempty and no larger than ${MAX_CONSUMER_STATEMENT_BYTES} bytes.`);
  }
  return {
    text,
    sha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
  };
}

module.exports = {
  MAX_CONSUMER_STATEMENT_BYTES,
  MAX_MAILPIECE_HTML_BYTES,
  decodeHtmlEntities,
  mailedConsumerStatementEvidence,
  visibleTextFromHtml,
};
