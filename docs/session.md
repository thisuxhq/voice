# Session model

## Interface

```ts
interface Session {
  id: string;
  state: SessionState;
  metadata: Record<string, unknown>;
  startedAt: number;
}
```

## States

```text
idle
connecting
connected
listening
thinking
speaking
interrupted
reconnecting
failed
closed
```

## Typical transitions

```text
idle → connecting → connected → listening
listening → thinking → speaking → listening
speaking → interrupted → listening
* → reconnecting → connected | failed
* → closed
* → failed
```

## Rules

1. Only the state machine mutates `session.state`.
2. Invalid transitions throw or emit `error` (never silent).
3. `interrupted` always preserves conversation context.
4. `reconnecting` keeps session `id` stable.

## Policies (Phase 2.5)

```ts
createVoice({
  policies: {
    silenceTimeoutMs: 8_000,       // emit session.idle + optional prompt
    silencePrompt: "Are you still there?",
    toolTimeoutMs: 15_000,         // default
    maxTurnMs: 60_000,             // optional whole-turn abort
  },
});
```

| Policy | Default | Effect |
| ------ | ------- | ------ |
| `silenceTimeoutMs` | off | While `listening`, fire `session.idle` and one silence prompt |
| `toolTimeoutMs` | `15000` | Tool error payload; turn continues |
| `maxTurnMs` | off | Abort in-flight turn |

Implementation: `@thisux/voice-session` + `@thisux/voice-state-machine`.
