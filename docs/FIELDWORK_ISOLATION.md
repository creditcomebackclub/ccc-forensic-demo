# Fieldwork isolation from CCC Forensic Suite

Fieldwork is a **separate product lane**. It must not read, write, or bill through the agency CCC setup.

## Hard rules

1. **No edits to agency surfaces** for Fieldwork features: `src/App.jsx`, staff components, `client-profiles`, CCC `lob.cjs` / `audit-run-background.mjs`, agency billing ledger, LPOA flows.
2. **Separate data:** only `fieldwork_*` tables + `fieldwork-docs` storage bucket (see migration `20260801000000_fieldwork_diy_isolated.sql`). No FKs to `clients` / `audits` / `letters`.
3. **Separate credentials:** Fieldwork Netlify functions use **`FIELDWORK_*` env vars only**. They intentionally do **not** fall back to `VITE_SUPABASE_*`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, or `LOB_*`.
4. **Separate browser client:** `src/diy/supabase.js` uses `VITE_FIELDWORK_SUPABASE_*` with storage key `fieldwork-auth`. Agency app keeps `src/utils/supabase.js`.
5. **Separate UI entry:** `/diy.html` (and `/diy`). Agency SPA stays on `index.html`.

## Recommended production topology

| Concern | CCC Forensic Suite | Fieldwork DIY |
|---|---|---|
| Supabase | Existing CCC project | **Prefer a second project** (or same project with only `fieldwork_*` tables) |
| Anthropic | `ANTHROPIC_API_KEY` | `FIELDWORK_ANTHROPIC_API_KEY` |
| Lob | `LOB_TEST_KEY` / `LOB_LIVE_KEY` | `FIELDWORK_LOB_TEST_KEY` / `FIELDWORK_LOB_LIVE_KEY` |
| Stripe | N/A (manual ledger today) | `FIELDWORK_STRIPE_*` |
| Users | Staff + invited clients | Self-serve subscribers |

Sharing the same Anthropic/Lob *vendor login* is an ops choice — but **API keys in Netlify should still be distinct Fieldwork keys** so DIY traffic cannot drain CCC quotas by misconfiguration.

## Forensic engine reuse (audits + letters)

Fieldwork **reuses CCC forensic logic** (prompts, schemas, DOFD/balance guards) but **never CCC UI or letter HTML templates**.

| Piece | CCC | Fieldwork |
|---|---|---|
| Audit brain | `masterPrompt` + `auditSchemas` + guards | `fieldwork-audit-run.mjs` via `FIELDWORK_ANTHROPIC_API_KEY` |
| UI findings | Staff blue/gold screens | DIY cards (`AuditStep`) via `adaptCccAuditToFieldwork` |
| Letter brain | Legal boundaries / Metro 2 substance | `fieldworkLetterPrompt` + `buildFieldworkLetter` |
| Letter skin | Navy/gold HTML tables | Plain-text Fieldwork preview (`<pre>`) |

- `POST fieldwork-audit-run` → CCC-shaped analysis → adapted Fieldwork audit JSON  
- `POST fieldwork-generate-letter` → Fieldwork plain letter (engine or local builder)  
- Sample report path still uses canned `DEMO_AUDIT` so the demo UI works offline  

## Local demo (default)

With no `VITE_FIELDWORK_SUPABASE_*` / `FIELDWORK_*` set:

- UI runs entirely on `localStorage`
- `GET /.netlify/functions/fieldwork-status` reports `mode: "demo"`, `usesCccKeys: false`
- CCC production data and keys are never contacted
- Set **only** `FIELDWORK_ANTHROPIC_API_KEY` (+ `netlify dev`) to enable live audits/letters while keeping storage local

## Enabling cloud mode later

1. Create (recommended) a new Supabase project for Fieldwork.
2. Apply **only** the Fieldwork migration (or full migrations if greenfield).
3. Set Netlify/`netlify.toml` env for Fieldwork keys listed in `.env.example`.
4. Set `VITE_FIELDWORK_SUPABASE_URL` + `VITE_FIELDWORK_SUPABASE_ANON_KEY` for the DIY build.
5. Leave CCC keys unchanged.
