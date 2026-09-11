# Event system

Everything is event-based. Consumers subscribe with `voice.on(name, handler)`.

## Catalog

### Session

| Event | When |
| ----- | ---- |
| `session.started` | Session created / connected |
| `session.closed` | Session ended cleanly |
| `connected` | Transport ready |
| `error` | Unrecoverable or handled failure |

### Speech / audio

| Event | When |
| ----- | ---- |
| `speech.started` | User or agent speech begins |
| `speech.stopped` | Speech ends |
| `speech.barge_in` | Energy gate fired while thinking/speaking (Phase 2.5) |
| `speech` | Generic speech lifecycle (alias surface) |
| `duplex.overlap` | Overlapping final transcript; agent will adapt (Phase 2.5) |

### Transcript

| Event | When |
| ----- | ---- |
| `session.idle` | Silence policy fired while listening (Phase 2.5) |
| `session.reconnecting` | Transport dropped; session id stable (Phase 2.5) |
| `session.resumed` | Transport back online (Phase 2.5) |
| `transcript.partial` | Interim STT result |
| `transcript.final` | Final STT result |
| `transcript` | Generic transcript surface |

### LLM

| Event | When |
| ----- | ---- |
| `llm.started` | Generation begins |
| `llm.completed` | Generation finishes |

### Tools

| Event | When |
| ----- | ---- |
| `tool.called` | Tool invocation starts |
| `tool.completed` | Tool returns |
| `tool` | Generic tool surface |

### TTS

| Event | When |
| ----- | ---- |
| `tts.started` | Synthesis begins |
| `tts.completed` | Synthesis finishes |

## Guarantees

1. Every event payload includes `id` (UUID) and `sessionId`.
2. Emit order for a turn: transcript → llm → tool* → tts → speech complete.
3. Interruptions may emit `speech.stopped` / cancel in-flight tool/tts without a paired `*.completed` success; use cancel flags where needed.

## Example

```ts
voice.on("transcript.partial", ({ text }) => {
  console.log("partial:", text);
});

voice.on("transcript.final", ({ text }) => {
  console.log("final:", text);
});

voice.on("tool.called", ({ name, input }) => {
  console.log("tool:", name, input);
});
```
