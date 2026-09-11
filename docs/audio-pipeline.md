# Audio pipeline

```text
Microphone
      │
      ▼
Noise suppression
      │
      ▼
Voice activity detection
      │
      ▼
Resampling
      │
      ▼
Encoding
      │
      ▼
Provider (STT)
```

## Stages

| Stage | Purpose |
| ----- | ------- |
| Capture | Mic / remote track via transport |
| Noise suppression | Optional pre-process |
| VAD | Detect speech vs silence; drive turn-taking |
| Resampling | Normalize sample rate for providers |
| Encoding | PCM / Opus / provider-required format |
| STT | Streaming transcription |

## Design notes

- Prefer streaming chunks over full-utterance buffers for low latency.
- VAD thresholds and silence timeouts are configurable per session.
- Encoding format is negotiated by the STT adapter.
- **Full duplex (Phase 2.5):** inbound chunks keep flowing to STT while TTS is playing. Core does not mute the mic for a half-duplex turn. Overlap is handled by the duplex policy ([interruptions.md](./interruptions.md)) — adapt in place, or classic barge-in.

## Echo

The energy barge-in `graceMs` window is a cheap echo guard, not AEC. Production AEC/RNNoise stays in the transport or app.
