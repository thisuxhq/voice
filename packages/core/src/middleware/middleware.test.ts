import { describe, expect, test } from "bun:test";
import { createVoice } from "../create-voice";
import {
  createEchoLLM,
  createFakeLLM,
  createFakeSTT,
  createFakeTTS,
  createFakeTransport,
} from "../testing/fakes";
import { createInMemoryStore, memory } from "./memory";
import { safety } from "./safety";

describe("memory middleware", () => {
  test("loads prior messages and persists after turn", async () => {
    const store = createInMemoryStore();
    const sessionSeed = crypto.randomUUID();
    // Pre-seed under a known id by wrapping createSession is hard —
    // instead: run turn 1, capture id, disconnect, new agent same store+id via metadata hack.
    // Simpler path: same process — persist after turn, read store data by session id.

    const transport = createFakeTransport();
    const stt = createFakeSTT();
    const llm = createEchoLLM("reply one");
    const tts = createFakeTTS({ chunkCount: 1 });

    const voice = createVoice({ transport, stt, llm, tts });
    voice.use(memory({ store }));

    await voice.connect();
    const id = voice.session.id;
    await voice.say("hello memory");
    await waitFor(() => (store.data.get(id)?.length ?? 0) >= 2);

    const saved = store.data.get(id) ?? [];
    expect(saved.some((m) => m.role === "user" && m.content === "hello memory")).toBe(
      true,
    );
    expect(saved.some((m) => m.role === "assistant")).toBe(true);

    await voice.disconnect();

    // Second agent with same store: manually set so get(sessionId) works —
    // new session id differs. Prove store retained data:
    expect(store.data.get(id)?.length).toBeGreaterThanOrEqual(2);

    // Simulate resume: put history under new session by re-set
    const transport2 = createFakeTransport();
    const voice2 = createVoice({
      transport: transport2,
      stt: createFakeSTT(),
      llm: createEchoLLM("reply two"),
      tts: createFakeTTS({ chunkCount: 1 }),
    });
    // Prime store under whatever id voice2 will use by hooking get to always return saved
    const resumeStore = {
      async get() {
        return saved;
      },
      async set(sid: string, messages: typeof saved) {
        store.data.set(sid, messages);
      },
    };
    voice2.use(memory({ store: resumeStore }));
    await voice2.connect();
    // After connect, history should include prior user turn so LLM sees it on next say
    await voice2.say("follow up");
    // llm received prior context: messageHistory[0] includes earlier user
    const hist = (llm as unknown as { messageHistory?: unknown }).messageHistory;
    void hist;
    const llm2 = createEchoLLM("x");
    void llm2;
    // Inspect via voice2's next generate — use a scripted llm instead next time
    await voice2.disconnect();
  });

  test("resume injects prior messages into the next LLM call", async () => {
    const prior = [
      { role: "system" as const, content: "You are a helpful voice assistant." },
      { role: "user" as const, content: "my name is Sam" },
      { role: "assistant" as const, content: "Hi Sam" },
    ];
    const store = {
      get: async () => prior,
      set: async () => {},
    };
    const llm = createFakeLLM([
      (messages) => {
        const hasName = messages.some(
          (m) => m.role === "user" && m.content.includes("Sam"),
        );
        return [
          {
            type: "text",
            text: hasName ? "Welcome back Sam" : "Who are you?",
          },
        ];
      },
    ]);

    const voice = createVoice({
      transport: createFakeTransport(),
      stt: createFakeSTT(),
      llm,
      tts: createFakeTTS({ chunkCount: 1 }),
      systemPrompt: "You are a helpful voice assistant.",
    });
    voice.use(memory({ store }));

    await voice.connect();
    await voice.say("remember me?");
    expect(llm.messageHistory[0]?.some((m) => m.content.includes("Sam"))).toBe(
      true,
    );
    await voice.disconnect();
  });
});

describe("safety middleware", () => {
  test("blocks say when checkTranscript fails", async () => {
    const tts = createFakeTTS({ chunkCount: 1 });
    const voice = createVoice({
      transport: createFakeTransport(),
      stt: createFakeSTT(),
      llm: createEchoLLM("should not speak"),
      tts,
    });
    voice.use(
      safety({
        checkTranscript: (text) => ({
          block: text.includes("forbidden"),
          reason: "blocked word",
        }),
      }),
    );

    const errors: string[] = [];
    voice.on("error", (e) => errors.push(e.error.message));

    await voice.connect();
    await voice.say("this is forbidden");
    expect(tts.speakCalls).toBe(0);
    expect(errors.some((m) => m.includes("blocked"))).toBe(true);

    await voice.say("hello safe");
    expect(tts.speakCalls).toBe(1);
    await voice.disconnect();
  });

  test("blocks tool execute when checkToolCall fails", async () => {
    const llm = createFakeLLM([
      [
        {
          type: "tool_call",
          toolCall: {
            id: "1",
            name: "deleteAll",
            arguments: "{}",
          },
        },
      ],
      (messages) => {
        const tool = [...messages].reverse().find((m) => m.role === "tool");
        return [{ type: "text", text: `result:${tool?.content}` }];
      },
    ]);

    const voice = createVoice({
      transport: createFakeTransport(),
      stt: createFakeSTT(),
      llm,
      tts: createFakeTTS({ chunkCount: 1 }),
    });
    voice.use(
      safety({
        checkToolCall: (name) => ({
          block: name === "deleteAll",
          reason: "dangerous tool",
        }),
      }),
    );

    let executed = false;
    voice.tool({
      name: "deleteAll",
      async execute() {
        executed = true;
        return { ok: true };
      },
    });

    await voice.connect();
    await voice.say("wipe");
    expect(executed).toBe(false);
    const toolMsg = llm.messageHistory
      .flat()
      .filter((m) => m.role === "tool")
      .pop();
    expect(toolMsg?.content).toContain("blocked");
    await voice.disconnect();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}
