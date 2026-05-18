# CCC Forensic Suite — Browser Demo

A working forensic credit audit + dispute letter generator for **Credit Comeback Club**.

Upload a 3-bureau credit report PDF → get back a structured forensic audit + Phase 1 dispute letters, all built on the CCC methodology (Setup & Spike framework, Metro 2 field violations, FCRA §1681s-2 citations, Johnson v. MBNA standard).

---

## How It Works

```
Browser (React)
    │
    │  POST /api/audit  ─────────► Netlify Function (audit.js)
    │   { pdfBase64 }                        │
    │                                        │  Anthropic API
    │                                        │  + Master System Prompt
    │                                        │  + PDF
    │                                        ▼
    │                              Claude Opus reads PDF,
    │                              applies CCC forensic methodology,
    │                              returns structured JSON
    │                                        │
    ◄────────────────────────────────────────┘
   Display:
   - Client info + 3-bureau scores
   - Account list (Type A/B/C, violations, batch)
   - Per-account violation details
   - "Generate Phase 1 Letter" → renders printable HTML
```

**The API key never touches the browser.** It lives in Netlify environment variables and is only accessed by the serverless function.

---

## Local Development

### Prerequisites
- Node.js 20+
- An Anthropic API key

### Setup

```bash
# Install dependencies
npm install

# Create env file
cp .env.example .env
# Edit .env and add your real ANTHROPIC_API_KEY

# Install Netlify CLI globally (one-time)
npm install -g netlify-cli

# Run with Netlify dev (this runs both Vite AND the serverless function)
netlify dev
```

The Netlify CLI will start everything on `http://localhost:8888`. The React app proxies `/api/*` requests to the serverless function.

### Alternative: Vite-only (without Netlify functions)
If you want to run just the frontend (functions won't work):
```bash
npm run dev
```
Opens on `http://localhost:5173`.

---

## Netlify Deployment

### Option 1: Push to GitHub, then connect in Netlify dashboard

1. Push this repo to GitHub
2. In Netlify dashboard: "Add new site" → "Import an existing project" → connect your repo
3. Build settings (auto-detected from `netlify.toml`):
   - Build command: `npm run build`
   - Publish directory: `dist`
   - Functions directory: `netlify/functions`
4. **Critical:** Add environment variable in Site Settings → Environment Variables:
   - Key: `ANTHROPIC_API_KEY`
   - Value: your real Anthropic API key
5. Deploy

### Option 2: Direct CLI deploy

```bash
netlify login
netlify init  # link to a new or existing site
netlify env:set ANTHROPIC_API_KEY sk-ant-...
netlify deploy --prod
```

---

## File Structure

```
ccc-demo/
├── netlify/
│   └── functions/
│       └── audit.js              # Serverless function — calls Claude API
├── src/
│   ├── components/
│   │   ├── UploadZone.jsx        # PDF drop zone
│   │   ├── AuditProgress.jsx     # Loading state with step animation
│   │   ├── AuditResults.jsx      # Results display (accounts, violations, batches)
│   │   └── LetterViewer.jsx      # HTML letter render + print/download
│   ├── prompts/
│   │   └── masterPrompt.js       # THE master CCC system prompt
│   ├── styles/
│   │   └── index.css             # Tailwind + custom CSS
│   ├── utils/
│   │   └── api.js                # API client wrapper
│   ├── App.jsx                   # Main app component
│   └── main.jsx                  # Entry point
├── index.html
├── netlify.toml                  # Netlify config (redirects, build, functions)
├── package.json
├── postcss.config.js
├── tailwind.config.js
└── vite.config.js
```

---

## How to Modify the Methodology

**All the forensic logic lives in `src/prompts/masterPrompt.js`.**

This is the single file you edit when:
- A new violation pattern emerges → add it to Section 3
- A new furnisher gets verified → add to Section 12 master list
- A new pattern card from a case → add to Section 8 pattern library
- Letter format changes → edit Section 7
- Tone or rules change → edit Section 11

Every API call uses this prompt. Update it once, every future audit reflects the change.

---

## Cost Tracking

Each audit uses roughly:
- ~10,000 tokens for the system prompt
- ~20,000–60,000 tokens for a credit report PDF (depending on length)
- ~3,000–6,000 tokens output

That's around **$0.30–$0.60 per audit** at current Claude Opus pricing. Letters are around $0.15–$0.30 each.

50 active clients running monthly audits + 5–10 letters each ≈ $200–$400/month in API costs. Compare with $30/month × 3 specialists × Claude.ai subscriptions = $90/month in subs but full operational chaos.

---

## Known Limitations (v1)

- Letters are HTML, not editable .docx. Print-to-PDF works perfectly for mailing.
- No client management / no persistence between sessions. Each audit is one-shot.
- No furnisher response analysis (Phase 2/3) yet — Phase 1 only.
- No DisputeFox integration.
- Single user. No team / multi-specialist support yet.

All of these are addressable in the next iteration when you're ready to build the full platform. This is the demo that proves it works.

---

## Next Steps After Demo Validation

1. **Add Phase 2/3 modes**: upload furnisher response → analyze + build CRA letters
2. **Add client persistence**: PostgreSQL backend for case state
3. **Add multi-user auth**: specialist logins, role-based access
4. **Add letter editing**: structured JSON output + DOCX generation client-side
5. **Add DisputeFox integration** if they have an API
6. **Add Phase 2 monitoring dashboard**: track response windows across all clients

---

*Built by Claude for Credit Comeback Club. The master prompt encodes the full Setup & Spike framework.*
