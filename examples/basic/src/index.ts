/**
 * Basic THISUX Voice example (Phase 1).
 *
 * Uses text turns via `voice.say()` so you can try the pipeline without a mic.
 * Set OPENAI_API_KEY, GROQ_API_KEY, CARTESIA_API_KEY in the environment.
 */
import { createVoice } from "@thisux/voice-core";
import { webrtc } from "@thisux/voice-transport-webrtc";
import { openai } from "@thisux/voice-provider-openai";
import { groq } from "@thisux/voice-provider-groq";
import { cartesia } from "@thisux/voice-provider-cartesia";

const openaiKey = process.env.OPENAI_API_KEY;
const groqKey = process.env.GROQ_API_KEY;
const cartesiaKey = process.env.CARTESIA_API_KEY;

if (!openaiKey || !groqKey || !cartesiaKey) {
  console.error(
    "Missing env: OPENAI_API_KEY, GROQ_API_KEY, CARTESIA_API_KEY are required.",
  );
  process.exit(1);
}

const voice = createVoice({
  transport: webrtc(),
  stt: openai({ apiKey: openaiKey }),
  llm: groq({ apiKey: groqKey }),
  tts: cartesia({ apiKey: cartesiaKey }),
  systemPrompt: "You are a concise, friendly voice assistant. Keep replies short.",
});

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
voice.on("llm.started", () => console.log("…thinking"));
voice.on("tool.called", ({ name, input }) =>
  console.log("tool call:", name, input),
);
voice.on("tts.started", ({ text }) => console.log("assistant:", text));
voice.on("error", ({ error }) => console.error("error:", error.message));

await voice.connect();
console.log("connected · session", voice.session.id);

// Simulate a user utterance (no mic required)
await voice.say("Create a task titled buy milk, then confirm.");

await voice.disconnect();
console.log("done");
