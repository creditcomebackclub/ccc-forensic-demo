# AGENTS.md

Repo-wide agent guidance for `ccc-forensic-demo`. See `README.md` for the full
product/architecture overview and the canonical install/run/build commands.
Additional agent rules live in `.agents/AGENTS.md`.

## Cursor Cloud specific instructions

This repo ships **two independent frontends from one Vite build**, plus optional
serverless/AI/mail backends. Knowing which pieces need secrets is the key to
working here productively.

### The two products
- **CCC Forensic Suite** (agency app) — entry `index.html` → `src/App.jsx`. It is
  gated behind a **Supabase email/password sign-in wall**. Without
  `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in `.env.local` you cannot get
  past the login screen, so most CCC flows are untestable in a bare cloud VM.
- **Fieldwork** (DIY SaaS) — entry `diy.html` → `src/diy/DiyApp.jsx`, served at
  `/diy.html` (hash routes like `#/signup`, `#/app`). It defaults to a
  **`localStorage` demo mode that needs NO backend and NO secrets**. This is the
  best way to exercise real product functionality end-to-end in cloud. Signup in
  demo mode only asks for name + email + plan + agreement (no password); "Enter
  Fieldwork" drops you into the dashboard and Campaign Wizard.

### Running / building (no secrets required)
- `npm run dev` starts Vite for **both** apps. It binds port **5173 but falls
  through to 5174/5175/… if that port is busy — always read the actual URL from
  the startup log** instead of assuming 5173.
- `npm run build` is the project's **primary validation step** (per README); it
  builds both `index.html` and `diy.html`. Run it after frontend changes.
- **No linter/formatter is configured** (no ESLint/Prettier/Jest/Vitest). "Lint"
  is not a thing here; don't invent one.
- The only automated tests are two standalone Node scripts that run without
  secrets: `npm run test:metro2-citations` and `npm run test:fieldwork-response`.

### Pieces that DO require secrets (usually can't run in a bare cloud VM)
- **Netlify Functions** (`netlify/functions/`) via `npx netlify dev` (port 8888;
  Vite proxies `/api/*` to it). Privileged CCC workflows (audits, letters, Lob
  mailing, intake, webhooks, cron) live here and need server-only keys
  (`SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `LOB_*`, `SENDGRID_API_KEY`).
- **CCC frontend auth/data** needs the `VITE_SUPABASE_*` browser keys.
- **Optional Python concierge agent** (`agents/`, FastAPI): `pip install -r
  agents/requirements.txt` then `agents/start.sh` (port 10000). Only the client
  portal concierge-chat tab needs it; the apps run fine without it. Requires
  Supabase + Google GenAI credentials.
- All secrets come from `.env.local` (template: `.env.example`). Fieldwork
  (`FIELDWORK_*` / `VITE_FIELDWORK_*`) is hard-isolated and never falls back to
  CCC keys — see `docs/FIELDWORK_ISOLATION.md`.
