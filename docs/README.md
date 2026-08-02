# THISUX Voice — Documentation

TypeScript-first framework for real-time voice agents.

> Build real-time voice agents in TypeScript.

## Docs index

| Document | Description |
| -------- | ----------- |
| [Vision](./vision.md) | Product vision, principles, and long-term goal |
| [DX](./dx.md) | Competitor category (Resend / UploadThing / Unstorage / Better Auth) and DX rules |
| [PRD](./prd.md) | Full product requirements |
| [Architecture](./architecture.md) | System layers, pipeline, and package map |
| [Public API](./api.md) | `createVoice`, tools, middleware, lifecycle |
| [Providers](./providers.md) | STT / LLM / TTS / transport / memory / storage |
| [Session model](./session.md) | Session interface and state machine |
| [Events](./events.md) | Event-driven contract |
| [Audio pipeline](./audio-pipeline.md) | Mic → VAD → encode → provider |
| [Tools](./tools.md) | Tool registration and execution pipeline |
| [Interruptions](./interruptions.md) | Barge-in requirements and behavior |
| [Observability](./observability.md) | Latency, tokens, failures, retries |
| [Infrastructure](./infrastructure.md) | Cloudflare, DB, cache targets |
| [Edge cases](./edge-cases.md) | Failure modes and mitigations |
| [Personas](./personas.md) | Target users |
| [Repository structure](./repository.md) | Monorepo layout |

## Roadmap (three phases)

| Phase | Doc | Focus |
| ----- | --- | ----- |
| **1** | [Phase 1](./phases/phase-1.md) | ✅ WebRTC, OpenAI STT, Groq, Cartesia, events, tools |
| **2** | [Phase 2](./phases/phase-2.md) | ✅ ElevenLabs, Twilio, SIP, metrics, logging |
| **2.5** | [Phase 2.5](./phases/phase-2.5.md) | 🔄 Audio barge-in, streamed TTS, policies, parallel tools, reconnect |
| **3** | [Phase 3](./phases/phase-3.md) | Video, avatars, multi-agent workflows |

## Quick links

- Root product overview: [../README.md](../README.md)
- Package source: [../packages/](../packages/)
- Examples: [../examples/](../examples/)
