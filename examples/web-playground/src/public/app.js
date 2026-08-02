const logEl = document.getElementById("log");
const eventsEl = document.getElementById("events");
const form = document.getElementById("chat-form");
const input = document.getElementById("message");
const sendBtn = document.getElementById("btn-send");
const clearBtn = document.getElementById("btn-clear");
const sessionEl = document.getElementById("session-id");
const wsStatus = document.getElementById("ws-status");
const micBtn = document.getElementById("btn-mic");
const micLabel = document.getElementById("mic-label");
const micStatus = document.getElementById("mic-status");

/** @type {WebSocket | null} */
let ws = null;
let busy = false;
let sessionMode = "offline";

// Playback (TTS): OpenAI / Cartesia pcm_s16le ~24k
const PLAYBACK_RATE = 24000;
// Capture (STT): 16k mono pcm_s16le for Whisper / streaming STT
const CAPTURE_RATE = 16000;
const pcmBuffers = [];
let playCtx = null;

// Mic capture
let micStream = null;
let captureCtx = null;
let processor = null;
let sourceNode = null;
let micActive = false;
/** @type {HTMLElement | null} */
let partialBubble = null;
/** When true, next transcript.final came from typed say (already shown) */
let typedTurn = false;

function setBusy(next) {
  busy = next;
  sendBtn.disabled = next;
  input.disabled = next;
  if (!micActive) {
    micBtn.disabled = next;
  }
}

function setMicUi(on) {
  micActive = on;
  micBtn.classList.toggle("recording", on);
  micLabel.textContent = on ? "Listening… release to send" : "Hold to talk";
  micStatus.textContent = on ? "Mic: on" : "Mic: off";
  micStatus.classList.toggle("badge-live", on);
}

function bubble(role, text) {
  const div = document.createElement("div");
  div.className = `bubble ${role}`;
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
  return div;
}

function ensurePartialBubble(text) {
  if (!partialBubble) {
    partialBubble = bubble("user partial", text || "…");
  } else {
    partialBubble.textContent = text || "…";
  }
  logEl.scrollTop = logEl.scrollHeight;
}

function finalizePartial(text) {
  if (partialBubble) {
    partialBubble.classList.remove("partial");
    partialBubble.textContent = text;
    partialBubble = null;
  } else if (text) {
    bubble("user", text);
  }
}

function pushEvent(name, detail = "") {
  const li = document.createElement("li");
  li.innerHTML = `<strong>${name}</strong>${detail ? " · " + escapeHtml(detail) : ""}`;
  eventsEl.prepend(li);
  while (eventsEl.children.length > 50) {
    eventsEl.lastChild?.remove();
  }
}

function escapeHtml(s) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.addEventListener("open", () => {
    wsStatus.textContent = "WS: connected";
    wsStatus.classList.add("badge-ok");
    wsStatus.classList.remove("badge-err");
    pushEvent("ws.open");
  });

  ws.addEventListener("close", () => {
    wsStatus.textContent = "WS: disconnected";
    wsStatus.classList.remove("badge-ok");
    wsStatus.classList.add("badge-err");
    pushEvent("ws.close");
    stopMic(true);
    setTimeout(connect, 1200);
  });

  ws.addEventListener("error", () => {
    wsStatus.textContent = "WS: error";
    wsStatus.classList.add("badge-err");
  });

  ws.addEventListener("message", async (ev) => {
    let msg;
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }

    switch (msg.type) {
      case "ready":
        sessionMode = msg.mode ?? "offline";
        sessionEl.textContent = msg.sessionId ?? "—";
        pushEvent("ready", msg.mode);
        bubble("system", `Session ${msg.sessionId} · ${msg.mode}`);
        if (msg.mode === "offline") {
          bubble(
            "system",
            "Offline: text works. Live speech needs OPENAI + GROQ keys.",
          );
        }
        break;
      case "event":
        pushEvent(msg.name, msg.detail ?? "");
        if (msg.name === "transcript.partial" && msg.detail) {
          ensurePartialBubble(msg.detail);
        }
        if (msg.name === "transcript.final" && msg.detail) {
          if (typedTurn) {
            typedTurn = false;
          } else {
            finalizePartial(msg.detail);
          }
          setBusy(true);
          pcmBuffers.length = 0;
        }
        if (msg.name === "tts.started" && msg.detail) {
          bubble("assistant", msg.detail);
        }
        if (msg.name === "error" && msg.detail) {
          bubble("system", `Error: ${msg.detail}`);
          setBusy(false);
        }
        if (msg.name === "turn.done") {
          setBusy(false);
          await flushAudio();
        }
        break;
      case "audio":
        pcmBuffers.push(base64ToBytes(msg.data));
        break;
      case "error":
        bubble("system", msg.message ?? "Unknown error");
        setBusy(false);
        break;
      default:
        break;
    }
  });
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function flushAudio() {
  if (!pcmBuffers.length) return;
  const chunks = pcmBuffers.splice(0, pcmBuffers.length);
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }

  playCtx ??= new AudioContext({ sampleRate: PLAYBACK_RATE });
  if (playCtx.state === "suspended") await playCtx.resume();

  const sampleCount = merged.byteLength / 2;
  if (sampleCount < 1) return;
  const buffer = playCtx.createBuffer(1, sampleCount, PLAYBACK_RATE);
  const channel = buffer.getChannelData(0);
  const view = new DataView(merged.buffer, merged.byteOffset, merged.byteLength);
  for (let i = 0; i < sampleCount; i++) {
    channel[i] = view.getInt16(i * 2, true) / 32768;
  }
  const src = playCtx.createBufferSource();
  src.buffer = buffer;
  src.connect(playCtx.destination);
  src.start();
  pushEvent("audio.play", `${sampleCount} samples`);
}

function sendText(text) {
  const trimmed = text.trim();
  if (!trimmed || !ws || ws.readyState !== WebSocket.OPEN || busy) return;
  setBusy(true);
  typedTurn = true;
  pcmBuffers.length = 0;
  bubble("user", trimmed);
  ws.send(JSON.stringify({ type: "say", text: trimmed }));
  pushEvent("client.say", trimmed.slice(0, 80));
}

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(out.buffer);
}

/** Downsample Float32 audio to target rate (linear). */
function downsample(float32, fromRate, toRate) {
  if (fromRate === toRate) return float32;
  const ratio = fromRate / toRate;
  const newLen = Math.round(float32.length / ratio);
  const result = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const idx = Math.floor(i * ratio);
    result[i] = float32[idx] ?? 0;
  }
  return result;
}

async function startMic() {
  if (micActive || busy) return;
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    bubble("system", "WebSocket not connected");
    return;
  }
  if (sessionMode !== "live") {
    bubble(
      "system",
      "Mic speech needs LIVE mode (OPENAI_API_KEY + GROQ_API_KEY). Use text for offline.",
    );
    return;
  }

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  } catch (err) {
    bubble("system", `Mic permission denied: ${err?.message ?? err}`);
    return;
  }

  captureCtx = new AudioContext();
  const deviceRate = captureCtx.sampleRate;
  sourceNode = captureCtx.createMediaStreamSource(micStream);
  processor = captureCtx.createScriptProcessor(4096, 1, 1);

  processor.onaudioprocess = (e) => {
    if (!micActive || !ws || ws.readyState !== WebSocket.OPEN) return;
    const inputData = e.inputBuffer.getChannelData(0);
    const down = downsample(inputData, deviceRate, CAPTURE_RATE);
    const pcm = floatTo16BitPCM(down);
    ws.send(
      JSON.stringify({
        type: "audio",
        data: bytesToBase64(pcm),
      }),
    );
  };

  sourceNode.connect(processor);
  processor.connect(captureCtx.destination);
  setMicUi(true);
  ensurePartialBubble("Listening…");
  pushEvent("mic.start");
}

function stopMic(silent = false) {
  if (!micActive && !micStream) return;
  setMicUi(false);

  try {
    processor?.disconnect();
    sourceNode?.disconnect();
    processor = null;
    sourceNode = null;
  } catch {
    /* ignore */
  }
  try {
    captureCtx?.close();
  } catch {
    /* ignore */
  }
  captureCtx = null;

  if (micStream) {
    for (const t of micStream.getTracks()) t.stop();
    micStream = null;
  }

  if (!silent && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "mic_stop" }));
  }
  pushEvent("mic.stop");
}

// Hold-to-talk
micBtn?.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  micBtn.setPointerCapture(e.pointerId);
  void startMic();
});
micBtn?.addEventListener("pointerup", (e) => {
  e.preventDefault();
  stopMic();
});
micBtn?.addEventListener("pointercancel", () => stopMic());
micBtn?.addEventListener("pointerleave", (e) => {
  if (micActive && e.buttons === 0) stopMic();
});

form?.addEventListener("submit", (e) => {
  e.preventDefault();
  sendText(input.value);
  input.value = "";
});

clearBtn?.addEventListener("click", () => {
  logEl.innerHTML = "";
  eventsEl.innerHTML = "";
  partialBubble = null;
});

for (const chip of document.querySelectorAll("[data-prompt]")) {
  chip.addEventListener("click", () => {
    const prompt = chip.getAttribute("data-prompt") ?? "";
    input.value = prompt;
    input.focus();
  });
}

connect();
