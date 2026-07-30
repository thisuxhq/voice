import {
  TypedEmitter,
  createBaseEvent,
  type EventMap,
  type EventHandler,
  type VoiceEventName,
} from "@thisux/voice-events";
import { createSession } from "@thisux/voice-session";
import { runTurn } from "./pipeline.js";
import type {
  CreateVoiceOptions,
  InternalVoiceContext,
  Middleware,
  ToolDefinition,
  VoiceAgent,
} from "./types.js";

export function createVoice(options: CreateVoiceOptions): VoiceAgent {
  const events = new TypedEmitter<EventMap>();
  const sessionManager = createSession({ metadata: options.metadata });
  const tools = new Map<string, ToolDefinition>();
  const middlewares: Middleware[] = [];

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
  };

  if (ctx.systemPrompt) {
    ctx.messages.push({ role: "system", content: ctx.systemPrompt });
  }

  let connected = false;
  let unsubAudio: (() => void) | undefined;
  let unsubTranscript: (() => void) | undefined;

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

        // Audio from transport → STT
        if (ctx.transport.onAudio) {
          const off = ctx.transport.onAudio((chunk) => {
            ctx.stt.transcribe(chunk);
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
              void handleFinalTranscript(text);
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

        sessionManager.transition("connected");
        sessionManager.tryTransition("listening");
        connected = true;

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
      unsubAudio = undefined;
      unsubTranscript = undefined;

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
      ctx.abortController?.abort();
      ctx.tts.abort?.();
      ctx.abortController = new AbortController();

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

  async function handleFinalTranscript(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    // Barge-in: cancel current turn
    if (
      sessionManager.state === "speaking" ||
      sessionManager.state === "thinking"
    ) {
      await agent.interrupt();
    }

    ctx.abortController = new AbortController();

    try {
      events.emit("speech.started", {
        ...createBaseEvent(sessionManager.id),
        role: "user",
      });
      events.emit("speech.stopped", {
        ...createBaseEvent(sessionManager.id),
        role: "user",
      });

      await runTurn(ctx, events, trimmed);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      events.emit("error", {
        ...createBaseEvent(sessionManager.id),
        error,
        fatal: false,
      });
      sessionManager.tryTransition("listening");
    }
  }

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
