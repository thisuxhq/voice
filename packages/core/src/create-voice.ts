import {
  TypedEmitter,
  createBaseEvent,
  type EventMap,
  type EventHandler,
  type VoiceEventName,
} from "@thisux/voice-events";
import { createSession } from "@thisux/voice-session";
import { createBargeInDetector, resolveBargeIn } from "./barge-in.js";
import { resolveDuplex } from "./duplex.js";
import { attachMessageAccessors } from "./middleware/memory.js";
import { attachToolWrapper } from "./middleware/safety.js";
import { runTurn } from "./pipeline.js";
import type {
  CreateVoiceOptions,
  InternalVoiceContext,
  Message,
  Middleware,
  ToolDefinition,
  VoiceAgent,
} from "./types.js";

export function createVoice(options: CreateVoiceOptions): VoiceAgent {
  const events = new TypedEmitter<EventMap>();
  const sessionManager = createSession({ metadata: options.metadata });
  const tools = new Map<string, ToolDefinition>();
  const middlewares: Middleware[] = [];
  const bargeIn = resolveBargeIn(options.bargeIn);
  const bargeDetector = createBargeInDetector(bargeIn);
  const duplex = resolveDuplex(options.duplex);
  const ttsStreaming = resolveTtsStreaming(options.ttsStreaming);
  const policies = resolvePolicies(options.policies);

  const ctx: InternalVoiceContext = {
    sessionManager,
    transport: options.transport,
    stt: options.stt,
    llm: options.llm,
    tts: options.tts,
    tools,
    messages: [],
    systemPrompt: options.systemPrompt ?? "You are a helpful voice assistant.",
    abortController: null,
    ttsStreaming,
    policies,
    maxToolRounds: options.maxToolRounds ?? 3,
    duplex,
    adapting: false,
    spokenAssistantText: "",
  };

  if (ctx.systemPrompt) {
    ctx.messages.push({ role: "system", content: ctx.systemPrompt });
  }

  let connected = false;
  let unsubAudio: (() => void) | undefined;
  let unsubTranscript: (() => void) | undefined;
  let unsubState: (() => void) | undefined;
  let unsubConn: (() => void) | undefined;
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let silenceFired = false;
  let reconnecting = false;
  let overlapTimer: ReturnType<typeof setTimeout> | null = null;
  let overlapGen = 0;
  let inflight: Promise<void> | null = null;
  let turnGen = 0;

  function clearSilenceTimer() {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function clearOverlapTimer() {
    if (overlapTimer) {
      clearTimeout(overlapTimer);
      overlapTimer = null;
    }
    overlapGen += 1;
  }

  function armOverlapTimer() {
    clearOverlapTimer();
    const ms = duplex.overlapTimeoutMs;
    if (ms == null || ms <= 0) return;
    const gen = overlapGen;
    overlapTimer = setTimeout(() => {
      overlapTimer = null;
      if (gen !== overlapGen) return;
      if (!ctx.adapting) return;
      ctx.adapting = false;
      sessionManager.tryTransition("listening");
    }, ms);
  }

  function persistSpokenAssistant() {
    const spoken = ctx.spokenAssistantText.trim();
    if (!spoken) return;
    const last = ctx.messages[ctx.messages.length - 1];
    if (last?.role === "assistant") {
      if (last.content === spoken) return;
      if (spoken.startsWith(last.content) || last.content.startsWith(spoken)) {
        last.content = spoken.length > last.content.length ? spoken : last.content;
        return;
      }
      return;
    }
    const msg: Message = { role: "assistant", content: spoken };
    ctx.messages.push(msg);
  }

  function midTurn(): boolean {
    const state = sessionManager.state;
    return (
      state === "speaking" ||
      state === "thinking" ||
      ctx.adapting
    );
  }

  function armSilenceTimer() {
    clearSilenceTimer();
    const ms = policies.silenceTimeoutMs;
    if (ms == null || ms <= 0 || !connected) return;
    if (sessionManager.state !== "listening") return;
    silenceTimer = setTimeout(() => {
      silenceTimer = null;
      if (!connected || sessionManager.state !== "listening") return;
      events.emit("session.idle", {
        ...createBaseEvent(sessionManager.id),
        state: sessionManager.state,
      });
      if (!silenceFired && policies.silencePrompt.trim()) {
        silenceFired = true;
        void handleFinalTranscript(policies.silencePrompt, {
          emitTranscript: true,
        });
      }
    }, ms);
  }

  const agent: VoiceAgent = {
    get session() {
      return sessionManager.snapshot;
    },

    events,

    on<K extends VoiceEventName>(
      event: K,
      handler: EventHandler<EventMap[K]>,
    ) {
      return events.on(event, handler);
    },

    tool(definition: ToolDefinition) {
      tools.set(definition.name, definition);
    },

    use(middleware: Middleware) {
      middlewares.push(middleware);
    },

    async connect() {
      if (connected) return;

      const run = async () => {
        sessionManager.transition("connecting");

        await ctx.transport.connect();
        await ctx.stt.connect();

        // Arm / disarm barge-in + silence timer on state changes.
        unsubState = sessionManager.onTransition((_from, to) => {
          if (bargeIn.enabled) {
            if (to === "speaking" || to === "thinking") {
              bargeDetector.arm();
            } else if (
              to === "listening" ||
              to === "interrupted" ||
              to === "closed" ||
              to === "failed"
            ) {
              bargeDetector.disarm();
            }
          }
          if (to === "listening") {
            armSilenceTimer();
          } else {
            clearSilenceTimer();
            if (to === "thinking" || to === "speaking") {
              silenceFired = false;
            }
          }
        });

        // Audio from transport → STT (stays live while speaking) + energy barge-in
        if (ctx.transport.onAudio) {
          const off = ctx.transport.onAudio((chunk) => {
            const speaking =
              sessionManager.state === "speaking" ||
              sessionManager.state === "thinking";
            if (!speaking || duplex.listenWhileSpeaking) {
              ctx.stt.transcribe(chunk);
            }
            if (
              bargeIn.enabled &&
              bargeDetector.push(chunk) &&
              speaking
            ) {
              events.emit("speech.barge_in", {
                ...createBaseEvent(sessionManager.id),
                role: "user",
                mode: duplex.onOverlap,
              });
              if (duplex.onOverlap === "adapt") {
                ctx.adapting = true;
                ctx.abortController?.abort();
                ctx.tts.abort?.();
                armOverlapTimer();
              } else {
                void agent.interrupt();
              }
            }
          });
          if (typeof off === "function") unsubAudio = off;
        }

        // STT → events + turns on final
        if (ctx.stt.onTranscript) {
          const off = ctx.stt.onTranscript(({ text, isFinal }) => {
            const base = createBaseEvent(sessionManager.id);
            if (isFinal) {
              events.emit("transcript.final", {
                ...base,
                text,
                isFinal: true,
              });
              events.emit("transcript", { ...base, text, isFinal: true });
              // STT path already emitted transcript events
              void handleFinalTranscript(text, { emitTranscript: false });
            } else {
              events.emit("transcript.partial", {
                ...base,
                text,
                isFinal: false,
              });
              events.emit("transcript", { ...base, text, isFinal: false });
            }
          });
          if (typeof off === "function") unsubTranscript = off;
        }

        // Transport drop / restore (session id stays stable)
        if (ctx.transport.onConnectionState) {
          const off = ctx.transport.onConnectionState((state) => {
            if (!connected) return;
            if (state === "offline") {
              reconnecting = true;
              clearSilenceTimer();
              ctx.abortController?.abort();
              ctx.tts.abort?.();
              sessionManager.tryTransition("reconnecting");
              events.emit("session.reconnecting", {
                ...createBaseEvent(sessionManager.id),
                state: "reconnecting",
              });
              return;
            }
            if (state === "online" && reconnecting) {
              void (async () => {
                try {
                  await ctx.transport.connect();
                  await ctx.stt.connect();
                } catch (err) {
                  const error =
                    err instanceof Error ? err : new Error(String(err));
                  events.emit("error", {
                    ...createBaseEvent(sessionManager.id),
                    error,
                    fatal: false,
                  });
                  return;
                }
                reconnecting = false;
                sessionManager.tryTransition("connected");
                sessionManager.tryTransition("listening");
                events.emit("session.resumed", {
                  ...createBaseEvent(sessionManager.id),
                  state: sessionManager.state,
                });
                events.emit("connected", {
                  ...createBaseEvent(sessionManager.id),
                  state: sessionManager.state,
                });
                armSilenceTimer();
              })();
            }
          });
          if (typeof off === "function") unsubConn = off;
        }

        sessionManager.transition("connected");
        sessionManager.tryTransition("listening");
        connected = true;
        armSilenceTimer();

        events.emit("connected", {
          ...createBaseEvent(sessionManager.id),
          state: sessionManager.state,
        });
        events.emit("session.started", {
          ...createBaseEvent(sessionManager.id),
          state: sessionManager.state,
        });
      };

      await runWithMiddleware(agent, middlewares, run);
    },

    async disconnect() {
      if (!connected && sessionManager.state === "idle") return;

      ctx.abortController?.abort();
      ctx.abortController = null;
      ctx.tts.abort?.();

      unsubAudio?.();
      unsubTranscript?.();
      unsubState?.();
      unsubConn?.();
      unsubAudio = undefined;
      unsubTranscript = undefined;
      unsubState = undefined;
      unsubConn = undefined;
      clearSilenceTimer();
      clearOverlapTimer();
      reconnecting = false;
      ctx.adapting = false;
      ctx.spokenAssistantText = "";
      bargeDetector.disarm();

      try {
        await ctx.stt.disconnect();
      } catch {
        /* ignore */
      }
      try {
        await ctx.transport.disconnect();
      } catch {
        /* ignore */
      }

      sessionManager.tryTransition("closed");
      if (sessionManager.state !== "closed") {
        // force closed via reset if mid-flight
        sessionManager.machine.reset("closed");
      }

      connected = false;
      events.emit("session.closed", {
        ...createBaseEvent(sessionManager.id),
        state: "closed",
      });
      events.removeAllListeners();
    },

    async interrupt() {
      // Hard stop: abort outbound and return to listening.
      ctx.adapting = false;
      clearOverlapTimer();
      ctx.abortController?.abort();
      ctx.tts.abort?.();

      sessionManager.tryTransition("interrupted");
      sessionManager.tryTransition("listening");

      events.emit("speech.stopped", {
        ...createBaseEvent(sessionManager.id),
        role: "assistant",
      });
    },

    async say(text: string) {
      if (!connected) {
        throw new Error("Voice agent is not connected. Call connect() first.");
      }
      await handleFinalTranscript(text);
    },
  };

  async function handleFinalTranscript(
    text: string,
    opts?: { emitTranscript?: boolean },
  ): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    const gen = ++turnGen;
    const overlapping = midTurn();

    if (overlapping) {
      if (duplex.onOverlap === "adapt") {
        persistSpokenAssistant();
        ctx.adapting = true;
        clearOverlapTimer();
        ctx.abortController?.abort();
        ctx.tts.abort?.();
        events.emit("duplex.overlap", {
          ...createBaseEvent(sessionManager.id),
          text: trimmed,
          spoken: ctx.spokenAssistantText.trim() || undefined,
        });
        events.emit("speech.stopped", {
          ...createBaseEvent(sessionManager.id),
          role: "assistant",
        });
      } else {
        await agent.interrupt();
      }
    }

    if (inflight) {
      try {
        await inflight;
      } catch {
        /* prior turn abort is expected */
      }
    }
    if (gen !== turnGen) return;

    // Fresh controller for this turn (interrupt only aborts; does not replace).
    ctx.abortController = new AbortController();
    ctx.adapting = false;
    ctx.spokenAssistantText = "";
    if (overlapping && duplex.onOverlap === "adapt") {
      sessionManager.tryTransition("thinking");
    }

    try {
      if (opts?.emitTranscript !== false) {
        const base = createBaseEvent(sessionManager.id);
        events.emit("transcript.final", {
          ...base,
          text: trimmed,
          isFinal: true,
        });
        events.emit("transcript", { ...base, text: trimmed, isFinal: true });
      }

      events.emit("speech.started", {
        ...createBaseEvent(sessionManager.id),
        role: "user",
      });
      events.emit("speech.stopped", {
        ...createBaseEvent(sessionManager.id),
        role: "user",
      });

      const turn = runTurn(ctx, events, trimmed);
      inflight = turn;
      await turn;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      events.emit("error", {
        ...createBaseEvent(sessionManager.id),
        error,
        fatal: false,
      });
      sessionManager.tryTransition("listening");
    } finally {
      if (inflight && gen === turnGen) {
        inflight = null;
      }
    }
  }

  attachMessageAccessors(agent, {
    getMessages: () => ctx.messages.map((m) => ({ ...m })),
    replaceMessages: (messages) => {
      ctx.messages.length = 0;
      for (const m of messages) ctx.messages.push({ ...m });
      // Ensure system prompt remains if store omitted it
      if (
        ctx.systemPrompt &&
        !ctx.messages.some((m) => m.role === "system")
      ) {
        ctx.messages.unshift({ role: "system", content: ctx.systemPrompt });
      }
    },
  });

  attachToolWrapper(agent, (wrapper) => {
    for (const [name, def] of tools) {
      tools.set(name, wrapper(def));
    }
    const prev = agent.tool.bind(agent);
    agent.tool = (definition) => {
      prev(wrapper(definition));
    };
  });

  return agent;
}

async function runWithMiddleware(
  voice: VoiceAgent,
  middlewares: Middleware[],
  terminal: () => Promise<void>,
): Promise<void> {
  let index = 0;
  const next = async (): Promise<void> => {
    const mw = middlewares[index++];
    if (!mw) {
      await terminal();
      return;
    }
    await mw(voice, next);
  };
  await next();
}

function resolveTtsStreaming(
  input?: boolean | { enabled?: boolean; maxBufferChars?: number },
): { enabled: boolean; maxBufferChars: number } {
  if (input === false) {
    return { enabled: false, maxBufferChars: 180 };
  }
  const opts = input === true || input === undefined ? {} : input;
  return {
    enabled: opts.enabled !== false,
    maxBufferChars: opts.maxBufferChars ?? 180,
  };
}

function resolvePolicies(
  input?: import("./types.js").SessionPolicies,
): import("./types.js").ResolvedPolicies {
  return {
    silenceTimeoutMs:
      input?.silenceTimeoutMs === undefined ? null : input.silenceTimeoutMs,
    silencePrompt: input?.silencePrompt ?? "Are you still there?",
    toolTimeoutMs:
      input?.toolTimeoutMs === undefined ? 15_000 : input.toolTimeoutMs,
    maxTurnMs: input?.maxTurnMs === undefined ? null : input.maxTurnMs,
  };
}
