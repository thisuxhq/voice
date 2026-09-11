# AGENTS.md

Guidance for coding agents working in **THISUX Voice** (`thisuxhq/voice`).

Read this first, then open only the `docs/` pages you need for the task.

---

## Project overview

TypeScript-first **SDK** for real-time voice agents — not a hosted product, dashboard, or Python pipeline.

**DX category:** Resend (email) · UploadThing (files) · Unstorage (storage) · Better Auth (auth) → **THISUX Voice (voice)**.

```ts
const voice = createVoice({
  transport: webrtc(),
  stt: openai(),
  llm: groq(),
  tts: cartesia(), // or elevenlabs()
});
voice.use(logger());
voice.use(metrics());
voice.tool({ name: "…", execute });
await voice.connect();
```

**Phases 1–2 are implemented.** Phase 3 (video, avatars, multi-agent) is not.

Repo: https://github.com/thisuxhq/voice

---

## Critical rules

1. **Scope** — Keep changes to the requested package(s). Do not refactor unrelated code.
2. **Bun** — Use Bun from the repo root (`bun install`, `bun run build`, `bun run test`).
3. **Provider independence** — Core must not hard-depend on a single STT/LLM/TTS vendor. New vendors = new packages implementing existing interfaces.
4. **Edge-safe core** — `@thisux/voice-core` must stay free of Node-only APIs (no `fs`, no Node `Buffer` required at runtime for core paths).
5. **Tests gate offline** — Do not require live OpenAI/Groq/Cartesia/ElevenLabs keys for the default suite. Use fakes (`createFake*` / `@thisux/voice-core` testing exports) or inject `fetch` / `WebSocket`.
6. **Exclude tests from `tsc` emit** — Package `tsconfig.json` must `"exclude": ["src/**/*.test.ts"]` so `bun run build` does not compile tests into `dist/`.
7. **Root build filter** — `build` runs `./packages/*` only (examples have no build script).
8. **Docs live under `docs/`** — Root stays thin (`README.md`, `AGENTS.md`, config). Update `docs/` when behavior or packages change.
9. **No secrets in git** — Use `.env` (gitignored); only `.env.example` is committed.
10. **Non-goals** — Do not train models, build GPUs, own a telephony network, or invent a proprietary foundation model.

---

## Repo map

```text
packages/
  voice/                 # @thisux/voice — umbrella re-exports
  core/                  # createVoice, pipeline, tools, types, fakes
  events/                # TypedEmitter + event catalog
  state-machine/         # SessionState transitions
  session/               # SessionManager
  observability/         # logger(), metrics()
  transport-webrtc/      # WebRTC + SDP/ICE helpers
  transport-websocket/   # Duplex WS frames
  transport-sip/         # SIP lifecycle + signaling adapter
  provider-openai/       # STT (+ llm/tts helpers)
  provider-groq/         # LLM
  provider-cartesia/     # TTS
  provider-elevenlabs/   # TTS
  plugin-twilio/         # Media Streams bridge + TwiML helper
examples/
  basic/                 # Live keys or offline fallback
  offline-launch/        # Deterministic offline consumer
  phase2-demo/           # SIP + Twilio helpers + observability
  web-playground/        # Hono + JSX sample app (http://localhost:8787)
docs/                    # Vision, PRD, architecture, phases, DX
```

Package names: `@thisux/voice-*` (plus umbrella `@thisux/voice`).

---

## Commands

```bash
# from repo root
bun install
bun run build          # all packages under packages/*
bun run test           # bun test packages/*/src
bun run typecheck      # tsc --noEmit per package
bun run clean          # wipe dist/

# demos (no live keys required unless noted)
bun run examples/offline-launch/src/index.ts   # → VOICE_OFFLINE_OK
bun run examples/phase2-demo/src/index.ts      # → PHASE2_DEMO_OK
bun run examples/basic/src/index.ts            # offline fallback without keys

# Hono + JSX web playground
cd examples/web-playground && bun run dev      # → http://localhost:8787
```

Live providers (optional):

```bash
cp .env.example .env
# OPENAI_API_KEY, GROQ_API_KEY, CARTESIA_API_KEY, ELEVENLABS_API_KEY, …
```

---

## Architecture (short)

```text
App → createVoice → session + state machine
                 → pipeline: audio → STT → LLM → tools? → LLM → TTS → transport
                 → events + middleware (logger/metrics)
```

| Layer | Responsibility |
| ----- | -------------- |
| **Interfaces** | `STTProvider`, `LLMProvider`, `TTSProvider`, `TransportProvider` in `core` |
| **Pipeline** | `runTurn` — one user utterance through tools/TTS |
| **Session** | `idle → connecting → connected → listening → thinking → speaking → … → closed` |
| **Interrupt** | AbortSignal + `tts.abort()`; duplex **adapt** (`speaking → thinking`) or hard `interrupted` → `listening` |

Details: [docs/architecture.md](docs/architecture.md), [docs/api.md](docs/api.md), [docs/events.md](docs/events.md).

---

## Conventions

### Adding a provider

1. New package `packages/provider-<name>` → `@thisux/voice-provider-<name>`.
2. Implement the interface from `@thisux/voice-core`.
3. Factory export: `export function deepgram(opts): STTProvider` (or llm/tts).
4. Optional re-export from `packages/voice/src/index.ts`.
5. Unit test with mocked `fetch` / streams (no live keys).
6. Note in `docs/providers.md` and phase docs if it closes a roadmap item.

### Adding transport / plugin

1. `packages/transport-*` or `packages/plugin-*`.
2. Implement `TransportProvider` (`connect` / `disconnect` / `send` / `onAudio`).
3. Telephony plugins may parse vendor frames then `pushAudio` into the transport.

### Middleware

```ts
voice.use(async (voice, next) => {
  // attach voice.on(...) listeners, then:
  await next();
});
```

`logger()` and `metrics()` in `@thisux/voice-observability` are the reference pattern.

### Tests

- Place next to source: `src/*.test.ts`.
- Import **shipped** modules (package source or built entry), not re-implemented stubs of the unit under test.
- Prefer `createFakeTransport`, `createFakeSTT`, `createFakeLLM`, `createFakeTTS`, `createEchoLLM`.
- After changes: `bun run build && bun run test`.

### Commits

- Prefer focused commits; message describes *why*.
- Do not commit `dist/`, `node_modules/`, or `.env`.

---

## Documentation index

| Doc | When to read |
| --- | ------------ |
| [docs/README.md](docs/README.md) | Full docs index |
| [docs/vision.md](docs/vision.md) | Mission, principles |
| [docs/dx.md](docs/dx.md) | Competitor DX (Resend/UploadThing/Unstorage/Better Auth) |
| [docs/prd.md](docs/prd.md) | Requirements, non-goals |
| [docs/architecture.md](docs/architecture.md) | Layers + packages |
| [docs/api.md](docs/api.md) | Public API |
| [docs/providers.md](docs/providers.md) | Provider matrix + interfaces |
| [docs/session.md](docs/session.md) | Session states |
| [docs/events.md](docs/events.md) | Event catalog |
| [docs/tools.md](docs/tools.md) | Tool pipeline |
| [docs/interruptions.md](docs/interruptions.md) | Barge-in |
| [docs/observability.md](docs/observability.md) | Metrics / logging |
| [docs/phases/phase-1.md](docs/phases/phase-1.md) | ✅ Core loop |
| [docs/phases/phase-2.md](docs/phases/phase-2.md) | ✅ Telephony + observability |
| [docs/phases/phase-2.5.md](docs/phases/phase-2.5.md) | 🔄 Duplex + latency (barge-in, streamed TTS, policies) |
| [docs/phases/phase-3.md](docs/phases/phase-3.md) | Video / avatars / multi-agent |
| [docs/repository.md](docs/repository.md) | Monorepo layout |

---

## Current status (agent checklist)

**Done (do not re-scaffold unless asked):**

- Core agent loop, tools, interrupt, state machine, events  
- OpenAI STT (streaming + realtime mode), Groq, Cartesia, ElevenLabs  
- WebRTC, WebSocket, SIP (adapter + memory demo), Twilio Media Streams  
- `logger` / `metrics`, umbrella `@thisux/voice`, offline examples + tests  

**Not done (Phase 3+ / product):**

- Video, avatars, multi-agent workflows  
- Deepgram / AssemblyAI / more memory drivers  
- Production JsSIP wiring (adapter hook exists; memory adapter for tests)  
- npm publish, hosted service, dashboard  

---

## Quick verification

Before claiming work complete:

```bash
bun run build && bun run test
bun run examples/offline-launch/src/index.ts
# expect: VOICE_OFFLINE_OK session=…
```
