/**
 * @thisux/voice — single-install entry for Phase 1 + Phase 2.
 *
 * Prefer deep imports (`@thisux/voice-core`, `@thisux/voice-provider-groq`, …)
 * for tree-shaking in production apps.
 */

// Core
export {
  createVoice,
  runTurn,
  createFakeTransport,
  createFakeSTT,
  createFakeLLM,
  createFakeTTS,
  createEchoLLM,
  memory,
  createInMemoryStore,
  safety,
} from "@thisux/voice-core";
export type {
  CreateVoiceOptions,
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
  Session,
  SessionState,
  EventMap,
  VoiceEventName,
  MemoryStore,
  MemoryMiddlewareOptions,
  SafetyCheckResult,
  SafetyMiddlewareOptions,
  SessionPolicies,
  BargeInOptions,
  DuplexOptions,
  TtsStreamingOptions,
} from "@thisux/voice-core";

// Transports
export { webrtc } from "@thisux/voice-transport-webrtc";
export type {
  WebRTCTransport,
  WebRTCSignal,
  WebRTCTransportOptions,
} from "@thisux/voice-transport-webrtc";

export { websocket } from "@thisux/voice-transport-websocket";
export type {
  WebSocketTransport,
  WebSocketTransportOptions,
} from "@thisux/voice-transport-websocket";

export { sip, createMemorySipSignaling } from "@thisux/voice-transport-sip";
export type {
  SipTransport,
  SipTransportOptions,
  SipCallState,
  SipSignalingAdapter,
} from "@thisux/voice-transport-sip";

// Providers
export {
  openai,
  openaiStt,
  openaiLlm,
  openaiTts,
} from "@thisux/voice-provider-openai";
export type { OpenAIOptions } from "@thisux/voice-provider-openai";

export { groq } from "@thisux/voice-provider-groq";
export type { GroqOptions } from "@thisux/voice-provider-groq";

export { cartesia } from "@thisux/voice-provider-cartesia";
export type { CartesiaOptions } from "@thisux/voice-provider-cartesia";

export { elevenlabs } from "@thisux/voice-provider-elevenlabs";
export type { ElevenLabsOptions } from "@thisux/voice-provider-elevenlabs";

// Twilio
export {
  twilioMediaStream,
  twilioStreamTwiml,
  mulawToPcm16,
} from "@thisux/voice-plugin-twilio";
export type {
  TwilioMediaStreamOptions,
  TwilioMediaStreamTransport,
} from "@thisux/voice-plugin-twilio";

// Observability
export { logger, metrics } from "@thisux/voice-observability";
export type {
  LoggerOptions,
  MetricsOptions,
  MetricEvent,
  MetricsSnapshot,
  LogLevel,
} from "@thisux/voice-observability";
