import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { renderDisputeTemplate, wrapDisputeLetterHtml } from '../src/utils/disputeTemplateEngine.js';

const require = createRequire(import.meta.url);
const {
  MAX_MAILPIECE_HTML_BYTES,
  mailedConsumerStatementEvidence,
} = require('../src/utils/mailedConsumerStatement.cjs');

const nestedHtml = `<!doctype html><html><body>
  <section class="consumer-statement" data-ccc-section="consumer_statement">
    <h2>cOnSuMeR   StAtEmEnT :</h2>
    <div><p>Housing &amp; loan &#x2014; cost &#36;500.</p><div>Second<br>line &quot;quoted&quot; and &#039;signed&#039;.</div></div>
  </section>
</body></html>`;
const expectedText = 'Housing & loan — cost $500.\n\nSecond\nline "quoted" and \'signed\'.';
const evidence = mailedConsumerStatementEvidence(nestedHtml, 'cra');
assert.equal(evidence.text, expectedText, 'visible nested markup is normalized into authored body text only');
assert.equal(
  evidence.sha256,
  crypto.createHash('sha256').update(expectedText, 'utf8').digest('hex'),
  'the fingerprint is calculated from the canonical authored body',
);
assert.doesNotMatch(evidence.text, /consumer statement/i, 'the fixed heading is excluded from evidence');

const rendererEvidence = mailedConsumerStatementEvidence(
  wrapDisputeLetterHtml(renderDisputeTemplate('{consumer_statement}', {
    consumer_statement: 'Confirmed client facts.\nDelete the account.',
  })),
  'cra',
);
assert.equal(
  rendererEvidence.text,
  'Confirmed client facts.\nDelete the account.',
  'the production renderer and server evidence parser share the exact semantic contract',
);

const newlineHtml = '<section data-ccc-section="consumer_statement"><h2>Consumer Statement:</h2><div>Line one<br>Line two\r\nLine three&nbsp;&nbsp;here</div></section>';
assert.equal(
  mailedConsumerStatementEvidence(newlineHtml, 'cra').text,
  'Line one\nLine two Line three here',
  'BR elements stay visible breaks while source whitespace and nonbreaking spaces collapse like the printed HTML',
);

assert.throws(
  () => mailedConsumerStatementEvidence('<html><body>No section</body></html>', 'cra'),
  /must contain one Consumer Statement section/,
  'CRA mail fails closed when the semantic section is missing',
);
assert.throws(
  () => mailedConsumerStatementEvidence(
    '<section data-ccc-section="consumer_statement"><h2>Consumer Statement:</h2>One</section>'
      + '<section data-ccc-section="consumer_statement"><h2>Consumer Statement:</h2>Two</section>',
    'cra',
  ),
  /exactly one Consumer Statement section/,
  'duplicate marked sections fail closed',
);
assert.throws(
  () => mailedConsumerStatementEvidence(
    '<section data-ccc-section="consumer_statement"><h2>Consumer Statement:</h2><div>&nbsp;</div></section>',
    'cra',
  ),
  /body must be nonempty/,
  'a fixed heading without an authored body is empty',
);
assert.throws(
  () => mailedConsumerStatementEvidence(
    '<section data-ccc-section="consumer_statement"><div>Confirmed facts.</div></section>',
    'cra',
  ),
  /missing its fixed heading/,
  'the semantic section must retain its renderer-owned heading',
);
assert.throws(
  () => mailedConsumerStatementEvidence(
    '<section data-ccc-section="consumer_statement"><h2>Consumer Statement:</h2><mark data-missing-token="consumer_statement">{consumer_statement}</mark></section>',
    'cra',
  ),
  /unresolved template token/,
  'a visible curly placeholder cannot masquerade as authored text',
);
assert.equal(
  mailedConsumerStatementEvidence('<html><body>Direct dispute body.</body></html>', 'direct'),
  null,
  'direct CCC letters have no Consumer Statement evidence',
);
assert.throws(
  () => mailedConsumerStatementEvidence(nestedHtml, 'direct'),
  /Direct CCC letters cannot contain/,
  'direct flow fails closed if a Consumer Statement section appears',
);
assert.throws(
  () => mailedConsumerStatementEvidence('x'.repeat(MAX_MAILPIECE_HTML_BYTES + 1), 'cra'),
  /no larger than/,
  'mailpiece scanning is byte bounded',
);

const migration = await readFile(
  new URL('../supabase/migrations/20260820190000_capture_mailed_consumer_statement.sql', import.meta.url),
  'utf8',
);
for (const column of [
  'consumer_statement_text',
  'consumer_statement_sha256',
  'consumer_statement_captured_at',
]) assert.match(migration, new RegExp(`add column if not exists ${column}`));
assert.match(migration, /mail_submissions_consumer_statement_snapshot_complete/);
assert.match(migration, /consumer_statement_sha256 ~ '\^\[0-9a-f\]\{64\}\$'/);
assert.match(migration, /consumer_statement_text is null[\s\S]*consumer_statement_sha256 is null[\s\S]*consumer_statement_captured_at is not null/);
assert.match(migration, /consumer_statement_text is not null[\s\S]*consumer_statement_sha256 is not null[\s\S]*length\(btrim\(consumer_statement_text\)\)/);
for (const immutableRecipientField of [
  'client_id',
  'client_name',
  'client_account_id',
  'account_id',
  'furnisher',
  'target_type',
  'target_bureau',
  'covered_furnishers',
]) {
  assert.match(
    migration,
    new RegExp(`old\\.${immutableRecipientField}[\\s\\S]*new\\.${immutableRecipientField}`),
    `mailed CCC evidence must freeze ${immutableRecipientField}`,
  );
}
assert.match(migration, /create trigger protect_mailed_ccc_letter_snapshots[\s\S]*before update on public\.letters/);
assert.match(migration, /old\.mailed_date is not null[\s\S]*old\.lob_id is not null[\s\S]*new\.mailed_date is not null[\s\S]*new\.lob_id is not null/);
for (const protectedColumn of [
  'html',
  'dispute_template_snapshot',
  'dispute_editable_sections',
  'dispute_account_snapshot',
  'dispute_screenshot_manifest',
]) {
  assert.match(migration, new RegExp(`old\\.${protectedColumn}[\\s\\S]*new\\.${protectedColumn}`));
}
assert.doesNotMatch(migration, /old\.html,[\s\S]*old\.(?:mailed_date|lob_id)[\s\S]*\) is distinct from/);
assert.doesNotMatch(migration, /new\.html,[\s\S]*new\.(?:mailed_date|lob_id)[\s\S]*\) then/);

const lobFunction = await readFile(new URL('../netlify/functions/lob.cjs', import.meta.url), 'utf8');
assert.match(lobFunction, /MAX_MAILPIECE_HTML_BYTES,[\s\S]*mailedConsumerStatementEvidence/);
assert.match(lobFunction, /mailedConsumerStatementEvidence\(\s*scannedMailpiece\.html,/);
assert.match(lobFunction, /flow === 'direct'[\s\S]*return 'direct'/);
assert.match(lobFunction, /consumer_statement_captured_at=is\.null/);
assert.match(lobFunction, /consumer_statement_text: evidence\?\.text \|\| null/);
assert.match(lobFunction, /existing\?\.consumer_statement_sha256 === \(evidence\?\.sha256 \|\| null\)/);
assert.doesNotMatch(
  lobFunction,
  /dispute_editable_sections/,
  'mail-time evidence is never derived from the browser-supplied editable-sections snapshot',
);
assert.ok(
  lobFunction.indexOf('await captureMailedConsumerStatement(')
    < lobFunction.indexOf("await lobRequest('/v1/letters'"),
  'the exact statement evidence is durable before the irreversible Lob request',
);

console.log('Mailed Consumer Statement evidence and immutable snapshot tests passed.');
