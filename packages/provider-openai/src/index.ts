import type {
  STTProvider,
  LLMProvider,
  TTSProvider,
  Message,
  LLMOptions,
  LLMChunk,
} from "@thisux/voice-core";

export interface OpenAIOptions {
  apiKey: string;
  baseUrl?: string;
  /** STT model — default whisper-1 / gpt-4o-transcribe when streaming is available */
  sttModel?: string;
  llmModel?: string;
  ttsModel?: string;
  ttsVoice?: string;
}

const DEFAULT_BASE = "https://api.openai.com/v1";

/** OpenAI STT adapter (Phase 1: buffered chunks → transcription API). */
export function openaiStt(options: OpenAIOptions): STTProvider {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE;
  const model = options.sttModel ?? "whisper-1";
  const handlers = new Set<(e: { text: string; isFinal: boolean }) => void>();
  let buffer: Uint8Array[] = [];
  let connected = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  async function flush() {
    if (buffer.length === 0) return;
    const chunks = buffer;
    buffer = [];
    const total = chunks.reduce((n, c) => n + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }

    // Phase 1: send as wav-ish binary; production path should use realtime WS
    try {
      const form = new FormData();
      form.append("model", model);
      form.append(
        "file",
        new Blob([merged], { type: "audio/wav" }),
        "audio.wav",
      );

      const res = await fetch(`${baseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${options.apiKey}` },
        body: form,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`OpenAI STT failed: ${res.status} ${body}`);
      }

      const json = (await res.json()) as { text?: string };
      const text = json.text ?? "";
      if (text) {
        for (const h of handlers) h({ text, isFinal: true });
      }
    } catch (err) {
      console.error("[openai-stt]", err);
    }
  }

  return {
    async connect() {
      connected = true;
    },
    async disconnect() {
      connected = false;
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = null;
      buffer = [];
      handlers.clear();
    },
    transcribe(audio: Uint8Array) {
      if (!connected) return;
      buffer.push(audio);
      if (flushTimer) clearTimeout(flushTimer);
      // Debounce end-of-utterance style flush
      flushTimer = setTimeout(() => void flush(), 400);
    },
    onTranscript(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

/** OpenAI chat completions as LLM (streaming). */
export function openaiLlm(options: OpenAIOptions): LLMProvider {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE;
  const model = options.llmModel ?? "gpt-4o-mini";

  return {
    async *generate(
      messages: Message[],
      llmOptions?: LLMOptions,
    ): AsyncIterable<LLMChunk> {
      const body: Record<string, unknown> = {
        model,
        messages: messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.name ? { name: m.name } : {}),
          ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
          ...(m.toolCalls
            ? {
                tool_calls: m.toolCalls.map((tc) => ({
                  id: tc.id,
                  type: "function",
                  function: { name: tc.name, arguments: tc.arguments },
                })),
              }
            : {}),
        })),
        stream: true,
      };

      if (llmOptions?.tools?.length) {
        body.tools = llmOptions.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters ?? { type: "object", properties: {} },
          },
        }));
      }

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: llmOptions?.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        throw new Error(`OpenAI LLM failed: ${res.status} ${text}`);
      }

      yield* parseOpenAIStream(res.body);
      yield { type: "done" };
    },
  };
}

/** OpenAI TTS */
export function openaiTts(options: OpenAIOptions): TTSProvider {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE;
  const model = options.ttsModel ?? "gpt-4o-mini-tts";
  const voice = options.ttsVoice ?? "alloy";
  let aborted = false;

  return {
    async *speak(text: string, speakOptions?: { signal?: AbortSignal }) {
      aborted = false;
      const res = await fetch(`${baseUrl}/audio/speech`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          voice,
          input: text,
          response_format: "pcm",
        }),
        signal: speakOptions?.signal,
      });

      if (!res.ok || !res.body) {
        const body = await res.text();
        throw new Error(`OpenAI TTS failed: ${res.status} ${body}`);
      }

      const reader = res.body.getReader();
      try {
        while (!aborted) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
    abort() {
      aborted = true;
    },
  };
}

/**
 * Default export factory: STT-focused (Phase 1 primary path uses OpenAI for STT).
 * Use `openaiStt` / `openaiLlm` / `openaiTts` for explicit surfaces.
 */
export function openai(options: OpenAIOptions): STTProvider {
  return openaiStt(options);
}

async function* parseOpenAIStream(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<LLMChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolArgs = new Map<number, { id: string; name: string; args: string }>();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;

        let json: {
          choices?: Array<{
            delta?: {
              content?: string;
              tool_calls?: Array<{
                index: number;
                id?: string;
                function?: { name?: string; arguments?: string };
              }>;
            };
          }>;
        };
        try {
          json = JSON.parse(data) as typeof json;
        } catch {
          continue;
        }

        const delta = json.choices?.[0]?.delta;
        if (delta?.content) {
          yield { type: "text", text: delta.content };
        }
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const existing = toolArgs.get(tc.index) ?? {
              id: tc.id ?? `call_${tc.index}`,
              name: "",
              args: "",
            };
            if (tc.id) existing.id = tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;
            toolArgs.set(tc.index, existing);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  for (const tc of toolArgs.values()) {
    yield {
      type: "tool_call",
      toolCall: {
        id: tc.id,
        name: tc.name,
        arguments: tc.args,
      },
    };
  }
}
