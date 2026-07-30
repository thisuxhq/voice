import { describe, expect, test } from "bun:test";
import {
  createVoice,
  createFakeSTT,
  createFakeTTS,
  createEchoLLM,
} from "@thisux/voice-core";
import {
  twilioMediaStream,
  twilioStreamTwiml,
  mulawToPcm16,
} from "./index";

describe("twilio plugin", () => {
  test("mulawToPcm16 expands byte-for-byte to s16", () => {
    const mulaw = new Uint8Array([0xff, 0x7f, 0x00]);
    const pcm = mulawToPcm16(mulaw);
    expect(pcm.byteLength).toBe(mulaw.byteLength * 2);
  });

  test("twilioStreamTwiml embeds websocket url", () => {
    const xml = twilioStreamTwiml("wss://example.com/media");
    expect(xml).toContain("wss://example.com/media");
    expect(xml).toContain("<Stream");
  });

  test("media events drive STT → agent turn", async () => {
    const transport = twilioMediaStream();
    const stt = createFakeSTT();
    // When STT receives audio via transport, we still drive transcript via emit
    // for deterministic test; also verify handleMessage pushes audio.
    let audioChunks = 0;
    const tts = createFakeTTS({ chunkCount: 1 });
    const voice = createVoice({
      transport,
      stt,
      llm: createEchoLLM("twilio hello"),
      tts,
    });

    await voice.connect();
    transport.onAudio?.(() => {
      audioChunks += 1;
    });

    transport.handleMessage({
      event: "start",
      sequenceNumber: "1",
      start: {
        streamSid: "MZ123",
        accountSid: "AC",
        callSid: "CA",
        tracks: ["inbound"],
        mediaFormat: {
          encoding: "audio/x-mulaw",
          sampleRate: 8000,
          channels: 1,
        },
      },
    });
    expect(transport.streamSid).toBe("MZ123");

    // Silence μ-law bytes
    const silence = new Uint8Array(8).fill(0xff);
    const payload =
      typeof Buffer !== "undefined"
        ? Buffer.from(silence).toString("base64")
        : btoa(String.fromCharCode(...silence));

    transport.handleMessage({
      event: "media",
      sequenceNumber: "2",
      media: {
        track: "inbound",
        chunk: "1",
        timestamp: "0",
        payload,
      },
    });

    expect(audioChunks).toBeGreaterThanOrEqual(1);

    // Simulate STT final after media
    stt.emitTranscript("hello from phone", true);
    await waitFor(() => tts.speakCalls === 1);
    expect(tts.spokenTexts[0]).toBe("twilio hello");
    expect(voice.session.state).toBe("listening");

    await voice.disconnect();
  });
});

async function waitFor(pred: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}
