/**
 * Phase 1 + Phase 2 offline demo (no live API keys required).
 *
 * Exercises: createVoice, tools, logger, metrics, SIP transport, ElevenLabs-shaped
 * path via fake TTS swap notes, Twilio media frame parsing.
 */
import {
  createVoice,
  createFakeSTT,
  createFakeTTS,
  createEchoLLM,
  sip,
  createMemorySipSignaling,
  twilioMediaStream,
  twilioStreamTwiml,
  logger,
  metrics,
  type MetricEvent,
} from "@thisux/voice";

const metricsLog: MetricEvent[] = [];

// --- SIP path ---
const sipTransport = sip({
  uri: "sip:agent@thisux.local",
  signaling: createMemorySipSignaling(),
  onState: (s) => console.log("[sip]", s),
});

const stt = createFakeSTT();
const tts = createFakeTTS({ chunkCount: 2 });
const voice = createVoice({
  transport: sipTransport,
  stt,
  llm: createEchoLLM("Phase two is online."),
  tts,
  systemPrompt: "You are a Phase 2 demo agent.",
});

voice.use(logger({ level: "info", prefix: "[demo]" }));
voice.use(metrics({ onMetric: (m) => metricsLog.push(m) }));

voice.tool({
  name: "ping",
  description: "Health check",
  parameters: { type: "object", properties: {} },
  async execute() {
    return { ok: true, at: Date.now() };
  },
});

await voice.connect();
await sipTransport.invite("sip:user@thisux.local");
await voice.say("Status check");
console.log("tts:", tts.spokenTexts[0]);
console.log("metrics sample:", metricsLog.map((m) => m.name).join(", "));

await voice.disconnect();

// --- Twilio helpers ---
const twiml = twilioStreamTwiml("wss://example.com/twilio/media");
console.log("twiml ok:", twiml.includes("Stream"));

const twilio = twilioMediaStream();
await twilio.connect();
twilio.handleMessage({
  event: "start",
  sequenceNumber: "1",
  start: {
    streamSid: "MZdemo",
    accountSid: "AC",
    callSid: "CA",
    tracks: ["inbound"],
    mediaFormat: {
      encoding: "audio/x-mulaw",
      sampleRate: 8000,
      channels: 1,
    },
  },
});
console.log("twilio streamSid:", twilio.streamSid);
await twilio.disconnect();

console.log("PHASE2_DEMO_OK");
