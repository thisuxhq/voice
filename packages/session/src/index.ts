import {
  createStateMachine,
  type SessionState,
  type StateMachine,
} from "@thisux/voice-state-machine";

export type { SessionState };

export interface Session {
  id: string;
  state: SessionState;
  metadata: Record<string, unknown>;
  startedAt: number;
}

export interface SessionManagerOptions {
  id?: string;
  metadata?: Record<string, unknown>;
  initialState?: SessionState;
}

export class SessionManager {
  readonly id: string;
  readonly startedAt: number;
  #metadata: Record<string, unknown>;
  #machine: StateMachine;

  constructor(options: SessionManagerOptions = {}) {
    this.id = options.id ?? crypto.randomUUID();
    this.startedAt = Date.now();
    this.#metadata = { ...(options.metadata ?? {}) };
    this.#machine = createStateMachine(options.initialState ?? "idle");
  }

  get state(): SessionState {
    return this.#machine.state;
  }

  get metadata(): Record<string, unknown> {
    return this.#metadata;
  }

  get snapshot(): Session {
    return {
      id: this.id,
      state: this.state,
      metadata: { ...this.#metadata },
      startedAt: this.startedAt,
    };
  }

  setMetadata(key: string, value: unknown): void {
    this.#metadata[key] = value;
  }

  transition(to: SessionState): SessionState {
    return this.#machine.transition(to);
  }

  tryTransition(to: SessionState): boolean {
    return this.#machine.tryTransition(to);
  }

  can(to: SessionState): boolean {
    return this.#machine.can(to);
  }

  onTransition(
    listener: (from: SessionState, to: SessionState) => void,
  ): () => void {
    return this.#machine.onTransition(listener);
  }

  get machine(): StateMachine {
    return this.#machine;
  }
}

export function createSession(
  options?: SessionManagerOptions,
): SessionManager {
  return new SessionManager(options);
}
