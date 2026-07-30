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
  /** STT model — whisper-1 (REST) or gpt-4o-transcribe / gpt-4o-mini-transcribe */
  sttModel?: string;
  /**
   * STT strategy:
   * - `streaming` (default): rolling windows with partial + final transcripts
   * - `rest`: single REST flush on silence (legacy)
   * - `realtime`: OpenAI Realtime transcription WebSocket when available
   */
  sttMode?: "streaming" | "rest" | "realtime";
  /** Silence window before finalizing an utterance (ms). Default 500. */
  endpointMs?: number;
  /** Partial emit interval while audio is flowing (ms). Default 250. */
  partialIntervalMs?: number;
  llmModel?: string;
  ttsModel?: string;
  ttsVoice?: string;
  /** Override WebSocket URL for realtime STT (tests). */
  realtimeUrl?: string;
  /** Inject WebSocket implementation (tests / Node polyfill). */
  WebSocketImpl?: typeof WebSocket;
}

const DEFAULT_BASE = "https://api.openai.com/v1";

type TranscriptHandler = (event: { text: string; isFinal: boolean }) => void;

/** OpenAI STT — streaming partials + finals (Phase 1 complete path). */
export function openaiStt(options: OpenAIOptions): STTProvider {
  const mode = options.sttMode ?? "streaming";
  if (mode === "realtime") {
    return openaiRealtimeStt(options);
  }
  return openaiStreamingRestStt(options, mode === "rest");
}

/**
 * Streaming REST path: accumulate PCM, emit partials on a timer while audio
 * flows, finalize with Whisper/transcribe on silence endpoint.
 */
function openaiStreamingRestStt(
  options: OpenAIOptions,
  restOnly: boolean,
): STTProvider {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE;
  const model = options.sttModel ?? "whisper-1";
  const endpointMs = options.endpointMs ?? 500;
  const partialIntervalMs = options.partialIntervalMs ?? 250;
  const handlers = new Set<TranscriptHandler>();
  let buffer: Uint8Array[] = [];
  let connected = false;
  let endpointTimer: ReturnType<typeof setTimeout> | null = null;
  let partialTimer: ReturnType<typeof setInterval> | null = null;
  let lastPartialText = "";
  let inflight: Promise<void> | null = null;
  let utteranceSeq = 0;

  function emit(text: string, isFinal: boolean) {
    if (!text.trim()) return;
    for (const h of handlers) h({ text, isFinal });
  }

  function mergeBuffer(): Uint8Array {
    const total = buffer.reduce((n, c) => n + c.byteLength, 0);
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of buffer) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return merged;
  }

  async function transcribeOnce(
    pcm: Uint8Array,
    prompt?: string,
  ): Promise<string> {
    if (pcm.byteLength === 0) return "";
    const wav = pcmToWav(pcm, 16_000);
    const form = new FormData();
    form.append("model", model);
    form.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "audio.wav");
    form.append("response_format", "json");
    if (prompt) form.append("prompt", prompt);

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
    return (json.text ?? "").trim();
  }

  async function emitPartial() {
    if (restOnly || buffer.length === 0 || inflight) return;
    const snapshot = mergeBuffer();
    // Need enough audio for a meaningful partial (~100ms @ 16k mono s16 = 3200 bytes)
    if (snapshot.byteLength < 3200) return;

    inflight = (async () => {
      try {
        const text = await transcribeOnce(snapshot, lastPartialText || undefined);
        if (text && text !== lastPartialText) {
          lastPartialText = text;
          emit(text, false);
        }
      } catch (err) {
        console.error("[openai-stt] partial", err);
      } finally {
        inflight = null;
      }
    })();
    await inflight;
  }

  async function finalize() {
    if (buffer.length === 0) return;
    const seq = ++utteranceSeq;
    const pcm = mergeBuffer();
    buffer = [];
    lastPartialText = "";
    stopPartialTimer();

    try {
      // Wait for any partial in flight so we don't race
      if (inflight) await inflight;
      if (seq !== utteranceSeq) return;
      const text = await transcribeOnce(pcm);
      if (text) emit(text, true);
    } catch (err) {
      console.error("[openai-stt] final", err);
    }
  }

  function stopPartialTimer() {
    if (partialTimer) {
      clearInterval(partialTimer);
      partialTimer = null;
    }
  }

  function armEndpoint() {
    if (endpointTimer) clearTimeout(endpointTimer);
    endpointTimer = setTimeout(() => void finalize(), endpointMs);
  }

  function ensurePartialTimer() {
    if (restOnly || partialTimer) return;
    partialTimer = setInterval(() => void emitPartial(), partialIntervalMs);
  }

  return {
    async connect() {
      connected = true;
    },
    async disconnect() {
      connected = false;
      if (endpointTimer) clearTimeout(endpointTimer);
      endpointTimer = null;
      stopPartialTimer();
      buffer = [];
      handlers.clear();
      lastPartialText = "";
    },
    transcribe(audio: Uint8Array) {
      if (!connected || audio.byteLength === 0) return;
      buffer.push(audio);
      ensurePartialTimer();
      armEndpoint();
    },
    onTranscript(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}

/**
 * OpenAI Realtime transcription WebSocket.
 * Uses session.update + input_audio_buffer.append pattern.
 */
function openaiRealtimeStt(options: OpenAIOptions): STTProvider {
  const handlers = new Set<TranscriptHandler>();
  const WS = options.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  let ws: WebSocket | null = null;
  let connected = false;
  let partial = "";

  function emit(text: string, isFinal: boolean) {
    if (!text.trim()) return;
    for (const h of handlers) h({ text, isFinal });
  }

  return {
    async connect() {
      if (!WS) {
        throw new Error(
          "WebSocket unavailable for OpenAI realtime STT. Pass WebSocketImpl or use sttMode: 'streaming'.",
        );
      }
      const url =
        options.realtimeUrl ??
        "wss://api.openai.com/v1/realtime?intent=transcription";

      await new Promise<void>((resolve, reject) => {
        ws = new WS(url, [
          "realtime",
          `openai-insecure-api-key.${options.apiKey}`,
          "openai-beta.realtime-v1",
        ] as unknown as string);

        const socket = ws;
        const timer = setTimeout(() => reject(new Error("Realtime STT connect timeout")), 15_000);

        socket.onopen = () => {
          socket.send(
            JSON.stringify({
              type: "session.update",
              session: {
                input_audio_format: "pcm16",
                input_audio_transcription: {
                  model: options.sttModel ?? "gpt-4o-mini-transcribe",
                },
                turn_detection: {
                  type: "server_vad",
                  silence_duration_ms: options.endpointMs ?? 500,
                },
              },
            }),
          );
          connected = true;
          clearTimeout(timer);
          resolve();
        };
        socket.onerror = () => {
          clearTimeout(timer);
          reject(new Error("Realtime STT WebSocket error"));
        };
        socket.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data)) as {
              type?: string;
              transcript?: string;
              delta?: string;
              text?: string;
            };
            if (
              msg.type === "conversation.item.input_audio_transcription.delta" ||
              msg.type === "transcription_session.delta"
            ) {
              const d = msg.delta ?? msg.text ?? "";
              partial += d;
              if (partial) emit(partial, false);
            }
            if (
              msg.type === "conversation.item.input_audio_transcription.completed" ||
              msg.type === "transcription_session.completed"
            ) {
              const text = (msg.transcript ?? msg.text ?? partial).trim();
              partial = "";
              if (text) emit(text, true);
            }
          } catch {
            /* ignore malformed */
          }
        };
      });
    },
    async disconnect() {
      connected = false;
      ws?.close();
      ws = null;
      partial = "";
      handlers.clear();
    },
    transcribe(audio: Uint8Array) {
      if (!connected || !ws || ws.readyState !== WS!.OPEN) return;
      // base64 PCM16
      const b64 = bytesToBase64(audio);
      ws.send(
        JSON.stringify({
          type: "input_audio_buffer.append",
          audio: b64,
        }),
      );
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
 * Default factory: STT (Phase 1 primary path).
 * Use `openaiStt` / `openaiLlm` / `openaiTts` for explicit surfaces.
 */
export function openai(options: OpenAIOptions): STTProvider {
  return openaiStt(options);
}

/** Minimal mono PCM16 LE → WAV container. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const out = new Uint8Array(buffer);

  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);
  out.set(pcm, 44);
  return out;
}

function writeStr(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
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
