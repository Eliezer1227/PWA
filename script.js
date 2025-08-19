/* Phone Inspection PWA — script.js (Aug 2025)
   Cambios:
   - GPS: permissions + mensajes y reintentos
   - Speaker: unlock/ resume WebAudio + fallback <audio>
   - Microphone: mejor manejo; fallback monitor con VU meter si no hay MediaRecorder
   - Touchscreen: fullscreen grid con timeout 45s y confirmación
   - Display: fullscreen, cambio de color por toque, confirmación al final
*/

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- Manifest inline ---------- */
(function attachManifest(){
  try{
    const json = $("#app-manifest")?.textContent?.trim();
    if(json){
      const blob = new Blob([json], { type: "application/manifest+json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("link");
      link.rel = "manifest";
      link.href = url;
      document.head.appendChild(link);
    }
  }catch(e){}
})();

/* ---------- (Opcional) SW ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(console.warn);
}
------------------------------------- */

$("#year").textContent = new Date().getFullYear();

/* ---------- Estado ---------- */
const TEST_KEYS = [
  "cosmetic","gps","speaker","microphone","frontCamera","backCamera",
  "touchscreen","multitouch","display","accelerometer","gyroscope","battery"
];

const state = {
  imei: null,
  startedAt: null,
  results: {
    cosmetic: { status: "pending", front:null, back:null, msg:"" },
    gps: { status: "pending", coords:null, accuracy:null, msg:"" },
    speaker: { status: "pending", heard:null, msg:"" },
    microphone: { status: "pending", blobUrl:null, msg:"" },
    frontCamera: { status: "pending", photo:null, msg:"" },
    backCamera: { status: "pending", photo:null, msg:"" },
    touchscreen: { status: "pending", taps:0, msg:"" },
    multitouch: { status: "pending", maxTouches:0, msg:"" },
    display: { status: "pending", pixels:null, ratio:null, depth:null, looksOk:null, msg:"" },
    accelerometer: { status: "pending", samples:0, last:null, msg:"" },
    gyroscope: { status: "pending", samples:0, last:null, msg:"" },
    battery: { status: "pending", level:null, charging:null, times:null, msg:"" }
  }
};

const STORAGE_KEY = "inspection_v1";

/* ---------- Helpers de estado ---------- */
function isValidIMEI(v){ return /^\d{15}$/.test(v); }
function persist(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    imei: state.imei, startedAt: state.startedAt, results: state.results
  }));
}
function hydrate(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const saved = JSON.parse(raw);
    if(saved?.imei && isValidIMEI(saved.imei)){
      state.imei = saved.imei;
      state.startedAt = saved.startedAt || new Date().toISOString();
      Object.assign(state.results, saved.results || {});
      showDashboard(); renderStatus();
    }
  }catch(e){ console.warn(e); }
}

/* ---------- Registro IMEI ---------- */
const imeiInput = $("#imeiInput");
const imeiError = $("#imeiError");
const imeiDisplay = $("#imeiDisplay");

$("#registerBtn").addEventListener("click", () => {
  const v = imeiInput.value.trim();
  if(!isValidIMEI(v)){
    imeiError.textContent = "Please enter a 15-digit numeric IMEI.";
    return;
  }
  imeiError.textContent = "";
  state.imei = v;
  state.startedAt = new Date().toISOString();
  persist();
  showDashboard();
  renderStatus();
});

function showDashboard(){
  $("#registerView").classList.remove("active");
  $("#dashboardView").classList.add("active");
  imeiDisplay.textContent = state.imei || "—";
}
hydrate();

/* ---------- Paneles / Overlay ---------- */
const overlay = $("#panelOverlay");
function openPanel(id){
  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden","false");
  $$(".panel", overlay).forEach(p => p.style.display = "none");
  const panel = $("#"+id, overlay);
  if(panel) panel.style.display = "block";
}
function closePanel(){
  overlay.classList.remove("show");
  overlay.setAttribute("aria-hidden","true");
  stopAllMedia();
  exitFullscreenSafe();
}
overlay.addEventListener("click", (e) => { if(e.target === overlay) closePanel(); });
$$("[data-close]", overlay).forEach(btn => btn.addEventListener("click", closePanel));
$$("[data-open]").forEach(btn => btn.addEventListener("click", () => openPanel(btn.dataset.open)));

/* ---------- Progreso ---------- */
function countPasses(){ return TEST_KEYS.filter(k => state.results[k].status === "pass").length; }
function renderStatus(){
  $("#progressBadge").textContent = `${countPasses()} / ${TEST_KEYS.length} done`;
  const host = $("#statusList");
  host.innerHTML = "";
  TEST_KEYS.forEach(k => {
    const r = state.results[k];
    const div = document.createElement("div");
    div.className = "status-item";
    const cls = r.status === "pass" ? "pass" : r.status === "fail" ? "fail" : "pending";
    div.innerHTML = `
      <div class="label">${k}</div>
      <div class="value ${cls}">${r.status.toUpperCase()}</div>
      <div class="muted small">${r.msg || ""}</div>
    `;
    host.appendChild(div);
  });
}

/* ---------- Util pantalla completa ---------- */
async function enterFullscreen(el){
  try{
    if(el.requestFullscreen) await el.requestFullscreen();
    else if(el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if(el.msRequestFullscreen) el.msRequestFullscreen();
  }catch(e){}
}
async function exitFullscreenSafe(){
  try{
    if(document.fullscreenElement || document.webkitFullscreenElement){
      if(document.exitFullscreen) await document.exitFullscreen();
      else if(document.webkitExitFullscreen) document.webkitExitFullscreen();
    }
  }catch(e){}
}

/* ---------- Util cámara/media ---------- */
async function startCamera(videoEl, facingMode){
  if(!navigator.mediaDevices?.getUserMedia){
    throw new Error("getUserMedia is not supported.");
  }
  const constraints = { video: { facingMode: facingMode || "user" }, audio: false };
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  videoEl.srcObject = stream;
  await videoEl.play().catch(()=>{});
  return stream;
}
function stopStream(videoEl){
  const stream = videoEl?.srcObject;
  if(stream){ stream.getTracks().forEach(t => t.stop()); videoEl.srcObject = null; }
}
function captureToDataURL(videoEl, canvasEl){
  const w = videoEl.videoWidth || 1280;
  const h = videoEl.videoHeight || 720;
  canvasEl.width = w; canvasEl.height = h;
  const ctx = canvasEl.getContext("2d");
  ctx.drawImage(videoEl, 0, 0, w, h);
  return canvasEl.toDataURL("image/jpeg", 0.92);
}
function stopAllMedia(){
  stopStream($("#cosmeticVideo"));
  stopStream($("#fVideo"));
  stopStream($("#bVideo"));
}

/* ---------- Confirmación Pass/Fail ---------- */
async function confirmPassFail(testKey, messageIfPass = "User confirmed OK", messageIfFail = "User reported an issue"){
  const ok = window.confirm("Mark this test as PASS?\n\nTap 'OK' for PASS, 'Cancel' for FAIL.");
  if(ok){
    state.results[testKey].status = "pass";
    state.results[testKey].msg = messageIfPass;
  }else{
    state.results[testKey].status = "fail";
    state.results[testKey].msg = messageIfFail;
  }
  persist(); renderStatus();
  return ok;
}

/* =========================================================
   COSMETIC
========================================================= */
const cos = {
  video: $("#cosmeticVideo"),
  canvas: $("#cosmeticCanvas"),
  btnFront: $("#cosStartFrontBtn"),
  btnBack: $("#cosStartBackBtn"),
  btnStop: $("#cosStopBtn"),
  btnCapture: $("#cosCaptureBtn"),
  imgFront: $("#cosFrontImg"),
  imgBack: $("#cosBackImg"),
  msg: $("#cosmeticMsg"),
  currentFacing: null
};
cos.btnFront.addEventListener("click", async ()=>{
  try{
    cos.msg.textContent = "Opening front camera...";
    stopStream(cos.video);
    await startCamera(cos.video, "user");
    cos.currentFacing = "user";
    cos.btnCapture.disabled = false;
    cos.btnStop.disabled = false;
    cos.msg.textContent = "Front camera ready. Tap Capture.";
  }catch(e){ cos.msg.textContent = e.message; }
});
cos.btnBack.addEventListener("click", async ()=>{
  try{
    cos.msg.textContent = "Opening back camera...";
    stopStream(cos.video);
    await startCamera(cos.video, "environment");
    cos.currentFacing = "environment";
    cos.btnCapture.disabled = false;
    cos.btnStop.disabled = false;
    cos.msg.textContent = "Back camera ready. Tap Capture.";
  }catch(e){ cos.msg.textContent = e.message; }
});
cos.btnCapture.addEventListener("click", async ()=>{
  try{
    const url = captureToDataURL(cos.video, cos.canvas);
    if(cos.currentFacing === "user"){
      cos.imgFront.src = url;
      state.results.cosmetic.front = url;
    }else{
      cos.imgBack.src = url;
      state.results.cosmetic.back = url;
    }
    const both = !!(state.results.cosmetic.front && state.results.cosmetic.back);
    state.results.cosmetic.status = both ? "pass" : "pending";
    state.results.cosmetic.msg = both ? "Both photos captured" : "One side captured";
    persist(); renderStatus();
    if(both){
      cos.msg.textContent = "Both photos captured.";
      await confirmPassFail("cosmetic", "Photos look acceptable", "Cosmetic issue reported");
    }else{
      cos.msg.textContent = "Captured. Take the other side to complete.";
    }
  }catch(e){ cos.msg.textContent = e.message; }
});
cos.btnStop.addEventListener("click", ()=>{
  stopStream(cos.video);
  cos.btnCapture.disabled = true;
  cos.btnStop.disabled = true;
  cos.msg.textContent = "Camera stopped.";
});

/* =========================================================
   GPS (permissions + mensajes)
========================================================= */
$("#gpsBtn").addEventListener("click", async ()=>{
  const out = $("#gpsOut");
  const warn = $("#gpsWarn");
  out.textContent = ""; warn.textContent = "";

  const tips = "Make sure:\n• You’re on HTTPS (or localhost)\n• Location Services are ON\n• Browser has Location permission ALLOWED for this site";

  try{
    if(!("geolocation" in navigator)){
      throw new Error("Geolocation is not supported by this browser.");
    }

    // Intentar saber estado de permisos si el navegador lo permite
    try{
      if(navigator.permissions?.query){
        const p = await navigator.permissions.query({ name: "geolocation" });
        if(p.state === "denied"){
          warn.textContent = "Location permission is denied. Open your browser settings and enable Location for this site.\n\n"+tips;
          state.results.gps.status = "fail";
          state.results.gps.msg = "Permission denied";
          renderStatus(); persist();
          return;
        }
      }
    }catch(e){ /* algunos navegadores no soportan */ }

    // Llamada que dispara prompt si está en "prompt"
    navigator.geolocation.getCurrentPosition((pos)=>{
      const { latitude, longitude, accuracy } = pos.coords;
      out.textContent = JSON.stringify({ latitude, longitude, accuracy, timestamp: pos.timestamp }, null, 2);
      state.results.gps.status = "pass";
      state.results.gps.coords = { latitude, longitude };
      state.results.gps.accuracy = accuracy;
      state.results.gps.msg = `Location OK (±${Math.round(accuracy)} m)`;
      renderStatus(); persist();
    }, (err)=>{
      warn.textContent = `Error: ${err.message}\n\n${tips}`;
      state.results.gps.status = "fail";
      state.results.gps.msg = err.message;
      renderStatus(); persist();
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });

  }catch(e){
    warn.textContent = e.message + "\n\n" + tips;
    state.results.gps.status = "fail";
    state.results.gps.msg = e.message;
    renderStatus(); persist();
  }
});

/* =========================================================
   SPEAKER (unlock/resume + fallback)
========================================================= */
let audioCtx = null;
let spkOsc = null, spkGain = null;

function ensureAudioContext(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if(audioCtx.state === "suspended"){
    // iOS/Android suelen requerir gesto del usuario
    return audioCtx.resume().catch(()=>{});
  }
  return Promise.resolve();
}
function playWebAudioBeep(){
  spkOsc = audioCtx.createOscillator();
  spkGain = audioCtx.createGain();
  spkOsc.type = "sine";
  spkOsc.frequency.value = 880; // más agudo para móviles
  spkOsc.connect(spkGain).connect(audioCtx.destination);
  spkGain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
  spkGain.gain.exponentialRampToValueAtTime(0.35, audioCtx.currentTime + 0.05);
  spkOsc.start();
  setTimeout(()=>{
    spkGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05);
    setTimeout(()=>{
      try{ spkOsc.stop(); spkOsc.disconnect(); spkGain.disconnect(); }catch(_){}
    },120);
  }, 1400);
}
function playFallbackAudio(){
  // Data URI simple (500ms) — por si el WebAudio fue bloqueado o el móvil está raro
  const snd = new Audio("data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQAA");
  // Nota: es un silencio corto, algunos navegadores bloquean; si no suena, al menos se intentó activar el canal
  snd.play().catch(()=>{});
}

$("#spkPlayBtn").addEventListener("click", async ()=>{
  try{
    await ensureAudioContext();
    playWebAudioBeep();
    $("#spkMsg").textContent = "Tone played. Ensure volume is up and silent mode is off.";
    // Intentar también fallback para 'desmutear' ruta de audio en algunos dispositivos
    playFallbackAudio();
  }catch(e){
    $("#spkMsg").textContent = "Audio error: " + e.message;
  }
});
$("#spkHeardBtn").addEventListener("click", ()=>{
  state.results.speaker.status = "pass";
  state.results.speaker.heard = true;
  state.results.speaker.msg = "User confirmed tone audible";
  renderStatus(); persist();
  $("#spkMsg").textContent = "PASS confirmed.";
});
$("#spkNotHeardBtn").addEventListener("click", ()=>{
  state.results.speaker.status = "fail";
  state.results.speaker.heard = false;
  state.results.speaker.msg = "User did not hear tone";
  renderStatus(); persist();
  $("#spkMsg").textContent = "Marked as FAIL.";
});
/* =========================================================
   SPEAKER – Frecuencias + AutoTest con micro
   (añade a tu bloque de SPEAKER existente)
========================================================= */

// --- UI dinámica dentro del panel Speaker ---
(function enhanceSpeakerUI(){
  const panel = $("#speakerPanel");
  const row = document.createElement("div");
  row.className = "row wrap gap";
  row.style.marginTop = "8px";

  // Frecuencias rápidas
  const freqBtns = [250, 440, 1000, 2000, 4000].map(f=>{
    const b = document.createElement("button");
    b.className = "btn outline";
    b.textContent = `${f} Hz`;
    b.addEventListener("click", ()=> playToneAtFreq(f));
    return b;
  });

  // Slider/num input
  const wrap = document.createElement("div");
  wrap.style.display = "flex"; wrap.style.gap = "6px"; wrap.style.alignItems = "center";
  const lab = document.createElement("label"); lab.textContent = "Custom Hz:";
  const inp = document.createElement("input");
  inp.type = "number"; inp.min = "50"; inp.max = "12000"; inp.step = "1"; inp.value = "1000";
  inp.style.width = "90px";
  const bPlay = document.createElement("button");
  bPlay.className = "btn outline"; bPlay.textContent = "Play";
  bPlay.addEventListener("click", ()=> playToneAtFreq(parseFloat(inp.value)||1000));

  wrap.appendChild(lab); wrap.appendChild(inp); wrap.appendChild(bPlay);

  // AutoTest (reproduce y mide con micro)
  const autoBtn = document.createElement("button");
  autoBtn.className = "btn success";
  autoBtn.textContent = "AutoTest: Play & Measure";
  autoBtn.addEventListener("click", async ()=>{
    const f0 = parseFloat(inp.value)||1000;
    $("#spkMsg").textContent = "AutoTest running… playing tone and measuring mic.";
    const ok = await autoTestSpeakerWithMic(f0);
    if (ok) {
      state.results.speaker.status = "pass";
      state.results.speaker.msg = `AutoTest OK at ${f0} Hz`;
    } else {
      // si falla AutoTest no marcamos fail forzoso; dejamos al usuario confirmar manual
      state.results.speaker.status = state.results.speaker.status === "pass" ? "pass" : "pending";
      state.results.speaker.msg = `AutoTest could not verify ${f0} Hz (low level or filtering?)`;
    }
    renderStatus(); persist();
  });

  // Montar
  freqBtns.forEach(b => row.appendChild(b));
  row.appendChild(wrap);
  row.appendChild(autoBtn);
  panel.appendChild(row);
})();

// --- Generador de tono a frecuencia elegida ---
async function playToneAtFreq(freq = 1000, duration = 1.5){
  try{
    await ensureAudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "sine";
    osc.frequency.value = Math.max(50, Math.min(12000, freq));
    gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    osc.connect(gain).connect(audioCtx.destination);

    // Fade in corto, mantener, fade out corto
    const t0 = audioCtx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.35, t0 + 0.05);
    osc.start(t0);
    gain.gain.setValueAtTime(0.35, t0 + Math.max(0.05, duration - 0.1));
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.06, duration));
    osc.stop(t0 + Math.max(0.08, duration + 0.02));

    $("#spkMsg").textContent = `Playing ${osc.frequency.value|0} Hz…`;
  }catch(e){
    $("#spkMsg").textContent = "Audio error: " + e.message;
  }
}

// --- AutoTest: reproduce y mide con el mic ---
async function autoTestSpeakerWithMic(targetHz){
  // 1) pedir micro
  let stream;
  try{
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1
      },
      video: false
    });
  }catch(e){
    $("#spkMsg").textContent = "Mic permission/availability error. Try manual confirmation.";
    return false;
  }

  // 2) preparar WebAudio para analizar mic
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  await ensureAudioContext();

  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 4096; // mejor resolución
  source.connect(analyser);

  // 3) reproducir el tono objetivo
  await playToneAtFreq(targetHz, 1.8);

  // 4) esperar ~150 ms para que “arranque” el sonido
  await sleep(150);

  // 5) tomar varias ventanas y estimar frecuencia por autocorrelación
  const sr = audioCtx.sampleRate;
  const buf = new Float32Array(analyser.fftSize);
  const estimates = [];

  const endAt = performance.now() + 900; // ~0.9 s de muestra
  while(performance.now() < endAt){
    analyser.getFloatTimeDomainData(buf);
    const { freq, rms } = estimatePitchAutocorr(buf, sr);
    if(rms > 0.01 && freq > 40 && freq < 12000){
      estimates.push(freq);
    }
    await sleep(60);
  }

  // 6) cerrar micro
  try{ stream.getTracks().forEach(t=>t.stop()); }catch(_){}

  if(estimates.length === 0){
    $("#spkMsg").textContent = "AutoTest: signal too weak or filtered.";
    return false;
  }

  // 7) mediana para robustez
  estimates.sort((a,b)=>a-b);
  const med = estimates[Math.floor(estimates.length/2)];

  const tol = Math.max(5, targetHz * 0.07); // ±7% o mínimo ±5 Hz
  const ok = Math.abs(med - targetHz) <= tol;

  $("#spkMsg").textContent = `AutoTest: measured ≈ ${med.toFixed(1)} Hz (target ${targetHz} Hz) → ${ok ? "OK" : "Not matching"}`;
  return ok;
}

// --- Utilidades de análisis ---
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

// Autocorrelación simple para pitch (monofónica, suficiente para tonos puros)
function estimatePitchAutocorr(timeData, sampleRate){
  // RMS para descartar silencio
  let rms = 0;
  for(let i=0;i<timeData.length;i++){ const v=timeData[i]; rms += v*v; }
  rms = Math.sqrt(rms/timeData.length);

  // Normalizar (quitar DC)
  const buf = timeData;
  let mean = 0; for(let i=0;i<buf.length;i++) mean += buf[i];
  mean /= buf.length;
  for(let i=0;i<buf.length;i++) buf[i] -= mean;

  // Autocorr
  const SIZE = buf.length;
  const MAX_LAG = Math.min( Math.floor(sampleRate/40), SIZE-1 );   // f > 40 Hz
  const MIN_LAG = Math.max( Math.floor(sampleRate/12000), 2 );     // f < 12 kHz

  let bestLag = -1;
  let bestCorr = 0;

  for(let lag=MIN_LAG; lag<=MAX_LAG; lag++){
    let corr = 0;
    for(let i=0; i<SIZE-lag; i++){
      corr += buf[i] * buf[i+lag];
    }
    if(corr > bestCorr){
      bestCorr = corr;
      bestLag = lag;
    }
  }

  let freq = -1;
  if(bestLag > 0){
    // afinar pico con interpolación parabólica simple
    const c0 = corrAtLag(buf, bestLag-1);
    const c1 = corrAtLag(buf, bestLag);
    const c2 = corrAtLag(buf, bestLag+1);
    const denom = (c0 - 2*c1 + c2);
    let shift = 0;
    if (denom !== 0){
      shift = 0.5 * (c0 - c2) / denom;
    }
    const refinedLag = bestLag + shift;
    freq = sampleRate / refinedLag;
  }
  return { freq, rms };

  function corrAtLag(b, lag){
    let c=0;
    for(let i=0;i<b.length-lag;i++){ c += b[i]*b[i+lag]; }
    return c;
  }
}

/* =========================================================
   MICROPHONE (MediaRecorder o monitor con VU meter)
========================================================= */
const mic = {
  startBtn: $("#micStartBtn"),
  stopBtn: $("#micStopBtn"),
  confirmBtn: $("#micConfirmBtn"),
  denyBtn: $("#micDenyBtn"),
  audio: $("#micAudio"),
  warn: $("#micWarn"),
  msg: $("#micMsg"),
  media: null,
  rec: null,
  chunks: [],
  analyser: null,
  raf: null,
  vuEl: null,
  monitoring: false
};

function attachVUMeter(parent){
  if(mic.vuEl) return;
  const bar = document.createElement("div");
  Object.assign(bar.style, {
    width: "100%", height: "12px",
    background: "linear-gradient(90deg,#1f8f3a,#ffc107,#dc3545)",
    transformOrigin: "left center",
    transform: "scaleX(0.01)",
    borderRadius: "6px", marginTop: "8px"
  });
  parent.appendChild(bar);
  mic.vuEl = bar;
}
function startMonitor(stream){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  const src = audioCtx.createMediaStreamSource(stream);
  mic.analyser = audioCtx.createAnalyser();
  mic.analyser.fftSize = 2048;
  src.connect(mic.analyser);
  attachVUMeter(mic.msg.parentElement || mic.msg);
  mic.monitoring = true;
  const data = new Uint8Array(mic.analyser.frequencyBinCount);
  const loop = ()=>{
    if(!mic.monitoring) return;
    mic.analyser.getByteTimeDomainData(data);
    // Calcular RMS simple
    let sum=0; for(let i=0;i<data.length;i++){ const v=(data[i]-128)/128; sum+=v*v; }
    const rms = Math.sqrt(sum/data.length); // 0..~1
    const level = Math.min(1, rms*4); // ganar un poco
    if(mic.vuEl){ mic.vuEl.style.transform = `scaleX(${Math.max(0.02, level)})`; }
    mic.raf = requestAnimationFrame(loop);
  };
  mic.raf = requestAnimationFrame(loop);
}

mic.startBtn.addEventListener("click", async ()=>{
  mic.warn.textContent = ""; mic.msg.textContent = "";
  try{
    const constraints = { audio: { echoCancellation:true, noiseSuppression:true, sampleRate: 44100 }, video:false };
    mic.media = await navigator.mediaDevices.getUserMedia(constraints);

    if(window.MediaRecorder){
      // Grabación normal
      mic.rec = new MediaRecorder(mic.media, { mimeType: "audio/webm" });
      mic.chunks = [];
      mic.rec.ondataavailable = e => { if(e.data.size>0) mic.chunks.push(e.data); };
      mic.rec.onstop = ()=>{
        const blob = new Blob(mic.chunks, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        mic.audio.src = url;
        mic.audio.classList.remove("hide");
        mic.confirmBtn.disabled = false;
        mic.denyBtn.disabled = false;
        state.results.microphone.blobUrl = url;
        mic.msg.textContent = "Playback ready. Can you hear your voice?";
        mic.media.getTracks().forEach(t=>t.stop());
        mic.media = null;
      };
      mic.rec.start();
      mic.startBtn.disabled = true;
      mic.stopBtn.disabled = false;
      mic.msg.textContent = "Recording… speak for ~3 seconds, then tap Stop.";
      setTimeout(()=> { if(mic.rec?.state==="recording") mic.rec.stop(); }, 3500);
    } else {
      // Fallback monitor (iOS Safari antiguo)
      mic.msg.textContent = "Live monitor mode (no recording on this browser). Speak and watch the level bar.";
      mic.audio.classList.add("hide");
      mic.confirmBtn.disabled = false;
      mic.denyBtn.disabled = false;
      startMonitor(mic.media);
      mic.startBtn.disabled = true;
      mic.stopBtn.disabled = false;
    }
  }catch(e){
    mic.warn.textContent = "Microphone error: " + (e.message || e.name || "Unknown");
    mic.msg.textContent = "Check the site permission for Microphone and try again.";
  }
});
mic.stopBtn.addEventListener("click", ()=>{
  try{
    if(mic.rec?.state==="recording") mic.rec.stop();
    if(mic.media){ mic.media.getTracks().forEach(t=>t.stop()); mic.media = null; }
    if(mic.monitoring){
      mic.monitoring = false;
      if(mic.raf) cancelAnimationFrame(mic.raf);
      mic.raf = null;
      mic.analyser && (mic.analyser.disconnect(), mic.analyser=null);
    }
    mic.stopBtn.disabled = true;
    mic.startBtn.disabled = false;
  }catch(e){}
});
mic.confirmBtn.addEventListener("click", ()=>{
  state.results.microphone.status = "pass";
  state.results.microphone.msg = window.MediaRecorder ? "User heard recorded playback" : "User confirmed live monitor works";
  persist(); renderStatus();
  mic.msg.textContent = "PASS confirmed.";
});
mic.denyBtn.addEventListener("click", ()=>{
  state.results.microphone.status = "fail";
  state.results.microphone.msg = window.MediaRecorder ? "User could not hear playback" : "User reported monitor not working";
  persist(); renderStatus();
  mic.msg.textContent = "Marked as FAIL.";
});

/* =========================================================
   FRONT / BACK CAMERA (confirma calidad)
========================================================= */
const f = { video: $("#fVideo"), canvas: $("#fCanvas"), img: $("#fImg"),
  startBtn: $("#fStartBtn"), captureBtn: $("#fCaptureBtn"), stopBtn: $("#fStopBtn"), msg: $("#fMsg")
};
f.startBtn.addEventListener("click", async ()=>{
  try{
    f.msg.textContent = "Opening front camera…";
    stopStream(f.video);
    await startCamera(f.video,"user");
    f.captureBtn.disabled = false; f.stopBtn.disabled = false;
    f.msg.textContent = "Front camera ready.";
  }catch(e){ f.msg.textContent = e.message; }
});
f.captureBtn.addEventListener("click", async ()=>{
  try{
    const url = captureToDataURL(f.video, f.canvas);
    f.img.src = url;
    state.results.frontCamera.photo = url;
    await confirmPassFail("frontCamera", "Front image looks clear", "Front image not acceptable");
    if(!state.results.cosmetic.front){ state.results.cosmetic.front = url; }
    if(state.results.cosmetic.front && state.results.cosmetic.back && state.results.cosmetic.status!=="fail"){
      state.results.cosmetic.status = "pass";
      state.results.cosmetic.msg = state.results.cosmetic.msg || "Both photos captured";
    }
    persist(); renderStatus();
    f.msg.textContent = "Captured.";
  }catch(e){ f.msg.textContent = e.message; }
});
f.stopBtn.addEventListener("click", ()=>{
  stopStream(f.video);
  f.captureBtn.disabled = true; f.stopBtn.disabled = true;
  f.msg.textContent = "Camera stopped.";
});

const b = { video: $("#bVideo"), canvas: $("#bCanvas"), img: $("#bImg"),
  startBtn: $("#bStartBtn"), captureBtn: $("#bCaptureBtn"), stopBtn: $("#bStopBtn"), msg: $("#bMsg")
};
b.startBtn.addEventListener("click", async ()=>{
  try{
    b.msg.textContent = "Opening back camera…";
    stopStream(b.video);
    await startCamera(b.video,"environment");
    b.captureBtn.disabled = false; b.stopBtn.disabled = false;
    b.msg.textContent = "Back camera ready.";
  }catch(e){ b.msg.textContent = e.message; }
});
b.captureBtn.addEventListener("click", async ()=>{
  try{
    const url = captureToDataURL(b.video, b.canvas);
    b.img.src = url;
    state.results.backCamera.photo = url;
    await confirmPassFail("backCamera", "Back image looks clear", "Back image not acceptable");
    if(!state.results.cosmetic.back){ state.results.cosmetic.back = url; }
    if(state.results.cosmetic.front && state.results.cosmetic.back && state.results.cosmetic.status!=="fail"){
      state.results.cosmetic.status = "pass";
      state.results.cosmetic.msg = state.results.cosmetic.msg || "Both photos captured";
    }
    persist(); renderStatus();
    b.msg.textContent = "Captured.";
  }catch(e){ b.msg.textContent = e.message; }
});
b.stopBtn.addEventListener("click", ()=>{
  stopStream(b.video);
  b.captureBtn.disabled = true; b.stopBtn.disabled = true;
  b.msg.textContent = "Camera stopped.";
});

/* =========================================================
   TOUCHSCREEN — Fullscreen Grid + 45s timeout
========================================================= */
const tCanvas = $("#touchCanvas");
const tCtx = tCanvas.getContext("2d");

let touchGrid = null, touchRows = 0, touchCols = 0, touchFilled = 0, touchTimer = null, touchDeadline = null;

function sizeCanvasFullscreen(canvas, container){
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w; canvas.height = h;
  container.style.width = "100%";
}

function buildTouchGrid(){
  // 6x10 aprox según aspecto (más celdas si pantalla grande)
  const w = tCanvas.width, h = tCanvas.height;
  touchCols = Math.max(6, Math.round(w / 80));
  touchRows = Math.max(8, Math.round(h / 90));
  touchGrid = new Array(touchRows * touchCols).fill(false);
  touchFilled = 0;

  // dibujar rejilla
  tCtx.clearRect(0,0,w,h);
  tCtx.lineWidth = 1;
  tCtx.strokeStyle = "rgba(255,255,255,.2)";
  for(let r=1;r<touchRows;r++){
    const y = (h/touchRows)*r;
    tCtx.beginPath(); tCtx.moveTo(0,y); tCtx.lineTo(w,y); tCtx.stroke();
  }
  for(let c=1;c<touchCols;c++){
    const x = (w/touchCols)*c;
    tCtx.beginPath(); tCtx.moveTo(x,0); tCtx.lineTo(x,h); tCtx.stroke();
  }
}

function markCellFromPoint(x,y){
  const w = tCanvas.width, h = tCanvas.height;
  const cW = w / touchCols, cH = h / touchRows;
  const c = Math.min(touchCols-1, Math.max(0, Math.floor(x / cW)));
  const r = Math.min(touchRows-1, Math.max(0, Math.floor(y / cH)));
  const idx = r * touchCols + c;
  if(!touchGrid[idx]){
    touchGrid[idx] = true;
    touchFilled++;
    // pintar la celda
    tCtx.fillStyle = "rgba(13,110,253,.35)";
    tCtx.fillRect(c*cW+1, r*cH+1, cW-2, cH-2);
    // ¿completo?
    if(touchFilled === touchGrid.length){
      clearTimeout(touchTimer);
      confirmPassFail("touchscreen", "All grid cells touched", "User reported issue").then(()=> {
        closePanel();
      });
    }
  }
}

function touchHandlerFactory(canvas){
  const rectOf = ()=> canvas.getBoundingClientRect();
  const onTouch = (clientX, clientY)=>{
    const rect = rectOf();
    markCellFromPoint(clientX - rect.left, clientY - rect.top);
  };
  canvas.addEventListener("touchstart", (e)=>{ e.preventDefault(); [...e.touches].forEach(t=>onTouch(t.clientX,t.clientY)); }, {passive:false});
  canvas.addEventListener("touchmove", (e)=>{ e.preventDefault(); [...e.touches].forEach(t=>onTouch(t.clientX,t.clientY)); }, {passive:false});
  canvas.addEventListener("mousedown", (e)=> onTouch(e.clientX,e.clientY));
  canvas.addEventListener("mousemove", (e)=> { if(e.buttons&1) onTouch(e.clientX,e.clientY); });
}

touchHandlerFactory(tCanvas);

// Cuando se abre el panel de touch, ir a fullscreen y armar rejilla + timer
$("#touchPanel").addEventListener("transitionstart", ()=>{}, { once:true });
const openTouchPanel = new MutationObserver((muts)=>{
  muts.forEach(m=>{
    if(m.attributeName === "style"){
      const panel = $("#touchPanel");
      if(panel.style.display === "block"){
        (async ()=>{
          await enterFullscreen(panel);
          sizeCanvasFullscreen(tCanvas, panel);
          buildTouchGrid();
          // 45s timeout
          if(touchTimer) clearTimeout(touchTimer);
          touchDeadline = Date.now() + 45000;
          touchTimer = setTimeout(()=>{
            // si no se completó, preguntar automáticamente
            confirmPassFail("touchscreen", "User confirmed grid OK", "Not all cells touched in time").then(()=>{
              closePanel();
            });
          }, 45000);
        })();
      }
    }
  });
});
openTouchPanel.observe($("#touchPanel"), { attributes:true });

window.addEventListener("resize", ()=>{
  if(document.fullscreenElement === $("#touchPanel")){
    sizeCanvasFullscreen(tCanvas, $("#touchPanel"));
    buildTouchGrid(); // reset grid si cambió tamaño
  }
});

/* =========================================================
   MULTITOUCH (igual que antes, automático)
========================================================= */
function drawDot(ctx, x, y, color){
  ctx.fillStyle = color || "#7eb3ff";
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI*2); ctx.fill();
}
function setTouchHandlers(canvas, isMulti){
  if(canvas === tCanvas) return; // ya manejado por el test fullscreen
  const msgEl = isMulti ? $("#multiMsg") : $("#touchMsg");
  const key = isMulti ? "multitouch" : "touchscreen";
  let maxTouches = 0;

  canvas.addEventListener("touchstart", (e)=>{
    e.preventDefault();
    const touches = Array.from(e.touches);
    maxTouches = Math.max(maxTouches, touches.length);
    const rect = canvas.getBoundingClientRect();
    touches.forEach(t => drawDot(canvas.getContext("2d"), t.clientX - rect.left, t.clientY - rect.top, isMulti ? "#7dffb6" : "#7eb3ff"));
    if(!isMulti){
      state.results.touchscreen.taps += touches.length;
      state.results.touchscreen.status = "pass";
      state.results.touchscreen.msg = `Detected ${state.results.touchscreen.taps} touch(es)`;
    }else{
      state.results.multitouch.maxTouches = maxTouches;
      if(maxTouches >= 2){
        state.results.multitouch.status = "pass";
        state.results.multitouch.msg = `Detected ${maxTouches} simultaneous touches`;
      }else{
        state.results.multitouch.status = "pending";
        state.results.multitouch.msg = "Need 2+ simultaneous touches";
      }
    }
    persist(); renderStatus();
    msgEl.textContent = state.results[key].msg;
  }, { passive:false });

  canvas.addEventListener("mousedown", (e)=>{
    const rect = canvas.getBoundingClientRect();
    drawDot(canvas.getContext("2d"), e.clientX - rect.left, e.clientY - rect.top);
    if(!isMulti){
      state.results.touchscreen.taps += 1;
      state.results.touchscreen.status = "pass";
      state.results.touchscreen.msg = `Detected ${state.results.touchscreen.taps} input(s)`;
    }else{
      state.results.multitouch.status = "pending";
      state.results.multitouch.msg = "Multitouch requires a touch device (2+ fingers).";
    }
    persist(); renderStatus();
    msgEl.textContent = state.results[key].msg;
  });
}
setTouchHandlers($("#multiCanvas"), true);

/* =========================================================
   DISPLAY — Fullscreen + Tap to cycle colors + confirm
========================================================= */
const dispArea = $("#displayTestArea");
const dispInfo = $("#displayInfo");
const dispMsg = $("#displayMsg");
const dispStartBtn = $("#dispStartBtn");
const dispStopBtn  = $("#dispStopBtn");
const dispOkBtn    = $("#dispOkBtn");
const dispBadBtn   = $("#dispBadBtn");

(function initDisplayInfo(){
  const info = {
    width: window.screen.width,
    height: window.screen.height,
    availWidth: window.screen.availWidth,
    availHeight: window.screen.availHeight,
    pixelRatio: window.devicePixelRatio || 1,
    colorDepth: window.screen.colorDepth
  };
  dispInfo.textContent = JSON.stringify(info, null, 2);
  state.results.display.pixels = `${info.width}x${info.height}`;
  state.results.display.ratio = info.pixelRatio;
  state.results.display.depth = info.colorDepth;
  state.results.display.status = "pending";
  state.results.display.msg = "Tap Start to run fullscreen color test";
  persist(); renderStatus();
})();

const colorSeq = ["#ff0000","#00ff00","#0000ff","#ffffff","#000000","#ffff00","#00ffff","#ff00ff","#808080"];
let colorIndex = 0;
let dispCycling = false;

function setDispColor(c){ dispArea.style.background = c; dispArea.textContent = ""; }

dispStartBtn.addEventListener("click", async ()=>{
  // fullscreen del panel Display
  const panel = $("#displayPanel");
  await enterFullscreen(panel);
  dispCycling = true;
  colorIndex = 0;
  setDispColor(colorSeq[colorIndex]);
  dispMsg.textContent = "Tap anywhere to cycle colors. Tap Stop when done.";
  dispStopBtn.disabled = false;
  // tap para cambiar
  panel.addEventListener("click", onDispTap);
}, { once:true });

function onDispTap(ev){
  if(!dispCycling) return;
  colorIndex++;
  if(colorIndex >= colorSeq.length){
    dispCycling = false;
    // pedir confirmación
    confirmPassFail("display", "User confirmed colors OK", "User reported color/brightness issue").then(()=>{
      dispMsg.textContent = "Display test finished.";
      exitFullscreenSafe();
    });
    return;
  }
  setDispColor(colorSeq[colorIndex]);
}

dispStopBtn.addEventListener("click", ()=>{
  dispCycling = false;
  dispMsg.textContent = "Stopped.";
  dispStopBtn.disabled = true;
  exitFullscreenSafe();
});

dispOkBtn.addEventListener("click", ()=>{
  state.results.display.status = "pass";
  state.results.display.looksOk = true;
  state.results.display.msg = "User confirmed colors OK";
  persist(); renderStatus();
  dispMsg.textContent = "PASS confirmed.";
});
dispBadBtn.addEventListener("click", ()=>{
  state.results.display.status = "fail";
  state.results.display.looksOk = false;
  state.results.display.msg = "User reported color/brightness issue";
  persist(); renderStatus();
  dispMsg.textContent = "Marked as FAIL.";
});

/* =========================================================
   ACCELEROMETER / GYROSCOPE (permiso iOS, automático)
========================================================= */
let accelHandler = null;
$("#accelPermBtn").addEventListener("click", async ()=>{
  const out = $("#accelOut"), warn = $("#accelWarn");
  warn.textContent = ""; out.textContent = "";
  try{
    if(typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function"){
      const perm = await DeviceMotionEvent.requestPermission();
      if(perm !== "granted"){ throw new Error("Motion permission denied."); }
    }
    $("#accelStopBtn").disabled = false;
    accelHandler = (e)=>{
      const a = e.accelerationIncludingGravity || e.acceleration || {};
      const val = { x: a.x||0, y: a.y||0, z: a.z||0 };
      state.results.accelerometer.samples += 1;
      state.results.accelerometer.last = val;
      state.results.accelerometer.status = "pass";
      state.results.accelerometer.msg = `Samples: ${state.results.accelerometer.samples}`;
      out.textContent = JSON.stringify(val, null, 2);
      renderStatus(); persist();
    };
    window.addEventListener("devicemotion", accelHandler);
  }catch(e){
    warn.textContent = e.message || "Accelerometer not supported.";
    state.results.accelerometer.status = "fail";
    state.results.accelerometer.msg = warn.textContent;
    renderStatus(); persist();
  }
});
$("#accelStopBtn").addEventListener("click", ()=>{
  if(accelHandler){ window.removeEventListener("devicemotion", accelHandler); accelHandler = null; }
  $("#accelStopBtn").disabled = true;
  $("#accelOut").textContent += "\nStopped.";
});

let gyroHandler = null;
$("#gyroPermBtn").addEventListener("click", async ()=>{
  const out = $("#gyroOut"), warn = $("#gyroWarn");
  warn.textContent = ""; out.textContent = "";
  try{
    if(typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function"){
      const perm = await DeviceOrientationEvent.requestPermission();
      if(perm !== "granted"){ throw new Error("Orientation permission denied."); }
    }
    $("#gyroStopBtn").disabled = false;
    gyroHandler = (e)=>{
      const val = { alpha: e.alpha||0, beta: e.beta||0, gamma: e.gamma||0 };
      state.results.gyroscope.samples += 1;
      state.results.gyroscope.last = val;
      state.results.gyroscope.status = "pass";
      state.results.gyroscope.msg = `Samples: ${state.results.gyroscope.samples}`;
      out.textContent = JSON.stringify(val, null, 2);
      renderStatus(); persist();
    };
    window.addEventListener("deviceorientation", gyroHandler);
  }catch(e){
    warn.textContent = e.message || "Gyroscope not supported.";
    state.results.gyroscope.status = "fail";
    state.results.gyroscope.msg = warn.textContent;
    renderStatus(); persist();
  }
});
$("#gyroStopBtn").addEventListener("click", ()=>{
  if(gyroHandler){ window.removeEventListener("deviceorientation", gyroHandler); gyroHandler = null; }
  $("#gyroStopBtn").disabled = true;
  $("#gyroOut").textContent += "\nStopped.";
});

/* =========================================================
   BATTERY (automático)
========================================================= */
$("#batteryBtn").addEventListener("click", async ()=>{
  const out = $("#batteryOut"), warn = $("#batteryWarn");
  out.textContent = ""; warn.textContent = "";
  try{
    if(!navigator.getBattery){ throw new Error("Battery API not supported on this browser."); }
    const b = await navigator.getBattery();
    const info = {
      level: Math.round(b.level * 100) + "%",
      charging: b.charging,
      chargingTime: b.chargingTime,
      dischargingTime: b.dischargingTime
    };
    out.textContent = JSON.stringify(info, null, 2);
    state.results.battery.status = "pass";
    state.results.battery.level = info.level;
    state.results.battery.charging = info.charging;
    state.results.battery.times = { chargingTime: info.chargingTime, dischargingTime: info.dischargingTime };
    state.results.battery.msg = "Battery info read";
    renderStatus(); persist();
  }catch(e){
    warn.textContent = e.message;
    state.results.battery.status = "fail";
    state.results.battery.msg = e.message;
    renderStatus(); persist();
  }
});

/* =========================================================
   Reportes + compartir + Start Over
========================================================= */
function summarize(){
  const lines = [];
  lines.push(`Phone Inspection Report`);
  lines.push(`IMEI: ${state.imei || "N/A"}`);
  lines.push(`Started: ${state.startedAt}`);
  lines.push(`Completed: ${new Date().toISOString()}`);
  lines.push(``);
  TEST_KEYS.forEach(k=>{
    const r = state.results[k];
    lines.push(`- ${k}: ${r.status.toUpperCase()} ${r.msg? `— ${r.msg}`:""}`);
    if(k === "gps" && r.coords){
      lines.push(`    lat=${r.coords.latitude}, lon=${r.coords.longitude}, acc=${Math.round(r.accuracy||0)}m`);
    }
    if(k === "display"){
      lines.push(`    resolution=${r.pixels}, DPR=${r.ratio}, colorDepth=${r.depth}`);
    }
    if(k === "battery"){
      lines.push(`    level=${r.level}, charging=${r.charging}`);
    }
  });
  return lines.join("\n");
}
function buildHTMLReport(){
  const css = `
    body{font-family:system-ui,Segoe UI,Roboto,Arial,sans-serif;padding:16px;color:#111;background:#fff}
    h1{margin-top:0}
    .muted{color:#666}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
    img, audio{max-width:100%;height:auto;border:1px solid #ddd;border-radius:8px}
    pre{background:#f6f8fa;padding:10px;border-radius:8px;border:1px solid #eee;overflow:auto}
    .status{display:grid;grid-template-columns:1fr auto;gap:6px;padding:8px;border:1px dashed #ddd;border-radius:8px}
    .pass{color:#1e7e34} .fail{color:#d73a49} .pending{color:#6a737d}
  `;
  const esc = s => (s||"").replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const blocks = TEST_KEYS.map(k=>{
    const r = state.results[k];
    const cls = r.status === "pass" ? "pass" : r.status==="fail" ? "fail" : "pending";
    let extra = "";
    if(k==="cosmetic"){
      extra += `<div class="grid">
        ${r.front?`<div><div>Front:</div><img src="${r.front}"/></div>`:""}
        ${r.back?`<div><div>Back:</div><img src="${r.back}"/></div>`:""}
      </div>`;
    }
    if(k==="frontCamera" && r.photo) extra += `<div><img src="${r.photo}"/></div>`;
    if(k==="backCamera" && r.photo) extra += `<div><img src="${r.photo}"/></div>`;
    if(k==="microphone" && r.blobUrl) extra += `<div><audio controls src="${r.blobUrl}"></audio></div>`;
    if(k==="gps" && r.coords) extra += `<pre>${esc(JSON.stringify({coords:r.coords, accuracy:r.accuracy}, null, 2))}</pre>`;
    if(k==="display") extra += `<pre>${esc(JSON.stringify({ pixels:r.pixels, ratio:r.ratio, depth:r.depth, looksOk:r.looksOk }, null, 2))}</pre>`;
    if(k==="accelerometer" && r.last) extra += `<pre>${esc(JSON.stringify(r.last, null, 2))}</pre>`;
    if(k==="gyroscope" && r.last) extra += `<pre>${esc(JSON.stringify(r.last, null, 2))}</pre>`;
    if(k==="battery" && r.level) extra += `<pre>${esc(JSON.stringify({ level:r.level, charging:r.charging, times:r.times }, null, 2))}</pre>`;
    return `
      <section class="status">
        <div><strong>${k}</strong><div class="muted">${esc(r.msg||"")}</div></div>
        <div class="${cls}">${r.status.toUpperCase()}</div>
        <div style="grid-column:1/-1">${extra}</div>
      </section>
    `;
  }).join("\n");

  return `<!doctype html>
  <html><head><meta charset="utf-8"><title>Phone Inspection Report</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>${css}</style></head><body>
  <h1>Phone Inspection Report</h1>
  <p><strong>IMEI:</strong> ${esc(state.imei||"N/A")}<br/>
     <strong>Started:</strong> ${esc(state.startedAt||"")}<br/>
     <strong>Generated:</strong> ${esc(new Date().toISOString())}
  </p>
  ${blocks}
  </body></html>`;
}

async function shareTextOrWhatsApp(text) {
  const shareData = { title: "Phone Inspection Report", text };
  if (navigator.canShare && navigator.canShare(shareData) && navigator.share) {
    try { await navigator.share(shareData); return true; }
    catch (e) {}
  }
  const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
  return true;
}

$("#generateReportBtn").addEventListener("click", ()=>{
  summarize();
  alert("Report generated.\n\nUse Share or Copy buttons below.\n\nPreview available via 'Open Full Report'.");
});
$("#shareReportBtn").addEventListener("click", async ()=>{
  const text = summarize();
  await shareTextOrWhatsApp(text);
});
$("#copyReportBtn").addEventListener("click", async ()=>{
  const text = summarize();
  try{
    await navigator.clipboard.writeText(text);
    alert("Report text copied! Paste it into WhatsApp or any chat.");
  }catch(e){
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta); ta.select(); document.execCommand("copy");
    document.body.removeChild(ta);
    alert("Report text copied (fallback).");
  }
});
$("#openReportBtn").addEventListener("click", ()=>{
  const html = buildHTMLReport();
  const w = window.open("", "_blank");
  w.document.open(); w.document.write(html); w.document.close();
});

/* ---------- Start Over ---------- */
function freshResults(){
  return {
    cosmetic: { status: "pending", front:null, back:null, msg:"" },
    gps: { status: "pending", coords:null, accuracy:null, msg:"" },
    speaker: { status: "pending", heard:null, msg:"" },
    microphone: { status: "pending", blobUrl:null, msg:"" },
    frontCamera: { status: "pending", photo:null, msg:"" },
    backCamera: { status: "pending", photo:null, msg:"" },
    touchscreen: { status: "pending", taps:0, msg:"" },
    multitouch: { status: "pending", maxTouches:0, msg:"" },
    display: { status: "pending", pixels:null, ratio:null, depth:null, looksOk:null, msg:"" },
    accelerometer: { status: "pending", samples:0, last:null, msg:"" },
    gyroscope: { status: "pending", samples:0, last:null, msg:"" },
    battery: { status: "pending", level:null, charging:null, times:null, msg:"" }
  };
}
async function wipeAllStorageAndCaches({ unregisterSW = false } = {}) {
  try {
    localStorage.removeItem(STORAGE_KEY);
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if (unregisterSW && 'serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) { console.warn("Wipe error:", e); }
}
function resetAppToStart() {
  stopAllMedia();
  state.imei = null;
  state.startedAt = null;
  state.results = freshResults();
  $("#imeiInput").value = "";
  $("#imeiError").textContent = "";
  $("#statusList").innerHTML = "";
  $("#progressBadge").textContent = `0 / ${TEST_KEYS.length} done`;
  if (overlay.classList.contains("show")) {
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden","true");
  }
  $("#dashboardView").classList.remove("active");
  $("#registerView").classList.add("active");
  $("#imeiDisplay").textContent = "—";
}
$("#startOverBtn").addEventListener("click", async () => {
  const wantsToShare = window.confirm(
    "Before starting over, would you like to share the current report?\n\nPress OK to share, or Cancel to skip."
  );
  if (wantsToShare) {
    const text = summarize();
    await shareTextOrWhatsApp(text);
    const confirmErase = window.confirm("Do you want to wipe all current data and start over?");
    if (!confirmErase) return;
  }
  await wipeAllStorageAndCaches({ unregisterSW: false });
  resetAppToStart();
  alert("All data cleared. You can register a new IMEI now.");
});

/* ---------- Misc ---------- */
window.addEventListener("beforeunload", ()=> stopAllMedia());
if(state.imei){ showDashboard(); renderStatus(); }



