# Phase 2.5 — Premium duplex + latency

**Status: implemented (stacked PRs)**

**Goal:** Make the SDK *feel* like a production voice product without becoming one.
Close the highest-leverage gaps between Phase 1–2 (working agent loop) and ChatGPT-class duplex UX.

This is **not** Phase 3 (video / avatars / multi-agent). It is a hardening + latency pass on the core loop.

---

## Problem statement

Phases 1–2 delivered:

- `createVoice` + tools + events + state machine
- Provider swap (OpenAI STT, Groq, Cartesia, ElevenLabs)
- Transports (WebRTC, WebSocket, SIP, Twilio)
- Interrupt API (`voice.interrupt()` + AbortSignal)
- Observability middleware

What still feels half-duplex / high-latency:

1. Barge-in is API-driven, not audio-driven while the agent is speaking.
2. TTS waits for the full assistant string before speaking.
3. No session-level silence / turn / tool timeout policies.
4. Tools run sequentially, single round.
5. `reconnecting` exists in the state machine but is not driven by transport drops.
6. Memory / safety are docs-only — apps have no stub surface to hang real drivers on.

---

## Non-goals

- Owning DSP (full AEC, RNNoise, professional VAD models) inside core
- Back-channeling / emotion detectors (Phase 3+ plugins)
- Model router product
- Hosted voice gateway
- npm publish

Core stays **edge-safe** and **provider-independent**. Heavy audio DSP stays in transport adapters or app-land; core exposes hooks and light defaults.

---

## Stack (review bottom → top)

```text
main
 └── phase-2.5/plan              # this doc + docs index
  └── phase-2.5/audio-barge-in   # energy VAD → interrupt while speaking
   └── phase-2.5/streamed-tts    # LLM token → sentence flush → TTS
    └── phase-2.5/session-policies
     └── phase-2.5/parallel-tools
      └── phase-2.5/reconnect
       └── phase-2.5/middleware-stubs
```

Each layer is independently reviewable and keeps `bun run build && bun run test` green.

---

## Layer details

### 1. Plan (this PR)

- [x] `docs/phases/phase-2.5.md`
- [x] Link from `docs/README.md`, root `README.md` roadmap, `AGENTS.md`

### 2. Audio barge-in

**User value:** User talks over the agent → speech stops immediately.

| Piece | Design |
| ----- | ------ |
| API | `createVoice({ bargeIn?: boolean \| BargeInOptions })` default `true` |
| Detection | Lightweight PCM energy gate on inbound `transport.onAudio` while state is `speaking` or `thinking` |
| Action | Call existing `interrupt()` once threshold sustained |
| Opt-out | `bargeIn: false` for push-to-talk / telephony that handles barge-in upstream |
| Events | Existing `speech.stopped` (assistant); optional `speech.barge_in` later if needed |

```ts
interface BargeInOptions {
  /** RMS threshold 0–1 over int16 PCM. Default ~0.025 */
  energyThreshold?: number;
  /** Min consecutive “hot” frames before interrupt. Default 3 */
  minFrames?: number;
  /** Ignore first N ms of assistant audio (echo guard). Default 250 */
  graceMs?: number;
  /** Assume PCM s16le mono @ sampleRate. Default 16000 */
  sampleRate?: number;
}
```

**Tests:** fake transport pushes loud PCM while TTS is streaming → `tts.abort` + state `listening`.

**Out of scope here:** full AEC, WebRTC `getUserMedia` wiring (playground can follow).

### 3. Streamed TTS (sentence flush)

**User value:** Agent starts talking before the LLM finishes the whole answer.

| Piece | Design |
| ----- | ------ |
| Splitter | Buffer LLM text tokens; flush on sentence boundary (`.?!` + space/end) or max buffer |
| Pipeline | For each flushed segment: `tts.speak(segment)` → `transport.send` |
| Tools | If tool calls appear, do **not** speak partial pre-tool text (avoid “let me check—” then tool). Hold TTS until post-tool final pass, *or* only stream when no tools pending |
| Events | `tts.started` once per turn (first segment); `tts.completed` after last segment; optional per-segment later |
| Config | `createVoice({ ttsStreaming?: boolean \| { maxBufferChars?: number } })` default on |

**Tests:** multi-chunk LLM text yields multiple `tts.speak` calls / multiple transport batches before `llm.completed` ordering allows; abort mid-stream still works.

### 4. Session policies

**User value:** Dead air and hung tools don’t strand the session.

| Policy | Default | Behavior |
| ------ | ------- | -------- |
| `silenceTimeoutMs` | `null` (off) | While `listening`, if no final transcript for N ms → emit `session.idle` + optional prompt via `onSilence` / auto `say` nudge text to LLM once |
| `toolTimeoutMs` | `15000` | Race tool `execute` vs timeout → tool error payload, continue turn |
| `maxTurnMs` | `null` (off) | Abort turn if wall clock exceeded |

```ts
createVoice({
  policies: {
    silenceTimeoutMs: 8_000,
    silencePrompt: "Are you still there?",
    toolTimeoutMs: 15_000,
    maxTurnMs: 60_000,
  },
});
```

**Events:** `session.idle` (new). Reuse `error` for tool timeout with `fatal: false`.

**Tests:** fake clock or short timeouts; silence fires once; tool timeout returns error JSON to LLM path.

### 5. Parallel + multi-round tools

**User value:** Faster tool batches; agents that need follow-up tools.

| Piece | Design |
| ----- | ------ |
| Parallel | `Promise.all` (settled) for tool calls in one LLM round |
| Multi-round | Loop up to `maxToolRounds` (default `3`) while LLM keeps requesting tools |
| Config | `createVoice({ maxToolRounds?: number })` |

**Tests:** two tools in one round run concurrently (start timestamps overlap); second round tools execute.

### 6. Transport reconnect

**User value:** Brief network blip doesn’t kill the session id.

| Piece | Design |
| ----- | ------ |
| Hook | `TransportProvider.onConnectionState?.(handler)` → `"online" \| "offline"` |
| Core | On offline while connected: `reconnecting`; on online: re-`connect` transport + stt if needed, back to `listening`/`connected` |
| Stable id | `session.id` unchanged |
| Events | `session.reconnecting`, `session.resumed` (or reuse `connected`) |
| Fake | `FakeTransport.goOffline()` / `goOnline()` |

**Tests:** drop mid-session → state `reconnecting` → resume → `say` still works same id.

### 7. Middleware stubs (`memory`, `safety`)

**User value:** Stable extension points before real Redis/moderation drivers.

| Export | Behavior (stub) |
| ------ | ---------------- |
| `memory({ get, set, summarize? })` | Load messages on connect; persist on turn end; optional summarize hook |
| `safety({ checkTranscript?, checkToolCall? })` | If check returns `{ block: true, reason }`, skip turn / tool and emit `error` or `safety.blocked` |

Prefer implementing as **middleware factories** in `@thisux/voice-core` or a tiny `@thisux/voice-middleware` — keep core free of Redis.

**Tests:** memory round-trips messages via in-memory map; safety blocks a transcript.

---

## Acceptance criteria (phase)

1. User audio energy during `speaking` interrupts TTS without calling `interrupt()` manually.
2. Multi-sentence LLM output begins playback before the full completion when streaming TTS is on.
3. Configurable silence + tool timeouts behave as documented offline.
4. Multiple tools in one round run in parallel; multi-round tool loops work up to the cap.
5. Transport offline/online keeps `session.id` and returns to a usable listening state.
6. `memory()` / `safety()` stubs are importable and tested with fakes.
7. Default test suite stays offline (no live keys).
8. Docs: this file + updates to interruptions, tools, session, events, api, edge-cases.

---

## Verification

```bash
bun run build && bun run test
bun run examples/offline-launch/src/index.ts   # still VOICE_OFFLINE_OK
```

Optional follow-ups (not blocking Phase 2.5):

- Web playground: mic → barge-in demo
- Cartesia/ElevenLabs true token-stream WebSocket TTS
- Production AEC note in audio-pipeline.md

---

## Exit → Phase 3

When the stack above is merged, Phase 3 remains video / avatars / multi-agent. Back-channeling and emotion detectors stay **out** until duplex + streaming TTS feel good in real demos.
