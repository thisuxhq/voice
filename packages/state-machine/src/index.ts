export type SessionState =
  | "idle"
  | "connecting"
  | "connected"
  | "listening"
  | "thinking"
  | "speaking"
  | "interrupted"
  | "reconnecting"
  | "failed"
  | "closed";

/** Allowed transitions: from → to[] */
export const TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  idle: ["connecting", "closed"],
  connecting: ["connected", "failed", "closed"],
  connected: ["listening", "reconnecting", "failed", "closed"],
  listening: ["thinking", "interrupted", "reconnecting", "failed", "closed"],
  thinking: ["speaking", "listening", "interrupted", "failed", "closed"],
  speaking: ["listening", "interrupted", "thinking", "failed", "closed"],
  interrupted: ["listening", "thinking", "failed", "closed"],
  reconnecting: ["connected", "failed", "closed"],
  failed: ["closed", "connecting"],
  closed: [],
};

export class InvalidTransitionError extends Error {
  readonly from: SessionState;
  readonly to: SessionState;

  constructor(from: SessionState, to: SessionState) {
    super(`Invalid session transition: ${from} → ${to}`);
    this.name = "InvalidTransitionError";
    this.from = from;
    this.to = to;
  }
}

export type TransitionListener = (
  from: SessionState,
  to: SessionState,
) => void;

export class StateMachine {
  #state: SessionState;
  #listeners = new Set<TransitionListener>();

  constructor(initial: SessionState = "idle") {
    this.#state = initial;
  }

  get state(): SessionState {
    return this.#state;
  }

  can(to: SessionState): boolean {
    return TRANSITIONS[this.#state].includes(to);
  }

  transition(to: SessionState): SessionState {
    if (!this.can(to)) {
      throw new InvalidTransitionError(this.#state, to);
    }
    const from = this.#state;
    this.#state = to;
    for (const listener of this.#listeners) {
      listener(from, to);
    }
    return this.#state;
  }

  /**
   * Transition if allowed; no-op otherwise.
   * Useful for best-effort moves (e.g. interrupt while already listening).
   */
  tryTransition(to: SessionState): boolean {
    if (!this.can(to)) return false;
    this.transition(to);
    return true;
  }

  onTransition(listener: TransitionListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Force state (tests / recovery only). Prefer transition(). */
  reset(state: SessionState = "idle"): void {
    this.#state = state;
  }
}

export function createStateMachine(initial?: SessionState): StateMachine {
  return new StateMachine(initial);
}
