import {
  createBaseEvent,
  type TypedEmitter,
  type EventMap,
} from "@thisux/voice-events";
import type {
  InternalVoiceContext,
  LLMChunk,
  Message,
  ToolCall,
} from "./types.js";

/**
 * Run one agent turn from a final user transcript:
 * LLM → optional tools → LLM → TTS → transport.
 */
export async function runTurn(
  ctx: InternalVoiceContext,
  events: TypedEmitter<EventMap>,
  userText: string,
): Promise<void> {
  const sessionId = ctx.sessionManager.id;
  const signal = ctx.abortController?.signal;

  ctx.messages.push({ role: "user", content: userText });
  ctx.sessionManager.tryTransition("thinking");

  events.emit("llm.started", {
    ...createBaseEvent(sessionId),
  });

  let assistantText = "";
  const pendingToolCalls: ToolCall[] = [];

  for await (const chunk of ctx.llm.generate(ctx.messages, {
    tools: [...ctx.tools.values()],
    signal,
  })) {
    if (signal?.aborted) break;
    await handleChunk(chunk, {
      onText: (text) => {
        assistantText += text;
      },
      onToolCall: (tc) => {
        pendingToolCalls.push(tc);
      },
    });
  }

  events.emit("llm.completed", {
    ...createBaseEvent(sessionId),
  });

  if (signal?.aborted) return;

  // Tool loop (single round for Phase 1)
  if (pendingToolCalls.length > 0) {
    const assistantMsg: Message = {
      role: "assistant",
      content: assistantText,
      toolCalls: pendingToolCalls,
    };
    ctx.messages.push(assistantMsg);

    for (const tc of pendingToolCalls) {
      if (signal?.aborted) return;
      await executeTool(ctx, events, tc, signal);
    }

    // Second LLM pass after tools
    events.emit("llm.started", { ...createBaseEvent(sessionId) });
    assistantText = "";
    for await (const chunk of ctx.llm.generate(ctx.messages, {
      tools: [...ctx.tools.values()],
      signal,
    })) {
      if (signal?.aborted) break;
      await handleChunk(chunk, {
        onText: (text) => {
          assistantText += text;
        },
        onToolCall: () => {
          // Phase 1: ignore nested tool calls after first round
        },
      });
    }
    events.emit("llm.completed", { ...createBaseEvent(sessionId) });
  }

  if (signal?.aborted || !assistantText.trim()) return;

  ctx.messages.push({ role: "assistant", content: assistantText });

  // TTS
  ctx.sessionManager.tryTransition("speaking");
  events.emit("tts.started", {
    ...createBaseEvent(sessionId),
    text: assistantText,
  });
  events.emit("speech.started", {
    ...createBaseEvent(sessionId),
    role: "assistant",
  });

  try {
    for await (const audio of ctx.tts.speak(assistantText, { signal })) {
      if (signal?.aborted) break;
      ctx.transport.send(audio);
    }
  } finally {
    events.emit("tts.completed", {
      ...createBaseEvent(sessionId),
      text: assistantText,
    });
    events.emit("speech.stopped", {
      ...createBaseEvent(sessionId),
      role: "assistant",
    });
    if (!signal?.aborted) {
      ctx.sessionManager.tryTransition("listening");
    }
  }
}

async function handleChunk(
  chunk: LLMChunk,
  handlers: {
    onText: (text: string) => void;
    onToolCall: (tc: ToolCall) => void;
  },
): Promise<void> {
  if (chunk.type === "text" && chunk.text) {
    handlers.onText(chunk.text);
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
  } else {
    try {
      const abort = new AbortController();
      if (signal) {
        signal.addEventListener("abort", () => abort.abort(), { once: true });
      }
      output = await def.execute(input, {
        sessionId,
        signal: abort.signal,
      });
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
