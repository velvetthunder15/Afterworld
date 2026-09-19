import os
import time
from pathlib import Path
from typing import List, Literal

import openai
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
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
    # no-store makes the browser load the latest index.html every time
    return FileResponse(
        STATIC_DIR / "index.html",
        headers={"Cache-Control": "no-store"}
    )


# max_retries=0 because we do our own failover below
client = OpenAI(
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY"),
    timeout=45.0,
    max_retries=0
)

# The FIRST model is your main model and is the one shown under the chatbot name.
# If it is rate limited (429) or unavailable, the next ones are tried automatically.
MODELS = [
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "openrouter/free",   # OpenRouter picks any free model that is available
]
MODEL = MODELS[0]
ROUTER_MODEL = "openrouter/free"

SYSTEM_PROMPT = "You are a helpful chatbot."
MAX_TOKENS = 1000     # max length of one reply
MAX_HISTORY = 20      # how many recent messages are sent to the model

# Errors that would fail for every model, so there is no point trying the next one
FATAL_STATUSES = {401, 402}


@app.get("/model")
def get_model():
    return {"model": MODEL}


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: List[Message]


def build_messages(items):
    """Turn the chat history sent by the browser into a clean message list."""
    cleaned = []

    for item in items:
        content = item.content.strip()
        if not content:
            continue

        # Some models reject two messages in a row from the same role, so merge them
        if cleaned and cleaned[-1]["role"] == item.role:
            cleaned[-1]["content"] += "\n\n" + content
        else:
            cleaned.append({"role": item.role, "content": content})

    cleaned = cleaned[-MAX_HISTORY:]

    # The conversation must start with a user message
    while cleaned and cleaned[0]["role"] != "user":
        cleaned.pop(0)

    return [{"role": "system", "content": SYSTEM_PROMPT}] + cleaned


def describe_error(error):
    status = getattr(error, "status_code", None)

    if status == 429:
        return (
            "The free models are rate limited right now. Wait a minute and try again, "
            "or add your own provider key at openrouter.ai/settings/integrations "
            "to get your own rate limit."
        )
    if status == 401:
        return "OpenRouter rejected the API key. Check OPENROUTER_API_KEY in your .env file."
    if status == 402:
        return "This OpenRouter account has no credits left for that model."
    if isinstance(error, openai.APITimeoutError):
        return "The model took too long to respond. Try again."
    if isinstance(error, openai.APIConnectionError):
        return "Couldn't reach OpenRouter. Check your internet connection and try again."

    return f"The model request failed: {getattr(error, 'message', error)}"


class ModelUnavailable(Exception):
    def __init__(self, message):
        super().__init__(message)
        self.message = message


def first_token(iterator):
    """Read the stream until the first piece of text arrives."""
    for chunk in iterator:
        if not chunk.choices:
            continue

        token = chunk.choices[0].delta.content

        if token:
            return token, getattr(chunk, "model", None)

    return None, None


def open_stream(messages):
    """Try each model in MODELS until one starts answering."""
    last_message = "No model is configured."

    for attempt in range(2):
        rate_limited = False

        for model in MODELS:
            stream = None

            try:
                stream = client.chat.completions.create(
                    model=model,
                    messages=messages,
                    max_tokens=MAX_TOKENS,
                    stream=True
                )

                iterator = iter(stream)
                token, reported_model = first_token(iterator)

                if token is not None:
                    # openrouter/free tells us which model it picked
                    if model == ROUTER_MODEL and reported_model:
                        used_model = reported_model
                    else:
                        used_model = model

                    return used_model, token, iterator, stream

                stream.close()
                last_message = "The model returned an empty reply. Try again."
                print(f"[CRChatbot] {model} returned an empty reply, trying the next model")

            except openai.APIError as error:
                if stream is not None:
                    stream.close()

                status = getattr(error, "status_code", None)
                last_message = describe_error(error)
                print(f"[CRChatbot] {model} failed ({status or type(error).__name__}): "
                      f"{getattr(error, 'message', error)}")

                if status in FATAL_STATUSES:
                    raise ModelUnavailable(last_message)

                if status == 429:
                    rate_limited = True

        # Only worth a second pass if the models were just busy
        if not rate_limited:
            break

        time.sleep(2)

    raise ModelUnavailable(last_message)


@app.post("/chat")
def chat(data: ChatRequest):

    messages = build_messages(data.messages)

    if len(messages) < 2:
        raise HTTPException(status_code=400, detail="Type a message first.")

    try:
        used_model, token, iterator, stream = open_stream(messages)
    except ModelUnavailable as error:
        raise HTTPException(status_code=503, detail=error.message)

    def generate():
        try:
            yield token

            for chunk in iterator:

                if not chunk.choices:
                    continue

                piece = chunk.choices[0].delta.content

                if piece:
                    yield piece

        except Exception as error:
            yield f"\n\n[Reply interrupted: {describe_error(error)}]"

        finally:
            stream.close()

    return StreamingResponse(
        generate(),
        media_type="text/plain",
        headers={
            "X-Model": used_model,
            "Cache-Control": "no-store"
        }
    )
