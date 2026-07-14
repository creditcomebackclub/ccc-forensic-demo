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

# Define tools as standard Python functions
def check_audit_status(client_id: str) -> str:
    """Checks if the forensic audit has been completed for the client."""
    return f"Audit for {client_id} is completed. 3 violations found."

def check_letter_delivery_status(client_id: str) -> str:
    """Checks the delivery status of the Phase 1 letters via Lob."""
    return "Letters were delivered 12 days ago."

def check_missing_onboarding_documents(client_id: str) -> str:
    """Checks if the client is missing their ID or utility bill."""
    return "Client is missing a Utility Bill."

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
            model='gemini-2.5-flash',
            contents=prompt,
            config=config
        )
        
        # If the model decided to call a tool, we'd need to execute it and return the result.
        # For simplicity in this demo endpoint, if it calls a tool, we will just manually execute it and provide a raw reply.
        if response.function_calls:
            fc = response.function_calls[0]
            func_name = fc.name
            # extremely basic router for the demo
            if func_name == "check_audit_status":
                res = check_audit_status(req.client_id)
            elif func_name == "check_letter_delivery_status":
                res = check_letter_delivery_status(req.client_id)
            elif func_name == "check_missing_onboarding_documents":
                res = check_missing_onboarding_documents(req.client_id)
            else:
                res = "Tool not found."
                
            # Send the tool result back to the model to get the final conversational response
            tool_response_part = types.Part.from_function_response(
                name=func_name,
                response={"result": res}
            )
            final_response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=[prompt, response.candidates[0].content, tool_response_part],
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
