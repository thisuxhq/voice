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

Implementation: `@thisux/voice-session` + `@thisux/voice-state-machine`.
