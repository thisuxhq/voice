import type { Middleware, ToolDefinition } from "../types.js";

export interface SafetyCheckResult {
  block: boolean;
  reason?: string;
}

export interface SafetyMiddlewareOptions {
  /** Return `{ block: true }` to skip the user turn. */
  checkTranscript?: (
    text: string,
    ctx: { sessionId: string },
  ) => SafetyCheckResult | Promise<SafetyCheckResult>;
  /** Return `{ block: true }` to skip a tool and return an error payload. */
  checkToolCall?: (
    name: string,
    input: Record<string, unknown>,
    ctx: { sessionId: string },
  ) => SafetyCheckResult | Promise<SafetyCheckResult>;
}

const toolWrapKey = "__voiceWrapTools" as const;

/** @internal — used by createVoice */
export type ToolWrapper = (definition: ToolDefinition) => ToolDefinition;

export function attachToolWrapper(
  voice: object,
  wrap: (wrapper: ToolWrapper) => void,
): void {
  Object.defineProperty(voice, toolWrapKey, {
    value: wrap,
    enumerable: false,
    configurable: true,
  });
}

function getToolWrap(voice: object): ((wrapper: ToolWrapper) => void) | undefined {
  return (voice as Record<string, unknown>)[toolWrapKey] as
    | ((wrapper: ToolWrapper) => void)
    | undefined;
}

/**
 * Stub safety middleware — gate transcripts and tool calls.
 * Wire a real moderator / allow-list later behind the same hooks.
 *
 * Wraps tools already registered and any registered after connect.
 */
export function safety(options: SafetyMiddlewareOptions): Middleware {
  return async (voice, next) => {
    const sessionId = () => voice.session.id;

    if (options.checkTranscript) {
      const originalSay = voice.say.bind(voice);
      voice.say = async (text: string) => {
        const result = await options.checkTranscript!(text, {
          sessionId: sessionId(),
        });
        if (result.block) {
          voice.events.emit("error", {
            id: crypto.randomUUID(),
            sessionId: sessionId(),
            timestamp: Date.now(),
            error: new Error(result.reason ?? "Blocked by safety policy"),
            fatal: false,
          });
          return;
        }
        return originalSay(text);
      };
    }

    if (options.checkToolCall) {
      const apply: ToolWrapper = (definition) => {
        const inner = definition.execute;
        return {
          ...definition,
          async execute(input, ctx) {
            const result = await options.checkToolCall!(
              definition.name,
              input,
              { sessionId: ctx.sessionId },
            );
            if (result.block) {
              const error = new Error(
                result.reason ?? `Tool blocked: ${definition.name}`,
              );
              voice.events.emit("error", {
                id: crypto.randomUUID(),
                sessionId: ctx.sessionId,
                timestamp: Date.now(),
                error,
                fatal: false,
              });
              return { error: error.message, blocked: true };
            }
            return inner(input, ctx);
          },
        };
      };

      const wrapAll = getToolWrap(voice);
      if (wrapAll) {
        wrapAll(apply);
      } else {
        // Fallback: only future registrations
        const originalTool = voice.tool.bind(voice);
        voice.tool = (definition: ToolDefinition) => {
          originalTool(apply(definition));
        };
      }
    }

    await next();
  };
}
