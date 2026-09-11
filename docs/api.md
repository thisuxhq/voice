# Public API

## Agent creation

```ts
import { createVoice } from "@thisux/voice-core";
import { webrtc } from "@thisux/voice-transport-webrtc";
import { openai } from "@thisux/voice-provider-openai";
import { groq } from "@thisux/voice-provider-groq";
import { cartesia } from "@thisux/voice-provider-cartesia";

const voice = createVoice({
  transport: webrtc(),
  stt: openai(),
  llm: groq(),
  tts: cartesia(),
  // Phase 2.5 — optional
  bargeIn: true, // energy gate while speaking (default on)
  duplex: true, // listen while speaking; adapt on overlap (default)
});
```

### Duplex options

| Option | Default | Meaning |
| ------ | ------- | ------- |
| `duplex: false` | — | Classic barge-in: overlap → `interrupted` → `listening` |
| `listenWhileSpeaking` | `true` | Keep inbound PCM flowing to STT during TTS |
| `onOverlap` | `"adapt"` | `"adapt"` continues thinking→speaking; `"interrupt"` hops to listening |
| `overlapTimeoutMs` | `4000` | After energy abort with no final transcript, return to listening |

Manual hard stop: `await voice.interrupt()` — see [interruptions.md](./interruptions.md).

### Barge-in options

| Option | Default | Meaning |
| ------ | ------- | ------- |
| `bargeIn: false` | — | Disable energy-driven outbound cancel |
| `energyThreshold` | `0.025` | RMS 0–1 on s16le PCM |
| `minFrames` | `3` | Consecutive hot chunks before interrupt |
| `graceMs` | `250` | Ignore mic energy right after speech starts |

### TTS streaming options

| Option | Default | Meaning |
| ------ | ------- | ------- |
| `ttsStreaming: false` | — | Wait for full assistant text before TTS |
| `ttsStreaming: true` | default | Flush TTS on sentence boundaries while LLM streams |
| `maxBufferChars` | `180` | Force flush if no punctuation yet |

When tools are registered, first-pass speech is held until the LLM stream finishes without tool calls (avoids “Let me check…” then a tool). Post-tool replies stream live. Agents with **no** tools stream sentences as tokens arrive.

## Connection lifecycle

```ts
await voice.connect();
await voice.disconnect();
```

## Event listeners

```ts
voice.on("connected", () => {});
voice.on("transcript", (event) => {});
voice.on("tool", (event) => {});
voice.on("speech", (event) => {});
voice.on("error", (error) => {});
```

Full event catalog: [events.md](./events.md).

## Tool registration

```ts
voice.tool({
  name: "createTask",
  description: "Create a task",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
    },
    required: ["title"],
  },
  execute(input) {
    return { id: "task_1", title: input.title };
  },
});
```

## Middleware

```ts
voice.use(logger());
voice.use(metrics());
voice.use(logger());
voice.use(metrics());
voice.use(memory({ store: createInMemoryStore() })); // Phase 2.5 stub
voice.use(safety({ checkTranscript: (t) => ({ block: false }) }));
```

Middleware wraps the pipeline (session hooks, audio, LLM, tools, TTS).

## Session access

```ts
const session = voice.session;
// session.id, session.state, session.metadata, session.startedAt
```

See [session.md](./session.md).
