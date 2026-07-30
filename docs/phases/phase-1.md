# Phase 1 — Core real-time path

**Goal:** Ship the minimal complete loop for a TypeScript voice agent.

## Scope

| Area | Deliverable |
| ---- | ----------- |
| Transport | WebRTC |
| STT | OpenAI |
| LLM | Groq |
| TTS | Cartesia |
| Runtime | Event system |
| Agents | Tool calling |

## Packages

- `@thisux/voice-core`
- `@thisux/voice-events`
- `@thisux/voice-state-machine`
- `@thisux/voice-session`
- `@thisux/voice-transport-webrtc`
- `@thisux/voice-provider-openai`
- `@thisux/voice-provider-groq`
- `@thisux/voice-provider-cartesia`

## Acceptance criteria

1. `createVoice({ transport, stt, llm, tts })` connects and runs a turn.
2. Partial + final transcripts emit correctly.
3. Tools register, execute, and feed results back to the LLM.
4. Session state machine covers `idle` → `closed` happy path + `interrupted`.
5. Example app runs with env keys for OpenAI, Groq, and Cartesia.

## Out of scope (this phase)

- ElevenLabs, Twilio, SIP
- Metrics / structured logging middleware
- Video / multi-agent
