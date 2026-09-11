import { describe, expect, test } from "bun:test";
import { createVoice } from "./create-voice";
import {
  appendSpoken,
  resolveDuplex,
} from "./duplex";
import { makeLoudPcmChunk } from "./barge-in";
import {
  createFakeLLM,
  createFakeSTT,
  createFakeTTS,
  createFakeTransport,
} from "./testing/fakes";

describe("resolveDuplex", () => {
  test("defaults to adapt + listen while speaking", () => {
    expect(resolveDuplex()).toEqual({
      listenWhileSpeaking: true,
      onOverlap: "adapt",
      overlapTimeoutMs: 4_000,
    });
  });

  test("false selects classic interrupt", () => {
    expect(resolveDuplex(false).onOverlap).toBe("interrupt");
    expect(resolveDuplex(false).listenWhileSpeaking).toBe(true);
  });
});

describe("appendSpoken", () => {
  test("joins segments with a single space", () => {
    expect(appendSpoken("", "Hello.")).toBe("Hello.");
    expect(appendSpoken("Hello.", "Next.")).toBe("Hello. Next.");
  });
});

describe("createVoice full duplex", () => {
  test("overlapping final transcript adapts without visiting listening", async () => {
    const llm = createFakeLLM([
      [{ type: "text", text: "Your meeting starts at noon today." }],
      (messages) => {
        const lastUser = [...messages].reverse().find((m) => m.role === "user");
        const lastAsst = [...messages]
          .reverse()
          .find((m) => m.role === "assistant");
        expect(lastUser?.content).toBe("No, tomorrow.");
        expect(lastAsst?.content).toContain("meeting");
        return [{ type: "text", text: "Got it, tomorrow instead." }];
      },
    ]);
    const transport = createFakeTransport();
    const stt = createFakeSTT();
    const tts = createFakeTTS({ chunkDelayMs: 25, chunkCount: 20 });
    const voice = createVoice({ transport, stt, llm, tts });

    const overlaps: string[] = [];
    voice.on("duplex.overlap", (e) => {
      overlaps.push(e.text);
    });

    let sawListeningBetween = false;
    let firstSpeaking = false;
    let adaptedSpeak = false;
    const poll = setInterval(() => {
      const state = voice.session.state;
      if (state === "speaking" && tts.speakCalls === 1) firstSpeaking = true;
      if (tts.speakCalls >= 2) adaptedSpeak = true;
      if (firstSpeaking && !adaptedSpeak && state === "listening") {
        sawListeningBetween = true;
      }
    }, 5);

    await voice.connect();
    const sessionId = voice.session.id;
    void voice.say("when is my meeting");
    await waitFor(() => tts.speakCalls >= 1 && tts.chunksEmitted >= 1);

    stt.emitTranscript("No, tomorrow.", true);

    await waitFor(() =>
      tts.spokenTexts.some((t) => t.includes("tomorrow instead")),
    );
    await waitFor(() => voice.session.state === "listening");
    clearInterval(poll);

    expect(overlaps).toEqual(["No, tomorrow."]);
    expect(sawListeningBetween).toBe(false);
    expect(voice.session.id).toBe(sessionId);
    expect(llm.calls).toBe(2);
    await voice.disconnect();
  });

  test("mic audio still reaches STT while the agent is speaking", async () => {
    const llm = createFakeLLM([
      [{ type: "text", text: "I will keep talking for a bit here." }],
    ]);
    const transport = createFakeTransport();
    const stt = createFakeSTT();
    const tts = createFakeTTS({ chunkDelayMs: 20, chunkCount: 12 });
    const voice = createVoice({
      transport,
      stt,
      llm,
      tts,
      bargeIn: false,
    });

    await voice.connect();
    const turn = voice.say("hello");
    await waitFor(() => tts.speakCalls >= 1 && voice.session.state === "speaking");

    const before = stt.transcribed.length;
    transport.pushAudio(makeLoudPcmChunk(80));
    expect(stt.transcribed.length).toBeGreaterThan(before);

    await turn;
    await voice.disconnect();
  });

  test("listenWhileSpeaking: false drops inbound audio during TTS", async () => {
    const llm = createFakeLLM([
      [{ type: "text", text: "Quiet on the inbound path please." }],
    ]);
    const transport = createFakeTransport();
    const stt = createFakeSTT();
    const tts = createFakeTTS({ chunkDelayMs: 20, chunkCount: 10 });
    const voice = createVoice({
      transport,
      stt,
      llm,
      tts,
      duplex: { listenWhileSpeaking: false },
      bargeIn: false,
    });

    await voice.connect();
    const turn = voice.say("hello");
    await waitFor(() => voice.session.state === "speaking");

    transport.pushAudio(makeLoudPcmChunk(80));
    expect(stt.transcribed.length).toBe(0);

    await turn;
    await voice.disconnect();
  });

  test("energy barge-in in adapt mode stops TTS without a listening hop", async () => {
    const llm = createFakeLLM([
      [{ type: "text", text: "Long reply that should be cut short by energy." }],
      [{ type: "text", text: "Adjusted after overlap." }],
    ]);
    const transport = createFakeTransport();
    const stt = createFakeSTT();
    const tts = createFakeTTS({ chunkDelayMs: 30, chunkCount: 30 });
    const voice = createVoice({
      transport,
      stt,
      llm,
      tts,
      bargeIn: { graceMs: 0, minFrames: 2, energyThreshold: 0.02 },
    });

    const bargeIns: string[] = [];
    voice.on("speech.barge_in", (e) => {
      bargeIns.push(e.mode);
    });

    await voice.connect();
    void voice.say("talk");
    await waitFor(() => tts.speakCalls >= 1 && tts.chunksEmitted >= 1);

    transport.pushAudio(makeLoudPcmChunk());
    transport.pushAudio(makeLoudPcmChunk());

    await waitFor(() => tts.aborted && bargeIns.length >= 1);
    expect(bargeIns).toEqual(["adapt"]);
    expect(voice.session.state).not.toBe("listening");
    expect(voice.session.state).not.toBe("interrupted");

    stt.emitTranscript("wait stop", true);
    await waitFor(() =>
      tts.spokenTexts.some((t) => t.includes("Adjusted after overlap")),
    );
    await waitFor(() => voice.session.state === "listening");
    await voice.disconnect();
  });

  test("overlap timeout returns to listening if no transcript arrives", async () => {
    const llm = createFakeLLM([
      [{ type: "text", text: "Please interrupt me with energy only." }],
    ]);
    const transport = createFakeTransport();
    const stt = createFakeSTT();
    const tts = createFakeTTS({ chunkDelayMs: 20, chunkCount: 20 });
    const voice = createVoice({
      transport,
      stt,
      llm,
      tts,
      bargeIn: { graceMs: 0, minFrames: 1, energyThreshold: 0.02 },
      duplex: { overlapTimeoutMs: 40 },
    });

    await voice.connect();
    void voice.say("go");
    await waitFor(() => tts.speakCalls >= 1 && tts.chunksEmitted >= 1);

    transport.pushAudio(makeLoudPcmChunk());
    await waitFor(() => tts.aborted);
    await waitFor(() => voice.session.state === "listening");
    await voice.disconnect();
  });

  test("duplex: false overlap uses interrupt → listening", async () => {
    const llm = createFakeLLM([
      [{ type: "text", text: "Classic interrupt path please keep talking." }],
      [{ type: "text", text: "Should not adapt in interrupt mode." }],
    ]);
    const transport = createFakeTransport();
    const stt = createFakeSTT();
    const tts = createFakeTTS({ chunkDelayMs: 25, chunkCount: 20 });
    const voice = createVoice({
      transport,
      stt,
      llm,
      tts,
      duplex: false,
      bargeIn: false,
    });

    const overlaps: string[] = [];
    voice.on("duplex.overlap", (e) => overlaps.push(e.text));

    await voice.connect();
    const first = voice.say("hello");
    await waitFor(() => tts.speakCalls >= 1 && tts.chunksEmitted >= 1);

    let sawListeningHop = false;
    const poll = setInterval(() => {
      if (
        voice.session.state === "listening" ||
        voice.session.state === "interrupted"
      ) {
        sawListeningHop = true;
      }
    }, 5);

    stt.emitTranscript("cut in", true);
    await first;
    await waitFor(() => sawListeningHop);
    clearInterval(poll);

    expect(overlaps).toEqual([]);
    expect(sawListeningHop).toBe(true);
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
