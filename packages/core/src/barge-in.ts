/**
 * Lightweight PCM energy gate for audio barge-in.
 * Assumes little-endian signed 16-bit mono PCM (common STT input).
 * Not a production VAD — enough to detect "user started talking over TTS".
 */

export interface BargeInOptions {
  /** Enable barge-in. Default true when options object or `bargeIn: true`. */
  enabled?: boolean;
  /**
   * RMS energy threshold as a fraction of full-scale int16 (0–1).
   * Default 0.025 (~ quiet room speech after gain).
   */
  energyThreshold?: number;
  /** Consecutive hot frames required before firing. Default 3. */
  minFrames?: number;
  /**
   * Ignore inbound energy for this many ms after assistant starts speaking
   * (cheap echo guard). Default 250.
   */
  graceMs?: number;
  /** Reserved for future framing; detection is chunk-based today. Default 16000. */
  sampleRate?: number;
}

export interface ResolvedBargeIn {
  enabled: boolean;
  energyThreshold: number;
  minFrames: number;
  graceMs: number;
  sampleRate: number;
}

export function resolveBargeIn(
  input?: boolean | BargeInOptions,
): ResolvedBargeIn {
  if (input === false) {
    return {
      enabled: false,
      energyThreshold: 0.025,
      minFrames: 3,
      graceMs: 250,
      sampleRate: 16_000,
    };
  }
  const opts = input === true || input === undefined ? {} : input;
  return {
    enabled: opts.enabled !== false,
    energyThreshold: opts.energyThreshold ?? 0.025,
    minFrames: opts.minFrames ?? 3,
    graceMs: opts.graceMs ?? 250,
    sampleRate: opts.sampleRate ?? 16_000,
  };
}

/** RMS of int16 LE samples normalized to 0–1. */
export function pcmS16leRms(chunk: Uint8Array): number {
  if (chunk.byteLength < 2) return 0;
  const len = chunk.byteLength & ~1; // even
  const view = new DataView(
    chunk.buffer,
    chunk.byteOffset,
    len,
  );
  const samples = len / 2;
  let sumSq = 0;
  for (let i = 0; i < samples; i++) {
    const s = view.getInt16(i * 2, true) / 32768;
    sumSq += s * s;
  }
  return Math.sqrt(sumSq / samples);
}

/**
 * Stateful detector: feed audio while agent is in an interruptible state.
 * Returns true once when barge-in should fire (then resets hot streak).
 */
export function createBargeInDetector(options: ResolvedBargeIn) {
  let hot = 0;
  let graceUntil = 0;
  let armed = false;

  return {
    /** Call when entering speaking/thinking so grace window starts. */
    arm(now = Date.now()) {
      armed = true;
      hot = 0;
      graceUntil = now + options.graceMs;
    },
    disarm() {
      armed = false;
      hot = 0;
    },
    get armed() {
      return armed;
    },
    /**
     * @returns true if interrupt should fire
     */
    push(chunk: Uint8Array, now = Date.now()): boolean {
      if (!options.enabled || !armed) return false;
      if (now < graceUntil) return false;
      if (chunk.byteLength < 2) return false;

      const rms = pcmS16leRms(chunk);
      if (rms >= options.energyThreshold) {
        hot += 1;
        if (hot >= options.minFrames) {
          hot = 0;
          armed = false;
          return true;
        }
      } else {
        hot = 0;
      }
      return false;
    },
  };
}

/** Build a loud s16le PCM frame for tests (full-scale tone-ish noise). */
export function makeLoudPcmChunk(samples = 320): Uint8Array {
  const buf = new ArrayBuffer(samples * 2);
  const view = new DataView(buf);
  for (let i = 0; i < samples; i++) {
    // ~0.5 amplitude square-ish
    view.setInt16(i * 2, i % 2 === 0 ? 16000 : -16000, true);
  }
  return new Uint8Array(buf);
}

/** Near-silent PCM for tests. */
export function makeSilentPcmChunk(samples = 320): Uint8Array {
  return new Uint8Array(samples * 2);
}
