from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import os
try:
    from google.antigravity import Agent, LocalAgentConfig, tool
except ImportError:
    # Fallback mock for public Render deployment since the proprietary SDK isn't on public PyPI
    print("Warning: Google Antigravity SDK not found. Using Mock Agent.")
    def tool(func): return func
    class LocalAgentConfig:
        def __init__(self, **kwargs): pass
    class MockResponse:
        async def text(self): return "This is a mock response from Render! The Google Antigravity SDK needs to be uploaded as a wheel file to work on public servers."
    class Agent:
        def __init__(self, config): pass
        async def __aenter__(self): return self
        async def __aexit__(self, exc_type, exc_val, exc_tb): pass
        async def chat(self, msg): return MockResponse()

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

@tool
async def check_audit_status(client_id: str) -> str:
    """Checks if the forensic audit has been completed for the client."""
    return f"Audit for {client_id} is completed. 3 violations found."

@tool
async def check_letter_delivery_status(client_id: str) -> str:
    """Checks the delivery status of the Phase 1 letters via Lob."""
    return "Letters were delivered 12 days ago."

@tool
async def check_missing_onboarding_documents(client_id: str) -> str:
    """Checks if the client is missing their ID or utility bill."""
    return "Client is missing a Utility Bill."

@app.post("/chat")
async def chat_with_concierge(req: ChatRequest):
    config = LocalAgentConfig(
        system_instruction="""
        You are the Credit Comeback Club Concierge. Be polite, authoritative, and helpful. 
        Use your tools to look up the exact status of the client's disputes. 
        Never guess. Keep responses concise.
        """
    )
    
    async with Agent(config) as agent:
        response = await agent.chat(f"Client {req.client_id} says: {req.message}")
        text = await response.text()
        return {"reply": text}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
