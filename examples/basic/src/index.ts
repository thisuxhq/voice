/**
 * Phase 1 live example.
 *
 * With OPENAI_API_KEY + GROQ_API_KEY + CARTESIA_API_KEY: real providers.
 * Without keys: falls back to offline fakes (still proves the agent loop).
 */
import { createVoice } from "@thisux/voice-core";
import { webrtc } from "@thisux/voice-transport-webrtc";
import { openai } from "@thisux/voice-provider-openai";
import { groq } from "@thisux/voice-provider-groq";
import { cartesia } from "@thisux/voice-provider-cartesia";
import {
  createFakeTransport,
  createFakeSTT,
  createFakeTTS,
  createEchoLLM,
} from "@thisux/voice-core";
import { logger, metrics } from "@thisux/voice-observability";

const openaiKey = process.env.OPENAI_API_KEY;
const groqKey = process.env.GROQ_API_KEY;
const cartesiaKey = process.env.CARTESIA_API_KEY;
const live = Boolean(openaiKey && groqKey && cartesiaKey);

const voice = live
  ? createVoice({
      transport: webrtc(),
      stt: openai({ apiKey: openaiKey!, sttMode: "streaming" }),
      llm: groq({ apiKey: groqKey! }),
      tts: cartesia({ apiKey: cartesiaKey! }),
      systemPrompt:
        "You are a concise, friendly voice assistant. Keep replies short.",
    })
  : createVoice({
      transport: createFakeTransport(),
      stt: createFakeSTT(),
      llm: createEchoLLM(
        "Offline mode: set OPENAI_API_KEY, GROQ_API_KEY, CARTESIA_API_KEY for live providers.",
      ),
      tts: createFakeTTS({ chunkCount: 2 }),
      systemPrompt: "Offline basic example",
    });

voice.use(logger({ level: "info" }));
voice.use(metrics({ debug: false }));

voice.tool({
  name: "createTask",
  description: "Create a task with a title",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Task title" },
    },
    required: ["title"],
  },
  async execute({ title }) {
    const task = { id: crypto.randomUUID(), title };
    console.log("[tool] createTask →", task);
    return task;
  },
});

voice.on("transcript.final", ({ text }) => console.log("user:", text));
voice.on("tts.started", ({ text }) => console.log("assistant:", text));
voice.on("error", ({ error }) => console.error("error:", error.message));

await voice.connect();
console.log(
  live ? "LIVE providers" : "OFFLINE fakes",
  "· session",
  voice.session.id,
);

await voice.say(
  live
    ? "Create a task titled buy milk, then confirm briefly."
    : "Hello from basic example",
);

await voice.disconnect();
console.log("BASIC_EXAMPLE_OK");
