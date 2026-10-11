"""
main.py
FastAPI server for Sunniye, Samjhiye + Discharge Decoder
Indic Healthcare Copilot — powered entirely by Sarvam AI APIs
"""

import json
import base64
from pathlib import Path

from fastapi import FastAPI, File, Form, UploadFile, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import sarvam_client as sarvam

app = FastAPI(title="Sunniye Samjhiye – Indic Healthcare Copilot")

# ─── Serve static files ───────────────────────────────────────────────────────
STATIC_DIR = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", response_class=HTMLResponse)
async def root():
    return (STATIC_DIR / "index.html").read_text(encoding="utf-8")


# ─────────────────────────────────────────────────────────────────────────────
# Route 1: Transcribe audio (Saaras STT)
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    language_code: str = Form("hi-IN"),
):
    """
    Accept an audio file (WAV/WebM) and return the transcript.
    """
    audio_bytes = await audio.read()
    try:
        result = await sarvam.transcribe_audio(audio_bytes, language_code)
        return JSONResponse(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"STT error: {str(e)}")


# ─────────────────────────────────────────────────────────────────────────────
# Route 2: Extract structured data from prescription image (Sarvam Vision)
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/extract-doc")
async def extract_doc(image: UploadFile = File(...)):
    """
    Upload a prescription photo and extract key-value medical fields.
    """
    image_bytes = await image.read()
    mime = image.content_type or "image/jpeg"
    try:
        result = await sarvam.extract_document(image_bytes, mime)
        return JSONResponse(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vision extract error: {str(e)}")


# ─────────────────────────────────────────────────────────────────────────────
# Route 3: Digitise a full discharge summary doc (Sarvam Vision)
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/digitise-doc")
async def digitise_doc(image: UploadFile = File(...)):
    """
    Upload a discharge summary image and get the full parsed text/structure.
    """
    image_bytes = await image.read()
    mime = image.content_type or "image/jpeg"
    try:
        result = await sarvam.digitise_document(image_bytes, mime)
        return JSONResponse(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vision digitise error: {str(e)}")


# ─────────────────────────────────────────────────────────────────────────────
# Route 4: Generate OPD Clinical Note (Sarvam-105B)
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/generate-note")
async def generate_note(
    transcript: str = Form(""),
    prescription_data: str = Form("{}"),
    language_code: str = Form("hi-IN"),
):
    """
    Combine STT transcript + extracted prescription data into a structured
    dual-column clinical OPD note using Sarvam-105B.
    """
    system_prompt = """You are an expert clinical note assistant for Indian hospitals.
Your role is to take a patient's spoken symptom narrative (in an Indic language) 
and any extracted prescription/document data, and produce a structured clinical note.

Return ONLY valid JSON in this exact format:
{
  "patient_narrative": [
    {"quote": "...", "timestamp": "0:00", "language": "Hindi"}
  ],
  "clinical_hypotheses": [
    {"finding": "...", "interpretation": "...", "priority": "high|medium|low"}
  ],
  "prescription_extracted": [
    {"field": "...", "value": "..."}
  ],
  "summary": "Brief one-paragraph clinical summary in English",
  "recommended_action": "..."
}"""

    user_message = f"""Patient Spoken Narrative (Transcript):
{transcript if transcript else 'No audio transcript provided.'}

Extracted Prescription/Document Data:
{prescription_data}

Language of patient: {language_code}

Generate a structured clinical note from the above."""

    try:
        raw = await sarvam.llm_complete(system_prompt, user_message)
        # Try to parse as JSON; if not, wrap in a simple structure
        try:
            note = json.loads(raw)
        except json.JSONDecodeError:
            # Extract JSON from markdown code blocks if present
            import re
            match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", raw)
            if match:
                note = json.loads(match.group(1))
            else:
                note = {"raw_response": raw}
        return JSONResponse(note)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM error: {str(e)}")


# ─────────────────────────────────────────────────────────────────────────────
# Route 5: Decode discharge summary (Vision + LLM + Translate)
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/decode-discharge")
async def decode_discharge(
    image: UploadFile = File(...),
    target_language: str = Form("hi-IN"),
):
    """
    Upload a discharge summary image. Returns simplified explanation,
    7-day recovery plan, and red-flag symptoms in the target Indic language.
    """
    image_bytes = await image.read()
    mime = image.content_type or "image/jpeg"

    # Step 1: Digitise the document
    try:
        doc_data = await sarvam.digitise_document(image_bytes, mime)
        raw_text = json.dumps(doc_data, ensure_ascii=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Vision digitise error: {str(e)}")

    # Step 2: Simplify with LLM
    system_prompt = """You are a compassionate healthcare communicator helping Indian patients 
understand their discharge summary in plain, simple language.

Return ONLY valid JSON in this exact format:
{
  "diagnosis": "What happened — simple 2-3 sentences in plain English",
  "recovery_plan": [
    "Day 1-2: Rest completely...",
    "Day 3-4: ...",
    "Day 5-7: ..."
  ],
  "medications": [
    {"medicine": "...", "dose": "...", "timing": "...", "duration": "..."}
  ],
  "red_flags": [
    "Go back to hospital immediately if: ...",
    "Call your doctor if: ..."
  ],
  "diet_advice": "...",
  "follow_up": "..."
}"""

    user_message = f"""Here is the discharge summary content extracted from the document:
{raw_text}

Simplify this for a patient who speaks {target_language} and may not have medical knowledge."""

    try:
        raw = await sarvam.llm_complete(system_prompt, user_message)
        try:
            simplified = json.loads(raw)
        except json.JSONDecodeError:
            import re
            match = re.search(r"```(?:json)?\s*([\s\S]+?)\s*```", raw)
            if match:
                simplified = json.loads(match.group(1))
            else:
                simplified = {"raw_response": raw}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM simplify error: {str(e)}")

    # Step 3: Translate to target language if not English
    if target_language != "en-IN":
        try:
            diagnosis_translated = await sarvam.translate_text(
                simplified.get("diagnosis", ""),
                source_lang="en-IN",
                target_lang=target_language,
            )
            simplified["diagnosis_translated"] = diagnosis_translated
            simplified["target_language"] = target_language
        except Exception:
            simplified["diagnosis_translated"] = simplified.get("diagnosis", "")

    return JSONResponse(simplified)


# ─────────────────────────────────────────────────────────────────────────────
# Route 6: Text-to-Speech (Bulbul v3)
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/speak")
async def speak(
    text: str = Form(...),
    language_code: str = Form("hi-IN"),
):
    """
    Convert text to spoken audio using Sarvam Bulbul TTS.
    Returns audio/wav bytes.
    """
    try:
        audio_bytes = await sarvam.speak_text(text, language_code)
        if not audio_bytes:
            raise HTTPException(status_code=500, detail="TTS returned no audio")
        return Response(content=audio_bytes, media_type="audio/wav")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS error: {str(e)}")


# ─────────────────────────────────────────────────────────────────────────────
# Route 7: Auto-detect language of text
# ─────────────────────────────────────────────────────────────────────────────
@app.post("/api/detect-language")
async def detect_language(text: str = Form(...)):
    """
    Auto-detect the language of a text snippet using Sarvam LID.
    """
    try:
        lang = await sarvam.identify_language(text)
        return JSONResponse({"language_code": lang})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Language ID error: {str(e)}")


# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
