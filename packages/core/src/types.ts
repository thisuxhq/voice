import type { Session, SessionManager } from "@thisux/voice-session";
import type {
  EventMap,
  TypedEmitter,
  VoiceEventName,
  EventHandler,
} from "@thisux/voice-events";
import type { BargeInOptions } from "./barge-in.js";
import type { DuplexOptions, ResolvedDuplex } from "./duplex.js";

export type { BargeInOptions, DuplexOptions, ResolvedDuplex };
export type { DuplexOverlapMode } from "./duplex.js";

/** Chat message for LLM providers */
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMChunk {
  type: "text" | "tool_call" | "done";
  text?: string;
  toolCall?: ToolCall;
}

export interface LLMOptions {
  tools?: ToolDefinition[];
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
}

export interface ToolDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  execute: (
    input: Record<string, unknown>,
    ctx: ToolContext,
  ) => unknown | Promise<unknown>;
}

export interface ToolContext {
  sessionId: string;
  signal: AbortSignal;
}

export interface STTProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Push encoded audio; provider streams transcripts via callbacks */
  transcribe(audio: Uint8Array): void;
  onTranscript?(
    handler: (event: { text: string; isFinal: boolean }) => void,
  ): void | (() => void);
}

export interface LLMProvider {
  generate(
    messages: Message[],
    options?: LLMOptions,
  ): AsyncIterable<LLMChunk>;
}

export interface TTSProvider {
  speak(text: string, options?: { signal?: AbortSignal }): AsyncIterable<Uint8Array>;
  abort?(): void;
}

export type TransportConnectionState = "online" | "offline";

export interface TransportProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(data: Uint8Array): void;
  onAudio?(handler: (chunk: Uint8Array) => void): void | (() => void);
  /**
   * Optional connection lifecycle (Phase 2.5).
   * Emit `offline` on drop and `online` after the transport is usable again.
   * Core keeps `session.id` stable across reconnects.
   */
  onConnectionState?(
    handler: (state: TransportConnectionState) => void,
  ): void | (() => void);
}

export interface TtsStreamingOptions {
  /** Enable sentence-level TTS while the LLM streams. Default true. */
  enabled?: boolean;
  /** Force a flush after this many buffered chars. Default 180. */
  maxBufferChars?: number;
}

export interface SessionPolicies {
  /**
   * While listening, if no final user turn for N ms, emit `session.idle`
   * and optionally inject `silencePrompt` as a user turn once.
   * Default: off (`null`).
   */
  silenceTimeoutMs?: number | null;
  /** Text injected on silence timeout. Default "Are you still there?" */
  silencePrompt?: string;
  /** Race each tool execute vs this timeout (ms). Default 15000. `null` = off. */
  toolTimeoutMs?: number | null;
  /** Abort the whole turn after N ms. Default off (`null`). */
  maxTurnMs?: number | null;
}

export interface CreateVoiceOptions {
  transport: TransportProvider;
  stt: STTProvider;
  llm: LLMProvider;
  tts: TTSProvider;
  systemPrompt?: string;
  metadata?: Record<string, unknown>;
  /**
   * Interrupt when inbound mic energy is high while thinking/speaking.
   * Pass `false` to disable (push-to-talk / upstream barge-in).
   * Default: enabled with sensible energy defaults.
   */
  bargeIn?: boolean | BargeInOptions;
  /**
   * Full-duplex overlap policy. Default: listen while speaking and *adapt*
   * (cancel remaining outbound speech, continue thinking→speaking without
   * a listening restart). Pass `false` for classic barge-in interrupt.
   */
  duplex?: boolean | DuplexOptions;
  /**
   * Stream TTS per sentence as LLM tokens arrive (no tools pending).
   * Pass `false` to wait for the full assistant string. Default true.
   */
  ttsStreaming?: boolean | TtsStreamingOptions;
  /** Silence / tool / turn timeouts. */
  policies?: SessionPolicies;
  /** Max tool rounds per user turn. Default 3 (applied in parallel-tools layer). */
  maxToolRounds?: number;
}

export type Middleware = (
  voice: VoiceAgent,
  next: () => Promise<void>,
) => Promise<void>;

export interface VoiceAgent {
  readonly session: Session;
  readonly events: TypedEmitter<EventMap>;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  interrupt(): Promise<void>;

  on<K extends VoiceEventName>(
    event: K,
    handler: EventHandler<EventMap[K]>,
  ): () => void;

  tool(definition: ToolDefinition): void;
  use(middleware: Middleware): void;

  /** Push a text user turn (useful for tests / non-audio clients) */
  say(text: string): Promise<void>;
}

export interface ResolvedTtsStreaming {
  enabled: boolean;
  maxBufferChars: number;
}

export interface ResolvedPolicies {
  silenceTimeoutMs: number | null;
  silencePrompt: string;
  toolTimeoutMs: number | null;
  maxTurnMs: number | null;
}

export interface InternalVoiceContext {
  sessionManager: SessionManager;
  transport: TransportProvider;
  stt: STTProvider;
  llm: LLMProvider;
  tts: TTSProvider;
  tools: Map<string, ToolDefinition>;
  messages: Message[];
  systemPrompt: string;
  abortController: AbortController | null;
  ttsStreaming: ResolvedTtsStreaming;
  policies: ResolvedPolicies;
  maxToolRounds: number;
  duplex: ResolvedDuplex;
  /**
   * True while outbound speech was cancelled for an overlap and we are
   * waiting to continue (or for a final transcript after energy barge-in).
   */
  adapting: boolean;
  /** Assistant text already sent to TTS in the current turn. */
  spokenAssistantText: string;
}
