export type EventHandler<T = unknown> = (payload: T) => void | Promise<void>;

export interface EventMap {
  // Session
  "session.started": SessionEvent;
  "session.closed": SessionEvent;
  "session.idle": SessionEvent;
  "session.reconnecting": SessionEvent;
  "session.resumed": SessionEvent;
  connected: SessionEvent;
  error: ErrorEvent;

  // Speech
  "speech.started": SpeechEvent;
  "speech.stopped": SpeechEvent;
  "speech.barge_in": BargeInEvent;
  speech: SpeechEvent;

  // Full duplex
  "duplex.overlap": DuplexOverlapEvent;

  // Transcript
  "transcript.partial": TranscriptEvent;
  "transcript.final": TranscriptEvent;
  transcript: TranscriptEvent;

  // LLM
  "llm.started": LlmEvent;
  "llm.completed": LlmEvent;

  // Tools
  "tool.called": ToolEvent;
  "tool.completed": ToolEvent;
  tool: ToolEvent;

  // TTS
  "tts.started": TtsEvent;
  "tts.completed": TtsEvent;
}

export interface BaseEvent {
  id: string;
  sessionId: string;
  timestamp: number;
}

export interface SessionEvent extends BaseEvent {
  state?: string;
}

export interface ErrorEvent extends BaseEvent {
  error: Error;
  fatal?: boolean;
}

export interface SpeechEvent extends BaseEvent {
  role: "user" | "assistant";
}

export interface BargeInEvent extends SpeechEvent {
  /** How the session will treat this barge-in. */
  mode: "adapt" | "interrupt";
}

export interface DuplexOverlapEvent extends BaseEvent {
  /** Overlapping user transcript that the agent will adapt to. */
  text: string;
  /** Assistant speech already played in this turn, if any. */
  spoken?: string;
}

export interface TranscriptEvent extends BaseEvent {
  text: string;
  isFinal: boolean;
}

export interface LlmEvent extends BaseEvent {
  messageId?: string;
}

export interface ToolEvent extends BaseEvent {
  name: string;
  input?: unknown;
  output?: unknown;
  error?: Error;
}

export interface TtsEvent extends BaseEvent {
  text?: string;
}

export type VoiceEventName = keyof EventMap;

export class TypedEmitter<TEvents extends object = EventMap> {
  #handlers = new Map<keyof TEvents & string, Set<EventHandler<never>>>();

  on<K extends keyof TEvents & string>(
    event: K,
    handler: EventHandler<TEvents[K]>,
  ): () => void {
    let set = this.#handlers.get(event);
    if (!set) {
      set = new Set();
      this.#handlers.set(event, set);
    }
    set.add(handler as EventHandler<never>);
    return () => this.off(event, handler);
  }

  off<K extends keyof TEvents & string>(
    event: K,
    handler: EventHandler<TEvents[K]>,
  ): void {
    this.#handlers.get(event)?.delete(handler as EventHandler<never>);
  }

  once<K extends keyof TEvents & string>(
    event: K,
    handler: EventHandler<TEvents[K]>,
  ): () => void {
    const wrap: EventHandler<TEvents[K]> = (payload) => {
      this.off(event, wrap);
      return handler(payload);
    };
    return this.on(event, wrap);
  }

  emit<K extends keyof TEvents & string>(event: K, payload: TEvents[K]): void {
    const set = this.#handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        void (handler as EventHandler<TEvents[K]>)(payload);
      } catch (err) {
        // Never let a listener crash the emitter
        console.error(`[voice-events] handler error for ${String(event)}:`, err);
      }
    }
  }

  removeAllListeners(event?: keyof TEvents & string): void {
    if (event !== undefined) {
      this.#handlers.delete(event);
      return;
    }
    this.#handlers.clear();
  }

  listenerCount(event: keyof TEvents & string): number {
    return this.#handlers.get(event)?.size ?? 0;
  }
}

export function createEventId(): string {
  return crypto.randomUUID();
}

export function createBaseEvent(sessionId: string): BaseEvent {
  return {
    id: createEventId(),
    sessionId,
    timestamp: Date.now(),
  };
}
