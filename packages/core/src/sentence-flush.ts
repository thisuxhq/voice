/**
 * Buffer streaming LLM text and flush speakable segments on sentence boundaries.
 */

export interface SentenceFlushOptions {
  /** Max chars to hold before forcing a flush (no boundary). Default 180. */
  maxBufferChars?: number;
}

const BOUNDARY = /([.!?…]+)(\s+|$)/;

/**
 * Stateful flusher: push token text, receive zero or more segments ready for TTS.
 * Call `flush(true)` at end-of-stream to emit the remainder.
 */
export function createSentenceFlusher(options: SentenceFlushOptions = {}) {
  const maxBufferChars = options.maxBufferChars ?? 180;
  let buffer = "";

  function takeReady(force: boolean): string[] {
    const out: string[] = [];
    while (buffer.length > 0) {
      const match = BOUNDARY.exec(buffer);
      if (match && match.index !== undefined) {
        const end = match.index + match[0].length;
        const segment = buffer.slice(0, end).trim();
        buffer = buffer.slice(end);
        if (segment) out.push(segment);
        continue;
      }
      if (force || buffer.length >= maxBufferChars) {
        // Prefer breaking on last whitespace when forcing by size
        if (!force && buffer.length >= maxBufferChars) {
          const breakAt = buffer.lastIndexOf(" ", maxBufferChars);
          if (breakAt > 0) {
            const segment = buffer.slice(0, breakAt).trim();
            buffer = buffer.slice(breakAt + 1);
            if (segment) out.push(segment);
            continue;
          }
          // No whitespace — hard cut
          const segment = buffer.slice(0, maxBufferChars).trim();
          buffer = buffer.slice(maxBufferChars);
          if (segment) out.push(segment);
          continue;
        }
        if (force) {
          const segment = buffer.trim();
          buffer = "";
          if (segment) out.push(segment);
        }
      }
      break;
    }
    return out;
  }

  return {
    push(text: string): string[] {
      if (!text) return [];
      buffer += text;
      return takeReady(false);
    },
    /** Emit remaining buffer (end of LLM stream). */
    flush(): string[] {
      return takeReady(true);
    },
    get pending() {
      return buffer;
    },
  };
}
