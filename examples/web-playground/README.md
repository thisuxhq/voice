# Web playground

Sample **Hono + JSX** app that uses THISUX Voice with your API keys.

```text
Browser (JSX page + WS client)
        │
        ▼
Hono server (keys stay here)
        │
        ▼
createVoice({ openai stt, groq, cartesia })
```

## Setup (~2 min)

1. From monorepo root, add keys:

```bash
cd ../..   # voice-sdk/
cp .env.example .env
# fill:
# OPENAI_API_KEY=
# GROQ_API_KEY=
# CARTESIA_API_KEY=
```

2. Install + build SDK + start playground:

```bash
bun install
bun run build
cd examples/web-playground
bun install
bun run dev
```

3. Open **http://localhost:8787**

Without keys the app still runs in **offline** mode (echo LLM + fake TTS).

## What to try

- Type a message → Send  
- Chip **Tool call** → exercises `createTask`  
- Watch **Live events** for `llm.*` / `tts.*` / `tool.*`  
- Live mode plays Cartesia PCM audio in the browser  

## Scripts

| Command | |
| ------- | - |
| `bun run dev` | Hot reload server |
| `bun run start` | Production-style start |

## Files

| Path | Role |
| ---- | ---- |
| `src/server.tsx` | Hono routes + WebSocket |
| `src/components/*.tsx` | JSX UI |
| `src/voice-session.ts` | SDK wiring |
| `src/public/app.js` | Client WS + audio playback |
