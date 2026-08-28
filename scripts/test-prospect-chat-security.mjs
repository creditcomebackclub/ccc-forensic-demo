import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
const widget = read('../src/components/ProspectChatWidget.jsx');
const app = read('../src/App.jsx');
const embed = read('../public/embed.js');
const prospectFunction = read('../netlify/functions/chat-prospect.mjs');
const portalAgent = read('../agents/concierge_agent.py');
const requirements = read('../agents/requirements.txt');
const config = read('../netlify.toml');
const render = read('../render.yaml');

// The public assistant remains an isolated Netlify Function. Its request contains
// only bounded browser history; the Function sends only the latest user question
// to Claude and never reads a client, portal, lead, or credit-file table.
assert.match(widget, /fetch\('\.\/\.netlify\/functions\/chat-prospect'|fetch\('\/\.netlify\/functions\/chat-prospect'/);
assert.match(widget, /JSON\.stringify\(\{ history: newMessages \}\)/);
assert.doesNotMatch(widget, /VITE_AGENTS_API_URL|\/prospect\/chat|client_id/);
assert.match(prospectFunction, /from '@anthropic-ai\/sdk'/);
assert.match(prospectFunction, /ANTHROPIC_API_KEY/);
assert.match(prospectFunction, /claude-haiku-4-5/);
assert.match(prospectFunction, /parseCurrentQuestion/);
assert.match(prospectFunction, /PROHIBITED_INPUT/);
assert.match(prospectFunction, /enforcePersistentRateLimit/);
assert.match(prospectFunction, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(prospectFunction, /public_intake_attempts/);
assert.doesNotMatch(prospectFunction, /client_profiles|\bclients\b|\baudits\b|\bletters\b|AGENTS_API_URL|\/prospect\/chat/);

// Public chat is not implemented by or routed through the authenticated Render
// service. The portal service keeps Gemini and canonical portal authentication.
assert.doesNotMatch(portalAgent, /@app\.post\("\/prospect\/chat"\)|PROSPECT_SYSTEM_PROMPT|ANTHROPIC_CHAT_MODEL/);
assert.match(portalAgent, /@app\.post\("\/portal\/chat"\)/);
assert.match(portalAgent, /ccc_resolve_canonical_portal_identity/);
assert.match(portalAgent, /gemini-3\.1-flash-lite/);
assert.match(requirements, /^google-genai$/m);
assert.doesNotMatch(requirements, /^anthropic$/m);

// The historical app code remains available for rollback, but the public embed
// is a no-op and Netlify cannot route a visitor to the React widget.
assert.match(app, /const ProspectChatWidget = lazy\(\(\) => import\('\.\/components\/ProspectChatWidget'\)\)/);
assert.match(embed, /Retired compatibility asset/);
assert.doesNotMatch(embed, /iframe|\/widget|loadChat|postMessage/);

// The public route is permanently retired and no longer has a framing-policy
// exception that could expose the old React surface.
assert.match(config, /from = "\/widget"[\s\S]{0,120}?to = "\/#consultation"[\s\S]{0,80}?status = 301/);
assert.doesNotMatch(config, /for = "\/widget"/);
assert.match(config, /\[functions\."chat-prospect"\.rate_limit\][\s\S]*?window = "1m"[\s\S]*?limit = 10/);

// The separate portal deployment has explicit health/config contracts.
assert.match(render, /name: ccc-agents-api/);
assert.match(render, /healthCheckPath: \/readyz/);
assert.match(render, /autoDeployTrigger: off/);
for (const key of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY', 'GOOGLE_API_KEY', 'ALLOWED_ORIGINS']) {
  assert.match(render, new RegExp(`key: ${key}`), `Render blueprint missing ${key}`);
}
assert.match(portalAgent, /@app\.get\("\/healthz"\)/);
assert.match(portalAgent, /@app\.get\("\/readyz"\)/);

console.log('Retired public React chat route and retained authenticated portal-agent contracts passed.');
