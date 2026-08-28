export const WEBSITE_SHARED_FILES = Object.freeze([
  'app.js',
  'ccc-logo.jpg',
  'ccc-logo.webp',
  'client-result-equifax-820.webp',
  'client-result-inquiries-828.webp',
  'client-result-dilian-t.webp',
  'client-result-ryan-e.webp',
  'client-result-elizabeth-h.webp',
  'client-result-cameron-m.webp',
  'founder-chris.webp',
  'review-noah-panetta.webp',
  'review-stefani-bryant.webp',
  'robert-k-result.webp',
]);

export const WEBSITE_LIVE_FILES = Object.freeze([
  'live-app.js',
  'ccc-social-preview-2026.jpg',
]);

const MODES = new Set(['preview', 'live']);
const BLOCK_KINDS = Object.freeze(['PREVIEW_ONLY', 'LIVE_ONLY']);

function marker(kind, edge) {
  return `<!-- CCC_${kind}_${edge} -->`;
}

function assertBalancedBlocks(html) {
  for (const kind of BLOCK_KINDS) {
    const starts = html.split(marker(kind, 'START')).length - 1;
    const ends = html.split(marker(kind, 'END')).length - 1;
    if (starts !== ends) throw new Error(`Unbalanced ${kind} release markers.`);
  }
}

function removeBlocks(html, kind) {
  const start = marker(kind, 'START').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const end = marker(kind, 'END').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp(`${start}[\\s\\S]*?${end}`, 'g'), '');
}

function unwrapBlocks(html, kind) {
  return html
    .replaceAll(marker(kind, 'START'), '')
    .replaceAll(marker(kind, 'END'), '');
}

function rewriteAssetPaths(source, basePath, assetNames) {
  let output = source;
  for (const file of assetNames) {
    output = output.replaceAll(`="/${file}"`, `="${basePath}/${file}"`);
    output = output.replaceAll(`url("/${file}")`, `url("${basePath}/${file}")`);
  }
  return output;
}

function removeClassToken(html, token) {
  return html.replace(/class="([^"]*)"/g, (attribute, value) => {
    const next = value.split(/\s+/).filter((item) => item && item !== token).join(' ');
    return next ? `class="${next}"` : '';
  });
}

export function createWebsiteReleaseHtml(htmlSource, mode) {
  if (!MODES.has(mode)) throw new Error(`Unknown website release mode: ${mode}`);
  assertBalancedBlocks(htmlSource);

  const activeKind = mode === 'preview' ? 'PREVIEW_ONLY' : 'LIVE_ONLY';
  const inactiveKind = mode === 'preview' ? 'LIVE_ONLY' : 'PREVIEW_ONLY';
  const basePath = mode === 'preview' ? '/site-preview' : '/site-live';
  const assetNames = ['styles.css', ...WEBSITE_SHARED_FILES, ...(mode === 'live' ? WEBSITE_LIVE_FILES : [])];
  let html = unwrapBlocks(removeBlocks(htmlSource, inactiveKind), activeKind);

  if (mode === 'live') {
    html = html
      .replace('<meta name="description" content="Local-only website concept for Credit Comeback Club.">', '<meta name="description" content="Veteran-owned credit repair support that reviews all three bureaus, builds factual disputes, explains the process, and documents every supported next step.">')
      .replace('<meta name="robots" content="noindex,nofollow">', '<meta name="robots" content="index,follow">')
      .replace('<title>Credit Comeback Club — Website Preview</title>', '<title>Credit Comeback Club | Your Credit Comeback Starts Here</title>')
      .replace('<body data-preview-only="true">', '<body data-live-site="true">')
      .replaceAll('data-live-only hidden', 'data-live-only')
      .replaceAll('aria-label="Credit Comeback Club preview home"', 'aria-label="Credit Comeback Club home"')
      .replace('<h2>Production destinations</h2>', '<h2>Client &amp; partner access</h2>')
      .replace('<h2>Legal inventory</h2>', '<h2>Legal</h2>')
      .replace(/\sdata-preview-destination="[^"]*"/g, '');
    html = removeClassToken(html, 'preview-destination');
    html = html
      .replace('</body>', `  <script src="${basePath}/live-app.js" defer></script>\n</body>`);
  }

  return rewriteAssetPaths(html, basePath, assetNames);
}

export function createWebsiteReleaseCss(cssSource, mode) {
  if (!MODES.has(mode)) throw new Error(`Unknown website release mode: ${mode}`);
  const basePath = mode === 'preview' ? '/site-preview' : '/site-live';
  return rewriteAssetPaths(cssSource, basePath, [...WEBSITE_SHARED_FILES, ...WEBSITE_LIVE_FILES]);
}
