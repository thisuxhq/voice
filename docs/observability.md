# Observability

## Track

- Latency (E2E and per stage: STT, LLM, TTS, tools)
- Tokens (prompt / completion)
- Session duration
- Tool execution time
- Audio quality signals
- Provider failures
- Retries

## API shape (Phase 2+)

```ts
voice.use(metrics({
  onMetric(metric) {
    // export to your backend
  },
}));

voice.use(logger({
  level: "info",
}));
```

## Phase mapping

| Capability | Phase |
| ---------- | ----- |
| Core events (basis for metrics) | 1 |
| Structured logger middleware | 2 |
| Metrics middleware | 2 |
| Provider failure / retry counters | 2 |
