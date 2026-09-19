
import os
import uuid
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from openai import OpenAI
from pydantic import BaseModel

load_dotenv()

app = FastAPI()

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"

app.mount(
    "/static",
    StaticFiles(directory=STATIC_DIR),
    name="static"
)


@app.get("/")
def home():
    return FileResponse(STATIC_DIR / "index.html")


client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
    timeout=60.0
)

MODEL = "google/gemma-4-26b-a4b:free"
app.get("/model")
def get_model():
    return {"model": MODEL_NAME}

# Each browser gets its own conversation
conversations = {}


class ChatRequest(BaseModel):
    message: str


def get_session(request: Request):
    session_id = request.cookies.get("session_id")

    if not session_id:
        session_id = str(uuid.uuid4())

    if session_id not in conversations:
        conversations[session_id] = [
            {
                "role": "system",
                "content": "You are a helpful chatbot."
            }
        ]

    return session_id


@app.post("/chat")
def chat(request: Request, data: ChatRequest):

    session_id = get_session(request)

    conversation = conversations[session_id]

    conversation.append({
        "role": "user",
        "content": data.message
    })

    # Keep conversations from becoming huge
    if len(conversation) > 21:
        conversation[:] = [conversation[0]] + conversation[-20:]

    def generate():

        try:
            stream = client.chat.completions.create(
                model=MODEL,
                messages=conversation,
                max_tokens=300,
                stream=True
            )

            full_answer = ""

            for chunk in stream:

                if not chunk.choices:
                    continue

                token = chunk.choices[0].delta.content

                if token:
                    full_answer += token
                    yield token

            conversation.append({
                "role": "assistant",
                "content": full_answer
            })

        except Exception as e:
            yield f"\n[Error: {str(e)}]"

    response = StreamingResponse(
        generate(),
        media_type="text/plain"
    )

    response.set_cookie(
        key="session_id",
        value=session_id,
        httponly=True,
        samesite="lax",
        max_age=60 * 60 * 24 * 30
    )

    return response