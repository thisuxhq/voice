export { createVoice } from "./create-voice.js";
export { runTurn } from "./pipeline.js";
export {
  resolveBargeIn,
  pcmS16leRms,
  createBargeInDetector,
} from "./barge-in.js";
export type { ResolvedBargeIn } from "./barge-in.js";
export { createSentenceFlusher } from "./sentence-flush.js";
export type {
  CreateVoiceOptions,
  BargeInOptions,
  TtsStreamingOptions,
  SessionPolicies,
  VoiceAgent,
  Middleware,
  ToolDefinition,
  ToolContext,
  Message,
  ToolCall,
  LLMChunk,
  LLMOptions,
  STTProvider,
  LLMProvider,
  TTSProvider,
  TransportProvider,
} from "./types.js";

export type {
  EventMap,
  VoiceEventName,
  TranscriptEvent,
  ToolEvent,
  SessionEvent,
  ErrorEvent,
} from "@thisux/voice-events";

export type { Session, SessionState } from "@thisux/voice-session";

export {
  createFakeTransport,
  createFakeSTT,
  createFakeLLM,
  createFakeTTS,
  createEchoLLM,
} from "./testing/index.js";
export type {
  FakeTransport,
  FakeSTT,
  FakeLLM,
  FakeTTS,
  FakeTTSOptions,
  LlmScriptStep,
} from "./testing/index.js";
