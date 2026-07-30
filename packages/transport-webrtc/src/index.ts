import type { TransportProvider } from "@thisux/voice-core";

export interface WebRTCTransportOptions {
  /**
   * Optional RTCPeerConnection factory (browser / polyfill).
   * Defaults to global RTCPeerConnection when available.
   */
  createPeerConnection?: () => RTCPeerConnection;
  /** Called when local ICE candidates / SDP need signaling */
  onSignal?: (signal: unknown) => void;
}

/**
 * Phase 1 WebRTC transport scaffold.
 *
 * Connects a peer connection and shuttles PCM/opus frames.
 * Signaling is application-owned via `onSignal` / `applySignal`.
 */
export function webrtc(options: WebRTCTransportOptions = {}): TransportProvider & {
  applySignal(signal: unknown): Promise<void>;
  getPeerConnection(): RTCPeerConnection | null;
} {
  let pc: RTCPeerConnection | null = null;
  let dataChannel: RTCDataChannel | null = null;
  const audioHandlers = new Set<(chunk: Uint8Array) => void>();
  let connected = false;

  const transport = {
    async connect() {
      if (connected) return;

      const factory =
        options.createPeerConnection ??
        (() => {
          if (typeof RTCPeerConnection === "undefined") {
            // Headless / Node: logical connect without a real PC
            return null as unknown as RTCPeerConnection;
          }
          return new RTCPeerConnection();
        });

      pc = factory();

      if (pc && typeof pc.createDataChannel === "function") {
        dataChannel = pc.createDataChannel("voice-audio");
        dataChannel.binaryType = "arraybuffer";
        dataChannel.onmessage = (ev) => {
          const data = ev.data;
          let chunk: Uint8Array;
          if (data instanceof ArrayBuffer) {
            chunk = new Uint8Array(data);
          } else if (data instanceof Uint8Array) {
            chunk = data;
          } else {
            return;
          }
          for (const h of audioHandlers) h(chunk);
        };
      }

      connected = true;
    },

    async disconnect() {
      dataChannel?.close();
      dataChannel = null;
      pc?.close();
      pc = null;
      connected = false;
      audioHandlers.clear();
    },

    send(data: Uint8Array) {
      if (!connected) return;
      if (dataChannel && dataChannel.readyState === "open") {
        // Copy into a fresh ArrayBuffer so TS is happy with BufferSource
        const copy = data.slice().buffer;
        dataChannel.send(copy);
        return;
      }
      // No DC yet: still notify outbound hooks if needed later
      void data;
    },

    onAudio(handler: (chunk: Uint8Array) => void) {
      audioHandlers.add(handler);
      return () => audioHandlers.delete(handler);
    },

    async applySignal(_signal: unknown) {
      // Application wires SDP/ICE here in a later iteration
    },

    getPeerConnection() {
      return pc;
    },
  };

  return transport;
}
