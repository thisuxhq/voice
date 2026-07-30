import type { TTSProvider } from "@thisux/voice-core";

export interface CartesiaOptions {
  apiKey: string;
  baseUrl?: string;
  /** Cartesia voice id */
  voiceId?: string;
  modelId?: string;
  /** Output container — raw pcm for low latency */
  outputFormat?: {
    container?: string;
    encoding?: string;
    sampleRate?: number;
  };
}

const DEFAULT_BASE = "https://api.cartesia.ai";
const DEFAULT_VOICE = "a0e99841-438c-4a64-b679-ae501e7d6091";
const DEFAULT_MODEL = "sonic-2";

/**
 * Cartesia TTS adapter (bytes streaming via REST).
 * WebSocket streaming can replace this in a later iteration for lower latency.
 */
export function cartesia(options: CartesiaOptions): TTSProvider {
  const baseUrl = options.baseUrl ?? DEFAULT_BASE;
  const voiceId = options.voiceId ?? DEFAULT_VOICE;
  const modelId = options.modelId ?? DEFAULT_MODEL;
  let aborted = false;

  return {
    async *speak(text: string, speakOptions?: { signal?: AbortSignal }) {
      aborted = false;

      const outputFormat = options.outputFormat ?? {
        container: "raw",
        encoding: "pcm_s16le",
        sampleRate: 24000,
      };

      const res = await fetch(`${baseUrl}/tts/bytes`, {
        method: "POST",
        headers: {
          "X-API-Key": options.apiKey,
          "Cartesia-Version": "2024-06-10",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model_id: modelId,
          transcript: text,
          voice: {
            mode: "id",
            id: voiceId,
          },
          output_format: outputFormat,
        }),
        signal: speakOptions?.signal,
      });

      if (!res.ok || !res.body) {
        const body = await res.text();
        throw new Error(`Cartesia TTS failed: ${res.status} ${body}`);
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
