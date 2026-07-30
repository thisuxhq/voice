import { describe, expect, test } from "bun:test";
import {
  createVoice,
  createFakeSTT,
  createFakeTTS,
  createEchoLLM,
} from "@thisux/voice-core";
import { sip, createMemorySipSignaling } from "./index";

describe("SIP transport", () => {
  test("register → invite → answered → hangup lifecycle", async () => {
    const states: string[] = [];
    const transport = sip({
      uri: "sip:agent@example.com",
      registrar: "sip:example.com",
      signaling: createMemorySipSignaling(),
      onState: (s) => states.push(s),
    });

    await transport.connect();
    expect(transport.state).toBe("ready");

    await transport.invite("sip:user@example.com");
    expect(transport.state).toBe("answered");
    expect(transport.callId).toMatch(/^mem-call-/);

    await transport.hangup();
    expect(transport.state).toBe("ended");
    expect(states).toContain("registering");
    expect(states).toContain("ready");
    expect(states).toContain("inviting");
    expect(states).toContain("answered");
  });

  test("sip transport drives a voice turn via pushAudio + STT", async () => {
    const transport = sip({
      uri: "sip:agent@example.com",
      signaling: createMemorySipSignaling(),
    });
    const stt = createFakeSTT();
    const tts = createFakeTTS({ chunkCount: 1 });
    const voice = createVoice({
      transport,
      stt,
      llm: createEchoLLM("sip reply"),
      tts,
    });

    await voice.connect();
    await transport.invite("sip:alice@example.com");
    transport.pushAudio(new Uint8Array([1, 2, 3, 4]));
    stt.emitTranscript("hello over sip", true);

    await waitFor(() => tts.speakCalls === 1);
    expect(tts.spokenTexts[0]).toBe("sip reply");
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
