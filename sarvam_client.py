"""
sarvam_client.py
Thin async wrapper around every Sarvam API used in this project.
All calls go to https://api.sarvam.ai.
"""

import os
import base64
import httpx
from dotenv import load_dotenv

load_dotenv()

SARVAM_API_KEY = os.getenv("SARVAM_API_KEY", "")
SARVAM_BASE_URL = os.getenv("SARVAM_API_BASE_URL", "https://api.sarvam.ai")

HEADERS = {
    "api-subscription-key": SARVAM_API_KEY,
}


def _client() -> httpx.AsyncClient:
    """Return an async HTTP client with the base URL and auth headers."""
    return httpx.AsyncClient(
        base_url=SARVAM_BASE_URL,
        headers=HEADERS,
        timeout=120.0,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 1. STT — Speech-to-Text (Saaras v3)
# ─────────────────────────────────────────────────────────────────────────────
async def transcribe_audio(audio_bytes: bytes, language_code: str = "hi-IN") -> dict:
    """
    Transcribe audio bytes using Sarvam Saaras STT.
    Returns: { "transcript": str, "language_code": str }
    """
    async with _client() as c:
        response = await c.post(
            "/speech-to-text",
            data={
                "model": "saaras:v4",
                "language_code": language_code,
                "with_timestamps": "false",
            },
            files={"file": ("audio.wav", audio_bytes, "audio/wav")},
        )
        response.raise_for_status()
        data = response.json()
        transcript = data.get("transcript", "")
        return {"transcript": transcript, "language_code": language_code}


# ─────────────────────────────────────────────────────────────────────────────
# 2. Vision — Extract structured key-values from a document image
# ─────────────────────────────────────────────────────────────────────────────
async def extract_document(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """
    Extract structured key-value pairs from a prescription / document image.
    Returns: { "fields": [...] }
    """
    b64 = base64.b64encode(image_bytes).decode()
    async with _client() as c:
        response = await c.post(
            "/vision/document/extract",
            json={
                "document": {
                    "type": "image_base64",
                    "data": b64,
                    "mime_type": mime_type,
                },
                "return_type": "all",
            },
        )
        response.raise_for_status()
        return response.json()


# ─────────────────────────────────────────────────────────────────────────────
# 3. Vision — Digitise / parse a full document
# ─────────────────────────────────────────────────────────────────────────────
async def digitise_document(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """
    Parse and digitise a full document (discharge summary, reports).
    Returns full structured JSON from Sarvam Vision.
    """
    b64 = base64.b64encode(image_bytes).decode()
    async with _client() as c:
        response = await c.post(
            "/vision/document/digitise",
            json={
                "document": {
                    "type": "image_base64",
                    "data": b64,
                    "mime_type": mime_type,
                },
            },
        )
        response.raise_for_status()
        return response.json()


# ─────────────────────────────────────────────────────────────────────────────
# 4. LLM — Chat completions (Sarvam-105B)
# ─────────────────────────────────────────────────────────────────────────────
async def llm_complete(system_prompt: str, user_message: str) -> str:
    """
    Call Sarvam-105B for text generation.
    Returns: str (assistant reply)
    """
    async with _client() as c:
        response = await c.post(
            "/text/completions",
            json={
                "model": "sarvam-m",
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_message},
                ],
                "max_tokens": 2048,
                "temperature": 0.3,
            },
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


# ─────────────────────────────────────────────────────────────────────────────
# 5. Translate (Mayura v1)
# ─────────────────────────────────────────────────────────────────────────────
async def translate_text(text: str, source_lang: str = "en-IN", target_lang: str = "hi-IN") -> str:
    """
    Translate text between Indic languages using Sarvam Mayura.
    Returns: translated string
    """
    async with _client() as c:
        response = await c.post(
            "/translate",
            json={
                "input": text,
                "source_language_code": source_lang,
                "target_language_code": target_lang,
                "speaker_gender": "Female",
                "mode": "formal",
                "model": "mayura:v1",
                "enable_preprocessing": True,
            },
        )
        response.raise_for_status()
        data = response.json()
        return data.get("translated_text", text)


# ─────────────────────────────────────────────────────────────────────────────
# 6. TTS — Text-to-Speech (Bulbul v3)
# ─────────────────────────────────────────────────────────────────────────────
async def speak_text(text: str, language_code: str = "hi-IN") -> bytes:
    """
    Convert text to speech using Sarvam Bulbul TTS.
    Returns: audio bytes (WAV)
    """
    # Bulbul v3 supports up to 500 chars per call; chunk if needed
    async with _client() as c:
        response = await c.post(
            "/text-to-speech",
            json={
                "inputs": [text[:500]],
                "target_language_code": language_code,
                "speaker": "meera",
                "pitch": 0,
                "pace": 1.0,
                "loudness": 1.5,
                "speech_sample_rate": 22050,
                "enable_preprocessing": True,
                "model": "bulbul:v1",
            },
        )
        response.raise_for_status()
        data = response.json()
        audios = data.get("audios", [])
        if audios:
            return base64.b64decode(audios[0])
        return b""


# ─────────────────────────────────────────────────────────────────────────────
# 7. Language Identification
# ─────────────────────────────────────────────────────────────────────────────
async def identify_language(text: str) -> str:
    """
    Auto-detect the language of input text.
    Returns: language code string (e.g. 'hi-IN')
    """
    async with _client() as c:
        response = await c.post(
            "/text-lid",
            json={"input": text},
        )
        response.raise_for_status()
        data = response.json()
        return data.get("language_code", "hi-IN")
