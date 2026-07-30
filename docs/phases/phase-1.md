# Phase 1 — Core real-time path

**Status: complete**

**Goal:** Ship the minimal complete loop for a TypeScript voice agent.

## Scope

| Area | Deliverable | Status |
| ---- | ----------- | ------ |
| Transport | WebRTC (SDP/ICE helpers + data channel) | Done |
| Transport | WebSocket | Done |
| STT | OpenAI streaming (partial + final) + realtime mode | Done |
| LLM | Groq | Done |
| TTS | Cartesia | Done |
| Runtime | Event system | Done |
| Agents | Tool calling + interrupt | Done |
| DX | Offline fakes, tests, basic example | Done |

## Packages

- `@thisux/voice-core`
- `@thisux/voice-events`
- `@thisux/voice-state-machine`
- `@thisux/voice-session`
- `@thisux/voice-transport-webrtc`
- `@thisux/voice-transport-websocket`
- `@thisux/voice-provider-openai`
- `@thisux/voice-provider-groq`
- `@thisux/voice-provider-cartesia`
- `@thisux/voice` (umbrella)

## Acceptance criteria

1. `createVoice({ transport, stt, llm, tts })` connects and runs a turn. ✅
2. Partial + final transcripts emit correctly. ✅
3. Tools register, execute, and feed results back to the LLM. ✅
4. Session state machine covers `idle` → `closed` happy path + `interrupted`. ✅
5. Example app runs (live keys or offline fallback). ✅

## Run

```bash
bun run build && bun run test
bun run examples/basic/src/index.ts
bun run examples/offline-launch/src/index.ts
```
