import {
  createBaseEvent,
  type TypedEmitter,
  type EventMap,
} from "@thisux/voice-events";
import { createSentenceFlusher } from "./sentence-flush.js";
import type {
  InternalVoiceContext,
  LLMChunk,
  Message,
  ToolCall,
} from "./types.js";

/**
 * Run one agent turn from a final user transcript:
 * LLM → optional tools → LLM → TTS → transport.
 *
 * TTS streaming (Phase 2.5):
 * - Sentence-flush speak while tokens arrive when safe.
 * - First pass with registered tools: buffer until stream ends (no pre-tool speech).
 * - Post-tool / no-tools: live sentence streaming.
 */
export async function runTurn(
  ctx: InternalVoiceContext,
  events: TypedEmitter<EventMap>,
  userText: string,
): Promise<void> {
  const sessionId = ctx.sessionManager.id;
  let signal = ctx.abortController?.signal;
  const streaming = ctx.ttsStreaming.enabled;
  // Live first-pass speech only when the agent has no tools (no tool_call risk).
  const liveFirstPass = streaming && ctx.tools.size === 0;

  // Optional whole-turn wall clock
  let turnTimer: ReturnType<typeof setTimeout> | null = null;
  const maxTurn = ctx.policies.maxTurnMs;
  if (maxTurn != null && maxTurn > 0 && ctx.abortController) {
    turnTimer = setTimeout(() => {
      ctx.abortController?.abort();
      ctx.tts.abort?.();
    }, maxTurn);
  }
  const clearTurnTimer = () => {
    if (turnTimer) {
      clearTimeout(turnTimer);
      turnTimer = null;
    }
  };

  ctx.messages.push({ role: "user", content: userText });
  ctx.sessionManager.tryTransition("thinking");

  events.emit("llm.started", {
    ...createBaseEvent(sessionId),
  });

  let assistantText = "";
  const pendingToolCalls: ToolCall[] = [];
  let spokeAny = false;
  const firstFlusher = createSentenceFlusher({
    maxBufferChars: ctx.ttsStreaming.maxBufferChars,
  });
  const bufferedFirst: string[] = [];

  try {
    for await (const chunk of ctx.llm.generate(ctx.messages, {
      tools: [...ctx.tools.values()],
      signal,
    })) {
      if (signal?.aborted) break;
      await handleChunk(chunk, {
        onText: async (text) => {
          assistantText += text;
          if (!streaming) return;
          const segs = firstFlusher.push(text);
          if (liveFirstPass) {
            for (const segment of segs) {
              if (signal?.aborted) break;
              const ok = await speakSegment(ctx, events, segment, {
                first: !spokeAny,
                fullTextHint: assistantText,
              });
              if (ok) spokeAny = true;
            }
          } else {
            bufferedFirst.push(...segs);
          }
        },
        onToolCall: (tc) => {
          pendingToolCalls.push(tc);
        },
      });
    }
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) {
      clearTurnTimer();
      recoverFromAbort(ctx);
      return;
    }
    clearTurnTimer();
    throw err;
  }

  if (streaming) {
    const tail = firstFlusher.flush();
    if (liveFirstPass) {
      for (const segment of tail) {
        if (signal?.aborted) break;
        const ok = await speakSegment(ctx, events, segment, {
          first: !spokeAny,
          fullTextHint: assistantText,
        });
        if (ok) spokeAny = true;
      }
    } else {
      bufferedFirst.push(...tail);
    }
  }

  events.emit("llm.completed", {
    ...createBaseEvent(sessionId),
  });

  if (signal?.aborted) {
    clearTurnTimer();
    recoverFromAbort(ctx);
    return;
  }

  // Speak buffered first-pass text only when there were no tools.
  if (
    streaming &&
    !liveFirstPass &&
    pendingToolCalls.length === 0 &&
    bufferedFirst.length > 0
  ) {
    for (const segment of bufferedFirst) {
      if (signal?.aborted) break;
      const ok = await speakSegment(ctx, events, segment, {
        first: !spokeAny,
        fullTextHint: assistantText,
      });
      if (ok) spokeAny = true;
    }
  }

  // Tool loop (single round — multi-round lands in a later stack layer)
  if (pendingToolCalls.length > 0) {
    const assistantMsg: Message = {
      role: "assistant",
      content: assistantText,
      toolCalls: pendingToolCalls,
    };
    ctx.messages.push(assistantMsg);

    for (const tc of pendingToolCalls) {
      if (signal?.aborted) {
        recoverFromAbort(ctx);
        return;
      }
      await executeTool(ctx, events, tc, signal);
      if (signal?.aborted) {
        recoverFromAbort(ctx);
        return;
      }
    }

    // Second LLM pass after tools — always live-stream sentences when enabled
    events.emit("llm.started", { ...createBaseEvent(sessionId) });
    assistantText = "";
    spokeAny = false;
    const postFlusher = createSentenceFlusher({
      maxBufferChars: ctx.ttsStreaming.maxBufferChars,
    });

    try {
      for await (const chunk of ctx.llm.generate(ctx.messages, {
        tools: [...ctx.tools.values()],
        signal,
      })) {
        if (signal?.aborted) break;
        await handleChunk(chunk, {
          onText: async (text) => {
            assistantText += text;
            if (!streaming) return;
            for (const segment of postFlusher.push(text)) {
              if (signal?.aborted) break;
              const ok = await speakSegment(ctx, events, segment, {
                first: !spokeAny,
                fullTextHint: assistantText,
              });
              if (ok) spokeAny = true;
            }
          },
          onToolCall: () => {
            // Multi-round tools land in a later stack layer
          },
        });
      }
    } catch (err) {
      if (signal?.aborted || isAbortError(err)) {
        recoverFromAbort(ctx);
        return;
      }
      throw err;
    }

    if (streaming && !signal?.aborted) {
      for (const segment of postFlusher.flush()) {
        if (signal?.aborted) break;
        const ok = await speakSegment(ctx, events, segment, {
          first: !spokeAny,
          fullTextHint: assistantText,
        });
        if (ok) spokeAny = true;
      }
    }

    events.emit("llm.completed", { ...createBaseEvent(sessionId) });
  }

  if (signal?.aborted) {
    recoverFromAbort(ctx);
    return;
  }

  if (!assistantText.trim()) {
    if (spokeAny) {
      finishSpeech(ctx, events, assistantText, signal);
    } else {
      ctx.sessionManager.tryTransition("listening");
    }
    return;
  }

  const last = ctx.messages[ctx.messages.length - 1];
  const alreadyStoredAssistant =
    last?.role === "assistant" &&
    last.content === assistantText &&
    !last.toolCalls;
  if (!alreadyStoredAssistant) {
    ctx.messages.push({ role: "assistant", content: assistantText });
  }

  // Non-streaming path: speak full text once
  if (!streaming && !spokeAny) {
    await speakSegment(ctx, events, assistantText, {
      first: true,
      fullTextHint: assistantText,
    });
    spokeAny = true;
  }

  if (spokeAny) {
    finishSpeech(ctx, events, assistantText, signal);
  } else {
    ctx.sessionManager.tryTransition("listening");
  }
  clearTurnTimer();
}

async function speakSegment(
  ctx: InternalVoiceContext,
  events: TypedEmitter<EventMap>,
  text: string,
  opts: { first: boolean; fullTextHint: string },
): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const sessionId = ctx.sessionManager.id;
  const signal = ctx.abortController?.signal;
  if (signal?.aborted) return false;

  if (opts.first) {
    ctx.sessionManager.tryTransition("speaking");
    events.emit("tts.started", {
      ...createBaseEvent(sessionId),
      text: opts.fullTextHint || trimmed,
    });
    events.emit("speech.started", {
      ...createBaseEvent(sessionId),
      role: "assistant",
    });
  }

  try {
    for await (const audio of ctx.tts.speak(trimmed, { signal })) {
      if (signal?.aborted) break;
      ctx.transport.send(audio);
    }
  } catch (err) {
    if (signal?.aborted || isAbortError(err)) return true;
    throw err;
  }
  return true;
}

function finishSpeech(
  ctx: InternalVoiceContext,
  events: TypedEmitter<EventMap>,
  assistantText: string,
  signal?: AbortSignal,
): void {
  const sessionId = ctx.sessionManager.id;
  events.emit("tts.completed", {
    ...createBaseEvent(sessionId),
    text: assistantText,
  });
  events.emit("speech.stopped", {
    ...createBaseEvent(sessionId),
    role: "assistant",
  });
  if (signal?.aborted) {
    recoverFromAbort(ctx);
  } else {
    ctx.sessionManager.tryTransition("listening");
  }
}

function recoverFromAbort(ctx: InternalVoiceContext): void {
  ctx.sessionManager.tryTransition("interrupted");
  ctx.sessionManager.tryTransition("listening");
}

function isAbortError(err: unknown): boolean {
  return (
    (err instanceof Error && err.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      err instanceof DOMException &&
      err.name === "AbortError")
  );
}

async function handleChunk(
  chunk: LLMChunk,
  handlers: {
    onText: (text: string) => void | Promise<void>;
    onToolCall: (tc: ToolCall) => void;
  },
): Promise<void> {
  if (chunk.type === "text" && chunk.text) {
    await handlers.onText(chunk.text);
  } else if (chunk.type === "tool_call" && chunk.toolCall) {
    handlers.onToolCall(chunk.toolCall);
  }
}

async function executeTool(
  ctx: InternalVoiceContext,
  events: TypedEmitter<EventMap>,
  tc: ToolCall,
  signal?: AbortSignal,
): Promise<void> {
  const sessionId = ctx.sessionManager.id;
  const def = ctx.tools.get(tc.name);

  let input: Record<string, unknown> = {};
  try {
    input = tc.arguments
      ? (JSON.parse(tc.arguments) as Record<string, unknown>)
      : {};
  } catch {
    input = { raw: tc.arguments };
  }

  events.emit("tool.called", {
    ...createBaseEvent(sessionId),
    name: tc.name,
    input,
  });
  events.emit("tool", {
    ...createBaseEvent(sessionId),
    name: tc.name,
    input,
  });

  let output: unknown;
  let error: Error | undefined;

  if (!def) {
    error = new Error(`Unknown tool: ${tc.name}`);
    output = { error: error.message };
  } else if (signal?.aborted) {
    error = new Error("Tool aborted");
    output = { error: error.message };
  } else {
    try {
      const abort = new AbortController();
      if (signal) {
        if (signal.aborted) abort.abort();
        else {
          signal.addEventListener("abort", () => abort.abort(), {
            once: true,
          });
        }
      }
      const toolTimeout = ctx.policies.toolTimeoutMs;
      const exec = def.execute(input, {
        sessionId,
        signal: abort.signal,
      });
      if (toolTimeout != null && toolTimeout > 0) {
        output = await Promise.race([
          Promise.resolve(exec),
          new Promise<never>((_, reject) => {
            const t = setTimeout(() => {
              abort.abort();
              reject(new Error(`Tool timed out after ${toolTimeout}ms`));
            }, toolTimeout);
            abort.signal.addEventListener(
              "abort",
              () => clearTimeout(t),
              { once: true },
            );
          }),
        ]);
      } else {
        output = await exec;
      }
    } catch (err) {
      error = err instanceof Error ? err : new Error(String(err));
      output = { error: error.message };
    }
  }

  events.emit("tool.completed", {
    ...createBaseEvent(sessionId),
    name: tc.name,
    input,
    output,
    error,
  });

  ctx.messages.push({
    role: "tool",
    content: JSON.stringify(output),
    name: tc.name,
    toolCallId: tc.id,
  });
}
