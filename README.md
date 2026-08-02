# THISUX Voice

> Build real-time voice agents in TypeScript.

TypeScript-first framework and orchestration layer for real-time voice applications. Swap STT, LLM, and TTS providers without rewriting your app.

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
voice.on("tts.started", () => console.log("speaking…"));

await voice.connect();
```

## Why

Voice stacks today force you to own WebRTC, VAD, STT, LLMs, tools, TTS, interruptions, and reconnection yourself — and most frameworks are Python-first.

THISUX Voice sits in the same **infrastructure SDK** category as:

| Domain | Library |
| ------ | ------- |
| Email | Resend |
| Files | UploadThing |
| Storage | Unstorage |
| Auth | Better Auth |
| **Voice** | **THISUX Voice** |

Same rules: one create call, providers as config, short happy path, plugins, TypeScript-first. Details: [docs/dx.md](./docs/dx.md).

## Docs

All product and design docs live in **[docs/](./docs/README.md)**:

| Start here | |
| ---------- | - |
| [Vision](./docs/vision.md) | Principles + long-term goal |
| [DX](./docs/dx.md) | Resend / UploadThing / Unstorage / Better Auth mapping |
| [Architecture](./docs/architecture.md) | Layers + package map |
| [Phase 1](./docs/phases/phase-1.md) | Current implementation target |
| [Public API](./docs/api.md) | `createVoice`, tools, events |

## Monorepo

```text
packages/
  voice                 # umbrella (@thisux/voice)
  core · events · state-machine · session · observability
  transport-webrtc · transport-websocket · transport-sip
  provider-openai · provider-groq · provider-cartesia · provider-elevenlabs
  plugin-twilio
examples/
  basic · offline-launch · phase2-demo · web-playground
```

## Develop

```bash
# from repo root
bun install
bun run build
bun run test
bun run examples/offline-launch/src/index.ts
bun run examples/phase2-demo/src/index.ts
bun run examples/basic/src/index.ts   # live keys optional; offline fallback

# Hono + JSX web app (http://localhost:8787)
cd examples/web-playground && bun install && bun run dev
```

## Roadmap

1. **Phase 1** — ✅ WebRTC, OpenAI STT, Groq, Cartesia, events, tools  
2. **Phase 2** — ✅ ElevenLabs, Twilio, SIP, metrics, logging  
3. **Phase 3** — Video, avatars, multi-agent  

## License

MIT © THISUX Private Limited
