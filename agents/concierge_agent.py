from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
from google import genai
from google.genai import types

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    client_id: str
    message: str

from supabase import create_client, Client

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL else None

def _get_client_name(client_id: str) -> str:
    if not supabase: return ""
    res = supabase.table('client_profiles').select('full_name').eq('user_id', client_id).execute()
    if res.data and len(res.data) > 0:
        return res.data[0]['full_name']
    return ""

# Define tools as standard Python functions
def check_audit_status(client_id: str) -> str:
    """Checks if the forensic audit has been completed for the client and summarizes violations."""
    if not supabase: return "Database not connected."
    name = _get_client_name(client_id)
    if not name: return "Client profile not found."
    
    res = supabase.table('audits').select('audit').eq('client_name', name).order('saved_at', desc=True).limit(1).execute()
    if not res.data:
        return "No audit has been run for this client yet."
        
    audit_data = res.data[0].get('audit', {})
    violations = []
    for bureau, data in audit_data.items():
        count = data.get('violationCount', 0)
        violations.append(f"{bureau.capitalize()}: {count} violations")
        
    if not violations:
        return "Audit found no violations."
    return "Audit is completed. Violations found: " + ", ".join(violations)

def check_letter_delivery_status(client_id: str) -> str:
    """Checks the delivery status of the Phase 1 letters via Lob."""
    if not supabase: return "Database not connected."
    name = _get_client_name(client_id)
    if not name: return "Client profile not found."
    
    res = supabase.table('letters').select('furnisher, phase, status, saved_at').eq('client_name', name).execute()
    if not res.data:
        return "No letters have been sent for this client."
        
    statuses = []
    for letter in res.data:
        furnisher = letter.get('furnisher')
        phase = letter.get('phase')
        status = letter.get('status')
        date = letter.get('saved_at', '').split('T')[0]
        statuses.append(f"{furnisher} ({phase}): {status} on {date}")
        
    return "Letter statuses: " + " | ".join(statuses)

def check_missing_onboarding_documents(client_id: str) -> str:
    """Checks if the client is missing their ID or utility bill."""
    if not supabase: return "Database not connected."
    name = _get_client_name(client_id)
    if not name: return "Client profile not found."
    
    res = supabase.table('documents').select('doc_type').eq('client_name', name).execute()
    docs = [d.get('doc_type') for d in (res.data or [])]
    
    missing = []
    if 'id' not in docs: missing.append("Government ID")
    if 'address' not in docs: missing.append("Utility Bill")
    
    if not missing:
        return "All onboarding documents have been received."
    return "Client is missing: " + ", ".join(missing)

@app.post("/chat")
async def chat_with_concierge(req: ChatRequest):
    # Initialize the public Gemini client
    # It automatically picks up GEMINI_API_KEY from the environment variables
    client = genai.Client()
    
    system_instruction = (
        "You are the Credit Comeback Club Concierge. Be polite, authoritative, and helpful. "
        "Use your tools to look up the exact status of the client's disputes. "
        "Never guess. Keep responses concise."
    )
    
    # Configure the request with tools
    config = types.GenerateContentConfig(
        system_instruction=system_instruction,
        tools=[check_audit_status, check_letter_delivery_status, check_missing_onboarding_documents],
        temperature=0.4
    )
    
    prompt = f"Client {req.client_id} says: {req.message}"
    
    try:
        # In this demo, we use stateless generate_content and rely on the model to call the tool and return.
        # Since we just want a simple response or tool call, we'll handle a single interaction.
        # Note: A robust chat agent loop would handle tool calls recursively. 
        # We will let the model answer directly for this basic setup.
        response = client.models.generate_content(
            model='gemini-3.5-flash',
            contents=prompt,
            config=config
        )
        
        # If the model decided to call a tool, we'd need to execute it and return the result.
        # For simplicity in this demo endpoint, if it calls a tool, we will just manually execute it and provide a raw reply.
        if response.function_calls:
            tool_response_parts = []
            for fc in response.function_calls:
                func_name = fc.name
                if func_name == "check_audit_status":
                    res = check_audit_status(req.client_id)
                elif func_name == "check_letter_delivery_status":
                    res = check_letter_delivery_status(req.client_id)
                elif func_name == "check_missing_onboarding_documents":
                    res = check_missing_onboarding_documents(req.client_id)
                else:
                    res = "Tool not found."
                    
                tool_response_parts.append(
                    types.Part.from_function_response(
                        name=func_name,
                        response={"result": res}
                    )
                )
                
            # Send all tool results back to the model
            final_response = client.models.generate_content(
                model='gemini-3.5-flash',
                contents=[prompt, response.candidates[0].content, types.Content(parts=tool_response_parts, role="user")],
                config=config
            )
            return {"reply": final_response.text}
            
        return {"reply": response.text}
        
    except Exception as e:
        print(f"Error: {e}")
        return {"reply": f"Developer Error: {e}"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
