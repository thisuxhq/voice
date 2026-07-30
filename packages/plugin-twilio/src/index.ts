import type { TransportProvider } from "@thisux/voice-core";
import {
  websocket,
  type WebSocketLike,
  type WebSocketTransport,
} from "@thisux/voice-transport-websocket";

export interface TwilioMediaStreamOptions {
  /** Existing Twilio Media Stream WebSocket (from your server upgrade). */
  socket?: WebSocketLike;
  /** Optional URL if the plugin should open the socket (rare — usually Twilio dials you). */
  url?: string;
  /** Stream SID once known (for outbound media). */
  streamSid?: string;
  /** Sample rate of inbound mulaw (Twilio default 8000). */
  sampleRate?: number;
  onStart?: (msg: TwilioStartMessage) => void;
  onStop?: () => void;
  WebSocketImpl?: new (url: string) => WebSocketLike;
}

export interface TwilioStartMessage {
  event: "start";
  sequenceNumber: string;
  start: {
    streamSid: string;
    accountSid: string;
    callSid: string;
    tracks: string[];
    mediaFormat: {
      encoding: string;
      sampleRate: number;
      channels: number;
    };
  };
}

export interface TwilioMediaMessage {
  event: "media";
  sequenceNumber: string;
  media: {
    track: string;
    chunk: string;
    timestamp: string;
    payload: string;
  };
}

export interface TwilioStopMessage {
  event: "stop";
  sequenceNumber: string;
  stop: { accountSid: string; callSid: string };
}

export type TwilioStreamEvent =
  | TwilioStartMessage
  | TwilioMediaMessage
  | TwilioStopMessage
  | { event: string; [k: string]: unknown };

export interface TwilioMediaStreamTransport extends TransportProvider {
  /** Feed a raw Twilio Media Streams JSON message (string or object). */
  handleMessage(data: string | TwilioStreamEvent): void;
  /** Current stream SID (set on `start` event). */
  readonly streamSid: string | null;
  /** Underlying websocket transport helpers. */
  readonly ws: WebSocketTransport;
}

/**
 * Twilio Media Streams bridge.
 *
 * Wire your server WebSocket (Twilio → you) and pass the socket here.
 * Inbound mulaw/base64 payloads become PCM-ish bytes on `onAudio`.
 * Outbound TTS bytes are wrapped as Twilio `media` events.
 *
 * @example
 * ```ts
 * const transport = twilioMediaStream({ socket: twilioWs });
 * const voice = createVoice({ transport, stt, llm, tts });
 * await voice.connect();
 * // on each WS message: transport.handleMessage(raw)
 * ```
 */
export function twilioMediaStream(
  options: TwilioMediaStreamOptions = {},
): TwilioMediaStreamTransport {
  let streamSid: string | null = options.streamSid ?? null;
  const sampleRate = options.sampleRate ?? 8000;

  const ws = websocket({
    url: options.url,
    socket: options.socket,
    WebSocketImpl: options.WebSocketImpl,
  });

  const transport: TwilioMediaStreamTransport = {
    get streamSid() {
      return streamSid;
    },
    get ws() {
      return ws;
    },

    async connect() {
      await ws.connect();
    },

    async disconnect() {
      await ws.disconnect();
      streamSid = null;
    },

    send(data: Uint8Array) {
      // Twilio expects base64 mulaw in a media event. We send raw base64 of whatever
      // the TTS provider emitted; production apps should convert PCM→mulaw.
      const payload = bytesToBase64(data);
      const sid = streamSid ?? options.streamSid ?? "";
      const frame = JSON.stringify({
        event: "media",
        streamSid: sid,
        media: {
          payload,
        },
      });
      const socket = ws.getSocket();
      if (socket && socket.readyState === 1) {
        socket.send(frame);
      }
    },

    onAudio(handler) {
      return ws.onAudio?.(handler);
    },

    handleMessage(data: string | TwilioStreamEvent) {
      const msg: TwilioStreamEvent =
        typeof data === "string" ? (JSON.parse(data) as TwilioStreamEvent) : data;

      switch (msg.event) {
        case "connected":
          break;
        case "start": {
          const start = msg as TwilioStartMessage;
          streamSid = start.start.streamSid;
          options.onStart?.(start);
          break;
        }
        case "media": {
          const media = msg as TwilioMediaMessage;
          const payload = media.media?.payload;
          if (!payload) break;
          const mulaw = base64ToBytes(payload);
          // Decode μ-law → linear PCM s16le for STT providers
          const pcm = mulawToPcm16(mulaw);
          ws.pushAudio(pcm);
          void sampleRate;
          break;
        }
        case "stop": {
          options.onStop?.();
          break;
        }
        default:
          break;
      }
    },
  };

  return transport;
}

/** TwiML helper: connect a call to your Media Streams WebSocket URL. */
export function twilioStreamTwiml(websocketUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(websocketUrl)}" />
  </Connect>
</Response>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** G.711 μ-law → PCM16 LE (mono). */
export function mulawToPcm16(mulaw: Uint8Array): Uint8Array {
  const out = new Int16Array(mulaw.byteLength);
  for (let i = 0; i < mulaw.byteLength; i++) {
    out[i] = decodeMulaw(mulaw[i]!);
  }
  return new Uint8Array(out.buffer);
}

function decodeMulaw(mu: number): number {
  const BIAS = 0x84;
  const CLIP = 32635;
  mu = ~mu & 0xff;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let sample = ((mantissa << 3) + BIAS) << exponent;
  sample -= BIAS;
  if (sample > CLIP) sample = CLIP;
  return sign ? -sample : sample;
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(b64, "base64"));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}
