# Architecture

## High-level stack

```text
Application
      │
      ▼
THISUX Voice SDK
      │
      ▼
Session manager
      │
      ▼
Pipeline engine
      │
      ▼
Provider adapters
      │
      ▼
Infrastructure layer
```

## Layers

| Layer | Responsibility |
| ----- | -------------- |
| **Application** | Agent config, tools, business logic |
| **SDK (`createVoice`)** | Public API, middleware, event bus |
| **Session manager** | Lifecycle, state machine, reconnection |
| **Pipeline engine** | Audio → STT → LLM → tools → TTS loop |
| **Provider adapters** | STT / LLM / TTS / transport / memory |
| **Infrastructure** | Cloudflare, Redis, Postgres, R2/S3 |

## Runtime flow

```text
Microphone
  → noise suppression / VAD / resample / encode
  → STT provider (partial + final transcripts)
  → LLM (streamed tokens + optional tool calls)
  → tool executor (if needed) → LLM again
  → TTS provider (audio stream)
  → transport (WebRTC / WebSocket / …)
  → speaker
```

Interruptions short-circuit remaining TTS and in-flight tools; session state is preserved. Default duplex **adapts** mid-turn (`speaking → thinking`) instead of restarting from `listening`. See [interruptions.md](./interruptions.md).

## Package map

```text
packages/
├── core                 # createVoice, pipeline, tools, middleware
├── events               # typed EventEmitter
├── observability        # metrics + logging hooks (Phase 2)
├── state-machine        # session states + transitions
├── session              # Session model + manager
├── transport-webrtc     # WebRTC transport (Phase 1)
├── transport-websocket  # WebSocket transport
├── provider-openai      # STT / LLM / TTS (OpenAI)
├── provider-groq        # LLM (Phase 1)
├── provider-elevenlabs  # TTS (Phase 2)
├── provider-cartesia    # TTS (Phase 1)
├── provider-deepgram    # STT
├── memory-redis
├── memory-postgres
├── plugin-twilio        # Phase 2
├── plugin-daily
└── examples
```

## Design constraints

1. **Edge-compatible core** — no Node-only APIs in `@thisux/voice-core`.
2. **Provider interfaces only in core** — concrete SDKs live in provider packages.
3. **Event IDs on every emit** — de-dupe across reconnects.
4. **State machine is source of truth** for session lifecycle.
5. **Streams everywhere** — prefer async iterators / ReadableStreams over buffers.

## Related docs

- [Session model](./session.md)
- [Events](./events.md)
- [Audio pipeline](./audio-pipeline.md)
- [Tools](./tools.md)
- [Infrastructure](./infrastructure.md)
