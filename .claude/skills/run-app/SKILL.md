---
name: run-app
description: Launch and drive the CCC Forensic Suite (Credit Comeback Club) app locally to see a change working. Use when asked to run, start, or screenshot the app, or to confirm a UI change works in the real app. Captures the non-obvious env + checkout gotchas.
---

# Running the CCC Forensic Suite locally

Vite + React SPA, Supabase backend. `npm run dev` (plain `vite`). The tricky
parts are **which checkout** and **where the env lives** — get those right and it
just works.

## Gotchas that will bite you (read first)

1. **Two checkouts of the same repo exist.** The live code is the **nested**
   `~/Desktop/ccc-demo/ccc-forensic-demo`. The **outer** `~/Desktop/ccc-demo` is a
   **stale checkout ~180+ commits behind** — its dev server renders but is missing
   newer pages (e.g. the Billing dashboard nav item). Always run from the nested
   `ccc-forensic-demo` dir. Verify with `git log --oneline -1` before trusting what
   you see.
2. **The env file lives in the OUTER folder, not here.** Supabase creds are at
   `~/Desktop/ccc-demo/.env.local`. This nested checkout ships only `.env.example`,
   so a bare `npm run dev` here **crashes on boot** with
   `Error: supabaseUrl is required` (`src/utils/supabase.js` reads
   `import.meta.env.VITE_SUPABASE_URL`). Copy the env in first (step 1 below).
   `.env.local` is gitignored, so the copy is safe and won't be committed.
3. **Antigravity usually has dev servers already running** on :5173 (often the
   *stale outer* checkout) and another port from the nested checkout. Vite will
   fall through to :5174, :5175, … Read the actual URL from the startup log; don't
   assume :5173. Do **not** kill the user's Antigravity servers — only kill the one
   you started.
4. **Auth wall — you cannot get past it yourself.** The app requires email/password
   sign-in, and entering passwords to authenticate is a prohibited action. Ask the
   user to sign in in the browser tab, then continue. Each port is a separate origin
   with its own session, so a fresh port needs a fresh sign-in.
5. **Admin-gated nav.** Billing, Team, and Affiliates only appear when the signed-in
   user is admin (`isAdmin` in `src/App.jsx`). Routing is view-state, not URL — you
   navigate by clicking the sidebar item, not by changing the URL.

## Launch

```bash
cd ~/Desktop/ccc-demo/ccc-forensic-demo
# 1. Supply creds (gitignored; harmless local copy)
cp ~/Desktop/ccc-demo/.env.local .env.local
# 2. Start the dev server (backgrounded); read the port it prints
npm run dev            # → "Local: http://localhost:5174/" (or next free port)
```

## Drive it (browser automation)

1. `tabs_context_mcp{createIfEmpty:true}` → `navigate` to the URL from the log.
2. Screenshot. If blank white, check `read_console_messages{onlyErrors:true}` — a
   `supabaseUrl is required` exception means step 1 (env copy) was skipped.
3. On the sign-in screen, **ask the user to sign in** — do not type credentials.
4. After sign-in, click a sidebar item (`find` "Billing navigation item", then
   `computer left_click` its ref) and screenshot. Billing/Team/Affiliates require
   an admin account.

## Cleanup

```bash
# Kill ONLY the server you started (find its pid by the port you launched)
kill $(lsof -nP -iTCP:5174 -sTCP:LISTEN -t)
rm -f ~/Desktop/ccc-demo/ccc-forensic-demo/.env.local   # remove the copied creds
```

Leave the user's pre-existing Antigravity vite servers running.
