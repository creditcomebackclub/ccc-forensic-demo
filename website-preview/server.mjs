import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const previewRoot = dirname(fileURLToPath(import.meta.url));
const previewPort = Number.parseInt(process.env.CCC_PREVIEW_PORT || '4173', 10);
const previewHost = '127.0.0.1';

const files = new Map([
  ['/', { name: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/index.html', { name: 'index.html', type: 'text/html; charset=utf-8' }],
  ['/styles.css', { name: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['/app.js', { name: 'app.js', type: 'text/javascript; charset=utf-8' }],
  ['/ccc-logo.jpg', { name: 'ccc-logo.jpg', type: 'image/jpeg' }],
  ['/ccc-logo.webp', { name: 'ccc-logo.webp', type: 'image/webp' }],
  ['/ccc-social-preview-2026.jpg', { name: 'ccc-social-preview-2026.jpg', type: 'image/jpeg' }],
  ['/founder-chris.webp', { name: 'founder-chris.webp', type: 'image/webp' }],
  ['/robert-k-result.png', { name: 'robert-k-result.png', type: 'image/png' }],
  ['/robert-k-result.webp', { name: 'robert-k-result.webp', type: 'image/webp' }],
  ['/review-stefani-bryant.png', { name: 'review-stefani-bryant.png', type: 'image/png' }],
  ['/review-noah-panetta.png', { name: 'review-noah-panetta.png', type: 'image/png' }],
  ['/review-karl-elliott.png', { name: 'review-karl-elliott.png', type: 'image/png' }],
  ['/review-elizabeth-holland.png', { name: 'review-elizabeth-holland.png', type: 'image/png' }],
  ['/review-stefani-bryant.webp', { name: 'review-stefani-bryant.webp', type: 'image/webp' }],
  ['/review-noah-panetta.webp', { name: 'review-noah-panetta.webp', type: 'image/webp' }],
  ['/client-result-equifax-820.jpg', { name: 'client-result-equifax-820.jpg', type: 'image/jpeg' }],
  ['/client-result-inquiries-828.jpg', { name: 'client-result-inquiries-828.jpg', type: 'image/jpeg' }],
  ['/client-result-dilian-t.jpg', { name: 'client-result-dilian-t.jpg', type: 'image/jpeg' }],
  ['/client-result-ryan-e.jpg', { name: 'client-result-ryan-e.jpg', type: 'image/jpeg' }],
  ['/client-result-elizabeth-h.jpg', { name: 'client-result-elizabeth-h.jpg', type: 'image/jpeg' }],
  ['/client-result-cameron-m.jpg', { name: 'client-result-cameron-m.jpg', type: 'image/jpeg' }],
  ['/client-result-equifax-820.webp', { name: 'client-result-equifax-820.webp', type: 'image/webp' }],
  ['/client-result-inquiries-828.webp', { name: 'client-result-inquiries-828.webp', type: 'image/webp' }],
  ['/client-result-dilian-t.webp', { name: 'client-result-dilian-t.webp', type: 'image/webp' }],
  ['/client-result-ryan-e.webp', { name: 'client-result-ryan-e.webp', type: 'image/webp' }],
  ['/client-result-elizabeth-h.webp', { name: 'client-result-elizabeth-h.webp', type: 'image/webp' }],
  ['/client-result-cameron-m.webp', { name: 'client-result-cameron-m.webp', type: 'image/webp' }],
]);

const securityHeaders = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy': [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'none'",
    "font-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
  ].join('; '),
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
};

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || '/', 'http://' + previewHost);
  if (requestUrl.pathname === '/favicon.ico') {
    response.writeHead(204, securityHeaders);
    response.end();
    return;
  }

  const file = files.get(requestUrl.pathname);
  if (!file) {
    response.writeHead(404, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('This route is not part of the isolated website preview.');
    return;
  }

  try {
    const bytes = await readFile(join(previewRoot, file.name));
    response.writeHead(200, { ...securityHeaders, 'Content-Type': file.type });
    response.end(bytes);
  } catch (error) {
    response.writeHead(500, { ...securityHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Preview file unavailable.');
    console.error(error);
  }
});

server.listen(previewPort, previewHost, () => {
  console.log('CCC website preview: http://' + previewHost + ':' + previewPort);
  console.log('Local-only. Network calls and form submissions are blocked by CSP.');
});
