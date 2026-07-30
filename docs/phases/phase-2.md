# Phase 2 — Telephony + observability

**Goal:** Production hardiness and telephony surfaces.

## Scope

| Area | Deliverable |
| ---- | ----------- |
| TTS | ElevenLabs |
| Telephony | Twilio plugin |
| Telephony | SIP support |
| Ops | Metrics middleware |
| Ops | Logging middleware |

## Packages

- `@thisux/voice-provider-elevenlabs`
- `@thisux/voice-plugin-twilio`
- `@thisux/voice-observability` (metrics + logger)
- SIP transport or plugin (TBD: package name at implementation time)

## Acceptance criteria

1. ElevenLabs TTS is a drop-in `tts:` provider.
2. Twilio media streams (or equivalent) can drive a session.
3. SIP path documented and demoable.
4. `voice.use(metrics())` and `voice.use(logger())` export stage latencies and errors.

## Depends on

Phase 1 core loop and provider interfaces.
