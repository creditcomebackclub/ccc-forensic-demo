# Credit Comeback Club — Forensic Operations Suite

An internal operations platform and client portal for Credit Comeback Club. It supports the end-to-end credit-repair workflow: lead intake, client onboarding, forensic credit-report audits, dispute-letter generation and mailing, response handling, escalations, billing, affiliate tracking, and client-facing progress updates.

> This software supports an operational workflow; it is not legal advice. Configure and use it in accordance with applicable credit-repair, privacy, consumer-protection, and data-security requirements.

## What is built

### Staff operations

- Role-aware authentication and administration through Supabase.
- A dashboard for active dispute campaigns, response windows, escalation readiness, Phase 3/4 workload, deletion outcomes, and portal adoption.
- Client and lead management with lifecycle statuses, VIP handling, referral data, notes, document status, billing status, and case history.
- An AI-assisted forensic audit workflow for uploaded credit reports, using CCC methodology and Metro 2 field references.
- Phase 1 dispute letters, Phase 2 response analysis, Phase 3 CRA escalations, and Phase 4 CFPB/AG escalation generation.
- Letter review, editing, mail fulfillment through Lob, delivery/return-receipt tracking, and a firm-wide in-flight letter tracker.
- Document management, LPOA signing/audit logging, response-file uploads, and encrypted handling for selected sensitive client data.
- Billing, accounts receivable, affiliate commissions, payout tracking, and affiliate management.

### Client and affiliate experiences

- A client portal for onboarding, audit progress, disputes, timeline, documents, billing, VIP services, and concierge chat.
- Public lead intake and referral flows.
- Branded affiliate portal data, referral links, and commission visibility.

## Architecture

```text
React + Vite frontend
        |
        +-- Supabase: Auth, Postgres, Storage, RLS
        |
        +-- Netlify Functions: privileged workflows, AI jobs, mailing,
        |                       LPOA, intake, notifications, cron
        |
        +-- Anthropic API: audits, letters, response analysis,
        |                   progress narratives, escalations
        |
        +-- Lob: letter fulfillment, tracking, webhooks
        |
        +-- Optional concierge service: Python service in /agents
```

The browser uses the Supabase anon key only. Privileged serverless functions use the Supabase service-role key and AI/mailing keys, which must remain server-side.

## Key areas of the repository

| Path | Purpose |
| --- | --- |
| `src/App.jsx` | Application shell, authentication, navigation, and role-aware views |
| `src/components/` | Staff dashboard, client management, portal, billing, affiliate, audit, and mailing UI |
| `src/components/client-portal/` | Client self-service portal tabs and concierge chat |
| `src/prompts/` | CCC forensic-audit, letter, Phase 2, Phase 4, and progress-narrative prompts |
| `src/utils/` | Supabase data access, workflow helpers, document handling, reporting, and calculations |
| `netlify/functions/` | Authenticated/privileged API endpoints, background jobs, Lob integration, webhooks, and cron |
| `supabase/migrations/` | Database schema, RLS, workflow, security, and data-migration history |
| `agents/` | Optional Python concierge-agent service |
| `public/` | Public marketing, intake, legal, embed, and static assets |

## Local development

### Prerequisites

- Node.js 20+
- A Supabase project with the migrations applied
- Netlify CLI for local serverless functions
- Required environment variables configured locally and in Netlify

### Install and run

```bash
npm install
npm run dev
```

`npm run dev` starts the Vite frontend only. For the application plus Netlify Functions, use:

```bash
npx netlify dev
```

The Netlify development server normally runs at `http://localhost:8888`.

### Required environment variables

Client-side variables:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_AGENTS_API_URL=  # optional; concierge-agent service URL
```

Server-only variables:

```bash
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
LOB_MODE=test
LOB_TEST_KEY=
LOB_LIVE_KEY=
LOB_WEBHOOK_SECRET=
SENDGRID_API_KEY=
```

Never expose `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, SendGrid, or Lob keys in client code or public build variables. In particular, remove any legacy `VITE_LOB_*` variables from Netlify and local environment files: only browser-safe values may use the `VITE_` prefix.

## Database and security

Apply the SQL migrations in `supabase/migrations/` to the target Supabase project, in filename order. They establish the application’s schema and include changes for client IDs, sensitive data, documents, letters, audits, billing, lifecycle status, escalations, affiliate commissions, and row-level security.

Before deploying to a new environment, verify:

1. Supabase Auth redirect URLs and email templates.
2. Storage buckets and policies used by client documents and response uploads.
3. RLS policies for staff, clients, affiliates, and public intake.
4. Server-side environment variables in Netlify.
5. Lob test/live mode, webhook secret, sender address, and return-address configuration.
6. The scheduled `daily-cron` function, configured in `netlify.toml`.
7. The `mail_artifacts` migration and private `documents` bucket access. A newly mailed letter should archive its exact Lob-rendered PDF; a return receipt is archived when Lob supplies it.

## Build and deploy

```bash
npm run build
```

Netlify is configured in `netlify.toml`:

- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`
- Node version: 20

The public homepage is served from `public/home.html`; authenticated app routes fall back to the React application.

## Current scaling work

The admin dashboard and client boards currently load full audit JSON and letter HTML for broad client lists. At higher volume, that creates unnecessary browser payload and memory pressure.

[implementation_plan.md](implementation_plan.md) describes the planned remedy:

- fetch lightweight client/audit/letter metadata for dashboard and Kanban views;
- fetch a client’s full audits and letters only when their detail panel opens;
- preserve the existing UI while allowing the system to scale to much larger client volumes.

## Validation

Run the production build after frontend changes:

```bash
npm run build
```

For workflow changes, also test the relevant role and path in Netlify local development: staff/admin, client portal, affiliate portal, public intake, mail tracking, and any affected background function.
