# Interruptions

## Requirements

When the user talks over the agent:

1. Keep inbound audio flowing to STT (both streams stay live).
2. Stop remaining playback / TTS generation (and in-flight tools, best-effort).
3. Preserve session state and conversation context — including what the agent already said.
4. **Adapt** (default): continue `speaking → thinking → speaking` with the overlapping transcript. Do **not** hop through `listening`.
5. **Interrupt** (opt-in / `voice.interrupt()`): `speaking → interrupted → listening`, then the next turn starts from listening.

## Example

```text
Assistant:
Your meeting starts—

User:
No, tomorrow.
```

Expected behavior (default duplex):

1. Mic stays open; STT hears the overlap while TTS is still playing.
2. Remaining TTS aborts mid-sentence.
3. Session moves `speaking → thinking → speaking` (no `listening` restart).
4. Context includes the partial assistant utterance plus the user’s correction.
5. The agent speaks an adjusted reply (“Got it — tomorrow.”) instead of finishing the original sentence.

Classic barge-in (`duplex: false` or `duplex: { onOverlap: "interrupt" }` / `await voice.interrupt()`):

1. TTS aborts mid-sentence.
2. Session moves `speaking → interrupted → listening`.
3. The next user turn starts from listening.

## Implementation hooks

- State machine: `speaking → thinking` (adapt) and `interrupted` (hard stop) — [session.md](./session.md)
- TTS: `abort()` on provider
- Tools: pass `AbortSignal` into `execute`
- Transport: inbound `onAudio` stays subscribed during TTS; stop outbound frames immediately
- API: `await voice.interrupt()` for a hard stop
- Auto barge-in: inbound `transport.onAudio` energy gate while `thinking` / `speaking`
- Duplex policy: `createVoice({ duplex })` — default `onOverlap: "adapt"`

## Full duplex (Phase 2.5)

Both directions stay live. Inbound PCM is still passed to `stt.transcribe` while the agent is thinking or speaking (`listenWhileSpeaking`, default on). A final transcript mid-turn is treated as overlap:

```ts
const voice = createVoice({
  // ...
  duplex: true, // default — adapt without a listening restart
  // or tune:
  duplex: {
    listenWhileSpeaking: true,
    onOverlap: "adapt", // or "interrupt"
    overlapTimeoutMs: 4_000, // energy abort with no transcript → listening
  },
  // half-duplex turn-taking:
  // duplex: false,
});
```

Events: `duplex.overlap` when an overlapping final transcript continues the turn; `speech.barge_in` when the energy gate fires.

## Audio barge-in (Phase 2.5)

When the agent is thinking or speaking, loud inbound PCM (s16le mono) can cancel remaining outbound speech without an app call. In **adapt** mode that is a courtesy stop (so the user isn’t talked over) while STT finishes the overlap. In **interrupt** mode it is the same path as `interrupt()`.

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
