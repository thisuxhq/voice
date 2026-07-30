import { describe, expect, test } from "bun:test";
import {
  createVoice,
  createFakeTransport,
  createFakeSTT,
  createFakeTTS,
  createEchoLLM,
} from "@thisux/voice-core";
import { logger, metrics, type MetricEvent } from "./index";

describe("observability middleware", () => {
  test("logger captures lifecycle lines", async () => {
    const lines: Array<{ level: string; message: string }> = [];
    const voice = createVoice({
      transport: createFakeTransport(),
      stt: createFakeSTT(),
      llm: createEchoLLM("hi"),
      tts: createFakeTTS({ chunkCount: 1 }),
    });

    voice.use(
      logger({
        level: "debug",
        sink: (level, message) => lines.push({ level, message }),
      }),
    );

    await voice.connect();
    await voice.say("hello");
    await voice.disconnect();

    const messages = lines.map((l) => l.message);
    expect(messages).toContain("session.started");
    expect(messages).toContain("connected");
    expect(messages).toContain("transcript.final");
    expect(messages).toContain("llm.started");
    expect(messages).toContain("tts.completed");
    expect(messages).toContain("session.closed");
  });

  test("metrics records llm/tts latency and turn count", async () => {
    const events: MetricEvent[] = [];
    const mw = metrics({ onMetric: (m) => events.push(m) });

    const voice = createVoice({
      transport: createFakeTransport(),
      stt: createFakeSTT(),
      llm: createEchoLLM("metric reply"),
      tts: createFakeTTS({ chunkCount: 1 }),
    });
    voice.use(mw);

    await voice.connect();
    await voice.say("ping");
    await voice.disconnect();

    const names = events.map((e) => e.name);
    expect(names).toContain("llm.latency_ms");
    expect(names).toContain("tts.latency_ms");
    expect(names).toContain("turn.count");
    expect(names).toContain("session.duration_ms");

    const snap = mw.snapshot();
    expect(snap.turns).toBeGreaterThanOrEqual(1);
    expect(snap.lastLlmLatencyMs).not.toBeNull();
    expect(snap.lastTtsLatencyMs).not.toBeNull();
  });
});
