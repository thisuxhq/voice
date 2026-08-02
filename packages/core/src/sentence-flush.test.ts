import { describe, expect, test } from "bun:test";
import { createSentenceFlusher } from "./sentence-flush";

describe("createSentenceFlusher", () => {
  test("flushes on sentence boundaries across token chunks", () => {
    const f = createSentenceFlusher();
    expect(f.push("Hello")).toEqual([]);
    expect(f.push(" there. ")).toEqual(["Hello there."]);
    expect(f.push("How are")).toEqual([]);
    expect(f.push(" you?")).toEqual(["How are you?"]);
    expect(f.flush()).toEqual([]);
  });

  test("flush emits remainder without boundary", () => {
    const f = createSentenceFlusher();
    f.push("Almost done");
    expect(f.flush()).toEqual(["Almost done"]);
  });

  test("maxBufferChars forces a break on whitespace", () => {
    const f = createSentenceFlusher({ maxBufferChars: 20 });
    const segs = f.push("one two three four five six seven");
    expect(segs.length).toBeGreaterThanOrEqual(1);
    expect(segs.join(" ").length).toBeLessThan("one two three four five six seven".length);
    const rest = f.flush();
    expect([...segs, ...rest].join(" ")).toContain("one");
    expect([...segs, ...rest].join(" ")).toContain("seven");
  });
});
