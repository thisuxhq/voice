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
