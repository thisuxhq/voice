import type {
  LLMChunk,
  LLMOptions,
  LLMProvider,
  Message,
  STTProvider,
  TTSProvider,
  TransportProvider,
} from "../types.js";

export interface FakeTransport extends TransportProvider {
  readonly connected: boolean;
  readonly sent: Uint8Array[];
  /** Push remote audio into onAudio handlers (simulates mic). */
  pushAudio(chunk: Uint8Array): void;
  /** Simulate network drop (emits connection state offline). */
  goOffline(): void;
  /** Simulate network restore (emits connection state online). */
  goOnline(): void;
}

export function createFakeTransport(): FakeTransport {
  let connected = false;
  const sent: Uint8Array[] = [];
  const audioHandlers = new Set<(chunk: Uint8Array) => void>();
  const connHandlers = new Set<
    (state: "online" | "offline") => void
  >();

  return {
    get connected() {
      return connected;
    },
    get sent() {
      return sent;
    },
    async connect() {
      connected = true;
    },
    async disconnect() {
      connected = false;
      audioHandlers.clear();
    },
    send(data: Uint8Array) {
      sent.push(data);
    },
    onAudio(handler: (chunk: Uint8Array) => void) {
      audioHandlers.add(handler);
      return () => audioHandlers.delete(handler);
    },
    onConnectionState(handler) {
      connHandlers.add(handler);
      return () => connHandlers.delete(handler);
    },
    pushAudio(chunk: Uint8Array) {
      for (const h of audioHandlers) h(chunk);
    },
    goOffline() {
      connected = false;
      for (const h of connHandlers) h("offline");
    },
    goOnline() {
      connected = true;
      for (const h of connHandlers) h("online");
    },
  };
}

export interface FakeSTT extends STTProvider {
  readonly connected: boolean;
  /** Audio chunks received via `transcribe` (duplex: mic stays live). */
  readonly transcribed: Uint8Array[];
  /** Emit a transcript as if the STT engine produced it. */
  emitTranscript(text: string, isFinal?: boolean): void;
}

export function createFakeSTT(): FakeSTT {
  let connected = false;
  const transcribed: Uint8Array[] = [];
  const handlers = new Set<(e: { text: string; isFinal: boolean }) => void>();

  return {
    get connected() {
      return connected;
    },
    get transcribed() {
      return transcribed;
    },
    async connect() {
      connected = true;
    },
    async disconnect() {
      connected = false;
      handlers.clear();
    },
    transcribe(audio: Uint8Array) {
      transcribed.push(audio);
    },
    onTranscript(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    emitTranscript(text: string, isFinal = true) {
      for (const h of handlers) h({ text, isFinal });
    },
  };
}

export type LlmScriptStep =
  | LLMChunk[]
  | ((messages: Message[], options?: LLMOptions) => LLMChunk[] | Promise<LLMChunk[]>);

export interface FakeLLM extends LLMProvider {
  readonly calls: number;
  readonly messageHistory: Message[][];
}

/**
 * Scripted LLM: each `generate` call consumes the next script step.
 * Steps may be chunk arrays or functions of the current message list
 * (so tool results can influence the next reply).
 */
export function createFakeLLM(steps: LlmScriptStep[]): FakeLLM {
  let calls = 0;
  const messageHistory: Message[][] = [];

  return {
    get calls() {
      return calls;
    },
    get messageHistory() {
      return messageHistory;
    },
    async *generate(
      messages: Message[],
      options?: LLMOptions,
    ): AsyncIterable<LLMChunk> {
      if (options?.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      const index = calls;
      calls += 1;
      messageHistory.push(messages.map((m) => ({ ...m })));

      const step = steps[index];
      if (!step) {
        yield { type: "text", text: "" };
        yield { type: "done" };
        return;
      }

      const chunks =
        typeof step === "function" ? await step(messages, options) : step;

      for (const chunk of chunks) {
        if (options?.signal?.aborted) {
          throw new DOMException("Aborted", "AbortError");
        }
        yield chunk;
      }

      const hasDone = chunks.some((c) => c.type === "done");
      if (!hasDone) yield { type: "done" };
    },
  };
}

export interface FakeTTSOptions {
  /** Delay between audio chunks (ms) so interrupt tests can land mid-stream. */
  chunkDelayMs?: number;
  /** Number of audio chunks to yield per speak(). */
  chunkCount?: number;
}

export interface FakeTTS extends TTSProvider {
  readonly aborted: boolean;
  readonly speakCalls: number;
  readonly spokenTexts: string[];
  readonly chunksEmitted: number;
}

export function createFakeTTS(options: FakeTTSOptions = {}): FakeTTS {
  const chunkDelayMs = options.chunkDelayMs ?? 0;
  const chunkCount = options.chunkCount ?? 3;
  let aborted = false;
  let speakCalls = 0;
  const spokenTexts: string[] = [];
  let chunksEmitted = 0;

  return {
    get aborted() {
      return aborted;
    },
    get speakCalls() {
      return speakCalls;
    },
    get spokenTexts() {
      return spokenTexts;
    },
    get chunksEmitted() {
      return chunksEmitted;
    },
    async *speak(text: string, speakOptions?: { signal?: AbortSignal }) {
      aborted = false;
      speakCalls += 1;
      spokenTexts.push(text);

      for (let i = 0; i < chunkCount; i++) {
        if (aborted || speakOptions?.signal?.aborted) {
          return;
        }
        if (chunkDelayMs > 0) {
          const ok = await delay(chunkDelayMs, speakOptions?.signal);
          if (!ok || aborted || speakOptions?.signal?.aborted) return;
        }
        chunksEmitted += 1;
        yield new Uint8Array([i & 0xff]);
      }
    },
    abort() {
      aborted = true;
    },
  };
}

/** Resolves true if waited fully; false if aborted. Never throws. */
function delay(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => resolve(true), ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Convenience: text-only reply LLM (single generate → text). */
export function createEchoLLM(reply?: string): FakeLLM {
  return createFakeLLM([
    (messages) => {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const text =
        reply ??
        (lastUser ? `Echo: ${lastUser.content}` : "Hello from fake LLM");
      return [{ type: "text", text }];
    },
  ]);
}
