# THISUX Voice

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-first-3178C6?logo=typescript&logoColor=white)](./packages/core)
[![Bun](https://img.shields.io/badge/runtime-Bun-fbf0df?logo=bun&logoColor=black)](https://bun.sh)

**Build real-time voice agents in TypeScript.**

Swap STT, LLM, and TTS without rewriting your app. One `createVoice` call — providers as config, tools as plugins, events for everything else.

```ts
import { createVoice, webrtc, openai, groq, cartesia } from "@thisux/voice";

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
voice.on("tts.started", () => console.log("speaking…"));

await voice.connect();
```

Same DX category as **Resend** (email), **UploadThing** (files), **Unstorage** (storage), and **Better Auth** (auth) — for voice.

---

## Features

| | |
| - | - |
| **Provider swap** | OpenAI · Groq · Cartesia · ElevenLabs behind stable interfaces |
| **Transports** | WebRTC · WebSocket · SIP · Twilio Media Streams |
| **Agent loop** | Audio → STT → LLM → tools → TTS, with barge-in |
| **Events** | Typed lifecycle: `transcript.*`, `llm.*`, `tool.*`, `tts.*` |
| **Middleware** | `voice.use(logger())`, `voice.use(metrics())` |
| **Edge-safe core** | No Node-only APIs required in `@thisux/voice-core` |
| **Offline tests** | Fakes shipped — no live API keys for the default suite |

Phases **1** and **2** are implemented. Phase **3** (video, avatars, multi-agent) is next.

---

## Install

```bash
bun add @thisux/voice
# or pick packages:
# bun add @thisux/voice-core @thisux/voice-provider-groq …
```

> Packages are **not on npm yet** — clone this monorepo and use workspace links, or install from GitHub until publish.

```bash
git clone https://github.com/thisuxhq/voice.git
cd voice
bun install
bun run build
```

---

## Quick start (offline, ~30s)

No API keys required:

```bash
bun run examples/offline-launch/src/index.ts
# → VOICE_OFFLINE_OK session=…
```

**Browser UI** (Hono + JSX, offline fallback without keys):

```bash
cd examples/web-playground
bun run dev
# → http://localhost:8787
```

**Live providers** — copy env and fill keys:

```bash
cp .env.example .env
# OPENAI_API_KEY, GROQ_API_KEY, CARTESIA_API_KEY, …
bun run examples/basic/src/index.ts
```

---

## Providers

| Layer | Available now | Later |
| ----- | ------------- | ----- |
| **STT** | OpenAI | Deepgram, AssemblyAI |
| **LLM** | Groq, OpenAI helpers | Anthropic, Google |
| **TTS** | Cartesia, ElevenLabs | OpenAI, PlayAI |
| **Transport** | WebRTC, WebSocket, SIP, Twilio | Daily |
| **Obs** | `logger()`, `metrics()` | — |

Interfaces live in [`@thisux/voice-core`](./packages/core). New vendor = new package implementing the same contract. Full matrix: [docs/providers.md](./docs/providers.md).

---

## Examples

| Example | What it shows |
| ------- | ------------- |
| [`offline-launch`](./examples/offline-launch) | Deterministic fake providers → `VOICE_OFFLINE_OK` |
| [`basic`](./examples/basic) | Live keys or offline fallback |
| [`phase2-demo`](./examples/phase2-demo) | SIP + Twilio helpers + observability |
| [`web-playground`](./examples/web-playground) | Hono + JSX UI at `localhost:8787` |

---

## Develop

```bash
bun install
bun run build
bun run test
bun run typecheck
```

```text
packages/
  voice/                  # @thisux/voice umbrella re-exports
  core/                   # createVoice, pipeline, tools, fakes
  events/ · state-machine/ · session/ · observability/
  transport-webrtc/ · transport-websocket/ · transport-sip/
  provider-openai/ · provider-groq/ · provider-cartesia/ · provider-elevenlabs/
  plugin-twilio/
examples/
  basic/ · offline-launch/ · phase2-demo/ · web-playground/
docs/                     # vision, API, architecture, phases
```

Coding agents: start at [AGENTS.md](./AGENTS.md).

---

## Docs

| Doc | |
| --- | - |
| [Vision](./docs/vision.md) | Mission + principles |
| [DX](./docs/dx.md) | Why this category (Resend / UploadThing / …) |
| [Architecture](./docs/architecture.md) | Layers + package map |
| [Public API](./docs/api.md) | `createVoice`, tools, lifecycle |
| [Events](./docs/events.md) | Full event catalog |
| [Session](./docs/session.md) | State machine |
| [Tools](./docs/tools.md) | Tool pipeline |
| [Interruptions](./docs/interruptions.md) | Barge-in |
| [Providers](./docs/providers.md) | Matrix + interfaces |
| [Phase 1](./docs/phases/phase-1.md) · [2](./docs/phases/phase-2.md) · [3](./docs/phases/phase-3.md) | Roadmap detail |

Full index: [docs/README.md](./docs/README.md).

---

## Roadmap

1. **Phase 1** — ✅ Core loop, WebRTC, OpenAI STT, Groq, Cartesia, events, tools  
2. **Phase 2** — ✅ ElevenLabs, Twilio, SIP, WebSocket, logger/metrics  
3. **Phase 2.5** — 🔄 Audio barge-in, streamed TTS, session policies, parallel tools, reconnect ([doc](./docs/phases/phase-2.5.md))  
4. **Phase 3** — Video, avatars, multi-agent workflows  

Not goals: training models, owning a telephony network, or a proprietary foundation model.

---

## License

[MIT](./LICENSE) © [THISUX Private Limited](https://thisux.com)

You may use this software personally or commercially. Keep the copyright and license notice.
