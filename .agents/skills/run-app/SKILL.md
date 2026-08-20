---
name: run-app
description: Launch and drive the CCC Forensic Suite (Credit Comeback Club) app locally to see a change working. Use when asked to run, start, or screenshot the app, or to confirm a UI change works in the real app. Captures the non-obvious env + checkout gotchas.
---

# Running the CCC Forensic Suite locally

Vite + React SPA, Supabase backend. `npm run dev` (plain `vite`).

## As of 2026-07-26: single checkout, env already in place

The repo used to live nested inside a stale outer checkout
(`~/Desktop/ccc-demo/ccc-forensic-demo`, with creds one level up at
`~/Desktop/ccc-demo/.env.local`) — Chris moved it straight to
`~/Desktop/ccc-forensic-demo` and the old outer folder no longer exists. There is
now only one checkout, and `.env.local` already lives directly in it (gitignored,
already populated) — **no more copying an env file in from anywhere.** A bare
`npm run dev` from this directory just works.

## Gotchas that will still bite you

1. **Antigravity usually has a dev server already running** on :5173. Vite will
   fall through to :5174, :5175, … Read the actual URL from the startup log; don't
   assume :5173. Do **not** kill the user's Antigravity server — only kill the one
   you started.
2. **Auth wall — you cannot get past it yourself.** The app requires email/password
   sign-in, and entering passwords to authenticate is a prohibited action. Ask the
   user to sign in in the browser tab, then continue. Each port is a separate origin
   with its own session, so a fresh port needs a fresh sign-in.
3. **Admin-gated nav.** Billing, Team, and Affiliates only appear when the signed-in
   user is admin (`isAdmin` in `src/App.jsx`). Routing is view-state, not URL — you
   navigate by clicking the sidebar item, not by changing the URL.
4. **Verify you're actually running current code.** `git log --oneline -1` before
   trusting what you see, same discipline as always — cheap insurance against a
   stray stale checkout turning up again somewhere.

## Launch

```bash
cd ~/Desktop/ccc-forensic-demo
npm run dev            # → "Local: http://localhost:5174/" (or next free port)
```

## Drive it (browser automation)

1. `tabs_context_mcp{createIfEmpty:true}` → `navigate` to the URL from the log.
2. Screenshot. If blank white, check `read_console_messages{onlyErrors:true}` — a
   `supabaseUrl is required` exception would mean `.env.local` went missing;
   re-check it's actually present before assuming anything else.
3. On the sign-in screen, **ask the user to sign in** — do not type credentials.
4. After sign-in, click a sidebar item (`find` "Billing navigation item", then
   `computer left_click` its ref) and screenshot. Billing/Team/Affiliates require
   an admin account.

## Cleanup

```bash
# Kill ONLY the server you started (find its pid by the port you launched)
kill $(lsof -nP -iTCP:5174 -sTCP:LISTEN -t)
```

No env file to clean up anymore — it lives in place now, not a temporary copy.
Leave the user's pre-existing Antigravity vite server running.
