from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
import json
from google import genai
from google.genai import types
from supabase import create_client, Client

app = FastAPI()

# Comma-separated list of frontend origins allowed to call this API. Set
# ALLOWED_ORIGINS in the Render environment to the real deployed site
# URL(s) in production — the localhost defaults are for local dev only.
_allowed_origins = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:8888")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in _allowed_origins.split(",") if o.strip()],
    allow_credentials=True,
    allow_methods=["POST"],
    allow_headers=["Authorization", "Content-Type"],
)

class ChatRequest(BaseModel):
    client_id: str
    message: str

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL else None
# Separate anon-key client used only to verify a caller's session token —
# never trust a client-supplied client_id for who's asking (see
# netlify/functions/client-sensitive-data.mjs for the same pattern).
auth_client: Client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY) if (SUPABASE_URL and SUPABASE_ANON_KEY) else None


def _verify_caller(authorization: str | None, client_id: str) -> None:
    if not auth_client:
        raise HTTPException(status_code=500, detail="Server not configured")
    token = (authorization or "").removeprefix("Bearer ").removeprefix("bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing Authorization token")
    try:
        user_res = auth_client.auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    user = getattr(user_res, "user", None)
    if not user or user.id != client_id:
        raise HTTPException(status_code=403, detail="Not authorized for this client")


def _summarize_audit(audit: dict) -> dict:
    """Condensed, concierge-relevant view of one audit. Deliberately drops
    audit.get('personalInfo') (DOB, address, phone, employer, aliases) and
    audit.get('client', {}).get('personalInfo') — real personal PII that a
    "what's happening with my Discover account" question never needs — and
    each violation's full statute/case-law text, keeping just field name +
    severity so the concierge can still say what's wrong without carrying
    the complete legal citation into a third-party LLM prompt. Per-account
    furnisher/status/balance/masked-account-number and per-audit scores are
    kept: none of that is PII, and it's exactly what dispute-status
    questions need answered."""
    accounts = []
    for acct in (audit.get('accounts') or []):
        violations = acct.get('violations') or []
        accounts.append({
            'furnisher': acct.get('furnisher'),
            'accountNumberMasked': acct.get('accountNumberMasked'),
            'status': acct.get('status'),
            'balance': acct.get('balance'),
            'type': acct.get('type'),
            'disputeFlag': acct.get('disputeFlag'),
            'violations': [
                {'field': v.get('field'), 'severity': v.get('severity')}
                for v in violations
            ],
        })
    return {
        'scores': audit.get('scores') or (audit.get('client') or {}).get('scores'),
        'totalViolations': audit.get('totalViolations'),
        'accountsTargeted': audit.get('accountsTargeted'),
        'accounts': accounts,
    }


def _summarize_progress(diff: dict) -> dict:
    """Furnisher-level change signals only — not the full before/after
    violation objects (with statute text) the standalone diff engine
    produces for staff/client-portal use."""
    return {
        'scoreDeltas': diff.get('scoreDeltas'),
        'deleted_furnishers': [a.get('furnisher') for a in (diff.get('deleted') or [])],
        'new_furnishers': [a.get('furnisher') for a in (diff.get('new') or [])],
        'changed_furnishers': [c.get('furnisher') for c in (diff.get('changed') or [])],
        'negativeCounts': diff.get('negativeCounts'),
        'totalDebtRemoved': diff.get('totalDebtRemoved'),
    }


def _load_full_client_context(client_id: str) -> str:
    """Load this client's data and return it as a single context string for
    the concierge prompt. Deliberately NOT everything in the underlying
    tables — audits and progress diffs are passed through _summarize_audit
    / _summarize_progress first, which strip personalInfo (DOB, address,
    phone, employer) and full violation legal text before anything reaches
    a third-party LLM. Letters were already a narrow column select (no
    `html` column in it) from the query itself, so no change needed there."""
    if not supabase:
        return "Database not connected."

    # 1. Resolve identity
    profile_res = supabase.table('client_profiles').select('*').eq('user_id', client_id).execute()
    if not profile_res.data:
        return "Client profile not found."
    profile = profile_res.data[0]
    name = profile.get('full_name', '')

    # 2. Load client metadata (scores, enrollment, monitoring, etc.)
    client_res = supabase.table('clients').select('*').eq('name', name).execute()
    client_meta = client_res.data[0] if client_res.data else {}
    # `clients.user_id` is the owning staff/auditor tenant, not this client's
    # own login. audits/letters/documents/progress_updates only carry a text
    # `client_name`, so scoping by name alone would merge two different
    # clients that happen to share a full name. Every other write path in
    # this app (see src/utils/storage.js) always compound-keys on
    # (user_id, client_name) for exactly this reason — do the same here.
    tenant_user_id = client_meta.get('user_id')

    if not tenant_user_id:
        # Can't establish a safe tenant scope — fail closed rather than
        # querying audits/letters/documents by name alone.
        audits, letters, missing_docs, progress = [], [], ["Government ID", "Utility Bill"], []
    else:
        # 3. Load ALL audits (contains every account with full forensic detail)
        audits_res = supabase.table('audits').select('audit, report_date, saved_at').eq('client_name', name).eq('user_id', tenant_user_id).order('saved_at', desc=True).execute()
        audits = audits_res.data or []

        # 4. Load ALL letters (every furnisher, phase, mailed date, tracking, response outcome)
        letters_res = supabase.table('letters').select('furnisher, account_id, phase, type, saved_at, mailed_date, tracking_number, tracking_status, delivered_at, response_outcome, response_date, summary').eq('client_name', name).eq('user_id', tenant_user_id).execute()
        letters = letters_res.data or []

        # 5. Load documents (onboarding ID + utility bill)
        docs_res = supabase.table('documents').select('doc_type').eq('client_name', name).eq('user_id', tenant_user_id).execute()
        docs = [d.get('doc_type') for d in (docs_res.data or [])]
        missing_docs = []
        if 'id' not in docs:
            missing_docs.append("Government ID")
        if 'address' not in docs:
            missing_docs.append("Utility Bill")

        # 6. Load progress updates (audit-to-audit diffs)
        progress_res = supabase.table('progress_updates').select('from_report_date, to_report_date, diff').eq('client_name', name).eq('user_id', tenant_user_id).order('to_report_date', desc=True).execute()
        progress = progress_res.data or []

    # Build the context blob
    context_parts = []
    context_parts.append(f"=== CLIENT PROFILE ===")
    context_parts.append(f"Name: {name}")
    context_parts.append(f"Email: {profile.get('email', 'N/A')}")
    context_parts.append(f"Onboarding Complete: {profile.get('onboarding_complete', False)}")

    if client_meta:
        context_parts.append(f"\n=== CLIENT DETAILS ===")
        context_parts.append(f"Status: {client_meta.get('status', 'N/A')}")
        context_parts.append(f"Enrollment Date: {client_meta.get('enrollment_date', 'N/A')}")
        context_parts.append(f"Starting Scores - EQ: {client_meta.get('score_eq_start', 'N/A')}, EXP: {client_meta.get('score_exp_start', 'N/A')}, TU: {client_meta.get('score_tu_start', 'N/A')}")
        context_parts.append(f"Monitoring Service: {client_meta.get('monitoring_service', 'N/A')}")
        context_parts.append(f"Monitoring Enrolled: {client_meta.get('monitoring_enrolled', False)}")

    if missing_docs:
        context_parts.append(f"\n⚠️ MISSING DOCUMENTS: {', '.join(missing_docs)}")
    else:
        context_parts.append(f"\n✅ All onboarding documents received.")

    if audits:
        context_parts.append(f"\n=== FORENSIC AUDIT DATA ({len(audits)} audit(s)) ===")
        for i, a in enumerate(audits):
            context_parts.append(f"\n--- Audit #{i+1} (Report Date: {a.get('report_date', 'N/A')}) ---")
            context_parts.append(json.dumps(_summarize_audit(a.get('audit') or {})))
    else:
        context_parts.append(f"\n=== NO AUDITS RUN YET ===")

    if letters:
        context_parts.append(f"\n=== DISPUTE LETTERS ({len(letters)} letter(s)) ===")
        context_parts.append(json.dumps(letters))
    else:
        context_parts.append(f"\n=== NO LETTERS SENT YET ===")

    if progress:
        context_parts.append(f"\n=== PROGRESS UPDATES ({len(progress)} update(s)) ===")
        for p in progress:
            context_parts.append(f"\n--- {p.get('from_report_date', 'N/A')} → {p.get('to_report_date', 'N/A')} ---")
            context_parts.append(json.dumps(_summarize_progress(p.get('diff') or {})))

    return "\n".join(context_parts)


@app.post("/chat")
async def chat_with_concierge(req: ChatRequest, authorization: str | None = Header(default=None)):
    # Verify the caller's session actually belongs to the client_id they're
    # asking about — never trust a client-supplied id for whose data to load.
    _verify_caller(authorization, req.client_id)

    # Reject oversized messages — prevents prompt injection and runaway token costs.
    if len(req.message) > 2000:
        raise HTTPException(status_code=400, detail="Message too long (max 2000 characters)")

    # Load the full client context from the database
    client_context = _load_full_client_context(req.client_id)

    client = genai.Client()

    system_instruction = (
        "You are the Credit Comeback Club Concierge, a precise and knowledgeable AI assistant. "
        "You have been given a summary of the client's file below: every account with its furnisher, "
        "status, balance, and violations, all dispute letters sent, tracking info, response outcomes, "
        "onboarding documents, credit scores, and progress updates.\n\n"
        "RULES:\n"
        "1. Answer the client's exact question using the data provided. Be specific — reference account names, "
        "furnishers, violation types, dates, and statuses directly from the data.\n"
        "2. If the client asks about a specific account (e.g. 'Discover', 'USAlliance', 'Capital One'), search "
        "through the audit data for that furnisher/account and give them the exact details.\n"
        "3. Never guess. If the data genuinely does not contain what they asked about, say so clearly.\n"
        "4. Keep responses concise but thorough when specifics are needed.\n\n"
        f"=== CLIENT FILE ===\n{client_context}\n=== END CLIENT FILE ==="
    )

    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0.3
    )

    try:
        response = client.models.generate_content(
            model='gemini-3.1-flash-lite',
            contents=req.message,
            config=config
        )
        return {"reply": response.text}

    except Exception as e:
        print(f"Error: {e}")
        return {"reply": "Sorry, I'm having trouble answering right now. Please try again shortly."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
