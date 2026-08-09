// Load firm attorney signature PNG as a data URL (service-role only).
// client-docs/firm/* is staff-only after the storage reorg — portal clients
// cannot download it, so every LPOA builder must inject via this helper.
const https = require('https');
const {
  FIRM_ASSETS_BUCKET,
  FIRM_ATTORNEY_SIG_PATH,
} = require('./_storagePaths.cjs');

const BOLD_FALLBACK_RE = /<span style="font-size:14px;font-weight:bold;">Christopher Holland<\/span>/g;

function storageDownload(supabaseUrl, serviceKey, bucket, objectPath) {
  return new Promise((resolve, reject) => {
    const u = new URL(
      `${supabaseUrl}/storage/v1/object/${bucket}/${objectPath.split('/').map(encodeURIComponent).join('/')}`
    );
    const options = {
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        apikey: serviceKey,
        Authorization: 'Bearer ' + serviceKey,
      },
    };
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Attorney signature download failed (${res.statusCode}): ${buf.toString('utf8').slice(0, 200)}`));
          return;
        }
        resolve(buf);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function loadAttorneySignatureDataUrl(supabaseUrl, serviceKey) {
  const buf = await storageDownload(supabaseUrl, serviceKey, FIRM_ASSETS_BUCKET, FIRM_ATTORNEY_SIG_PATH);
  return `data:image/png;base64,${buf.toString('base64')}`;
}

function attorneySignatureImgTag(dataUrl) {
  return `<img src="${dataUrl}" style="max-height:56px;max-width:220px;" alt="Christopher Holland signature" />`;
}

/** Replace the bold-text attorney fallback with the real signature image. */
function injectAttorneySignatureHtml(html, dataUrl) {
  if (!html || !dataUrl) return html;
  if (!BOLD_FALLBACK_RE.test(html)) return html;
  BOLD_FALLBACK_RE.lastIndex = 0;
  return html.replace(BOLD_FALLBACK_RE, attorneySignatureImgTag(dataUrl));
}

function htmlNeedsAttorneySignature(html) {
  return typeof html === 'string' && BOLD_FALLBACK_RE.test(html);
}

module.exports = {
  loadAttorneySignatureDataUrl,
  injectAttorneySignatureHtml,
  attorneySignatureImgTag,
  htmlNeedsAttorneySignature,
  BOLD_FALLBACK_RE,
};
