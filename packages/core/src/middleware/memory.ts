import type { Message, Middleware } from "../types.js";

export interface MemoryStore {
  /** Load prior messages for a session. */
  get(sessionId: string): Promise<Message[]> | Message[];
  /** Persist the message list. */
  set(sessionId: string, messages: Message[]): Promise<void> | void;
  /** Optional: compress old turns before set. */
  summarize?(messages: Message[]): Promise<Message[]> | Message[];
}

export interface MemoryMiddlewareOptions {
  store: MemoryStore;
  /**
   * `turn` = after each `tts.completed` (default).
   * `disconnect` = only on `session.closed`.
   */
  persistOn?: "turn" | "disconnect";
}

/**
 * Memory middleware — load history on connect, persist via your store.
 * Real Redis/Postgres drivers implement `MemoryStore`.
 *
 * Requires the agent to expose message accessors (wired in `createVoice`).
 */
export function memory(options: MemoryMiddlewareOptions): Middleware {
  const persistOn = options.persistOn ?? "turn";

  return async (voice, next) => {
    const accessors = getMessageAccessors(voice);
    const sessionId = voice.session.id;

    try {
      const prior = await options.store.get(sessionId);
      if (Array.isArray(prior) && prior.length > 0 && accessors) {
        accessors.replaceMessages(prior);
      }
    } catch (err) {
      voice.events.emit("error", {
        id: crypto.randomUUID(),
        sessionId,
        timestamp: Date.now(),
        error: err instanceof Error ? err : new Error(String(err)),
        fatal: false,
      });
    }

    const doPersist = () => {
      if (!accessors) return;
      void (async () => {
        try {
          let messages = accessors.getMessages();
          if (options.store.summarize) {
            messages = await options.store.summarize(messages);
          }
          await options.store.set(voice.session.id, messages);
        } catch (err) {
          voice.events.emit("error", {
            id: crypto.randomUUID(),
            sessionId: voice.session.id,
            timestamp: Date.now(),
            error: err instanceof Error ? err : new Error(String(err)),
            fatal: false,
          });
        }
      })();
    };

    const unsubTurn =
      persistOn === "turn"
        ? voice.on("tts.completed", () => doPersist())
        : undefined;

    const unsubClose = voice.on("session.closed", () => {
      doPersist();
      unsubTurn?.();
      unsubClose();
    });

    await next();
  };
}

/** In-memory store for tests and local demos. */
export function createInMemoryStore(): MemoryStore & {
  readonly data: Map<string, Message[]>;
} {
  const data = new Map<string, Message[]>();
  return {
    data,
    get(sessionId) {
      return data.get(sessionId)?.map((m) => ({ ...m })) ?? [];
    },
    set(sessionId, messages) {
      data.set(
        sessionId,
        messages.map((m) => ({ ...m })),
      );
    },
  };
}

/** @internal */
export interface MessageAccessors {
  getMessages(): Message[];
  replaceMessages(messages: Message[]): void;
}

const accessorsKey = "__voiceMessageAccessors" as const;

export function attachMessageAccessors(
  voice: object,
  accessors: MessageAccessors,
): void {
  Object.defineProperty(voice, accessorsKey, {
    value: accessors,
    enumerable: false,
    configurable: true,
  });
}

function getMessageAccessors(voice: object): MessageAccessors | undefined {
  return (voice as Record<string, unknown>)[accessorsKey] as
    | MessageAccessors
    | undefined;
}
