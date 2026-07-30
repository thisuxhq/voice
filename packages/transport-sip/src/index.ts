import type { TransportProvider } from "@thisux/voice-core";

export type SipCallState =
  | "idle"
  | "registering"
  | "ready"
  | "inviting"
  | "ringing"
  | "answered"
  | "hanging-up"
  | "ended"
  | "failed";

export interface SipTransportOptions {
  /** SIP URI of this user agent, e.g. sip:agent@example.com */
  uri: string;
  /** Registrar / proxy host */
  registrar?: string;
  username?: string;
  password?: string;
  /**
   * Outbound signaling adapter — plug JsSIP, SIP.js, or your SBC webhook here.
   * Phase 2 ships the session/signaling contract; wire a real stack in production.
   */
  signaling?: SipSignalingAdapter;
  onState?: (state: SipCallState) => void;
}

export interface SipSignalingAdapter {
  register?(opts: {
    uri: string;
    registrar?: string;
    username?: string;
    password?: string;
  }): Promise<void>;
  unregister?(): Promise<void>;
  invite(target: string, opts?: { sdp?: string }): Promise<{ callId: string }>;
  answer?(callId: string, opts?: { sdp?: string }): Promise<void>;
  hangup(callId: string): Promise<void>;
  onInvite?: (handler: (invite: SipInboundInvite) => void) => void;
  /** Push RTP / audio frames when the media path is ready */
  onAudio?: (handler: (chunk: Uint8Array) => void) => void | (() => void);
  sendAudio?(chunk: Uint8Array): void;
}

export interface SipInboundInvite {
  callId: string;
  from: string;
  to: string;
  sdp?: string;
}

export interface SipTransport extends TransportProvider {
  readonly state: SipCallState;
  readonly callId: string | null;
  /** Place an outbound call */
  invite(target: string): Promise<void>;
  /** Accept inbound invite */
  answer(): Promise<void>;
  hangup(): Promise<void>;
  /** Inject inbound audio (tests / media bridge) */
  pushAudio(chunk: Uint8Array): void;
}

/**
 * SIP transport for telephony (Phase 2).
 *
 * This package defines the session lifecycle and audio bridge. Provide a
 * `signaling` adapter (JsSIP, FreeSWITCH ESL, Twilio SIP domain, etc.) for
 * real on-wire SIP. Without an adapter, an in-memory demo adapter is used
 * so unit tests and offline demos still exercise the contract.
 */
export function sip(options: SipTransportOptions): SipTransport {
  const signaling = options.signaling ?? createMemorySipSignaling();
  let state: SipCallState = "idle";
  let callId: string | null = null;
  let connected = false;
  const audioHandlers = new Set<(chunk: Uint8Array) => void>();
  let unsubAudio: (() => void) | undefined;

  function setState(next: SipCallState) {
    state = next;
    options.onState?.(next);
  }

  return {
    get state() {
      return state;
    },
    get callId() {
      return callId;
    },

    async connect() {
      if (connected) return;
      setState("registering");
      await signaling.register?.({
        uri: options.uri,
        registrar: options.registrar,
        username: options.username,
        password: options.password,
      });
      const off = signaling.onAudio?.((chunk) => {
        for (const h of audioHandlers) h(chunk);
      });
      if (typeof off === "function") unsubAudio = off;
      setState("ready");
      connected = true;
    },

    async disconnect() {
      if (callId) {
        try {
          await signaling.hangup(callId);
        } catch {
          /* ignore */
        }
        callId = null;
      }
      unsubAudio?.();
      await signaling.unregister?.();
      setState("ended");
      connected = false;
      audioHandlers.clear();
    },

    send(data: Uint8Array) {
      if (!connected || state !== "answered") return;
      signaling.sendAudio?.(data);
    },

    onAudio(handler: (chunk: Uint8Array) => void) {
      audioHandlers.add(handler);
      return () => audioHandlers.delete(handler);
    },

    async invite(target: string) {
      if (!connected) throw new Error("SIP transport not connected");
      setState("inviting");
      try {
        const res = await signaling.invite(target);
        callId = res.callId;
        setState("answered");
      } catch (err) {
        setState("failed");
        throw err;
      }
    },

    async answer() {
      if (!callId) throw new Error("No inbound call to answer");
      setState("ringing");
      await signaling.answer?.(callId);
      setState("answered");
    },

    async hangup() {
      if (!callId) return;
      setState("hanging-up");
      await signaling.hangup(callId);
      callId = null;
      setState("ended");
    },

    pushAudio(chunk: Uint8Array) {
      for (const h of audioHandlers) h(chunk);
    },
  };
}

/** In-memory SIP signaling for demos and tests. */
export function createMemorySipSignaling(): SipSignalingAdapter {
  let audioHandler: ((chunk: Uint8Array) => void) | null = null;
  let callCounter = 0;

  return {
    async register() {
      /* no-op */
    },
    async unregister() {
      /* no-op */
    },
    async invite(_target: string) {
      callCounter += 1;
      return { callId: `mem-call-${callCounter}` };
    },
    async answer(_callId: string) {
      /* no-op */
    },
    async hangup(_callId: string) {
      /* no-op */
    },
    onAudio(handler) {
      audioHandler = handler;
      return () => {
        audioHandler = null;
      };
    },
    sendAudio(chunk: Uint8Array) {
      // Echo path for demos: optional loopback is caller-controlled via pushAudio
      void chunk;
    },
  };
}
