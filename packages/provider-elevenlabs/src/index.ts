import type { TTSProvider } from "@thisux/voice-core";

export interface ElevenLabsOptions {
  apiKey: string;
  /** Voice ID from ElevenLabs dashboard */
  voiceId?: string;
  modelId?: string;
  baseUrl?: string;
  /** Output format — default pcm_24000 */
  outputFormat?: string;
  /** Optional fetch inject for tests */
  fetchImpl?: typeof fetch;
}

const DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM"; // Rachel
const DEFAULT_MODEL = "eleven_multilingual_v2";
const DEFAULT_BASE = "https://api.elevenlabs.io";

/**
 * ElevenLabs streaming TTS — drop-in `tts:` provider (Phase 2).
 */
export function elevenlabs(options: ElevenLabsOptions): TTSProvider {
  const voiceId = options.voiceId ?? DEFAULT_VOICE;
  const modelId = options.modelId ?? DEFAULT_MODEL;
  const baseUrl = options.baseUrl ?? DEFAULT_BASE;
  const outputFormat = options.outputFormat ?? "pcm_24000";
  const fetchFn = options.fetchImpl ?? fetch;
  let aborted = false;

  return {
    async *speak(text: string, speakOptions?: { signal?: AbortSignal }) {
      aborted = false;
      const url = `${baseUrl}/v1/text-to-speech/${voiceId}/stream?output_format=${encodeURIComponent(outputFormat)}`;

      const res = await fetchFn(url, {
        method: "POST",
        headers: {
          "xi-api-key": options.apiKey,
          "Content-Type": "application/json",
          Accept: "application/octet-stream",
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
        }),
        signal: speakOptions?.signal,
      });

      if (!res.ok || !res.body) {
        const body = await res.text();
        throw new Error(`ElevenLabs TTS failed: ${res.status} ${body}`);
      }

      const reader = res.body.getReader();
      try {
        while (!aborted) {
          if (speakOptions?.signal?.aborted) break;
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
