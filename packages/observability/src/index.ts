import type { Middleware, VoiceAgent } from "@thisux/voice-core";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerOptions {
  level?: LogLevel;
  /** Sink for log lines — default console */
  sink?: (level: LogLevel, message: string, meta?: Record<string, unknown>) => void;
  /** Prefix for every line */
  prefix?: string;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Structured session logger middleware.
 *
 * @example
 * ```ts
 * voice.use(logger({ level: "info" }));
 * ```
 */
export function logger(options: LoggerOptions = {}): Middleware {
  const min = LEVEL_ORDER[options.level ?? "info"];
  const prefix = options.prefix ?? "[voice]";
  const sink =
    options.sink ??
    ((level, message, meta) => {
      const line = meta
        ? `${prefix} ${message} ${JSON.stringify(meta)}`
        : `${prefix} ${message}`;
      if (level === "error") console.error(line);
      else if (level === "warn") console.warn(line);
      else console.log(line);
    });

  const log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    if (LEVEL_ORDER[level] < min) return;
    sink(level, message, meta);
  };

  return async (voice, next) => {
    attachLogger(voice, log);
    await next();
  };
}

function attachLogger(
  voice: VoiceAgent,
  log: (level: LogLevel, message: string, meta?: Record<string, unknown>) => void,
) {
  const sid = () => voice.session.id;

  voice.on("session.started", () => {
    log("info", "session.started", { sessionId: sid(), state: voice.session.state });
  });
  voice.on("session.closed", () => {
    log("info", "session.closed", { sessionId: sid() });
  });
  voice.on("connected", () => {
    log("info", "connected", { sessionId: sid() });
  });
  voice.on("transcript.partial", (e) => {
    log("debug", "transcript.partial", { sessionId: sid(), text: e.text });
  });
  voice.on("transcript.final", (e) => {
    log("info", "transcript.final", { sessionId: sid(), text: e.text });
  });
  voice.on("llm.started", () => {
    log("debug", "llm.started", { sessionId: sid() });
  });
  voice.on("llm.completed", () => {
    log("debug", "llm.completed", { sessionId: sid() });
  });
  voice.on("tool.called", (e) => {
    log("info", "tool.called", { sessionId: sid(), name: e.name, input: e.input });
  });
  voice.on("tool.completed", (e) => {
    log("info", "tool.completed", {
      sessionId: sid(),
      name: e.name,
      error: e.error?.message,
    });
  });
  voice.on("tts.started", (e) => {
    log("debug", "tts.started", { sessionId: sid(), text: e.text });
  });
  voice.on("tts.completed", () => {
    log("debug", "tts.completed", { sessionId: sid() });
  });
  voice.on("error", (e) => {
    log("error", "error", {
      sessionId: sid(),
      message: e.error.message,
      fatal: e.fatal,
    });
  });
}

export type MetricName =
  | "session.duration_ms"
  | "llm.latency_ms"
  | "tts.latency_ms"
  | "tool.latency_ms"
  | "turn.count"
  | "error.count"
  | "transcript.final.count";

export interface MetricEvent {
  name: MetricName | string;
  value: number;
  unit?: "ms" | "count";
  sessionId: string;
  tags?: Record<string, string>;
  timestamp: number;
}

export interface MetricsOptions {
  onMetric?: (metric: MetricEvent) => void;
  /** Also mirror metrics to console.debug */
  debug?: boolean;
}

export interface MetricsHandle {
  /** Snapshot of counters / last latencies */
  snapshot(): MetricsSnapshot;
}

export interface MetricsSnapshot {
  turns: number;
  errors: number;
  finals: number;
  lastLlmLatencyMs: number | null;
  lastTtsLatencyMs: number | null;
  lastToolLatencyMs: number | null;
  sessionStartedAt: number | null;
}

/**
 * Stage latency + counter metrics middleware.
 *
 * @example
 * ```ts
 * const metricsStore: MetricEvent[] = [];
 * voice.use(metrics({ onMetric: (m) => metricsStore.push(m) }));
 * ```
 */
export function metrics(options: MetricsOptions = {}): Middleware & MetricsHandle {
  const snap: MetricsSnapshot = {
    turns: 0,
    errors: 0,
    finals: 0,
    lastLlmLatencyMs: null,
    lastTtsLatencyMs: null,
    lastToolLatencyMs: null,
    sessionStartedAt: null,
  };

  let llmStart: number | null = null;
  let ttsStart: number | null = null;
  let toolStart: number | null = null;
  let toolName: string | null = null;
  let sessionId = "";

  const emit = (name: MetricName | string, value: number, unit: "ms" | "count" = "ms", tags?: Record<string, string>) => {
    const metric: MetricEvent = {
      name,
      value,
      unit,
      sessionId,
      tags,
      timestamp: Date.now(),
    };
    options.onMetric?.(metric);
    if (options.debug) {
      console.debug("[voice-metrics]", metric);
    }
  };

  const mw = (async (voice, next) => {
    sessionId = voice.session.id;

    voice.on("session.started", () => {
      sessionId = voice.session.id;
      snap.sessionStartedAt = Date.now();
    });

    voice.on("session.closed", () => {
      if (snap.sessionStartedAt != null) {
        emit("session.duration_ms", Date.now() - snap.sessionStartedAt, "ms");
      }
    });

    voice.on("transcript.final", () => {
      snap.finals += 1;
      snap.turns += 1;
      emit("transcript.final.count", snap.finals, "count");
      emit("turn.count", snap.turns, "count");
    });

    voice.on("llm.started", () => {
      llmStart = Date.now();
    });
    voice.on("llm.completed", () => {
      if (llmStart != null) {
        const ms = Date.now() - llmStart;
        snap.lastLlmLatencyMs = ms;
        emit("llm.latency_ms", ms, "ms");
        llmStart = null;
      }
    });

    voice.on("tts.started", () => {
      ttsStart = Date.now();
    });
    voice.on("tts.completed", () => {
      if (ttsStart != null) {
        const ms = Date.now() - ttsStart;
        snap.lastTtsLatencyMs = ms;
        emit("tts.latency_ms", ms, "ms");
        ttsStart = null;
      }
    });

    voice.on("tool.called", (e) => {
      toolStart = Date.now();
      toolName = e.name;
    });
    voice.on("tool.completed", (e) => {
      if (toolStart != null) {
        const ms = Date.now() - toolStart;
        snap.lastToolLatencyMs = ms;
        emit("tool.latency_ms", ms, "ms", { tool: e.name ?? toolName ?? "unknown" });
        toolStart = null;
        toolName = null;
      }
    });

    voice.on("error", () => {
      snap.errors += 1;
      emit("error.count", snap.errors, "count");
    });

    await next();
  }) as Middleware & MetricsHandle;

  mw.snapshot = () => ({ ...snap });
  return mw;
}

export { attachLogger };
