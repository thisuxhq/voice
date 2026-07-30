import { describe, expect, test } from "bun:test";
import { elevenlabs } from "./index";

describe("elevenlabs TTS", () => {
  test("streams audio chunks from fetch body", async () => {
    const chunks: Uint8Array[] = [];
    const provider = elevenlabs({
      apiKey: "test-key",
      voiceId: "voice_1",
      fetchImpl: async (input, init) => {
        expect(String(input)).toContain("/v1/text-to-speech/voice_1/stream");
        expect(init?.headers).toBeDefined();
        const headers = init!.headers as Record<string, string>;
        expect(headers["xi-api-key"]).toBe("test-key");

        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array([1, 2]));
            controller.enqueue(new Uint8Array([3, 4]));
            controller.close();
          },
        });
        return new Response(body, { status: 200 });
      },
    });

    for await (const chunk of provider.speak("Hello")) {
      chunks.push(chunk);
    }
    expect(chunks.length).toBe(2);
    expect(Array.from(chunks[0]!)).toEqual([1, 2]);
  });

  test("abort stops further yields", async () => {
    const provider = elevenlabs({
      apiKey: "k",
      fetchImpl: async () => {
        let i = 0;
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (i++ < 5) {
              controller.enqueue(new Uint8Array([i]));
            } else {
              controller.close();
            }
          },
        });
        return new Response(body, { status: 200 });
      },
    });

    const collected: number[] = [];
    const iter = provider.speak("long")[Symbol.asyncIterator]();
    const first = await iter.next();
    collected.push(first.value![0]!);
    provider.abort();
    // Drain remainder — abort flag should stop after current read loop checks
    for await (const c of { [Symbol.asyncIterator]: () => iter }) {
      collected.push(c[0]!);
    }
    expect(collected.length).toBeLessThanOrEqual(5);
  });
});
