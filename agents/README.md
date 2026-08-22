# CCC authenticated client concierge

The Render service at `ccc-agents-api.onrender.com` serves the authenticated
client-portal concierge. Public prospect chat is intentionally separate: it is
served by Netlify's `chat-prospect` Function and uses Claude without reading any
client, portal, lead, or credit-file data.

| Route | Authentication | Model context | Durable limit |
| --- | --- | --- | --- |
| `POST /portal/chat` | Supabase bearer token | Canonical active portal identity plus a privacy-filtered case-status summary | 8/minute and 40/hour per portal user/client |
| `POST /chat` | Same as `/portal/chat` | Transitional compatibility alias; do not use in new UI | Same portal limiter |
| `GET /healthz` | None | None | Liveness only |
| `GET /readyz` | None | None | Returns 503 unless configuration and the hardened database contract are ready |

The portal route rejects identity, contact, payment, login, health, and other
sensitive input before Gemini is called. It resolves the bearer token through
the canonical active portal identity function; the browser never submits a
`client_id`. Only the explicit client-safe case-status projection is sent to the
model. Raw audits, source documents, staff notes, statutes, classifications, and
letter content remain outside the model context.

## Required Render configuration

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` (verifies the client's Supabase bearer token)
- `SUPABASE_SERVICE_KEY` (canonical identity, client-safe projection, and durable rate gates)
- `GOOGLE_API_KEY` (a `GEMINI_API_KEY` fallback is accepted by the service)
- `ALLOWED_ORIGINS` (comma-separated exact origins, no path or trailing slash)

`PORT` is supplied by Render. Never prefix a server secret with `VITE_`.

The repository `render.yaml` uses `/readyz` as the deployment health check and
keeps automatic deploys disabled. Review and deploy explicitly. Readiness also
probes the concierge events table and the canonical active limiter contract with
a nil portal identity; the expected fail-closed resolver error proves the `4300`
hardening is live without inserting an event.

## Release order

1. Apply all pending Supabase migrations through
   `20260820500000_public_intake_hardening.sql`. The portal projection and
   durable concierge limiter are introduced by the `3700` migration and bound
   to the canonical active portal identity by the `4300` migration; the `5000`
   migration also locks the shared public rate-limit table to server-only use.
2. Set and verify the Render variables above. Add every exact production portal
   origin to `ALLOWED_ORIGINS`; add `https://creditcomebackclub.credit` before any
   future operational-domain cutover.
3. Deploy the `agents/` service. Verify `/healthz` and `/readyz` return 200,
   preflight succeeds only for allowed origins, `/portal/chat` without a bearer
   token returns 401, and an authenticated active client can receive one reply.
4. Set Netlify `VITE_AGENTS_API_URL` to the Render origin, rebuild, and verify the
   portal sends `{ "message": "..." }` to `/portal/chat` with its bearer token.

For the separate public assistant, Netlify needs `ANTHROPIC_API_KEY`,
`VITE_SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`; the last two support the
durable pseudonymous public-chat limiter. The `/widget` response must retain its
path-specific `SAMEORIGIN` override so the global app `DENY` frame policy does
not block the same-site iframe. Before promoting a replacement marketing page to
the root route, ensure that page mounts `/embed.js` just as `public/home.html` does.
