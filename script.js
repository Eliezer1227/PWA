/* Phone Inspection PWA — Vanilla JS (Actualizado con confirmaciones)
   - Añade confirmación Pass/Fail en pruebas NO automáticas (o cuando conviene validar visualmente).
   - Mantiene automáticas: GPS / Touch / Multitouch / Accelerometer / Gyroscope / Battery.
   - Mantiene confirmación ya existente: Speaker / Microphone / Display.
*/

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------- Adjuntar manifest inlined ---------- */
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
  }catch(e){ /* ignore */ }
})();

/* ---------- (Opcional) Registrar Service Worker si existe sw.js ---------- */
// Descomenta si ya agregaste sw.js
// if ('serviceWorker' in navigator) {
//   navigator.serviceWorker.register('./sw.js')
//     .then(()=>console.log('SW registered'))
//     .catch(console.warn);
// }

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

/* ---------- Utilidades de estado ---------- */
function isValidIMEI(v){ return /^\d{15}$/.test(v); }

function persist(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    imei: state.imei,
    startedAt: state.startedAt,
    results: state.results
  }));
}

function hydrate(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return;
    const saved = JSON.parse(raw);
    if(saved?.imei && isValidIMEI(saved.imei)){
      state.imei = saved.imei;
      state.startedAt = saved.startedAt || new Date().toISOString();
      Object.assign(state.results, saved.results || {});
      showDashboard();
      renderStatus();
    }
  } catch(e){ console.warn(e); }
}

/* ---------- IMEI ---------- */
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

/* ---------- Paneles ---------- */
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

/* ---------- Util: cámara ---------- */
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

/* ---------- NUEVO: helper de confirmación Pass/Fail ---------- */
async function confirmPassFail(testKey, messageIfPass = "User confirmed OK", messageIfFail = "User reported an issue"){
  // confirm() es simple y funciona en todos los navegadores móviles
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

/* ---------- COSMETIC ---------- */
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
let cosStream = null;

cos.btnFront.addEventListener("click", async ()=>{
  try{
    cos.msg.textContent = "Opening front camera...";
    stopStream(cos.video);
    cosStream = await startCamera(cos.video, "user");
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
    cosStream = await startCamera(cos.video, "environment");
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
      // NUEVO: confirmar con el usuario
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

/* ---------- GPS (automático) ---------- */
$("#gpsBtn").addEventListener("click", ()=>{
  const out = $("#gpsOut");
  const warn = $("#gpsWarn");
  out.textContent = ""; warn.textContent = "";
  if(!navigator.geolocation){
    warn.textContent = "Geolocation is not supported by this browser.";
    state.results.gps.status = "fail";
    state.results.gps.msg = "No geolocation support";
    renderStatus(); persist();
    return;
  }
  navigator.geolocation.getCurrentPosition((pos)=>{
    const { latitude, longitude, accuracy } = pos.coords;
    out.textContent = JSON.stringify({ latitude, longitude, accuracy, timestamp: pos.timestamp }, null, 2);
    state.results.gps.status = "pass";
    state.results.gps.coords = { latitude, longitude };
    state.results.gps.accuracy = accuracy;
    state.results.gps.msg = `Location OK (±${Math.round(accuracy)} m)`;
    renderStatus(); persist();
  }, (err)=>{
    warn.textContent = `Error: ${err.message}`;
    state.results.gps.status = "fail";
    state.results.gps.msg = err.message;
    renderStatus(); persist();
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
});

/* ---------- SPEAKER (ya tenía confirmación) ---------- */
let audioCtx = null, spkOsc = null, spkGain = null;
$("#spkPlayBtn").addEventListener("click", ()=>{
  try{
    if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    spkOsc = audioCtx.createOscillator();
    spkGain = audioCtx.createGain();
    spkOsc.type = "sine";
    spkOsc.frequency.value = 440;
    spkOsc.connect(spkGain).connect(audioCtx.destination);
    spkGain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    spkGain.gain.exponentialRampToValueAtTime(0.3, audioCtx.currentTime + 0.1);
    spkOsc.start();
    setTimeout(()=>{
      spkGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.1);
      setTimeout(()=>{
        try{ spkOsc.stop(); spkOsc.disconnect(); spkGain.disconnect(); }catch(_){}
      },150);
    }, 1800);
    $("#spkMsg").textContent = "Tone played. Did you hear it?";
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

/* ---------- MICROPHONE (ya tenía confirmación) ---------- */
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
  chunks: []
};
mic.startBtn.addEventListener("click", async ()=>{
  mic.warn.textContent = ""; mic.msg.textContent = "";
  if(!navigator.mediaDevices?.getUserMedia){
    mic.warn.textContent = "getUserMedia is not supported.";
    return;
  }
  try{
    mic.media = await navigator.mediaDevices.getUserMedia({ audio:true, video:false });
    if(!window.MediaRecorder){
      mic.warn.textContent = "MediaRecorder is not supported in this browser.";
      return;
    }
    mic.rec = new MediaRecorder(mic.media);
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
  }catch(e){
    mic.warn.textContent = "Microphone error: " + e.message;
  }
});
mic.stopBtn.addEventListener("click", ()=>{
  try{
    mic.rec?.state==="recording" && mic.rec.stop();
    mic.stopBtn.disabled = true;
    mic.startBtn.disabled = false;
  }catch(e){}
});
mic.confirmBtn.addEventListener("click", ()=>{
  state.results.microphone.status = "pass";
  state.results.microphone.msg = "User heard recorded playback";
  persist(); renderStatus();
  mic.msg.textContent = "PASS confirmed.";
});
mic.denyBtn.addEventListener("click", ()=>{
  state.results.microphone.status = "fail";
  state.results.microphone.msg = "User could not hear playback";
  persist(); renderStatus();
  mic.msg.textContent = "Marked as FAIL.";
});

/* ---------- FRONT CAMERA (ahora con confirmación) ---------- */
const f = {
  video: $("#fVideo"),
  canvas: $("#fCanvas"),
  img: $("#fImg"),
  startBtn: $("#fStartBtn"),
  captureBtn: $("#fCaptureBtn"),
  stopBtn: $("#fStopBtn"),
  stream: null,
  msg: $("#fMsg")
};
f.startBtn.addEventListener("click", async ()=>{
  try{
    f.msg.textContent = "Opening front camera…";
    stopStream(f.video);
    f.stream = await startCamera(f.video,"user");
    f.captureBtn.disabled = false; f.stopBtn.disabled = false;
    f.msg.textContent = "Front camera ready.";
  }catch(e){ f.msg.textContent = e.message; }
});
f.captureBtn.addEventListener("click", async ()=>{
  try{
    const url = captureToDataURL(f.video, f.canvas);
    f.img.src = url;
    state.results.frontCamera.photo = url;
    // Antes se marcaba PASS directo; ahora pedimos confirmación
    await confirmPassFail("frontCamera", "Front image looks clear", "Front image not acceptable");
    // También puede alimentar Cosmetic si falta la frontal
    if(!state.results.cosmetic.front){ state.results.cosmetic.front = url; }
    // Si ya hay ambas en cosmetic, marcar pass (y mantener su propio confirm)
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

/* ---------- BACK CAMERA (ahora con confirmación) ---------- */
const b = {
  video: $("#bVideo"),
  canvas: $("#bCanvas"),
  img: $("#bImg"),
  startBtn: $("#bStartBtn"),
  captureBtn: $("#bCaptureBtn"),
  stopBtn: $("#bStopBtn"),
  stream: null,
  msg: $("#bMsg")
};
b.startBtn.addEventListener("click", async ()=>{
  try{
    b.msg.textContent = "Opening back camera…";
    stopStream(b.video);
    b.stream = await startCamera(b.video,"environment");
    b.captureBtn.disabled = false; b.stopBtn.disabled = false;
    b.msg.textContent = "Back camera ready.";
  }catch(e){ b.msg.textContent = e.message; }
});
b.captureBtn.addEventListener("click", async ()=>{
  try{
    const url = captureToDataURL(b.video, b.canvas);
    b.img.src = url;
    state.results.backCamera.photo = url;
    // Confirmación con el usuario
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

/* ---------- TOUCHSCREEN (automático) ---------- */
function drawDot(ctx, x, y, color){
  ctx.fillStyle = color || "#7eb3ff";
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI*2); ctx.fill();
}
function setTouchHandlers(canvas, isMulti){
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

  // Mouse fallback
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
setTouchHandlers($("#touchCanvas"), false);
setTouchHandlers($("#multiCanvas"), true);

/* ---------- DISPLAY (ya tenía confirmación con botones) ---------- */
(function initDisplayInfo(){
  const info = {
    width: window.screen.width,
    height: window.screen.height,
    availWidth: window.screen.availWidth,
    availHeight: window.screen.availHeight,
    pixelRatio: window.devicePixelRatio || 1,
    colorDepth: window.screen.colorDepth
  };
  $("#displayInfo").textContent = JSON.stringify(info, null, 2);
  state.results.display.status = "pending";
  state.results.display.pixels = `${info.width}x${info.height}`;
  state.results.display.ratio = info.pixelRatio;
  state.results.display.depth = info.colorDepth;
  state.results.display.msg = "Info read; run color test";
  persist(); renderStatus();
})();
let dispTimer = null, dispStep = 0;
const dispArea = $("#displayTestArea");
$("#dispStartBtn").addEventListener("click", ()=>{
  const colors = ["#ff0000","#00ff00","#0000ff","#ffffff","#000000","#888888"];
  dispStep = 0;
  dispArea.textContent = "Color Test Running…";
  dispArea.style.background = colors[0];
  $("#dispStopBtn").disabled = false;
  clearInterval(dispTimer);
  dispTimer = setInterval(()=>{
    dispStep = (dispStep+1) % colors.length;
    dispArea.style.background = colors[dispStep];
    dispArea.textContent = "";
  }, 800);
});
$("#dispStopBtn").addEventListener("click", ()=>{
  clearInterval(dispTimer); dispTimer = null;
  dispArea.textContent = "Stopped.";
  $("#dispStopBtn").disabled = true;
});
$("#dispOkBtn").addEventListener("click", ()=>{
  state.results.display.status = "pass";
  state.results.display.looksOk = true;
  state.results.display.msg = "User confirmed colors OK";
  persist(); renderStatus();
  $("#displayMsg").textContent = "PASS confirmed.";
});
$("#dispBadBtn").addEventListener("click", ()=>{
  state.results.display.status = "fail";
  state.results.display.looksOk = false;
  state.results.display.msg = "User reported color/brightness issue";
  persist(); renderStatus();
  $("#displayMsg").textContent = "Marked as FAIL.";
});

/* ---------- ACCELEROMETER (automático) ---------- */
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

/* ---------- GYROSCOPE (automático) ---------- */
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

/* ---------- BATTERY (automático) ---------- */
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

/* ---------- Reportes ---------- */
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
    if(k==="display") extra += `<pre>${esc(JSON.stringify({
      pixels: r.pixels, ratio: r.ratio, depth: r.depth, looksOk: r.looksOk
    }, null, 2))}</pre>`;
    if(k==="accelerometer" && r.last) extra += `<pre>${esc(JSON.stringify(r.last, null, 2))}</pre>`;
    if(k==="gyroscope" && r.last) extra += `<pre>${esc(JSON.stringify(r.last, null, 2))}</pre>`;
    if(k==="battery" && r.level) extra += `<pre>${esc(JSON.stringify({
      level:r.level, charging:r.charging, times:r.times
    }, null, 2))}</pre>`;
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

/* ---------- Acciones de Reporte ---------- */
$("#generateReportBtn").addEventListener("click", ()=>{
  const text = summarize();
  alert("Report generated.\n\nUse Share or Copy buttons below.\n\nPreview available via 'Open Full Report'.");
});
$("#shareReportBtn").addEventListener("click", async ()=>{
  const text = summarize();
  const shareData = { title: "Phone Inspection Report", text };
  if(navigator.canShare && navigator.canShare(shareData) && navigator.share){
    try { await navigator.share(shareData); }
    catch(e){ alert("Share canceled or failed."); }
  } else {
    const url = `https://wa.me/?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  }
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

/* ---------- Misceláneo ---------- */
window.addEventListener("beforeunload", ()=> stopAllMedia());
if(state.imei){ showDashboard(); renderStatus(); }
