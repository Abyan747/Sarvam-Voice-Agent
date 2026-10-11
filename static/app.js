/* ===================================================================
   app.js — Sunniye Samjhiye Frontend Logic
   Handles: mic recording, waveform, file upload, API calls, UI rendering
   =================================================================== */

'use strict';

// ─── State ────────────────────────────────────────────────────────
let mediaRecorder = null;
let audioChunks   = [];
let recordingTimer = null;
let recordingSeconds = 0;
let audioContext  = null;
let analyser      = null;
let waveAnimFrame = null;
let currentTranscript = '';
let currentRxData     = {};
let lastDischargeData = null;
let lastDischargeLanguage = 'hi-IN';

const LANG_NAMES = {
  'hi-IN': 'Hindi', 'ta-IN': 'Tamil', 'te-IN': 'Telugu',
  'bn-IN': 'Bengali', 'mr-IN': 'Marathi', 'gu-IN': 'Gujarati',
  'kn-IN': 'Kannada', 'ml-IN': 'Malayalam', 'pa-IN': 'Punjabi',
  'od-IN': 'Odia', 'en-IN': 'English',
};

// ─── Tab Switching ─────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('tab-' + name).setAttribute('aria-selected', 'true');
  document.getElementById('tab-' + name + '-content').classList.add('active');
}

// ─── Utility ───────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('errorToast');
  t.textContent = '⚠️ ' + msg;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 5000);
}

function setStep(steps) {
  const ids = ['step-record','step-scan','step-generate','step-result'];
  ids.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.remove('active','done');
    if (steps.active === id) el.classList.add('active');
    if (steps.done && steps.done.includes(id)) el.classList.add('done');
  });
}

function formatTime(secs) {
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

// ─── Audio Recording ───────────────────────────────────────────────
async function toggleRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    stopRecording();
  } else {
    await startRecording();
  }
}

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
    audioChunks = [];
    recordingSeconds = 0;

    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = handleRecordingStop;
    mediaRecorder.start(200);

    // UI
    const btn = document.getElementById('recordBtn');
    btn.classList.add('recording');
    btn.textContent = '⏹️';
    document.getElementById('recordStatus').textContent = 'Recording… click to stop';
    document.getElementById('recordTimer').textContent = '00:00';
    setStep({ active: 'step-record', done: [] });

    // Timer
    recordingTimer = setInterval(() => {
      recordingSeconds++;
      document.getElementById('recordTimer').textContent = formatTime(recordingSeconds);
    }, 1000);

    // Waveform
    startWaveform(stream);
  } catch (err) {
    showToast('Microphone access denied. Please allow mic permissions.');
  }
}

function stopRecording() {
  if (mediaRecorder) {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach(t => t.stop());
  }
  clearInterval(recordingTimer);
  stopWaveform();

  const btn = document.getElementById('recordBtn');
  btn.classList.remove('recording');
  btn.textContent = '🎙️';
  document.getElementById('recordStatus').textContent = 'Processing…';
}

// ─── WebM → WAV Converter (Web Audio API) ─────────────────────────
// Sarvam STT requires PCM WAV — browser MediaRecorder gives WebM/Opus
async function webmToWav(webmBlob) {
  const arrayBuffer = await webmBlob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  ctx.close();

  // Downmix to mono at 16kHz
  const numChannels = 1;
  const sampleRate  = decoded.sampleRate;
  const samples     = decoded.getChannelData(0); // mono
  const numSamples  = samples.length;

  // Build WAV header + PCM data
  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view   = new DataView(buffer);

  function writeStr(off, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i));
  }
  writeStr(0, 'RIFF');
  view.setUint32(4,  36 + numSamples * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);          // PCM chunk size
  view.setUint16(20,  1, true);          // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);           // block align
  view.setUint16(34, 16, true);          // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, numSamples * 2, true);

  // Write PCM samples (clamp float32 → int16)
  let off = 44;
  for (let i = 0; i < numSamples; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    off += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

async function handleRecordingStop() {
  const webmBlob = new Blob(audioChunks, { type: 'audio/webm' });
  const lang     = document.getElementById('opd-lang').value;

  document.getElementById('recordStatus').textContent = 'Converting audio…';
  setStep({ active: 'step-scan', done: ['step-record'] });

  try {
    // Convert WebM → WAV before sending to Sarvam
    const wavBlob = await webmToWav(webmBlob);

    document.getElementById('recordStatus').textContent = 'Transcribing with Saaras v4…';

    const formData = new FormData();
    formData.append('audio', wavBlob, 'recording.wav');
    formData.append('language_code', lang);

    const res  = await fetch('/api/transcribe', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || 'STT failed');

    currentTranscript = data.transcript || '';
    const chip = document.getElementById('transcriptDisplay');
    chip.textContent = currentTranscript || '(No speech detected)';
    chip.classList.add('visible');
    document.getElementById('recordStatus').textContent = '✅ Transcript ready';
  } catch (err) {
    document.getElementById('recordStatus').textContent = 'Transcription failed';
    showToast(err.message);
  }
}

// ─── Live Waveform ─────────────────────────────────────────────────
function startWaveform(stream) {
  audioContext = new (window.AudioContext || window.webkitAudioContext)();
  analyser     = audioContext.createAnalyser();
  analyser.fftSize = 256;
  audioContext.createMediaStreamSource(stream).connect(analyser);
  drawWaveform();
}

function drawWaveform() {
  const canvas = document.getElementById('waveformCanvas');
  if (!canvas) return;
  const ctx    = canvas.getContext('2d');
  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  canvas.width = W; canvas.height = H;

  const bufferLen = analyser.frequencyBinCount;
  const dataArr   = new Uint8Array(bufferLen);

  function render() {
    waveAnimFrame = requestAnimationFrame(render);
    analyser.getByteFrequencyData(dataArr);
    ctx.fillStyle = 'rgba(7,11,20,0.6)';
    ctx.fillRect(0, 0, W, H);

    const barW = (W / bufferLen) * 2;
    let x = 0;
    for (let i = 0; i < bufferLen; i++) {
      const barH = (dataArr[i] / 255) * H;
      const hue  = 200 + (i / bufferLen) * 40;
      ctx.fillStyle = `hsla(${hue}, 90%, 65%, 0.85)`;
      ctx.fillRect(x, H - barH, barW - 1, barH);
      x += barW;
    }
  }
  render();
}

function stopWaveform() {
  if (waveAnimFrame) cancelAnimationFrame(waveAnimFrame);
  if (audioContext) { audioContext.close(); audioContext = null; }
  const canvas = document.getElementById('waveformCanvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
}

// ─── File Upload / Preview ─────────────────────────────────────────
function previewFile(inputId, previewId, panelId) {
  const file    = document.getElementById(inputId).files[0];
  const preview = document.getElementById(previewId);
  const panel   = document.getElementById(panelId);
  if (!file) return;

  const reader = new FileReader();
  reader.onload = e => {
    preview.src = e.target.result;
    preview.classList.add('visible');
    panel.querySelector('p').textContent = file.name;
  };
  reader.readAsDataURL(file);
}

function dragOver(e, panelId) {
  e.preventDefault();
  document.getElementById(panelId).classList.add('drag-over');
}
function dragLeave(panelId) {
  document.getElementById(panelId).classList.remove('drag-over');
}
function dropFile(e, inputId, previewId) {
  e.preventDefault();
  const panelId = e.currentTarget.id;
  dragLeave(panelId);
  const file = e.dataTransfer.files[0];
  if (file) {
    const dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById(inputId).files = dt.files;
    previewFile(inputId, previewId, panelId);
  }
}

// ─── Generate OPD Clinical Note ────────────────────────────────────
async function generateClinicalNote() {
  const lang    = document.getElementById('opd-lang').value;
  const rxInput = document.getElementById('rxFileInput');
  const btn     = document.getElementById('generateNoteBtn');
  const loading = document.getElementById('noteLoading');
  const loadingText = document.getElementById('noteLoadingText');

  btn.disabled = true;
  loading.classList.add('visible');
  document.getElementById('noteOutput').classList.remove('visible');
  setStep({ active: 'step-generate', done: ['step-record','step-scan'] });

  try {
    // Step 1: Extract prescription if provided
    let rxData = '{}';
    if (rxInput.files.length > 0) {
      loadingText.textContent = '📄 Scanning prescription with Sarvam Vision…';
      const rxForm = new FormData();
      rxForm.append('image', rxInput.files[0]);
      const rxRes  = await fetch('/api/extract-doc', { method: 'POST', body: rxForm });
      if (rxRes.ok) {
        const rxJson = await rxRes.json();
        rxData = JSON.stringify(rxJson);
        currentRxData = rxJson;
      }
    }

    // Step 2: Generate clinical note with LLM
    loadingText.textContent = '🧠 Generating clinical note with Sarvam-105B…';
    const noteForm = new FormData();
    noteForm.append('transcript', currentTranscript);
    noteForm.append('prescription_data', rxData);
    noteForm.append('language_code', lang);

    const noteRes  = await fetch('/api/generate-note', { method: 'POST', body: noteForm });
    const noteData = await noteRes.json();

    if (!noteRes.ok) throw new Error(noteData.detail || 'Note generation failed');

    renderClinicalNote(noteData, rxData !== '{}' ? currentRxData : null);
    setStep({ active: 'step-result', done: ['step-record','step-scan','step-generate'] });
  } catch (err) {
    showToast('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    loading.classList.remove('visible');
  }
}

function renderClinicalNote(data, rxData) {
  const output = document.getElementById('noteOutput');
  output.classList.add('visible');

  // Facts
  const factsEl = document.getElementById('factsContainer');
  factsEl.innerHTML = '';
  const facts = data.patient_narrative || [];
  if (facts.length === 0) {
    factsEl.innerHTML = `<div class="fact-item"><div class="quote" style="color:var(--text-muted);">No narrative captured — record audio above.</div></div>`;
  }
  facts.forEach(f => {
    factsEl.innerHTML += `
      <div class="fact-item">
        <div class="quote">"${escHtml(f.quote || '')}"</div>
        <div class="meta">⏱ ${f.timestamp || '—'} &nbsp;·&nbsp; 🌐 ${f.language || '—'}</div>
      </div>`;
  });

  // Hypotheses
  const hypEl = document.getElementById('hypothesesContainer');
  hypEl.innerHTML = '';
  const hyps = data.clinical_hypotheses || [];
  if (hyps.length === 0) {
    hypEl.innerHTML = `<div class="hypothesis-item"><div class="interp" style="color:var(--text-muted);">No hypotheses generated.</div></div>`;
  }
  hyps.forEach(h => {
    const prio = (h.priority || 'medium').toLowerCase();
    hypEl.innerHTML += `
      <div class="hypothesis-item">
        <div class="finding">${escHtml(h.finding || '')}</div>
        <div class="interp">${escHtml(h.interpretation || '')}</div>
        <span class="priority-badge priority-${prio}">${prio}</span>
      </div>`;
  });

  // Summary
  document.getElementById('summaryText').textContent = data.summary || '—';
  document.getElementById('recommendedAction').textContent = data.recommended_action || '—';

  // Prescription data
  const rxSection = document.getElementById('rxDataSection');
  const rxList    = document.getElementById('rxDataList');
  const prescriptions = data.prescription_extracted || [];
  if (prescriptions.length > 0 || rxData) {
    rxSection.style.display = 'block';
    rxList.innerHTML = prescriptions.map(p =>
      `<div style="display:flex;gap:8px;padding:4px 0;font-size:12px;border-bottom:1px solid var(--border);">
        <span style="color:var(--purple);font-weight:600;min-width:120px;">${escHtml(p.field || '')}</span>
        <span style="color:var(--text-secondary);">${escHtml(p.value || '')}</span>
      </div>`
    ).join('');
  } else {
    rxSection.style.display = 'none';
  }

  output.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Discharge Decoder ─────────────────────────────────────────────
async function decodeDischarge() {
  const fileInput = document.getElementById('dischargeFileInput');
  const lang      = document.getElementById('discharge-lang').value;
  const btn       = document.getElementById('decodeBtn');
  const loading   = document.getElementById('dischargeLoading');
  const loadingText = document.getElementById('dischargeLoadingText');

  if (!fileInput.files.length) {
    showToast('Please upload a discharge summary image first.');
    return;
  }

  btn.disabled = true;
  loading.classList.add('visible');
  document.getElementById('dischargeOutput').classList.remove('visible');
  lastDischargeLanguage = lang;

  try {
    loadingText.textContent = '👁️ Digitising document with Sarvam Vision…';
    const form = new FormData();
    form.append('image', fileInput.files[0]);
    form.append('target_language', lang);

    const res  = await fetch('/api/decode-discharge', { method: 'POST', body: form });
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || 'Discharge decoding failed');

    lastDischargeData = data;
    renderDischarge(data, lang);
  } catch (err) {
    showToast('Error: ' + err.message);
  } finally {
    btn.disabled = false;
    loading.classList.remove('visible');
  }
}

function renderDischarge(data, lang) {
  const output = document.getElementById('dischargeOutput');
  output.classList.add('visible');

  // Diagnosis
  document.getElementById('diagnosisText').textContent =
    data.diagnosis || 'No diagnosis information found.';

  const transEl = document.getElementById('diagnosisTranslated');
  if (data.diagnosis_translated && lang !== 'en-IN') {
    transEl.style.display = 'block';
    transEl.innerHTML = `<span class="lang-badge">🌐 ${LANG_NAMES[lang] || lang}</span> &nbsp;${escHtml(data.diagnosis_translated)}`;
  } else {
    transEl.style.display = 'none';
  }

  // Recovery plan
  const recoveryEl = document.getElementById('recoveryList');
  const plan = data.recovery_plan || [];
  recoveryEl.innerHTML = plan.length
    ? plan.map(item => `
        <div class="checklist-item">
          <span class="check">✅</span>
          <span>${escHtml(item)}</span>
        </div>`).join('')
    : '<p style="color:var(--text-muted); font-size:13px;">No recovery plan specified.</p>';

  // Medications
  const meds    = data.medications || [];
  const tbody   = document.getElementById('medTableBody');
  tbody.innerHTML = meds.length
    ? meds.map(m => `
        <tr>
          <td style="color:var(--purple);font-weight:500;">${escHtml(m.medicine || '—')}</td>
          <td>${escHtml(m.dose || '—')}</td>
          <td>${escHtml(m.timing || '—')}</td>
          <td>${escHtml(m.duration || '—')}</td>
        </tr>`).join('')
    : '<tr><td colspan="4" style="color:var(--text-muted);">No medications listed.</td></tr>';

  // Red flags
  const flags   = data.red_flags || [];
  const flagsEl = document.getElementById('redFlagList');
  flagsEl.innerHTML = flags.length
    ? flags.map(f => `
        <div class="redflag-item">
          <span class="flag">🚨</span>
          <span>${escHtml(f)}</span>
        </div>`).join('')
    : '<p style="color:var(--text-muted); font-size:13px;">No red flags specified.</p>';

  // Update speak button label
  document.getElementById('speakLangLabel').textContent = LANG_NAMES[lang] || lang;

  output.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── TTS — Speak Discharge ─────────────────────────────────────────
async function speakDischarge() {
  if (!lastDischargeData) {
    showToast('Please decode a discharge summary first.');
    return;
  }

  const lang = lastDischargeLanguage;
  const btn  = document.getElementById('speakDiagnosisBtn');
  btn.disabled = true;
  btn.innerHTML = '<div class="spinner"></div> Generating…';

  // Speak the translated diagnosis if available, else English
  const textToSpeak = (lang !== 'en-IN' && lastDischargeData.diagnosis_translated)
    ? lastDischargeData.diagnosis_translated
    : lastDischargeData.diagnosis || 'No information available.';

  try {
    const form = new FormData();
    form.append('text', textToSpeak.slice(0, 480));
    form.append('language_code', lang);

    const res = await fetch('/api/speak', { method: 'POST', body: form });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'TTS failed');
    }

    const audioBlob = await res.blob();
    const audioUrl  = URL.createObjectURL(audioBlob);
    const audioEl   = document.getElementById('dischargeAudio');
    audioEl.src     = audioUrl;
    audioEl.style.display = 'block';
    audioEl.play();
  } catch (err) {
    showToast('TTS error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = `🔊 Play in <span id="speakLangLabel">${LANG_NAMES[lang] || lang}</span>`;
  }
}

// ─── Reset Helpers ─────────────────────────────────────────────────
function resetOPD() {
  currentTranscript = '';
  currentRxData     = {};
  document.getElementById('transcriptDisplay').textContent = '';
  document.getElementById('transcriptDisplay').classList.remove('visible');
  document.getElementById('rxPreview').classList.remove('visible');
  document.getElementById('rxPreview').src = '';
  document.getElementById('rxFileInput').value = '';
  document.getElementById('rxUploadPanel').querySelector('p').textContent = 'Upload Prescription Photo';
  document.getElementById('noteOutput').classList.remove('visible');
  document.getElementById('recordStatus').textContent = 'Click to start recording';
  document.getElementById('recordTimer').textContent = '00:00';
  setStep({ active: 'step-record', done: [] });
}

function resetDischarge() {
  lastDischargeData = null;
  document.getElementById('dischargePreview').classList.remove('visible');
  document.getElementById('dischargePreview').src = '';
  document.getElementById('dischargeFileInput').value = '';
  document.getElementById('dischargeUploadPanel').querySelector('p').textContent = 'Upload Discharge Summary';
  document.getElementById('dischargeOutput').classList.remove('visible');
  const audioEl = document.getElementById('dischargeAudio');
  audioEl.pause(); audioEl.src = ''; audioEl.style.display = 'none';
}

// ─── HTML Escape ───────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
