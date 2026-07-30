# Phase 2 — Telephony + observability

**Status: complete**

**Goal:** Production hardiness and telephony surfaces.

## Scope

| Area | Deliverable | Status |
| ---- | ----------- | ------ |
| TTS | ElevenLabs | Done |
| Telephony | Twilio Media Streams plugin | Done |
| Telephony | SIP transport + signaling adapter | Done |
| Ops | Metrics middleware | Done |
| Ops | Logging middleware | Done |

## Packages

- `@thisux/voice-provider-elevenlabs`
- `@thisux/voice-plugin-twilio`
- `@thisux/voice-transport-sip`
- `@thisux/voice-observability`
- Re-exported from `@thisux/voice`

## Acceptance criteria

1. ElevenLabs TTS is a drop-in `tts:` provider. ✅
2. Twilio media streams can drive a session. ✅
3. SIP path documented and demoable (memory adapter + real adapter hook). ✅
4. `voice.use(metrics())` and `voice.use(logger())` export stage latencies and errors. ✅

## Examples

```bash
bun run examples/phase2-demo/src/index.ts
```

### Twilio sketch

```ts
import { createVoice, twilioMediaStream, twilioStreamTwiml, openai, groq, cartesia } from "@thisux/voice";

// TwiML for your voice webhook:
// twilioStreamTwiml("wss://your.app/media")

const transport = twilioMediaStream({ socket: twilioWs });
const voice = createVoice({
  transport,
  stt: openai({ apiKey }),
  llm: groq({ apiKey }),
  tts: cartesia({ apiKey }),
});
// on each WS message: transport.handleMessage(raw)
```

### SIP sketch

```ts
import { sip, createVoice } from "@thisux/voice";

const transport = sip({
  uri: "sip:agent@example.com",
  signaling: myJsSipAdapter, // or createMemorySipSignaling() for offline
});
```

### Observability

```ts
voice.use(logger({ level: "info" }));
voice.use(metrics({ onMetric: (m) => exportSomewhere(m) }));
```
