import { describe, expect, test } from "bun:test";
import { webrtc, type WebRTCSignal } from "./index";

describe("webrtc transport", () => {
  test("headless connect + createOffer/Answer without RTCPeerConnection", async () => {
    const signals: WebRTCSignal[] = [];
    const t = webrtc({
      onSignal: (s) => signals.push(s),
    });

    await t.connect();
    expect(t.signalingState).toBe("headless");

    const offer = await t.createOffer();
    expect(offer.type).toBe("offer");
    if (offer.type === "offer") {
      expect(offer.sdp).toContain("headless");
    }

    const answer = await t.createAnswer();
    expect(answer.type).toBe("answer");

    await t.applySignal({ type: "ice", candidate: null });
    await t.disconnect();
  });

  test("onAudio unsubscribe works", async () => {
    const t = webrtc();
    await t.connect();
    let n = 0;
    const off = t.onAudio?.(() => {
      n += 1;
    });
    // Headless has no remote push — just ensure API is callable
    off?.();
    await t.disconnect();
    expect(n).toBe(0);
  });
});
