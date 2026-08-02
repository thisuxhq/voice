# Interruptions

## Requirements

When the user barges in:

1. Stop playback.
2. Stop TTS generation.
3. Stop tool execution (best-effort).
4. Preserve session state and conversation context.
5. Resume listening / next turn execution.

## Example

```text
Assistant:
Your meeting starts—

User:
No, tomorrow.
```

Expected behavior:

1. TTS aborts mid-sentence.
2. Session moves `speaking` → `interrupted` → `listening`.
3. New user audio is transcribed; previous incomplete agent speech is not completed.
4. Context retains that the user corrected the schedule.

## Implementation hooks

- State machine: `interrupted` state ([session.md](./session.md))
- TTS: `abort()` on provider
- Tools: pass `AbortSignal` into `execute`
- Transport: stop outbound audio frames immediately
- API: `await voice.interrupt()`
- Auto barge-in: inbound `transport.onAudio` energy gate while `thinking` / `speaking` (Phase 2.5)

## Audio barge-in (Phase 2.5)

When the agent is thinking or speaking, loud inbound PCM (s16le mono) can trigger the same path as `interrupt()` without an app call:

```ts
const voice = createVoice({
  // ...
  bargeIn: true, // default
  // or tune:
  bargeIn: {
    energyThreshold: 0.025,
    minFrames: 3,
    graceMs: 250, // ignore echo right after TTS starts
  },
  // push-to-talk / upstream barge-in:
  // bargeIn: false,
});
```

This is a **lightweight energy detector**, not full AEC/VAD. Production apps may disable it and drive `interrupt()` from WebRTC VAD or telephony events.

See [phase-2.5.md](./phases/phase-2.5.md).
