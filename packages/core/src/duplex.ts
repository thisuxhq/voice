/**
 * Full-duplex overlap policy.
 *
 * Inbound mic audio stays wired to STT while the agent speaks. When a final
 * transcript arrives mid-turn, the default is to *adapt*: cancel remaining
 * outbound speech and continue thinking → speaking without a listening restart.
 */

export type DuplexOverlapMode = "adapt" | "interrupt";

export interface DuplexOptions {
  /**
   * Keep pushing inbound PCM into STT while thinking/speaking.
   * Default true. Set false for push-to-talk / half-duplex capture.
   */
  listenWhileSpeaking?: boolean;
  /**
   * How a final user transcript mid-turn is handled.
   * - `"adapt"` (default): abort remaining TTS/LLM, inject overlap, continue
   *   `speaking → thinking → speaking` (no `listening` hop).
   * - `"interrupt"`: classic barge-in (`speaking → interrupted → listening`).
   */
  onOverlap?: DuplexOverlapMode;
  /**
   * After energy barge-in in adapt mode, if no final transcript arrives,
   * return to `listening`. Default 4000. `null` / `0` = wait indefinitely.
   */
  overlapTimeoutMs?: number | null;
}

export interface ResolvedDuplex {
  listenWhileSpeaking: boolean;
  onOverlap: DuplexOverlapMode;
  overlapTimeoutMs: number | null;
}

export function resolveDuplex(
  input?: boolean | DuplexOptions,
): ResolvedDuplex {
  if (input === false) {
    return {
      listenWhileSpeaking: true,
      onOverlap: "interrupt",
      overlapTimeoutMs: 4_000,
    };
  }
  const opts = input === true || input === undefined ? {} : input;
  return {
    listenWhileSpeaking: opts.listenWhileSpeaking !== false,
    onOverlap: opts.onOverlap ?? "adapt",
    overlapTimeoutMs:
      opts.overlapTimeoutMs === undefined ? 4_000 : opts.overlapTimeoutMs,
  };
}

/** Append a spoken TTS segment onto the running assistant utterance. */
export function appendSpoken(prev: string, segment: string): string {
  const next = segment.trim();
  if (!next) return prev.trim();
  const head = prev.trim();
  if (!head) return next;
  return `${head} ${next}`;
}
