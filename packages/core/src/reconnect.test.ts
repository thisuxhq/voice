import { describe, expect, test } from "bun:test";
import { createVoice } from "./create-voice";
import {
  createEchoLLM,
  createFakeSTT,
  createFakeTTS,
  createFakeTransport,
} from "./testing/fakes";

describe("transport reconnect", () => {
  test("offline → reconnecting → online keeps session id and accepts say()", async () => {
    const transport = createFakeTransport();
    const stt = createFakeSTT();
    const llm = createEchoLLM("after resume");
    const tts = createFakeTTS({ chunkCount: 1 });

    const voice = createVoice({ transport, stt, llm, tts });

    const lifecycle: string[] = [];
    voice.on("session.reconnecting", () => lifecycle.push("reconnecting"));
    voice.on("session.resumed", () => lifecycle.push("resumed"));

    await voice.connect();
    const id = voice.session.id;
    expect(voice.session.state).toBe("listening");

    transport.goOffline();
    await waitFor(() => voice.session.state === "reconnecting");
    expect(lifecycle).toContain("reconnecting");
    expect(voice.session.id).toBe(id);

    transport.goOnline();
    await waitFor(() => lifecycle.includes("resumed"));
    expect(voice.session.id).toBe(id);
    expect(voice.session.state).toBe("listening");

    await voice.say("hello again");
    expect(tts.spokenTexts).toContain("after resume");
    expect(voice.session.id).toBe(id);

    await voice.disconnect();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}
