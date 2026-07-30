import { describe, expect, test } from "bun:test";
import {
  createStateMachine,
  InvalidTransitionError,
  type SessionState,
} from "./index";

describe("StateMachine", () => {
  test("happy path: idle → connecting → connected → listening → thinking → speaking → listening → closed", () => {
    const m = createStateMachine();
    expect(m.state).toBe("idle");

    const path: SessionState[] = [
      "connecting",
      "connected",
      "listening",
      "thinking",
      "speaking",
      "listening",
      "closed",
    ];

    for (const to of path) {
      expect(m.can(to)).toBe(true);
      m.transition(to);
      expect(m.state).toBe(to);
    }
  });

  test("interrupt path: speaking → interrupted → listening", () => {
    const m = createStateMachine("speaking");
    m.transition("interrupted");
    expect(m.state).toBe("interrupted");
    m.transition("listening");
    expect(m.state).toBe("listening");
  });

  test("interrupt path: thinking → interrupted → listening", () => {
    const m = createStateMachine("thinking");
    m.transition("interrupted");
    m.transition("listening");
    expect(m.state).toBe("listening");
  });

  test("rejects invalid transitions", () => {
    const m = createStateMachine("idle");
    expect(m.can("speaking")).toBe(false);
    expect(() => m.transition("speaking")).toThrow(InvalidTransitionError);
    expect(m.state).toBe("idle");
  });

  test("tryTransition is no-op when invalid", () => {
    const m = createStateMachine("closed");
    expect(m.tryTransition("listening")).toBe(false);
    expect(m.state).toBe("closed");
  });

  test("onTransition fires for valid moves", () => {
    const m = createStateMachine();
    const seen: Array<[SessionState, SessionState]> = [];
    m.onTransition((from, to) => seen.push([from, to]));
    m.transition("connecting");
    m.transition("connected");
    expect(seen).toEqual([
      ["idle", "connecting"],
      ["connecting", "connected"],
    ]);
  });
});
