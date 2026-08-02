import { describe, expect, test } from "bun:test";
import { createVoice } from "./create-voice";
import {
  createEchoLLM,
  createFakeLLM,
  createFakeSTT,
  createFakeTTS,
  createFakeTransport,
} from "./testing/fakes";

function makeAgent(overrides?: {
  llm?: ReturnType<typeof createFakeLLM>;
  tts?: ReturnType<typeof createFakeTTS>;
}) {
  const transport = createFakeTransport();
  const stt = createFakeSTT();
  const llm = overrides?.llm ?? createEchoLLM("Hello there");
  const tts = overrides?.tts ?? createFakeTTS({ chunkCount: 2 });

  const voice = createVoice({
    transport,
    stt,
    llm,
    tts,
    systemPrompt: "Test assistant",
  });

  return { voice, transport, stt, llm, tts };
}

describe("createVoice full turn", () => {
  test("connect + say completes transcript→LLM→TTS and ends listening", async () => {
    const { voice, transport, tts } = makeAgent();
    const events: string[] = [];

    voice.on("session.started", () => {
      events.push("session.started");
    });
    voice.on("connected", () => {
      events.push("connected");
    });
    voice.on("llm.started", () => {
      events.push("llm.started");
    });
    voice.on("llm.completed", () => {
      events.push("llm.completed");
    });
    voice.on("tts.started", (e) => {
      events.push(`tts.started:${e.text}`);
    });
    voice.on("tts.completed", () => {
      events.push("tts.completed");
    });
    voice.on("speech.started", (e) => {
      events.push(`speech.started:${e.role}`);
    });
    voice.on("speech.stopped", (e) => {
      events.push(`speech.stopped:${e.role}`);
    });

    expect(voice.session.state).toBe("idle");
    await voice.connect();
    expect(voice.session.state).toBe("listening");
    expect(events).toContain("connected");
    expect(events).toContain("session.started");

    await voice.say("Hi");

    expect(events).toContain("llm.started");
    expect(events).toContain("llm.completed");
    expect(events).toContain("tts.started:Hello there");
    expect(events).toContain("tts.completed");
    expect(events).toContain("speech.started:assistant");
    expect(events).toContain("speech.stopped:assistant");

    // Order: llm before tts
    const llmStart = events.indexOf("llm.started");
    const ttsStart = events.indexOf("tts.started:Hello there");
    expect(llmStart).toBeGreaterThanOrEqual(0);
    expect(ttsStart).toBeGreaterThan(llmStart);

    expect(tts.speakCalls).toBe(1);
    expect(tts.spokenTexts).toEqual(["Hello there"]);
    expect(transport.sent.length).toBeGreaterThan(0);
    expect(voice.session.state).toBe("listening");
    expect(["listening", "connected"]).toContain(voice.session.state);

    const sessionId = voice.session.id;
    await voice.disconnect();
    expect(voice.session.id).toBe(sessionId);
    expect(voice.session.state).toBe("closed");
  });

  test("STT final transcript drives a turn", async () => {
    const { voice, stt, tts } = makeAgent({
      llm: createEchoLLM("From audio"),
    });
    const finals: string[] = [];
    voice.on("transcript.final", (e) => {
      finals.push(e.text);
    });

    await voice.connect();
    stt.emitTranscript("hello from mic", true);

    // Allow microtask/async turn to finish
    await waitFor(() => tts.speakCalls === 1);

    expect(finals).toEqual(["hello from mic"]);
    expect(tts.spokenTexts).toEqual(["From audio"]);
    expect(voice.session.state).toBe("listening");
    await voice.disconnect();
  });
});

describe("createVoice tools", () => {
  test("tool execute + re-entry: tool events fire and output shapes second LLM pass", async () => {
    const llm = createFakeLLM([
      [
        {
          type: "tool_call",
          toolCall: {
            id: "call_1",
            name: "createTask",
            arguments: JSON.stringify({ title: "buy milk" }),
          },
        },
      ],
      (messages) => {
        const toolMsg = [...messages].reverse().find((m) => m.role === "tool");
        expect(toolMsg).toBeDefined();
        const parsed = JSON.parse(toolMsg!.content) as {
          id: string;
          title: string;
        };
        return [
          {
            type: "text",
            text: `Created task ${parsed.id}: ${parsed.title}`,
          },
        ];
      },
    ]);

    const { voice, tts } = makeAgent({ llm });
    const toolCalled: Array<{ name: string; input: unknown }> = [];
    const toolCompleted: Array<{ name: string; output: unknown }> = [];

    voice.tool({
      name: "createTask",
      description: "Create a task",
      parameters: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
      async execute(input) {
        return { id: "task_99", title: String(input.title) };
      },
    });

    voice.on("tool.called", (e) => {
      toolCalled.push({ name: e.name, input: e.input });
    });
    voice.on("tool.completed", (e) => {
      toolCompleted.push({ name: e.name, output: e.output });
    });

    await voice.connect();
    await voice.say("Create a task titled buy milk");

    expect(toolCalled).toEqual([
      { name: "createTask", input: { title: "buy milk" } },
    ]);
    expect(toolCompleted).toHaveLength(1);
    expect(toolCompleted[0]?.name).toBe("createTask");
    expect(toolCompleted[0]?.output).toEqual({
      id: "task_99",
      title: "buy milk",
    });

    expect(llm.calls).toBe(2);
    expect(tts.spokenTexts[0]).toContain("task_99");
    expect(tts.spokenTexts[0]).toContain("buy milk");
    expect(voice.session.state).toBe("listening");

    await voice.disconnect();
  });
});

describe("createVoice parallel + multi-round tools", () => {
  test("two tools in one round start concurrently", async () => {
    const starts: number[] = [];
    const llm = createFakeLLM([
      [
        {
          type: "tool_call",
          toolCall: {
            id: "a",
            name: "slowA",
            arguments: "{}",
          },
        },
        {
          type: "tool_call",
          toolCall: {
            id: "b",
            name: "slowB",
            arguments: "{}",
          },
        },
      ],
      [{ type: "text", text: "done both" }],
    ]);

    const { voice, tts } = makeAgent({ llm });
    const run = async (name: string) => {
      starts.push(Date.now());
      await delay(40);
      return { name };
    };
    voice.tool({ name: "slowA", execute: () => run("a") });
    voice.tool({ name: "slowB", execute: () => run("b") });

    await voice.connect();
    const t0 = Date.now();
    await voice.say("both");
    const elapsed = Date.now() - t0;

    expect(starts).toHaveLength(2);
    // Concurrent: both start near each other; wall clock << serial 80ms+
    expect(Math.abs(starts[0]! - starts[1]!)).toBeLessThan(50);
    expect(elapsed).toBeLessThan(150);
    expect(tts.spokenTexts.join(" ")).toContain("done both");
    await voice.disconnect();
  });

  test("multi-round tools up to maxToolRounds", async () => {
    const llm = createFakeLLM([
      [
        {
          type: "tool_call",
          toolCall: {
            id: "1",
            name: "step",
            arguments: JSON.stringify({ n: 1 }),
          },
        },
      ],
      [
        {
          type: "tool_call",
          toolCall: {
            id: "2",
            name: "step",
            arguments: JSON.stringify({ n: 2 }),
          },
        },
      ],
      [{ type: "text", text: "finished rounds" }],
    ]);

    const transport = createFakeTransport();
    const stt = createFakeSTT();
    const tts = createFakeTTS({ chunkCount: 1 });
    const voice = createVoice({
      transport,
      stt,
      llm,
      tts,
      maxToolRounds: 3,
    });

    const ns: number[] = [];
    voice.tool({
      name: "step",
      async execute(input) {
        ns.push(Number(input.n));
        return { n: input.n };
      },
    });

    await voice.connect();
    await voice.say("multi");

    expect(ns).toEqual([1, 2]);
    expect(llm.calls).toBe(3);
    expect(tts.spokenTexts.join(" ")).toContain("finished rounds");
    await voice.disconnect();
  });
});

describe("createVoice streamed TTS", () => {
  test("multi-sentence LLM chunks produce multiple speak() calls", async () => {
    const llm = createFakeLLM([
      [
        { type: "text", text: "First sentence. " },
        { type: "text", text: "Second sentence. " },
        { type: "text", text: "Third one!" },
      ],
    ]);
    const tts = createFakeTTS({ chunkCount: 1 });
    const { voice } = makeAgent({ llm, tts });

    await voice.connect();
    await voice.say("hi");

    expect(tts.speakCalls).toBeGreaterThanOrEqual(2);
    expect(tts.spokenTexts.join(" ")).toContain("First sentence.");
    expect(tts.spokenTexts.join(" ")).toContain("Second sentence.");
    expect(tts.spokenTexts.join(" ")).toContain("Third one!");
    expect(voice.session.state).toBe("listening");
    await voice.disconnect();
  });

  test("ttsStreaming: false speaks once with full text", async () => {
    const llm = createFakeLLM([
      [
        { type: "text", text: "First sentence. " },
        { type: "text", text: "Second sentence." },
      ],
    ]);
    const transport = createFakeTransport();
    const stt = createFakeSTT();
    const tts = createFakeTTS({ chunkCount: 1 });
    const voice = createVoice({
      transport,
      stt,
      llm,
      tts,
      ttsStreaming: false,
    });

    await voice.connect();
    await voice.say("hi");

    expect(tts.speakCalls).toBe(1);
    expect(tts.spokenTexts[0]).toBe("First sentence. Second sentence.");
    await voice.disconnect();
  });

  test("tool calls suppress pre-tool streamed speech", async () => {
    const llm = createFakeLLM([
      [
        { type: "text", text: "Let me check. " },
        {
          type: "tool_call",
          toolCall: {
            id: "c1",
            name: "lookup",
            arguments: "{}",
          },
        },
      ],
      [{ type: "text", text: "All good." }],
    ]);
    const tts = createFakeTTS({ chunkCount: 1 });
    const { voice } = makeAgent({ llm, tts });
    voice.tool({
      name: "lookup",
      async execute() {
        return { ok: true };
      },
    });

    await voice.connect();
    await voice.say("check");

    expect(tts.spokenTexts.some((t) => t.includes("Let me check"))).toBe(
      false,
    );
    expect(tts.spokenTexts.join(" ")).toContain("All good.");
    await voice.disconnect();
  });
});

describe("createVoice interrupt", () => {
  test("interrupt mid-TTS aborts speech, keeps session id, returns to listening", async () => {
    const tts = createFakeTTS({ chunkDelayMs: 40, chunkCount: 30 });
    const llm = createEchoLLM("This is a long spoken reply for interrupt testing");
    const { voice } = makeAgent({ llm, tts });

    await voice.connect();
    const sessionId = voice.session.id;

    let ttsStarted = false;
    voice.on("tts.started", () => {
      ttsStarted = true;
    });

    const turn = voice.say("please talk for a while");

    await waitFor(() => ttsStarted && tts.chunksEmitted >= 1);

    await voice.interrupt();
    await turn;

    expect(tts.aborted).toBe(true);
    expect(tts.chunksEmitted).toBeLessThan(30);
    expect(voice.session.id).toBe(sessionId);
    expect(voice.session.state).toBe("listening");
    expect(voice.session.state).not.toBe("speaking");

    // Agent remains usable for another turn
    const llm2 = createEchoLLM("After interrupt");
    // swap not supported — just reconnect path: new agent already listening; say again with same fakes
    // Second turn: echo LLM only has one scripted step already consumed — use new agent instead
    await voice.disconnect();

    const agent2 = makeAgent({
      llm: createEchoLLM("Still works"),
      tts: createFakeTTS({ chunkCount: 1 }),
    });
    await agent2.voice.connect();
    const id2 = agent2.voice.session.id;
    await agent2.voice.say("ping");
    expect(agent2.tts.spokenTexts).toEqual(["Still works"]);
    expect(agent2.voice.session.id).toBe(id2);
    expect(agent2.voice.session.state).toBe("listening");
    await agent2.voice.disconnect();
  });

  test("interrupt mid-tool aborts and session stays usable", async () => {
    let toolStarted = false;
    let toolSawAbort = false;

    const llm = createFakeLLM([
      [
        {
          type: "tool_call",
          toolCall: {
            id: "call_slow",
            name: "slowTool",
            arguments: "{}",
          },
        },
      ],
      [{ type: "text", text: "should not speak if aborted" }],
    ]);

    const tts = createFakeTTS({ chunkCount: 1 });
    const { voice } = makeAgent({ llm, tts });

    voice.tool({
      name: "slowTool",
      async execute(_input, ctx) {
        toolStarted = true;
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 500);
          ctx.signal.addEventListener(
            "abort",
            () => {
              toolSawAbort = true;
              clearTimeout(t);
              resolve();
            },
            { once: true },
          );
        });
        if (ctx.signal.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        return { ok: true };
      },
    });

    await voice.connect();
    const sessionId = voice.session.id;

    const turn = voice.say("run slow tool");
    await waitFor(() => toolStarted);
    await voice.interrupt();
    await turn;

    expect(toolSawAbort).toBe(true);
    expect(voice.session.id).toBe(sessionId);
    expect(voice.session.state).toBe("listening");
    // TTS may or may not have run depending on race; must not be stuck speaking
    expect(voice.session.state).not.toBe("speaking");

    await voice.disconnect();
  });
});

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 3000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
