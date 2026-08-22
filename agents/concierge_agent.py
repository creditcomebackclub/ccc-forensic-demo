from typing import Any
import json
import logging
import math
import os
import re
import threading
import time

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from google import genai
from google.genai import types
from pydantic import BaseModel
from supabase import Client, create_client


app = FastAPI()
logger = logging.getLogger("ccc-concierge")

_allowed_origins_raw = os.environ.get(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:8888",
)
_allowed_origins = [
    origin.strip()
    for origin in _allowed_origins_raw.split(",")
    if origin.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["POST"],
    allow_headers=["Authorization", "Content-Type"],
)


class ChatRequest(BaseModel):
    message: str

    class Config:
        extra = "forbid"


SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.environ.get("SUPABASE_ANON_KEY", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "") or os.environ.get("GEMINI_API_KEY", "")
supabase: Client | None = (
    create_client(SUPABASE_URL, SUPABASE_KEY)
    if SUPABASE_URL and SUPABASE_KEY
    else None
)
auth_client: Client | None = (
    create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    if SUPABASE_URL and SUPABASE_ANON_KEY
    else None
)

_READINESS_SUCCESS_TTL_SECONDS = 30.0
_READINESS_FAILURE_TTL_SECONDS = 5.0
_READINESS_SENTINEL_PORTAL_USER_ID = "00000000-0000-0000-0000-000000000000"
_READINESS_SENTINEL_CLIENT_ID = "00000000-0000-0000-0000-000000000000"
_readiness_cache: tuple[bool, float] = (False, 0.0)
_readiness_lock = threading.Lock()


def _configuration_missing() -> list[str]:
    required = {
        "SUPABASE_URL": SUPABASE_URL,
        "SUPABASE_ANON_KEY": SUPABASE_ANON_KEY,
        "SUPABASE_SERVICE_KEY": SUPABASE_KEY,
        "GOOGLE_API_KEY_OR_GEMINI_API_KEY": GOOGLE_API_KEY,
    }
    if os.environ.get("RENDER") and not os.environ.get("ALLOWED_ORIGINS"):
        required["ALLOWED_ORIGINS"] = ""
    return [name for name, value in required.items() if not value]


@app.get("/healthz")
def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


def _postgrest_error(exc: Exception) -> tuple[str, str]:
    """Extract only the stable Postgres error code/message from supabase-py."""
    code = str(getattr(exc, "code", "") or "")
    message = str(getattr(exc, "message", "") or "")
    if exc.args and isinstance(exc.args[0], dict):
        payload = exc.args[0]
        code = code or str(payload.get("code") or "")
        message = message or str(payload.get("message") or "")
    return code, message


def _probe_database_contract() -> bool:
    """Prove the deployed DB supports the concierge's canonical active gate.

    The nil UUID cannot resolve to a portal profile, so the hardened limiter must
    stop at the canonical resolver with its exact fail-closed error. The older
    limiter returns a different error; a missing RPC or events table fails too.
    No event row is inserted by this probe.
    """
    if not supabase:
        return False
    try:
        supabase.table("portal_concierge_events").select("id").limit(1).execute()
        supabase.rpc(
            "ccc_begin_portal_concierge_request",
            {
                "p_portal_user_id": _READINESS_SENTINEL_PORTAL_USER_ID,
                "p_client_id": _READINESS_SENTINEL_CLIENT_ID,
                "p_handoff_reason": None,
            },
        ).execute()
    except Exception as exc:
        code, message = _postgrest_error(exc)
        return (
            code == "42501"
            and message == "The client portal identity is ambiguous"
        )
    return False


def _database_contract_ready(*, force: bool = False) -> bool:
    """Cache readiness briefly so Render health polling does not load the DB."""
    global _readiness_cache
    now = time.monotonic()
    ready, expires_at = _readiness_cache
    if not force and expires_at > now:
        return ready
    with _readiness_lock:
        now = time.monotonic()
        ready, expires_at = _readiness_cache
        if not force and expires_at > now:
            return ready
        ready = _probe_database_contract()
        ttl = (
            _READINESS_SUCCESS_TTL_SECONDS
            if ready
            else _READINESS_FAILURE_TTL_SECONDS
        )
        _readiness_cache = (ready, now + ttl)
        return ready


@app.get("/readyz")
def readiness() -> dict[str, str]:
    if _configuration_missing():
        raise HTTPException(status_code=503, detail="Service configuration is incomplete")
    if not _database_contract_ready():
        raise HTTPException(status_code=503, detail="Required database contract is unavailable")
    return {"status": "ready"}

_ssn_pattern = re.compile(r"\b\d{3}[- ]?\d{2}[- ]?\d{4}\b")
_card_pattern = re.compile(r"\b(?:\d[ -]*?){13,19}\b")
_credential_pattern = re.compile(
    r"\b(password|passcode|security answer|login code|social security|ssn)\b",
    re.IGNORECASE,
)
_email_pattern = re.compile(
    r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b",
    re.IGNORECASE,
)
_phone_pattern = re.compile(
    r"(?<!\d)(?:\+?1[ .-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[ .-]?\d{3}[ .-]?\d{4}(?!\d)"
)
_birth_detail_pattern = re.compile(
    r"\b(?:dob|date of birth|birth date|birthday|born)\b",
    re.IGNORECASE,
)
_street_address_pattern = re.compile(
    r"(?<!\w)\d{1,6}\s+(?:[A-Z0-9.'-]+\s+){0,6}"
    r"(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|"
    r"court|ct|circle|way|highway|hwy|parkway|pkwy|terrace|trail|place|pl)\b",
    re.IGNORECASE,
)
_address_value_pattern = re.compile(
    r"\b(?:(?:home|mailing|physical|residential)\s+)?address\s*(?:is|:|=)\s*\d{1,6}\b",
    re.IGNORECASE,
)
_po_box_pattern = re.compile(r"\bP\.?\s*O\.?\s+Box\s+\d+\b", re.IGNORECASE)
_bank_number_pattern = re.compile(
    r"\b(?:routing|ABA)(?:\s+(?:number|no\.?))?\s*(?:is|:|=|#)?\s*\d{5,19}\b|"
    r"\b(?:bank|checking|savings)\s+account(?:\s+(?:number|no\.?))?"
    r"\s*(?:is|:|=|#)?\s*\d{5,19}\b",
    re.IGNORECASE,
)
_health_detail_pattern = re.compile(
    r"\b(?:medical|health|diagnos(?:is|ed)|symptom|medication|prescription|"
    r"treatment|therapy|therapist|physician|doctor|hospital(?:ized)?|surgery|"
    r"disability|pregnan(?:t|cy)|mental health)\b",
    re.IGNORECASE,
)
_unformatted_identifier_pattern = re.compile(r"(?<!\d)\d{7,12}(?!\d)")
_human_handoff = re.compile(
    r"\b(speak|talk|chat|connect)\b.{0,30}\b(person|human|specialist|team member|chris)\b|"
    r"\b(call me|have someone call|need a person)\b",
    re.IGNORECASE,
)
_legal_handoff = re.compile(
    r"\b(attorney|lawyer|lawsuit|sue|court|formal complaint|identity theft|fraud)\b",
    re.IGNORECASE,
)
_uuid_pattern = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _bearer_token(authorization: str | None) -> str:
    value = (authorization or "").strip()
    if not value.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing Authorization token")
    token = value[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing Authorization token")
    return token


def _normalize_portal_identity(value: Any) -> tuple[str, str, str]:
    if isinstance(value, list):
        value = value[0] if len(value) == 1 else None
    if not isinstance(value, dict):
        raise HTTPException(status_code=403, detail="The client portal identity could not be verified")
    profile_id = str(value.get("profileId") or "")
    client_id = str(value.get("clientId") or "")
    firm_user_id = str(value.get("firmUserId") or "")
    if not all(_uuid_pattern.fullmatch(item) for item in (profile_id, client_id, firm_user_id)):
        raise HTTPException(status_code=403, detail="The client portal identity could not be verified")
    return profile_id, client_id, firm_user_id


def _resolve_caller(authorization: str | None) -> tuple[str, str, str]:
    """Resolve an authenticated user through the active canonical portal gate."""
    if not auth_client or not supabase:
        raise HTTPException(status_code=500, detail="Server not configured")
    try:
        user_res = auth_client.auth.get_user(_bearer_token(authorization))
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    user = getattr(user_res, "user", None)
    if not user or not getattr(user, "id", None):
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    try:
        identity_res = supabase.rpc(
            "ccc_resolve_canonical_portal_identity",
            {
                "p_portal_user_id": str(user.id),
                "p_access_mode": "active",
            },
        ).execute()
        _, client_id, firm_user_id = _normalize_portal_identity(identity_res.data)
        return str(user.id), client_id, firm_user_id
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="Portal identity is unavailable")


def _begin_request(
    portal_user_id: str,
    client_id: str,
    handoff_reason: str | None,
) -> dict[str, Any]:
    """Use the durable database limiter and handoff log or fail closed.
    No message content is recorded."""
    if not supabase:
        raise HTTPException(status_code=503, detail="The concierge is temporarily unavailable")
    try:
        result = supabase.rpc(
            "ccc_begin_portal_concierge_request",
            {
                "p_portal_user_id": portal_user_id,
                "p_client_id": client_id,
                "p_handoff_reason": handoff_reason,
            },
        ).execute()
        gate = result.data
        if not isinstance(gate, dict) or not isinstance(gate.get("allowed"), bool):
            raise RuntimeError("invalid concierge gate response")
        if handoff_reason and gate.get("allowed") and gate.get("handoff_recorded") is not True:
            raise RuntimeError("handoff was not recorded")
        return gate
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="The concierge is temporarily unavailable")


def _handoff_reason(message: str) -> str | None:
    if _human_handoff.search(message):
        return "human_requested"
    if _legal_handoff.search(message):
        return "legal_or_security"
    return None


def _reject_sensitive_message(message: str) -> None:
    if (
        _ssn_pattern.search(message)
        or _card_pattern.search(message)
        or _credential_pattern.search(message)
        or _email_pattern.search(message)
        or _phone_pattern.search(message)
        or _birth_detail_pattern.search(message)
        or _street_address_pattern.search(message)
        or _address_value_pattern.search(message)
        or _po_box_pattern.search(message)
        or _bank_number_pattern.search(message)
        or _health_detail_pattern.search(message)
        or _unformatted_identifier_pattern.search(message)
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "Please do not send identity numbers, contact details, a date of birth, "
                "a physical address, banking or card details, passwords, or health "
                "information in chat. Use the secure portal fields or contact the team instead."
            ),
        )


def _safe_progress_number(
    value: Any,
    *,
    minimum: float,
    maximum: float,
) -> int | float | None:
    """Return only finite, bounded JSON numbers from an internal progress diff."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if not math.isfinite(number) or number < minimum or number > maximum:
        return None
    return int(number) if number.is_integer() else number


def _safe_progress_summary(row: dict[str, Any]) -> dict[str, Any]:
    """Reconstruct the model-facing progress shape from a narrow allowlist.

    A progress diff is an internal artifact and may contain account identifiers,
    staff findings, statutes, or arbitrary nested text. No raw diff object or
    string value is allowed to cross the external-model boundary.
    """
    source = row.get("diff")
    source = source if isinstance(source, dict) else {}
    raw_scores = source.get("scoreDeltas")
    raw_scores = raw_scores if isinstance(raw_scores, dict) else {}
    score_changes: dict[str, dict[str, int | float | None]] = {}
    for bureau in ("equifax", "experian", "transunion"):
        raw_score = raw_scores.get(bureau)
        raw_score = raw_score if isinstance(raw_score, dict) else {}
        score_changes[bureau] = {
            "old": _safe_progress_number(raw_score.get("old"), minimum=300, maximum=850),
            "new": _safe_progress_number(raw_score.get("new"), minimum=300, maximum=850),
            "delta": _safe_progress_number(raw_score.get("delta"), minimum=-550, maximum=550),
        }

    raw_counts = source.get("negativeCounts")
    raw_counts = raw_counts if isinstance(raw_counts, dict) else {}
    from_report_date = row.get("from_report_date")
    to_report_date = row.get("to_report_date")
    return {
        "from_report_date": (
            from_report_date
            if isinstance(from_report_date, str)
            and re.fullmatch(r"\d{4}-\d{2}-\d{2}", from_report_date)
            else None
        ),
        "to_report_date": (
            to_report_date
            if isinstance(to_report_date, str)
            and re.fullmatch(r"\d{4}-\d{2}-\d{2}", to_report_date)
            else None
        ),
        "score_changes": score_changes,
        "negative_accounts": {
            "before": _safe_progress_number(
                raw_counts.get("before"), minimum=0, maximum=10000
            ),
            "after": _safe_progress_number(
                raw_counts.get("after"), minimum=0, maximum=10000
            ),
        },
        "debt_removed": _safe_progress_number(
            source.get("totalDebtRemoved"), minimum=0, maximum=1_000_000_000
        ),
    }


def _safe_rows(builder: Any) -> list[dict[str, Any]]:
    result = builder.execute()
    return result.data or []


def _mail_label(service: str | None) -> str:
    if service == "usps_first_class":
        return "USPS First Class"
    if service == "usps_first_class_certified_return_receipt":
        return "Certified Mail (legacy history)"
    return "Mail service not recorded"


def _public_track_status(value: str | None) -> str:
    return {
        "active": "casework in progress",
        "review_required": "staff review underway",
        "deleted": "removal confirmed",
        "resolved": "review complete",
        "pending": "not started",
    }.get(str(value or ""), "status being prepared")


def _public_outcome_label(result: dict[str, Any]) -> str:
    achieved = result.get("achieved_target")
    if achieved == "account_deletion":
        return "Account removed"
    if achieved == "late_payment_removal":
        return "Late payment removed"
    if achieved == "factual_correction":
        return "Information corrected"
    if achieved == "consumer_statement_full_match":
        return "Statement updated"
    if result.get("response_status") == "verified":
        return "Verified; team review continuing"
    if result.get("response_status") == "no_response":
        return "No response recorded; staff review pending"
    return "Result under staff review"


def _load_portal_context(portal_user_id: str, client_id: str, firm_user_id: str) -> str:
    """Build only the case-status context a client may see. Raw notes, raw
    audits, statutes, classification snapshots, and internal flow names never
    enter the model prompt."""
    if not supabase:
        raise HTTPException(status_code=500, detail="Server not configured")
    try:
        client_rows = _safe_rows(
            supabase.table("clients")
            .select(
                "id,status,enrollment_date,score_eq_start,score_exp_start,"
                "score_tu_start,monitoring_enrolled,monitoring_not_required"
            )
            .eq("id", client_id)
            .eq("user_id", firm_user_id)
            .limit(2)
        )
        if len(client_rows) != 1:
            raise HTTPException(status_code=403, detail="Client record is unavailable")
        client = client_rows[0]

        profile_rows = _safe_rows(
            supabase.table("client_profiles")
            .select("onboarding_complete,agreement_signed_at")
            .eq("client_id", client_id)
            .eq("user_id", portal_user_id)
            .limit(2)
        )
        if len(profile_rows) != 1:
            raise HTTPException(status_code=403, detail="Client profile is unavailable")
        profile = profile_rows[0]

        document_rows = _safe_rows(
            supabase.table("documents")
            .select("doc_type")
            .eq("client_id", client_id)
            .eq("user_id", firm_user_id)
        )
        document_types = {row.get("doc_type") for row in document_rows}

        letter_rows = _safe_rows(
            supabase.table("letters")
            .select(
                "furnisher,target_bureau,target_type,round_number,mailed_date,"
                "tracking_status,delivered_at,mail_service,expected_delivery_date,"
                "response_outcome,response_date"
            )
            .eq("client_id", client_id)
            .eq("user_id", firm_user_id)
            .order("saved_at", desc=True)
            .limit(100)
        )
        letters = [
            {
                "account": row.get("furnisher") or "Account",
                "bureau": row.get("target_bureau"),
                "channel": (
                    "credit bureau"
                    if row.get("target_type") == "bureau"
                    else "direct account correspondence"
                ),
                "round": row.get("round_number"),
                "mailed_date": row.get("mailed_date"),
                "mail_service": _mail_label(row.get("mail_service")),
                "estimated_delivery": row.get("expected_delivery_date"),
                "delivery_status": row.get("tracking_status"),
                "delivered_at": row.get("delivered_at"),
                "response_status": row.get("response_outcome"),
                "response_date": row.get("response_date"),
            }
            for row in letter_rows
        ]

        track_rows = _safe_rows(
            supabase.table("ccc_account_tracks")
            .select(
                "id,client_account_id,track_scope,bureau_code,current_round,status,"
                "updated_at,client_accounts(display_furnisher,account_last4)"
            )
            .eq("client_id", client_id)
            .eq("user_id", firm_user_id)
            .order("updated_at", desc=True)
        )
        visible_tracks = []
        track_labels: dict[str, dict[str, Any]] = {}
        for row in track_rows:
            if row.get("track_scope") == "direct" and row.get("status") == "pending":
                continue
            account = row.get("client_accounts") or {}
            if isinstance(account, list):
                account = account[0] if account else {}
            public = {
                "account": account.get("display_furnisher") or "Account",
                "masked_account": (
                    f"ending {account.get('account_last4')}"
                    if account.get("account_last4")
                    else None
                ),
                "bureau": row.get("bureau_code"),
                "channel": (
                    "direct account review"
                    if row.get("track_scope") == "direct"
                    else "credit bureau review"
                ),
                "case_step": row.get("current_round"),
                "status": _public_track_status(row.get("status")),
            }
            visible_tracks.append(public)
            track_labels[str(row.get("id"))] = public

        result_rows = _safe_rows(
            supabase.table("dispute_letter_results")
            .select(
                "track_id,bureau_code,result_date,target_status,response_status,"
                "achieved_target,next_action,created_at"
            )
            .eq("client_id", client_id)
            .eq("user_id", firm_user_id)
            .not_.is_("batch_id", "null")
            .order("created_at", desc=True)
            .limit(100)
        )
        results = []
        for row in result_rows:
            track = track_labels.get(str(row.get("track_id")))
            if not track:
                continue
            results.append(
                {
                    "account": track["account"],
                    "bureau": row.get("bureau_code"),
                    "result_date": row.get("result_date"),
                    "outcome": _public_outcome_label(row),
                }
            )

        deletion_rows = _safe_rows(
            supabase.table("deletions")
            .select("furnisher,account_type,bureau_code,deletion_confirmed_at")
            .eq("client_id", client_id)
            .eq("user_id", firm_user_id)
            .not_.is_("deletion_confirmed_at", "null")
            .order("deletion_confirmed_at", desc=True)
        )
        deletions = [
            {
                "account": row.get("furnisher") or "Account",
                "account_type": row.get("account_type"),
                "bureau": row.get("bureau_code"),
                "confirmed_at": row.get("deletion_confirmed_at"),
            }
            for row in deletion_rows
        ]

        progress_rows = _safe_rows(
            supabase.table("progress_updates")
            .select("from_report_date,to_report_date,diff")
            .eq("client_id", client_id)
            .eq("user_id", firm_user_id)
            .or_("status.eq.sent,emailed_at.not.is.null")
            .order("to_report_date", desc=True)
            .limit(5)
        )
        progress = [_safe_progress_summary(row) for row in progress_rows]

        context = {
            "service": {
                "status": client.get("status"),
                "enrollment_date": client.get("enrollment_date"),
                "onboarding_complete": profile.get("onboarding_complete") is True,
                "agreement_signed": bool(profile.get("agreement_signed_at")),
                "monitoring_ready": bool(
                    client.get("monitoring_enrolled")
                    or client.get("monitoring_not_required")
                ),
                "documents": {
                    "government_id": "id" in document_types,
                    "proof_of_address": "address" in document_types,
                },
                "starting_scores": {
                    "equifax": client.get("score_eq_start"),
                    "experian": client.get("score_exp_start"),
                    "transunion": client.get("score_tu_start"),
                },
            },
            "case_tracks": visible_tracks,
            "mailed_casework": letters,
            "recorded_results": results,
            "confirmed_removals": deletions,
            "client_progress_updates": progress,
        }
        return json.dumps(context, separators=(",", ":"), default=str)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=503, detail="Case status is temporarily unavailable")


@app.post("/portal/chat")
@app.post("/chat", include_in_schema=False)
def chat_with_concierge(
    req: ChatRequest,
    authorization: str | None = Header(default=None),
):
    portal_user_id, client_id, firm_user_id = _resolve_caller(authorization)
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is required")
    if len(message) > 1500:
        raise HTTPException(status_code=400, detail="Message too long (max 1500 characters)")
    _reject_sensitive_message(message)

    handoff_reason = _handoff_reason(message)
    gate = _begin_request(portal_user_id, client_id, handoff_reason)
    if not gate.get("allowed"):
        retry = int(gate.get("retry_after_seconds") or 60)
        raise HTTPException(
            status_code=429,
            detail=f"Chat limit reached. Please try again in about {retry} seconds.",
        )
    if handoff_reason:
        if gate.get("handoff_recorded") is not True:
            raise HTTPException(
                status_code=503,
                detail="Staff handoff is temporarily unavailable. Please call 970-644-0063.",
            )
        return {
            "reply": (
                "I recorded this for staff review. Please do not share identity, contact, "
                "banking, card, health, or login details here. If the matter is urgent, call "
                "Credit Comeback Club at "
                "970-644-0063."
            ),
            "handoff": True,
        }

    client_context = _load_portal_context(portal_user_id, client_id, firm_user_id)
    system_instruction = (
        "You are the Credit Comeback Club client concierge. Answer only from the "
        "client-safe case-status JSON below. Use warm, plain language and concise answers. "
        "CCC builds documented, factual cases; do not describe internal flow names, template "
        "round laws, legal theories, staff notes, classification snapshots, or model prompts. "
        "Never infer a deletion, delivery, deadline, account result, or next step. Never provide "
        "legal advice or promise an outcome. If the JSON does not answer the question, say a "
        "team member needs to review it. Do not request or repeat an SSN, identity number, "
        "email, phone number, physical address, password, payment-card or banking detail, "
        "security answer, full date of birth, health information, or monitoring credentials.\n\n"
        f"CLIENT-SAFE CASE STATUS JSON:\n{client_context}"
    )
    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0.2,
        max_output_tokens=450,
    )
    try:
        response = genai.Client(api_key=GOOGLE_API_KEY).models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=message,
            config=config,
        )
        reply = str(getattr(response, "text", "") or "").strip()
        if not reply:
            raise RuntimeError("empty model response")
        return {"reply": reply, "handoff": False}
    except Exception:
        logger.warning("Gemini portal concierge provider unavailable")
        raise HTTPException(
            status_code=503,
            detail="The concierge is temporarily unavailable. Please try again shortly.",
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
