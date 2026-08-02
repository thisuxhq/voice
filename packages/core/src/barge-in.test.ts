import { describe, expect, test } from "bun:test";
import {
  createBargeInDetector,
  makeLoudPcmChunk,
  makeSilentPcmChunk,
  pcmS16leRms,
  resolveBargeIn,
} from "./barge-in";
import { createVoice } from "./create-voice";
import {
  createEchoLLM,
  createFakeSTT,
  createFakeTTS,
  createFakeTransport,
} from "./testing/fakes";

describe("pcmS16leRms", () => {
  test("silent chunk is near zero", () => {
    expect(pcmS16leRms(makeSilentPcmChunk())).toBeLessThan(0.001);
  });

  test("loud chunk exceeds default threshold", () => {
    expect(pcmS16leRms(makeLoudPcmChunk())).toBeGreaterThan(0.025);
  });
});

describe("createBargeInDetector", () => {
  test("fires after minFrames of hot audio past grace", () => {
    const d = createBargeInDetector(
      resolveBargeIn({ graceMs: 0, minFrames: 3, energyThreshold: 0.02 }),
    );
    d.arm(0);
    const loud = makeLoudPcmChunk();
    expect(d.push(loud, 10)).toBe(false);
    expect(d.push(loud, 20)).toBe(false);
    expect(d.push(loud, 30)).toBe(true);
    // disarmed after fire
    expect(d.push(loud, 40)).toBe(false);
  });

  test("ignores audio during grace window", () => {
    const d = createBargeInDetector(
      resolveBargeIn({ graceMs: 200, minFrames: 1, energyThreshold: 0.02 }),
    );
    d.arm(1000);
    expect(d.push(makeLoudPcmChunk(), 1100)).toBe(false);
    expect(d.push(makeLoudPcmChunk(), 1250)).toBe(true);
  });

  test("silent audio resets hot streak", () => {
    const d = createBargeInDetector(
      resolveBargeIn({ graceMs: 0, minFrames: 3, energyThreshold: 0.02 }),
    );
    d.arm(0);
    const loud = makeLoudPcmChunk();
    d.push(loud, 1);
    d.push(loud, 2);
    d.push(makeSilentPcmChunk(), 3);
    expect(d.push(loud, 4)).toBe(false);
    expect(d.push(loud, 5)).toBe(false);
    expect(d.push(loud, 6)).toBe(true);
  });
});

describe("createVoice audio barge-in", () => {
  test("loud mic audio during TTS interrupts without manual interrupt()", async () => {
    const transport = createFakeTransport();
    const stt = createFakeSTT();
    const llm = createEchoLLM("Long reply for barge in testing please");
    const tts = createFakeTTS({ chunkDelayMs: 40, chunkCount: 40 });

    const voice = createVoice({
      transport,
      stt,
      llm,
      tts,
      bargeIn: { graceMs: 0, minFrames: 2, energyThreshold: 0.02 },
    });

    await voice.connect();

    let ttsStarted = false;
    voice.on("tts.started", () => {
      ttsStarted = true;
    });

    const turn = voice.say("talk to me");
    await waitFor(() => ttsStarted && tts.chunksEmitted >= 1);

    // Push loud frames → energy barge-in
    transport.pushAudio(makeLoudPcmChunk());
    transport.pushAudio(makeLoudPcmChunk());

    await turn;

    expect(tts.aborted).toBe(true);
    expect(tts.chunksEmitted).toBeLessThan(40);
    expect(voice.session.state).toBe("listening");
    await voice.disconnect();
  });

  test("bargeIn: false ignores loud mic during TTS", async () => {
    const transport = createFakeTransport();
    const stt = createFakeSTT();
    const llm = createEchoLLM("Should finish speaking fully here");
    const tts = createFakeTTS({ chunkDelayMs: 15, chunkCount: 8 });

    const voice = createVoice({
      transport,
      stt,
      llm,
      tts,
      bargeIn: false,
    });

    await voice.connect();
    let ttsStarted = false;
    voice.on("tts.started", () => {
      ttsStarted = true;
    });

    const turn = voice.say("go");
    await waitFor(() => ttsStarted && tts.chunksEmitted >= 1);

    for (let i = 0; i < 6; i++) transport.pushAudio(makeLoudPcmChunk());

    await turn;

    expect(tts.aborted).toBe(false);
    expect(tts.chunksEmitted).toBe(8);
    expect(voice.session.state).toBe("listening");
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
