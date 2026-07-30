# Product Requirements Document (PRD)

## Product name

**THISUX Voice**

**Tagline**

> Build real-time voice agents in TypeScript.

---

## Problem statement

Today’s voice stack is fragmented. A developer must manage:

- WebRTC and WebSockets
- Session management
- Voice activity detection
- Audio encoding
- Speech-to-text (STT)
- Large language models (LLMs)
- Tool execution
- Text-to-speech (TTS)
- Memory
- Logging and observability
- Interruptions
- Reconnection logic

Most existing frameworks are Python-centric.

**Positioning:** match infrastructure SDK DX (Resend, UploadThing, Unstorage, Better Auth) — not “assemble a telephony stack.” See [dx.md](./dx.md).

---

## Goals

### Primary

- TypeScript-first
- Hono support
- Cloudflare support
- Edge-compatible architecture
- Provider independence
- Event-driven architecture
- Extremely low latency
- Simple developer experience (Resend / Unstorage-class happy path)

### Secondary

- SIP support
- Twilio support
- Video support
- Multi-agent support
- Local inference support

### Non-goals

- Training speech models
- Building GPUs
- Building a proprietary foundation model
- Building a telephony network

---

## Personas

See [personas.md](./personas.md).

---

## Supported providers (target)

See [providers.md](./providers.md).

---

## Public API

See [api.md](./api.md).

---

## Architecture

See [architecture.md](./architecture.md).

---

## Roadmap

| Phase | Summary |
| ----- | ------- |
| [Phase 1](./phases/phase-1.md) | Core path: WebRTC + OpenAI STT + Groq + Cartesia + events + tools |
| [Phase 2](./phases/phase-2.md) | ElevenLabs, Twilio, SIP, metrics, logging |
| [Phase 3](./phases/phase-3.md) | Video, avatars, multi-agent |

---

## Success criteria (v1)

1. A developer can stand up a duplex voice agent in under 50 lines of TypeScript.
2. Swapping any one provider (STT / LLM / TTS) requires only a config change.
3. Partial transcripts, tool calls, and speech events are all observable via `voice.on(...)`.
4. Interruptions cancel TTS/tool work without dropping session state.
5. Core packages run on Node and Cloudflare Workers (edge-compatible types, no Node-only APIs in `core`).
