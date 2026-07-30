/**
 * Offline library consumer: imports shipped @thisux/voice-core after build,
 * runs one turn with fake providers, prints a stable success marker.
 */
import {
  createVoice,
  createFakeTransport,
  createFakeSTT,
  createFakeTTS,
  createEchoLLM,
} from "@thisux/voice-core";

const transport = createFakeTransport();
const stt = createFakeSTT();
const llm = createEchoLLM("Offline launch reply");
const tts = createFakeTTS({ chunkCount: 2 });

const voice = createVoice({
  transport,
  stt,
  llm,
  tts,
  systemPrompt: "Offline launch agent",
});

const events: string[] = [];
voice.on("llm.started", () => events.push("llm.started"));
voice.on("llm.completed", () => events.push("llm.completed"));
voice.on("tts.started", () => events.push("tts.started"));
voice.on("tts.completed", () => events.push("tts.completed"));

await voice.connect();
const sessionId = voice.session.id;
await voice.say("hello offline");
await voice.disconnect();

if (voice.session.state !== "closed") {
  console.error("FAIL: expected closed session, got", voice.session.state);
  process.exit(1);
}
if (!events.includes("llm.completed") || !events.includes("tts.completed")) {
  console.error("FAIL: missing lifecycle events", events);
  process.exit(1);
}
if (tts.spokenTexts[0] !== "Offline launch reply") {
  console.error("FAIL: unexpected TTS text", tts.spokenTexts);
  process.exit(1);
}

// Stable success marker (asserted by verification harness)
console.log(`VOICE_OFFLINE_OK session=${sessionId}`);
