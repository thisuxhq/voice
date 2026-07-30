# Providers

Providers are interchangeable adapters behind stable interfaces.

## Target matrix

### STT

| Provider | Status |
| -------- | ------ |
| OpenAI | Phase 1 |
| Deepgram | Later |
| AssemblyAI | Later |
| Google | Later |

### LLM

| Provider | Status |
| -------- | ------ |
| Groq | Phase 1 |
| OpenAI | Phase 1+ |
| Anthropic | Later |
| Google | Later |

### TTS

| Provider | Status |
| -------- | ------ |
| Cartesia | Phase 1 |
| OpenAI | Later |
| ElevenLabs | Phase 2 |
| PlayAI | Later |

### Memory

- Redis
- PostgreSQL
- Cloudflare KV

### Storage

- R2
- S3

### Transport

| Transport | Status |
| --------- | ------ |
| WebRTC | Phase 1 |
| WebSockets | Phase 1+ |
| SIP | Phase 2 |
| Twilio | Phase 2 |
| Daily | Later |

## Interfaces

### STT

```ts
interface STTProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  transcribe(audio: Uint8Array): void;
  // emits partial / final transcripts via events or callbacks
}
```

### LLM

```ts
interface LLMProvider {
  generate(messages: Message[], options?: LLMOptions): AsyncIterable<LLMChunk>;
}
```

### TTS

```ts
interface TTSProvider {
  speak(text: string): AsyncIterable<Uint8Array>;
  abort?(): void;
}
```

### Transport

```ts
interface TransportProvider {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(data: Uint8Array): void;
  onAudio?(handler: (chunk: Uint8Array) => void): void;
}
```

## Package naming

```text
@thisux/voice-provider-openai
@thisux/voice-provider-groq
@thisux/voice-provider-cartesia
@thisux/voice-provider-elevenlabs
@thisux/voice-provider-deepgram
@thisux/voice-transport-webrtc
@thisux/voice-transport-websocket
```
