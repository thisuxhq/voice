import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { Layout } from "./components/Layout";
import { Playground } from "./components/Playground";
import {
  createPlaygroundAgent,
  detectMode,
  providerLabel,
  type ClientSink,
} from "./voice-session";
import type { VoiceAgent } from "@thisux/voice-core";

// Load monorepo root .env when running from examples/web-playground
const rootEnv = new URL("../../../.env", import.meta.url).pathname;
try {
  const file = Bun.file(rootEnv);
  if (await file.exists()) {
    const text = await file.text();
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1]!;
      let val = m[2] ?? "";
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = val;
    }
  }
} catch {
  /* ignore */
}

const mode = detectMode();
const providers = providerLabel(mode, process.env);

const app = new Hono();
const { upgradeWebSocket, websocket } = createBunWebSocket();

app.get("/styles.css", async () => {
  const file = Bun.file(new URL("./styles.css", import.meta.url));
  return new Response(file, {
    headers: { "Content-Type": "text/css; charset=utf-8" },
  });
});

app.get("/app.js", async () => {
  const file = Bun.file(new URL("./public/app.js", import.meta.url));
  return new Response(file, {
    headers: { "Content-Type": "text/javascript; charset=utf-8" },
  });
});

app.get("/", (c) =>
  c.html(
    <Layout title="THISUX Voice · Playground">
      <Playground mode={mode} providers={providers} />
    </Layout>,
  ),
);

app.get("/health", (c) =>
  c.json({
    ok: true,
    mode,
    providers,
  }),
);

type SocketData = {
  voice?: VoiceAgent;
  mode?: string;
  turnLock: boolean;
  pushAudio?: (chunk: Uint8Array) => void;
};

app.get(
  "/ws",
  upgradeWebSocket(() => {
    const state: SocketData = { turnLock: false };

    return {
      async onOpen(_evt, ws) {
        const sink: ClientSink = {
          send(data) {
            try {
              ws.send(JSON.stringify(data));
            } catch {
              /* closed */
            }
          },
        };

        try {
          const session = await createPlaygroundAgent(sink);
          state.voice = session.voice;
          state.mode = session.mode;
          state.pushAudio = session.pushAudio;
          sink.send({
            type: "ready",
            sessionId: session.voice.session.id,
            mode: session.mode,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          sink.send({ type: "error", message });
          ws.close();
        }
      },

      async onMessage(evt, ws) {
        let msg: {
          type?: string;
          text?: string;
          data?: string;
        };
        try {
          msg = JSON.parse(String(evt.data)) as typeof msg;
        } catch {
          ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
          return;
        }

        // Mic PCM → STT
        if (msg.type === "audio" && msg.data && state.pushAudio) {
          try {
            state.pushAudio(Buffer.from(msg.data, "base64"));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            ws.send(JSON.stringify({ type: "error", message }));
          }
          return;
        }

        if (msg.type === "mic_stop") {
          ws.send(JSON.stringify({ type: "event", name: "mic.stopped" }));
          return;
        }

        if (msg.type !== "say" || !msg.text?.trim()) return;
        if (!state.voice) return;

        if (state.turnLock) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: "Turn in progress — wait for the current reply.",
            }),
          );
          return;
        }

        state.turnLock = true;
        try {
          await state.voice.say(msg.text.trim());
          ws.send(JSON.stringify({ type: "event", name: "turn.done" }));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          ws.send(JSON.stringify({ type: "error", message }));
        } finally {
          state.turnLock = false;
        }
      },

      async onClose() {
        try {
          await state.voice?.disconnect();
        } catch {
          /* ignore */
        }
        state.voice = undefined;
        state.pushAudio = undefined;
      },
    };
  }),
);

const port = Number(process.env.PORT ?? 8787);

console.log(`
THISUX Voice · Web playground
  url:   http://localhost:${port}
  mode:  ${mode}
  stack: ${providers}
`);

if (mode === "offline") {
  console.log(
    "  tip:  copy voice-sdk/.env.example → .env and set OPENAI / GROQ keys\n",
  );
}

export default {
  port,
  fetch: app.fetch,
  websocket,
};
