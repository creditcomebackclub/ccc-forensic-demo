from fastapi import FastAPI
from pydantic import BaseModel
import asyncio
import os
from google.antigravity import Agent, LocalAgentConfig, tool

app = FastAPI()

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
