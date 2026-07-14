import os
from google import genai
from google.genai import types

def check_audit_status(client_id: str) -> str:
    return "Audit for {client_id} is completed. 3 violations found."

client = genai.Client(api_key="mock_key")

config = types.GenerateContentConfig(
    system_instruction="Be helpful.",
    tools=[check_audit_status],
    temperature=0.4
)

try:
    response = client.models.generate_content(
        model='gemini-2.5-pro',
        contents="Client 123 says: what is my audit status?",
        config=config
    )
    print(response)
except Exception as e:
    print(f"Error: {e}")
