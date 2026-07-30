import { describe, expect, test } from "bun:test";
import { openaiStt, pcmToWav } from "./index";

describe("openai STT helpers", () => {
  test("pcmToWav adds 44-byte header", () => {
    const pcm = new Uint8Array(100);
    const wav = pcmToWav(pcm, 16000);
    expect(wav.byteLength).toBe(144);
    expect(String.fromCharCode(wav[0]!, wav[1]!, wav[2]!, wav[3]!)).toBe("RIFF");
    expect(String.fromCharCode(wav[8]!, wav[9]!, wav[10]!, wav[11]!)).toBe("WAVE");
  });

  test("streaming mode emits final after silence endpoint", async () => {
    const originals = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ text: "hello world" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    try {
      const stt = openaiStt({
        apiKey: "test",
        sttMode: "streaming",
        endpointMs: 40,
        partialIntervalMs: 10_000, // avoid partial races
      });

      const finals: string[] = [];
      const partials: string[] = [];
      stt.onTranscript?.(({ text, isFinal }) => {
        if (isFinal) finals.push(text);
        else partials.push(text);
      });

      await stt.connect();
      // ~200ms of fake audio so partial threshold could fire if timer shorter
      stt.transcribe(new Uint8Array(4000));
      await new Promise((r) => setTimeout(r, 80));
      await stt.disconnect();

      expect(calls).toBeGreaterThanOrEqual(1);
      expect(finals).toContain("hello world");
    } finally {
      globalThis.fetch = originals;
    }
  });
});
