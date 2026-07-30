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
});
```

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
voice.use(memory());
```

Middleware wraps the pipeline (session hooks, audio, LLM, tools, TTS).

## Session access

```ts
const session = voice.session;
// session.id, session.state, session.metadata, session.startedAt
```

See [session.md](./session.md).
