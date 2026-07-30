# Developer experience (DX)

THISUX Voice is not competing with “voice frameworks” on features first.

It competes on **infrastructure SDK DX** — the same category as email, files, storage, and auth libraries modern TypeScript teams already trust.

## Category map

| Domain | Library | Setup shape |
| ------ | ------- | ----------- |
| Email | [Resend](https://resend.com) | `new Resend(key)` → `emails.send(...)` |
| Files | [UploadThing](https://uploadthing.com) | `createUploadthing()` → file router + middleware + adapters |
| Storage | [Unstorage](https://unstorage.unjs.io) | `createStorage({ driver })` — same API, swap backends |
| Auth | [Better Auth](https://www.better-auth.com) | `betterAuth({ plugins })` + typed client |
| **Voice** | **THISUX Voice** | `createVoice({ stt, llm, tts, transport })` |

```text
Email   → Resend
Files   → UploadThing
Storage → Unstorage
Auth    → Better Auth
Voice   → THISUX Voice
```

## What those products share (rules we follow)

1. **One create call** — `createX({ ... })` or `new X(key)`.
2. **Providers/drivers as config, not architecture** — swap without rewriting the app.
3. **Happy path ≤ ~20 lines** for the common case.
4. **Framework adapters when needed** — e.g. Next, Hono, Cloudflare Workers (UploadThing-style).
5. **Plugins / middleware** for cross-cutting concerns — memory, logger, metrics (Better Auth-style).
6. **TypeScript-first** — types fall out of the config the developer already wrote.

## How each maps onto voice

| Inspiration | Pattern we take | Voice equivalent |
| ----------- | --------------- | ---------------- |
| **Resend** | Tiny public surface, resource-ish methods, env API keys | `createVoice` + `connect` / `tool` / `on` — not 12 services to wire |
| **UploadThing** | Declarative router, middleware chain, framework entrypoints | Future: Hono/Workers route helpers, auth middleware on sessions |
| **Unstorage** | Driver adapters behind one storage API | `stt: openai()` / `llm: groq()` / `tts: cartesia()` / `transport: webrtc()` |
| **Better Auth** | `plugins: []` / composable server + client | `voice.use(memory())`, `voice.use(logger())`, tools as registered capabilities |

## Target happy path

```ts
import { createVoice } from "@thisux/voice-core";
import { webrtc } from "@thisux/voice-transport-webrtc";
import { openai } from "@thisux/voice-provider-openai";
import { groq } from "@thisux/voice-provider-groq";
import { cartesia } from "@thisux/voice-provider-cartesia";

const voice = createVoice({
  transport: webrtc(),
  stt: openai({ apiKey: process.env.OPENAI_API_KEY! }),
  llm: groq({ apiKey: process.env.GROQ_API_KEY! }),
  tts: cartesia({ apiKey: process.env.CARTESIA_API_KEY! }),
});

voice.tool({
  name: "createTask",
  description: "Create a task",
  parameters: {
    type: "object",
    properties: { title: { type: "string" } },
    required: ["title"],
  },
  async execute({ title }) {
    return { id: crypto.randomUUID(), title };
  },
});

voice.on("transcript.final", ({ text }) => console.log("user:", text));
await voice.connect();
```

Same idea as Resend’s “send in a few lines” — but for a full duplex voice agent.

## What we are *not*

| Avoid | Why |
| ----- | --- |
| LiveKit-style “assemble 12 primitives yourself” as the default DX | Too much surface for the happy path |
| Python-first pipeline DSLs as the primary API | Wrong ecosystem for our users |
| Provider lock-in SDKs (one STT/LLM/TTS vendor only) | Breaks Unstorage-style interchangeability |
| Training models / owning telephony networks | Out of scope ([PRD non-goals](./prd.md)) |

## Packaging DX (aspirational)

Match how those libraries feel on npm over time:

| Milestone | Goal |
| --------- | ---- |
| Phase 1 | Monorepo packages work (`@thisux/voice-core` + providers) |
| Soon | Single install entry (`@thisux/voice` or `thisux-voice`) re-exporting common path — Resend-style one package start |
| Phase 2+ | Framework adapters (`/hono`, Workers helpers) — UploadThing-style |
| Phase 2+ | First-class `logger` / `metrics` plugins — Better Auth-style |

## Design checklist (before shipping an API)

- [ ] Can a new user get a working agent from the README alone?
- [ ] Does swapping one provider require only a config line change?
- [ ] Are events and tools discoverable without reading the whole monorepo?
- [ ] Does the API feel like Resend/Unstorage, or like a telephony stack dump?

## Related docs

- [Vision](./vision.md)
- [Public API](./api.md)
- [Providers](./providers.md)
- [Architecture](./architecture.md)
