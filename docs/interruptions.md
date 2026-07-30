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
