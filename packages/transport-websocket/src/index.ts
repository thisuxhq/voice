import type { TransportProvider } from "@thisux/voice-core";

export interface WebSocketTransportOptions {
  /** WebSocket URL (e.g. wss://example.com/voice) */
  url?: string;
  /** Existing socket (tests / already-connected Twilio stream) */
  socket?: WebSocketLike;
  /** Inject WebSocket constructor */
  WebSocketImpl?: new (url: string, protocols?: string | string[]) => WebSocketLike;
  protocols?: string | string[];
  /** Encode outbound binary as base64 JSON frames instead of raw binary */
  jsonBinaryField?: string;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (err: unknown) => void;
}

export interface WebSocketLike {
  readyState: number;
  binaryType?: string;
  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
  addEventListener?(type: string, listener: (ev: MessageEvent | Event) => void): void;
  removeEventListener?(type: string, listener: (ev: MessageEvent | Event) => void): void;
  onopen: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
}

export interface WebSocketTransport extends TransportProvider {
  /** Push inbound audio (when driving from Twilio / external parser). */
  pushAudio(chunk: Uint8Array): void;
  /** Push inbound text/JSON control messages to optional handlers. */
  getSocket(): WebSocketLike | null;
}

const OPEN = 1;

/**
 * WebSocket transport for duplex audio frames.
 * Used by server paths, Twilio Media Streams bridges, and tests.
 */
export function websocket(
  options: WebSocketTransportOptions = {},
): WebSocketTransport {
  let socket: WebSocketLike | null = options.socket ?? null;
  let connected = false;
  const audioHandlers = new Set<(chunk: Uint8Array) => void>();
  const WS =
    options.WebSocketImpl ??
    (globalThis as { WebSocket?: new (url: string, protocols?: string | string[]) => WebSocketLike })
      .WebSocket;

  function handleMessage(data: unknown) {
    if (data instanceof ArrayBuffer) {
      const chunk = new Uint8Array(data);
      for (const h of audioHandlers) h(chunk);
      return;
    }
    if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
      const chunk = new Uint8Array(data);
      for (const h of audioHandlers) h(chunk);
      return;
    }
    if (data instanceof Uint8Array) {
      for (const h of audioHandlers) h(data);
      return;
    }
    if (typeof data === "string" && options.jsonBinaryField) {
      try {
        const json = JSON.parse(data) as Record<string, unknown>;
        const b64 = json[options.jsonBinaryField];
        if (typeof b64 === "string") {
          const chunk = base64ToBytes(b64);
          for (const h of audioHandlers) h(chunk);
        }
      } catch {
        /* ignore non-json */
      }
    }
  }

  return {
    async connect() {
      if (connected) return;

      if (socket) {
        connected = true;
        attach(socket);
        return;
      }

      if (!options.url) {
        // Logical in-memory socket for offline / tests
        connected = true;
        return;
      }

      if (!WS) {
        throw new Error(
          "WebSocket implementation not found. Pass WebSocketImpl or socket.",
        );
      }

      await new Promise<void>((resolve, reject) => {
        const ws = options.protocols
          ? new WS(options.url!, options.protocols)
          : new WS(options.url!);
        socket = ws;
        if ("binaryType" in ws) {
          (ws as { binaryType: string }).binaryType = "arraybuffer";
        }
        ws.onopen = () => {
          connected = true;
          options.onOpen?.();
          resolve();
        };
        ws.onerror = (ev) => {
          options.onError?.(ev);
          reject(new Error("WebSocket connection error"));
        };
        attach(ws);
      });
    },

    async disconnect() {
      connected = false;
      try {
        socket?.close();
      } catch {
        /* ignore */
      }
      socket = null;
      audioHandlers.clear();
      options.onClose?.();
    },

    send(data: Uint8Array) {
      if (!connected || !socket || socket.readyState !== OPEN) {
        return;
      }
      if (options.jsonBinaryField) {
        socket.send(
          JSON.stringify({
            [options.jsonBinaryField]: bytesToBase64(data),
          }),
        );
        return;
      }
      socket.send(data.slice().buffer);
    },

    onAudio(handler: (chunk: Uint8Array) => void) {
      audioHandlers.add(handler);
      return () => audioHandlers.delete(handler);
    },

    pushAudio(chunk: Uint8Array) {
      for (const h of audioHandlers) h(chunk);
    },

    getSocket() {
      return socket;
    },
  };

  function attach(ws: WebSocketLike) {
    ws.onmessage = (ev) => {
      handleMessage((ev as MessageEvent).data);
    };
    ws.onclose = () => {
      connected = false;
      options.onClose?.();
    };
  }
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
