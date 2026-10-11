# Sunniye, Samjhiye + Discharge Decoder 🏥🇮🇳
### Indic Healthcare Copilot — Powered by Sarvam AI

> **"Sunniye, Samjhiye"** (Listen & Understand) transforms healthcare accessibility across India. By bridging linguistic and clinical divides, it empowers doctors with automated bilingual clinical intake and translates dense medical discharge summaries into clear, spoken instructions in patients' native tongues.

---

## 🌟 Key Features

### 1. 🩺 OPD Intake Copilot ("Sunniye, Samjhiye")
* **Indic Speech Recognition:** Real-time speech-to-text powered by Sarvam **Saaras v4** across 11+ Indic languages (Hindi, Tamil, Telugu, Bengali, Kannada, Marathi, Gujarati, Punjabi, Malayalam, Odia, and Indian English).
* **Smart Prescription Extraction:** Digitise handwritten/printed doctor prescriptions and medical notes using **Sarvam Vision / Doc-AI**.
* **Dual-Column Clinical Note:** Synthesised with **Sarvam-105B**, separating **Patient-Reported Facts** from **AI Clinical Hypotheses** to ensure clinical safety and reduce physician charting fatigue.
* **Live Audio Visualizer:** High-fidelity real-time canvas waveform and in-browser PCM WAV downsampling.

### 2. 📋 Discharge Decoder
* **Document Digitisation:** Ingest complex discharge summaries, hospital records, and doctor orders.
* **Plain Language Translation:** Automatic medical terminology simplification and translation into patient native dialects using **Mayura v1**.
* **7-Day Patient Action Plan:** Clear visual breakdown of medicines, wound care, emergency warning signs, and follow-up schedules.
* **Native Voice Playback:** High-quality Indic speech synthesis with **Sarvam Bulbul v3**, reading care instructions aloud for patients and caregivers.

---

## 🏗️ Architecture & Sarvam AI Stack

| Capability | Sarvam Model / Endpoint | Role in Pipeline |
| :--- | :--- | :--- |
| **Speech-to-Text** | `saaras:v4` (`/speech-to-text`) | Transcribes patient and clinician speech in Indic languages |
| **Document Vision** | `/doc-ai/v1/job/extract` & `/digitise` | Extracts key medical entities & digitises records |
| **Clinical Reasoning** | `sarvam-105b` (`/v1/chat/completions`) | Dual-column note generation & discharge simplification |
| **Machine Translation** | `mayura:v1` (`/translate`) | Accurate translation into 11+ Indic languages |
| **Text-to-Speech** | `bulbul:v3` (`/text-to-speech`) | Spoken recovery instructions in regional accents |
| **Language Detection** | `text-lid` (`/text-lid`) | Auto-identifies input spoken dialect |

---

## 🚀 Quickstart Guide

### 1. Clone & Setup
```bash
git clone <repository-url>
cd "Sarvam Voice Agent"
```

### 2. Environment Configuration
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
Provide your Sarvam API subscription key in `.env`:
```env
SARVAM_API_KEY=your_sarvam_api_key_here
PORT=8000
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Run Application
```bash
python main.py
```
Open your browser at **`http://localhost:8000`**. Interactive API docs are available at **`http://localhost:8000/docs`**.

---

## 📁 Repository Structure
```
├── main.py              # FastAPI server (7 REST endpoints)
├── sarvam_client.py     # Asynchronous client wrapper for Sarvam AI APIs
├── requirements.txt     # Python dependencies (fastapi, uvicorn, httpx, python-dotenv, etc.)
├── static/
│   ├── index.html       # Single-page responsive web app
│   ├── style.css        # Glassmorphic dark-mode design system
│   └── app.js           # Audio recorder, Web Audio PCM converter & UI controller
├── .env.example         # Example environment template
└── .gitignore           # Secret and build artifact prevention
```

---

## 🔒 Security & Privacy Note
All medical data and credentials are kept strictly local or passed securely via ephemeral HTTPS calls to the official Sarvam AI API endpoints. No private patient audio or documents are permanently stored on-disk.
