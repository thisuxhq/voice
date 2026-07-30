# Repository structure

```text
voice-sdk/
├── README.md                 # Product entry (root only)
├── docs/                     # All product + design docs
├── packages/
│   ├── voice                 # umbrella package
│   ├── core
│   ├── events
│   ├── observability
│   ├── state-machine
│   ├── session
│   ├── transport-webrtc
│   ├── transport-websocket
│   ├── transport-sip
│   ├── provider-openai
│   ├── provider-groq
│   ├── provider-elevenlabs
│   ├── provider-cartesia
│   ├── plugin-twilio
│   ├── provider-deepgram     # Phase 3+
│   ├── memory-redis          # later
│   ├── memory-postgres       # later
│   └── plugin-daily          # later
├── examples/
│   ├── basic
│   ├── offline-launch
│   └── phase2-demo
└── package.json
```

## Package scope

**Phase 1 + 2 implemented:** core, events, state-machine, session, observability, transports (WebRTC / WebSocket / SIP), providers (OpenAI / Groq / Cartesia / ElevenLabs), Twilio plugin, umbrella `@thisux/voice`.

**Later:** Deepgram, memory drivers, Daily, video / multi-agent (Phase 3).
