# Tool execution

## Registration

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
  async execute(input) {
    return { ok: true, title: input.title };
  },
});
```

## Pipeline

```text
Transcript
     │
     ▼
LLM
     │
     ▼
Tool call
     │
     ▼
Database / API
     │
     ▼
Result
     │
     ▼
LLM
     │
     ▼
TTS
```

## Rules

1. Tool schemas are exposed to the LLM as function definitions.
2. `tool.called` fires before `execute`; `tool.completed` after resolve/reject.
3. Interruptions may abort in-flight tools (best-effort cancel via `AbortSignal`).
4. Tool results are re-injected into the LLM before TTS for the final reply.
