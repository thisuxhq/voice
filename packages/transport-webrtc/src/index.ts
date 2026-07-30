import type { TransportProvider } from "@thisux/voice-core";

export type WebRTCSignal =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit | null };

export interface WebRTCTransportOptions {
  /**
   * Optional RTCPeerConnection factory (browser / polyfill).
   * Defaults to global RTCPeerConnection when available.
   */
  createPeerConnection?: () => RTCPeerConnection;
  /** ICE servers for the peer connection */
  iceServers?: RTCIceServer[];
  /** Called when local offer/answer/ICE need out-of-band signaling */
  onSignal?: (signal: WebRTCSignal) => void;
  /** Create data channel as offerer (default true). Answerer waits for remote. */
  initiateDataChannel?: boolean;
  channelLabel?: string;
}

export interface WebRTCTransport extends TransportProvider {
  applySignal(signal: WebRTCSignal): Promise<void>;
  createOffer(): Promise<WebRTCSignal>;
  createAnswer(): Promise<WebRTCSignal>;
  getPeerConnection(): RTCPeerConnection | null;
  getDataChannel(): RTCDataChannel | null;
  readonly signalingState: string;
}

/**
 * WebRTC transport with full SDP/ICE signaling helpers.
 * Audio frames travel on a binary data channel (`voice-audio` by default).
 * Headless Node: logical connect without RTCPeerConnection.
 */
export function webrtc(options: WebRTCTransportOptions = {}): WebRTCTransport {
  let pc: RTCPeerConnection | null = null;
  let dataChannel: RTCDataChannel | null = null;
  const audioHandlers = new Set<(chunk: Uint8Array) => void>();
  let connected = false;
  let headless = false;
  const initiate = options.initiateDataChannel ?? true;
  const label = options.channelLabel ?? "voice-audio";
  const outboundQueue: Uint8Array[] = [];

  function wireChannel(channel: RTCDataChannel) {
    dataChannel = channel;
    dataChannel.binaryType = "arraybuffer";
    dataChannel.onmessage = (ev) => {
      const data = ev.data;
      let chunk: Uint8Array;
      if (data instanceof ArrayBuffer) {
        chunk = new Uint8Array(data);
      } else if (data instanceof Uint8Array) {
        chunk = data;
      } else if (typeof Buffer !== "undefined" && Buffer.isBuffer(data)) {
        chunk = new Uint8Array(data);
      } else {
        return;
      }
      for (const h of audioHandlers) h(chunk);
    };
    dataChannel.onopen = () => {
      while (outboundQueue.length > 0) {
        const next = outboundQueue.shift()!;
        sendRaw(next);
      }
    };
  }

  function sendRaw(data: Uint8Array) {
    if (dataChannel && dataChannel.readyState === "open") {
      const copy = data.slice().buffer;
      dataChannel.send(copy);
    }
  }

  function ensurePeer(): RTCPeerConnection | null {
    if (pc) return pc;
    if (typeof RTCPeerConnection === "undefined" && !options.createPeerConnection) {
      headless = true;
      return null;
    }
    const factory =
      options.createPeerConnection ??
      (() =>
        new RTCPeerConnection({
          iceServers: options.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }],
        }));
    pc = factory();

    pc.onicecandidate = (ev) => {
      options.onSignal?.({
        type: "ice",
        candidate: ev.candidate ? ev.candidate.toJSON() : null,
      });
    };

    pc.ondatachannel = (ev) => {
      wireChannel(ev.channel);
    };

    if (initiate && typeof pc.createDataChannel === "function") {
      wireChannel(pc.createDataChannel(label));
    }

    return pc;
  }

  const transport: WebRTCTransport = {
    get signalingState() {
      return pc?.signalingState ?? (headless ? "headless" : "new");
    },

    async connect() {
      if (connected) return;
      ensurePeer();
      connected = true;
    },

    async disconnect() {
      dataChannel?.close();
      dataChannel = null;
      pc?.close();
      pc = null;
      connected = false;
      headless = false;
      outboundQueue.length = 0;
      audioHandlers.clear();
    },

    send(data: Uint8Array) {
      if (!connected) return;
      if (headless) {
        // Loopback in headless tests is a no-op outbound
        return;
      }
      if (dataChannel && dataChannel.readyState === "open") {
        sendRaw(data);
      } else {
        outboundQueue.push(data);
      }
    },

    onAudio(handler: (chunk: Uint8Array) => void) {
      audioHandlers.add(handler);
      return () => audioHandlers.delete(handler);
    },

    async createOffer() {
      const peer = ensurePeer();
      if (!peer) {
        const signal: WebRTCSignal = { type: "offer", sdp: "headless-offer" };
        options.onSignal?.(signal);
        return signal;
      }
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const signal: WebRTCSignal = {
        type: "offer",
        sdp: peer.localDescription?.sdp ?? offer.sdp ?? "",
      };
      options.onSignal?.(signal);
      return signal;
    },

    async createAnswer() {
      const peer = ensurePeer();
      if (!peer) {
        const signal: WebRTCSignal = { type: "answer", sdp: "headless-answer" };
        options.onSignal?.(signal);
        return signal;
      }
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      const signal: WebRTCSignal = {
        type: "answer",
        sdp: peer.localDescription?.sdp ?? answer.sdp ?? "",
      };
      options.onSignal?.(signal);
      return signal;
    },

    async applySignal(signal: WebRTCSignal) {
      const peer = ensurePeer();
      if (!peer) return;

      if (signal.type === "offer") {
        await peer.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      } else if (signal.type === "answer") {
        await peer.setRemoteDescription({ type: "answer", sdp: signal.sdp });
      } else if (signal.type === "ice" && signal.candidate) {
        try {
          await peer.addIceCandidate(signal.candidate);
        } catch (err) {
          console.error("[webrtc] addIceCandidate", err);
        }
      }
    },

    getPeerConnection() {
      return pc;
    },

    getDataChannel() {
      return dataChannel;
    },
  };

  return transport;
}
