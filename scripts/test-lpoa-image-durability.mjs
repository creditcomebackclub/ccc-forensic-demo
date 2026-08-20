#!/usr/bin/env node
// Guards the failure that killed real mailpieces: an enclosed LPOA whose
// signature images were still remote `client-docs` links after that bucket
// went private, so Lob 404'd them mid-render and failed the whole piece.

import { readFileSync } from 'node:fs';
import {
  classifyRemoteSignatureUrl,
  embedCanonicalSignatureInHistoricalHtml,
  embedRemoteSignatureImages,
  remoteImageSources,
} from '../src/utils/signatureInjection.js';

let failed = 0;
function assert(condition, message) {
  if (!condition) {
    failed += 1;
    console.error('FAIL:', message);
  } else {
    console.log('ok:', message);
  }
}

function throwsMessage(fn, substring, message) {
  try {
    fn();
    assert(false, message);
  } catch (error) {
    assert(String(error.message).includes(substring), `${message} (got: ${error.message})`);
  }
}

const CLIENT_SIG = 'data:image/png;base64,Y2xpZW50';
const ATTORNEY_SIG = 'data:image/png;base64,YXR0b3JuZXk=';

// The two exact URLs Lob reported on the failed Portfolio Recovery mailpiece.
const DEAD_CLIENT_URL = 'https://mlsbdmewxocgweotcdud.supabase.co/storage/v1/object/public/client-docs/307b398b-ffc5-4e11-b9b6-64a7f281b136/signature.png';
const DEAD_ATTORNEY_URL = 'https://mlsbdmewxocgweotcdud.supabase.co/storage/v1/object/public/client-docs/standalone/Christopher%20Holland/chris_signature.png';

assert(classifyRemoteSignatureUrl(DEAD_CLIENT_URL) === 'client', 'retired client signature URL is recognized');
assert(classifyRemoteSignatureUrl(DEAD_ATTORNEY_URL) === 'attorney', 'retired attorney signature URL is recognized');
assert(classifyRemoteSignatureUrl('https://cdn.example/logo.png') === 'unknown', 'unrelated remote images are not treated as signatures');
assert(
  classifyRemoteSignatureUrl('https://x/storage/v1/object/public/client-docs/firm/attorney-signature.png') === 'attorney',
  'canonical attorney asset name is recognized'
);

const legacyLpoa = '<div class="sig-row">'
  + `<div class="sig-col"><img src="${DEAD_CLIENT_URL}" style="max-height:56px;max-width:220px;" /><div>Principal Signature — Mary W. Schmidt</div></div>`
  + `<div class="sig-col"><img src="${DEAD_ATTORNEY_URL}" style="max-height:56px;max-width:220px;" /><div>Christopher Holland — Attorney-in-Fact</div></div>`
  + '</div>';

const repaired = embedRemoteSignatureImages(legacyLpoa, {
  clientSignatureDataUrl: CLIENT_SIG,
  attorneySignatureDataUrl: ATTORNEY_SIG,
  context: 'LPOA enclosure',
});
assert(remoteImageSources(repaired).length === 0, 'repaired LPOA has no remote image links left for Lob to fetch');
assert(
  repaired.indexOf(CLIENT_SIG) < repaired.indexOf(ATTORNEY_SIG),
  'each signature is embedded on its own line — the client image never lands on the attorney-in-fact line'
);
assert(repaired.includes('Principal Signature — Mary W. Schmidt'), 'repair preserves surrounding document text');
assert(repaired.includes('style="max-height:56px;max-width:220px;"'), 'repair preserves the original image attributes');

throwsMessage(
  () => embedRemoteSignatureImages(legacyLpoa, { attorneySignatureDataUrl: ATTORNEY_SIG, context: 'LPOA enclosure' }),
  'no canonical embedded signature',
  'a client signature that cannot be embedded fails closed'
);
throwsMessage(
  () => embedRemoteSignatureImages(legacyLpoa, { clientSignatureDataUrl: CLIENT_SIG, context: 'LPOA enclosure' }),
  'retired attorney-signature link',
  'an attorney signature that cannot be embedded fails closed'
);
throwsMessage(
  () => embedRemoteSignatureImages('<img src="https://cdn.example/exhibit.png" />', {
    clientSignatureDataUrl: CLIENT_SIG,
    attorneySignatureDataUrl: ATTORNEY_SIG,
  }),
  'will not reliably render in physical mail',
  'any other remote image fails closed rather than printing blank'
);
throwsMessage(
  () => embedRemoteSignatureImages(legacyLpoa, {
    clientSignatureDataUrl: 'https://example.com/signature.png',
    attorneySignatureDataUrl: ATTORNEY_SIG,
  }),
  'no canonical embedded signature',
  'a remote URL is not accepted as a replacement for a remote URL'
);

const alreadyEmbedded = `<img src="${CLIENT_SIG}" /><img src="${ATTORNEY_SIG}" />`;
assert(embedRemoteSignatureImages(alreadyEmbedded, {}) === alreadyEmbedded, 'already-embedded LPOAs are left untouched');
assert(remoteImageSources(alreadyEmbedded).length === 0, 'data URLs are not reported as remote images');

const entityEncoded = '<img src="https://x/storage/v1/object/sign/documents/a/page-1.jpg?token=a&amp;b=2" />';
assert(
  remoteImageSources(entityEncoded)[0] === 'https://x/storage/v1/object/sign/documents/a/page-1.jpg?token=a&b=2',
  'image sources are decoded to the URL the renderer actually requests'
);

const historical = `<p>Prior letter</p><img src="${DEAD_CLIENT_URL}" />`;
assert(
  embedCanonicalSignatureInHistoricalHtml(historical, CLIENT_SIG).includes(CLIENT_SIG),
  'historical enclosure repair still embeds the canonical client signature'
);
throwsMessage(
  () => embedCanonicalSignatureInHistoricalHtml(historical, null),
  'no canonical embedded signature',
  'historical enclosure repair still fails closed without a canonical signature'
);

const lobMailer = readFileSync(new URL('../src/components/LobMailer.jsx', import.meta.url), 'utf8');
assert(
  (lobMailer.match(/fetchLpoaHtmlForPrint\(supabase, clientMeta\?\.\[0\]\?\.lpoa_signature_data, \{ clientSignatureDataUrl: canonicalSignature \}\)/g) || []).length === 4,
  'every LPOA enclosure path can resolve a retired client signature link'
);
assert(
  /remoteImageSources\(finalHtml\)[\s\S]{0,200}mailAssetUrls\.has/.test(lobMailer)
  && lobMailer.indexOf('const foreignImages') < lobMailer.indexOf('const tempFileName'),
  'the assembled mailpiece is checked for foreign image links before it is uploaded for Lob'
);

const lobFunction = readFileSync(new URL('../netlify/functions/lob.cjs', import.meta.url), 'utf8');
assert(
  lobFunction.includes('scanRemoteAssetUrls(remoteUrl)')
  && lobFunction.indexOf('nonDurableAssets') < lobFunction.indexOf('let submission = await findSubmission(letterId, supabaseUrl, serviceKey);'),
  'the server re-reads the uploaded mailpiece and blocks non-durable assets before submitting to Lob'
);
assert(
  /storage\/v1\/object\/sign\/documents\//.test(lobFunction),
  'only short-lived signed document URLs minted for the send are accepted'
);

if (failed) {
  console.error(`\n${failed} failure(s)`);
  process.exit(1);
}
console.log('\nAll LPOA image durability tests passed.');
