import {
  createVoice,
  type TransportProvider,
  type VoiceAgent,
  type TTSProvider,
  createFakeSTT,
  createFakeTTS,
  createEchoLLM,
} from "@thisux/voice-core";
import { openai, openaiTts } from "@thisux/voice-provider-openai";
import { groq } from "@thisux/voice-provider-groq";
import { cartesia } from "@thisux/voice-provider-cartesia";
import { logger } from "@thisux/voice-observability";

export type ClientSink = {
  send(data: Record<string, unknown>): void;
};

export type SessionMode = "live" | "offline";

export type BridgeTransport = TransportProvider & {
  pushAudio(chunk: Uint8Array): void;
};

/** Live when STT + LLM keys exist. TTS prefers Cartesia, else OpenAI. */
export function detectMode(env: NodeJS.ProcessEnv = process.env): SessionMode {
  if (env.OPENAI_API_KEY && env.GROQ_API_KEY) {
    return "live";
  }
  return "offline";
}

export function providerLabel(
  mode: SessionMode,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (mode === "offline") return "fake stt · echo llm · fake tts";
  const tts = env.CARTESIA_API_KEY ? "cartesia (tts)" : "openai (tts)";
  return `openai (stt) · groq (llm) · ${tts}`;
}

function pickTts(env: NodeJS.ProcessEnv): TTSProvider {
  if (env.CARTESIA_API_KEY) {
    return cartesia({ apiKey: env.CARTESIA_API_KEY });
  }
  return openaiTts({ apiKey: env.OPENAI_API_KEY! });
}

/**
 * Duplex bridge:
 * - outbound: TTS PCM → browser
 * - inbound: mic PCM → STT (via createVoice transport.onAudio wiring)
 */
function bridgeTransport(sink: ClientSink): BridgeTransport {
  const audioHandlers = new Set<(chunk: Uint8Array) => void>();

  return {
    async connect() {},
    async disconnect() {
      audioHandlers.clear();
    },
    send(data: Uint8Array) {
      sink.send({
        type: "audio",
        data: Buffer.from(data).toString("base64"),
      });
    },
    onAudio(handler: (chunk: Uint8Array) => void) {
      audioHandlers.add(handler);
      return () => audioHandlers.delete(handler);
    },
    pushAudio(chunk: Uint8Array) {
      for (const h of audioHandlers) h(chunk);
    },
  };
}

export async function createPlaygroundAgent(
  sink: ClientSink,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{
  voice: VoiceAgent;
  mode: SessionMode;
  pushAudio: (chunk: Uint8Array) => void;
}> {
  const mode = detectMode(env);
  const transport = bridgeTransport(sink);

  const voice =
    mode === "live"
      ? createVoice({
          transport,
          stt: openai({
            apiKey: env.OPENAI_API_KEY!,
            sttMode: "streaming",
            endpointMs: 700,
            partialIntervalMs: 450,
          }),
          llm: groq({ apiKey: env.GROQ_API_KEY! }),
          tts: pickTts(env),
          systemPrompt:
            "You are a friendly voice assistant in the THISUX Voice playground. Keep answers short and spoken-friendly.",
        })
      : createVoice({
          transport,
          stt: createFakeSTT(),
          llm: createEchoLLM(
            "Offline mode: add OPENAI_API_KEY and GROQ_API_KEY to voice-sdk/.env then restart. Optional: CARTESIA_API_KEY for Cartesia TTS.",
          ),
          tts: createFakeTTS({ chunkCount: 4 }),
          systemPrompt: "Offline playground agent",
        });

  voice.use(logger({ level: "info", prefix: "[playground]" }));

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
      const task = { id: crypto.randomUUID(), title: String(title) };
      sink.send({
        type: "event",
        name: "tool.result",
        detail: JSON.stringify(task),
      });
      return task;
    },
  });

  const forward = (name: string, detail?: string) => {
    sink.send({ type: "event", name, detail });
  };

  voice.on("transcript.partial", (e) => forward("transcript.partial", e.text));
  voice.on("transcript.final", (e) => forward("transcript.final", e.text));
  voice.on("llm.started", () => forward("llm.started"));
  voice.on("llm.completed", () => forward("llm.completed"));
  voice.on("tool.called", (e) =>
    forward("tool.called", `${e.name} ${JSON.stringify(e.input ?? {})}`),
  );
  voice.on("tool.completed", (e) => forward("tool.completed", e.name));
  voice.on("tts.started", (e) => forward("tts.started", e.text ?? ""));
  voice.on("tts.completed", () => {
    forward("tts.completed");
    sink.send({ type: "event", name: "turn.done" });
  });
  voice.on("error", (e) => forward("error", e.error.message));

  await voice.connect();
  return {
    voice,
    mode,
    pushAudio: (chunk) => transport.pushAudio(chunk),
  };
}
