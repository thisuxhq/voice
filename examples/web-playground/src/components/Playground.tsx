import type { FC } from "hono/jsx";

export type PlaygroundProps = {
  mode: "live" | "offline";
  providers: string;
};

export const Playground: FC<PlaygroundProps> = ({ mode, providers }) => (
  <>
    <header class="header">
      <div>
        <p class="eyebrow">THISUX Voice</p>
        <h1>Web playground</h1>
        <p class="sub">
          Talk or type — chat stays visible. Mic audio goes through STT → LLM →
          TTS.
        </p>
      </div>
      <div class="badges">
        <span class={`badge ${mode === "live" ? "badge-live" : "badge-off"}`}>
          {mode === "live" ? "LIVE keys" : "OFFLINE fakes"}
        </span>
        <span class="badge badge-muted" id="ws-status">
          WS: connecting…
        </span>
        <span class="badge badge-muted" id="mic-status">
          Mic: off
        </span>
      </div>
    </header>

    <section class="panel meta">
      <div>
        <span class="label">Providers</span>
        <code id="providers">{providers}</code>
      </div>
      <div>
        <span class="label">Session</span>
        <code id="session-id">—</code>
      </div>
    </section>

    <main class="grid">
      <section class="panel">
        <div class="panel-head">
          <h2>Conversation</h2>
          <button type="button" class="btn ghost" id="btn-clear">
            Clear
          </button>
        </div>
        <div id="log" class="log" aria-live="polite" />

        <div class="mic-row">
          <button type="button" class="btn mic" id="btn-mic">
            <span class="mic-dot" aria-hidden="true" />
            <span id="mic-label">Hold to talk</span>
          </button>
          <p class="hint mic-hint">
            Hold the mic, speak, release. Transcript appears in chat; assistant
            replies with speech + text.
          </p>
        </div>

        <form id="chat-form" class="composer">
          <input
            id="message"
            name="message"
            type="text"
            placeholder="Or type instead…"
            autocomplete="off"
          />
          <button type="submit" class="btn primary" id="btn-send">
            Send
          </button>
        </form>
        <p class="hint">
          Speech uses <code>STT → LLM → TTS</code>. Text uses{" "}
          <code>voice.say()</code>. Same chat log.
        </p>
      </section>

      <aside class="panel">
        <h2>Live events</h2>
        <ul id="events" class="events" />
        <h2 class="mt">Quick text prompts</h2>
        <div class="chips">
          <button
            type="button"
            class="chip"
            data-prompt="Hello, introduce yourself in one sentence."
          >
            Intro
          </button>
          <button
            type="button"
            class="chip"
            data-prompt="Create a task titled buy milk, then confirm briefly."
          >
            Tool call
          </button>
          <button
            type="button"
            class="chip"
            data-prompt="What time is it in UTC? Keep it short."
          >
            Short Q
          </button>
        </div>
      </aside>
    </main>

    <footer class="footer">
      <span>
        SDK: <code>@thisux/voice-core</code>
      </span>
      <span id="mode-detail">{mode}</span>
    </footer>
  </>
);
