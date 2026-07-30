# Vision

## Product

**THISUX Voice** — build real-time voice agents in TypeScript.

## Mission

Create a TypeScript-first framework and orchestration layer for building real-time voice applications.

Developers should switch providers without rewriting their applications.

```ts
const voice = createVoice({
  stt: openai(),
  llm: groq(),
  tts: cartesia(),
});
```

## Category fit

Voice infrastructure should feel as simple as the rest of the modern TS stack:

| Domain | Library | Setup shape |
| ------ | ------- | ----------- |
| Email | Resend | `new Resend(key)` → `emails.send(...)` |
| Files | UploadThing | `createUploadthing()` → router + middleware + adapters |
| Storage | Unstorage | `createStorage({ driver })` — swap backends, same API |
| Auth | Better Auth | `betterAuth({ plugins })` + typed client |
| **Voice** | **THISUX Voice** | `createVoice({ stt, llm, tts, transport })` |

**DX rules we copy from that category:** one create call; providers as config; happy path ≤ ~20 lines; framework adapters when needed; plugins for cross-cutting work; TypeScript-first.

Full write-up: [dx.md](./dx.md).

## Core principles

### 1. Providers are interchangeable

```ts
stt: openai()   // or deepgram()
llm: groq()     // or openai()
tts: cartesia() // or elevenlabs()
```

### 2. Everything is event-based

```ts
voice.on("transcript.partial")
voice.on("transcript.final")
voice.on("tool.called")
voice.on("speech.started")
```

### 3. Everything streams

```text
User → Audio → Transcript → Reasoning → Tool call → Speech
```

### 4. Everything is modular

```ts
voice.use(memory());
voice.use(logger());
voice.use(metrics());
```

## Long-term vision

Not “another voice framework.”

Become the **AI infrastructure layer for real-time applications**.

```text
Email   → Resend
Files   → UploadThing
Storage → Unstorage
Auth    → Better Auth
Voice   → THISUX Voice
```

## Design north stars

- TypeScript-first and edge-compatible (Hono, Cloudflare Workers / Durable Objects)
- Provider independence by default (Unstorage-style drivers)
- Extremely low latency
- DX that matches Resend / UploadThing / Unstorage / Better Auth — small surface, clear defaults
- Not LiveKit “wire every primitive” or Python pipeline DSLs as the primary API
