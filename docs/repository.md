# Repository structure

```text
voice-sdk/
├── README.md                 # Product entry (root only)
├── docs/                     # All product + design docs
├── packages/
│   ├── core
│   ├── events
│   ├── observability
│   ├── state-machine
│   ├── session
│   ├── transport-webrtc
│   ├── transport-websocket
│   ├── provider-openai
│   ├── provider-groq
│   ├── provider-elevenlabs
│   ├── provider-cartesia
│   ├── provider-deepgram
│   ├── memory-redis
│   ├── memory-postgres
│   ├── plugin-twilio
│   └── plugin-daily
├── examples/
└── package.json              # workspace root
```

## Package scope (Phase 1 scaffold)

Implemented first:

- `core`, `events`, `state-machine`, `session`
- `transport-webrtc`
- `provider-openai`, `provider-groq`, `provider-cartesia`
- `examples/basic`

Stubs or deferred until later phases:

- `observability`, Twilio/SIP plugins, remaining providers
