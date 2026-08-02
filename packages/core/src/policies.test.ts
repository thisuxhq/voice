import { describe, expect, test } from "bun:test";
import { createVoice } from "./create-voice";
import {
  createEchoLLM,
  createFakeLLM,
  createFakeSTT,
  createFakeTTS,
  createFakeTransport,
} from "./testing/fakes";

describe("session policies", () => {
  test("silence timeout emits session.idle and injects prompt once", async () => {
    const transport = createFakeTransport();
    const stt = createFakeSTT();
    const llm = createEchoLLM("Still here");
    const tts = createFakeTTS({ chunkCount: 1 });

    const voice = createVoice({
      transport,
      stt,
      llm,
      tts,
      policies: {
        silenceTimeoutMs: 40,
        silencePrompt: "Are you still there?",
      },
    });

    let idle = 0;
    voice.on("session.idle", () => {
      idle += 1;
    });

    await voice.connect();
    await waitFor(() => idle >= 1 && tts.speakCalls >= 1, 2000);

    expect(idle).toBeGreaterThanOrEqual(1);
    expect(tts.spokenTexts.length).toBeGreaterThanOrEqual(1);
    // Only one silence-driven turn while still listening after
    await delay(80);
    const speaksAfter = tts.speakCalls;
    await delay(80);
    expect(tts.speakCalls).toBe(speaksAfter);

    await voice.disconnect();
  });

  test("toolTimeoutMs returns error payload and continues turn", async () => {
    const llm = createFakeLLM([
      [
        {
          type: "tool_call",
          toolCall: {
            id: "t1",
            name: "slow",
            arguments: "{}",
          },
        },
      ],
      (messages) => {
        const tool = [...messages].reverse().find((m) => m.role === "tool");
        return [
          {
            type: "text",
            text: `tool said: ${tool?.content ?? ""}`,
          },
        ];
      },
    ]);

    const voice = createVoice({
      transport: createFakeTransport(),
      stt: createFakeSTT(),
      llm,
      tts: createFakeTTS({ chunkCount: 1 }),
      policies: { toolTimeoutMs: 30 },
    });

    voice.tool({
      name: "slow",
      async execute(_input, ctx) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 500);
          ctx.signal.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              resolve();
            },
            { once: true },
          );
        });
        return { ok: true };
      },
    });

    await voice.connect();
    await voice.say("go");

    const spoken = voice as unknown as {
      /* access via tts through closure — re-get from make */
    };
    void spoken;
    // inspect via llm history
    const toolMsg = llm.messageHistory
      .flat()
      .filter((m) => m.role === "tool")
      .pop();
    expect(toolMsg?.content).toContain("timed out");
    expect(voice.session.state).toBe("listening");
    await voice.disconnect();
  });
});

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await delay(5);
  }
}
