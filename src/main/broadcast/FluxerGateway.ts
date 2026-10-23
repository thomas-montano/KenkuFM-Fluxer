import { TypedEmitter } from "tiny-typed-emitter";
import { WebSocket } from "ws";

/** Gateway opcodes (Discord wire-compatible, as implemented by Fluxer) */
const Op = {
  Dispatch: 0,
  Heartbeat: 1,
  Identify: 2,
  VoiceStateUpdate: 4,
  Resume: 6,
  Reconnect: 7,
  InvalidSession: 9,
  Hello: 10,
  HeartbeatAck: 11,
  GatewayError: 12,
} as const;

/**
 * Gateway close codes (https://docs.fluxer.app/gateway/opcodes-and-close-codes/).
 * Codes that indicate a client/protocol problem are fatal — reconnecting would
 * just loop — so we surface them. Everything else is treated as a recoverable
 * disconnect.
 */
const FATAL_CLOSE_CODES: Record<number, string> = {
  4001: "Unknown opcode",
  4002: "Decode error",
  4004: "Authentication failed: invalid bot token",
  4005: "Already authenticated",
  4010: "Invalid shard",
  4011: "Sharding required",
  4012: "Invalid API version",
};

/** Close codes after which the session can't be resumed and needs an Identify */
const SESSION_INVALIDATING_CLOSE_CODES = [4003, 4007];

/** Op 12 refusal codes Fluxer sends for a voice join, mapped to user-facing text */
const VOICE_ERROR_MESSAGES: Record<string, string> = {
  VOICE_CHANNEL_FULL: "The voice channel is full",
  VOICE_P2P_CONSENT_REQUIRED:
    "Peer-to-peer voice channels are not supported by Kenku FM",
  VOICE_P2P_UNAVAILABLE:
    "Peer-to-peer voice channels are not supported by Kenku FM",
};

type GatewayPayload = {
  op: number;
  d?: unknown;
  s?: number | null;
  t?: string | null;
};

export type VoiceServer = {
  token: string;
  endpoint: string;
};

interface FluxerGatewayEvents {
  ready: () => void;
  disconnected: () => void;
  error: (message: string) => void;
}

type VoiceServerUpdate = {
  token?: string;
  endpoint?: string;
  guild_id?: string;
  channel_id?: string;
  connection_id?: string;
  e2ee_key?: string;
};

type PendingVoice = {
  guildId: string;
  channelId: string;
  resolve: (server: VoiceServer) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const VOICE_SERVER_TIMEOUT = 15000;
/** How long to wait for the first READY before giving up on a fresh connect */
const READY_TIMEOUT = 20000;
/** Reconnect backoff bounds; the delay doubles per failed attempt */
const RECONNECT_MIN_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;

const log = (message: string, ...args: unknown[]) =>
  console.log(`[FluxerGateway] ${message}`, ...args);

/**
 * Minimal Fluxer gateway client. Handles identify/heartbeat/resume and the
 * op 4 voice join flow, awaiting the matching VOICE_SERVER_UPDATE dispatch.
 */
export class FluxerGateway extends TypedEmitter<FluxerGatewayEvents> {
  private readonly url: string;
  private readonly token: string;
  private ws?: WebSocket;

  private heartbeatInterval?: ReturnType<typeof setInterval>;
  private heartbeatAcked = true;
  private sequence: number | null = null;
  private sessionId?: string;
  private resumeGatewayUrl?: string;

  /** Set while intentionally closing so the close handler skips reconnect */
  private closing = false;
  /** Set once a fatal error has been surfaced; blocks further reconnects */
  private fatal = false;
  /** True once we've successfully reached READY at least once */
  private hasBeenReady = false;
  /** Timer that fails the initial connect if READY never arrives */
  private readyTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectDelay = RECONNECT_MIN_DELAY;

  private pendingVoice = new Map<string, PendingVoice>();
  /** Server-assigned connection id per guild, captured from VOICE_SERVER_UPDATE */
  private activeConnections = new Map<string, string>();

  constructor(url: string, token: string) {
    super();
    this.url = url;
    this.token = token;
  }

  connect() {
    this.closing = false;
    this.fatal = false;
    this._open(this.resumeGatewayUrl ?? this.url);
    this._startReadyTimer();
  }

  private _buildUrl(gatewayUrl: string): string {
    // Fluxer's gateway requires an API version (?v=1) and a payload encoding.
    // Without v=1 the server closes immediately with 4012 (invalid api version).
    try {
      const parsed = new URL(gatewayUrl);
      if (!parsed.searchParams.has("v")) {
        parsed.searchParams.set("v", "1");
      }
      if (!parsed.searchParams.has("encoding")) {
        parsed.searchParams.set("encoding", "json");
      }
      return parsed.toString();
    } catch {
      const separator = gatewayUrl.includes("?") ? "&" : "?";
      return `${gatewayUrl}${separator}v=1&encoding=json`;
    }
  }

  private _open(gatewayUrl: string) {
    const fullUrl = this._buildUrl(gatewayUrl);
    log(`Connecting to ${fullUrl}`);
    const ws = new WebSocket(fullUrl);
    this.ws = ws;
    ws.on("open", () => log("Socket open"));
    ws.on("message", this._handleMessage);
    ws.on("close", this._handleClose);
    ws.on("error", (err) => {
      log(`Socket error: ${err.message}`);
      // Surface the error only if we never got established; a transient error
      // on an established session is handled by the following close event.
      if (!this.hasBeenReady) {
        this.emit("error", `Gateway connection error: ${err.message}`);
      }
    });
  }

  private _startReadyTimer() {
    this._clearReadyTimer();
    this.readyTimer = setTimeout(() => {
      if (!this.hasBeenReady && !this.fatal) {
        log("Timed out waiting for READY");
        this.fatal = true;
        this.emit(
          "error",
          "Timed out connecting to the Fluxer gateway. Check the server URL and that the bot token is valid.",
        );
        this.destroy();
        this.emit("disconnected");
      }
    }, READY_TIMEOUT);
  }

  private _clearReadyTimer() {
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = undefined;
    }
  }

  private _handleMessage = (raw: Buffer) => {
    let payload: GatewayPayload;
    try {
      payload = JSON.parse(raw.toString());
    } catch {
      log("Received a non-JSON frame; ignoring");
      return;
    }

    if (typeof payload.s === "number") {
      this.sequence = payload.s;
    }

    switch (payload.op) {
      case Op.Hello:
        log("Received Hello");
        this._handleHello(payload.d as { heartbeat_interval: number });
        break;
      case Op.HeartbeatAck:
        this.heartbeatAcked = true;
        break;
      case Op.Heartbeat:
        this._sendHeartbeat();
        break;
      case Op.InvalidSession:
        log("Received Invalid Session; re-identifying");
        this.sessionId = undefined;
        this.sequence = null;
        this.resumeGatewayUrl = undefined;
        // The socket stays open but unauthenticated; identify after a brief delay
        setTimeout(() => this._identify(), 1000);
        break;
      case Op.Reconnect:
        // The server closes with 4000 right after this; the close handler
        // reconnects and resumes the session.
        log("Received Reconnect");
        break;
      case Op.GatewayError:
        this._handleGatewayError(payload.d as { code: string; message: string });
        break;
      case Op.Dispatch:
        this._handleDispatch(payload.t ?? "", payload.d);
        break;
      default:
        break;
    }
  };

  /**
   * Op 12 reports a refused voice join to the session that sent it. It doesn't
   * name the channel, so fail the oldest pending join (the server handles
   * commands in order) rather than letting it time out.
   */
  private _handleGatewayError(data: { code: string; message: string }) {
    log(`Gateway error: ${data?.code} ${data?.message}`);
    const pending = this.pendingVoice.values().next().value as
      | PendingVoice
      | undefined;
    if (!pending) {
      return;
    }
    clearTimeout(pending.timeout);
    this.pendingVoice.delete(pending.guildId);
    pending.reject(
      new Error(VOICE_ERROR_MESSAGES[data?.code] ?? `Refused (${data?.code})`),
    );
  }

  private _handleHello(data: { heartbeat_interval: number }) {
    if (this.sessionId && this.sequence !== null) {
      log("Resuming existing session");
      this._resume();
    } else {
      log("Identifying");
      this._identify();
    }
    this._startHeartbeat(data.heartbeat_interval);
  }

  // The gateway takes the raw token; the `Bot` prefix is only for HTTP
  private _identify() {
    this._send({
      op: Op.Identify,
      d: {
        token: this.token,
        properties: {
          os: "windows",
          browser: "Kenku FM",
          device: "Kenku FM",
        },
      },
    });
  }

  private _resume() {
    this._send({
      op: Op.Resume,
      d: {
        token: this.token,
        session_id: this.sessionId,
        seq: this.sequence,
      },
    });
  }

  private _startHeartbeat(interval: number) {
    this._stopHeartbeat();
    this.heartbeatAcked = true;
    this.heartbeatInterval = setInterval(() => {
      if (!this.heartbeatAcked) {
        // Missed ack: connection is dead, terminate to trigger reconnect
        log("Heartbeat not acked; terminating socket");
        this.ws?.terminate();
        return;
      }
      this._sendHeartbeat();
    }, interval);
  }

  private _sendHeartbeat() {
    this.heartbeatAcked = false;
    this._send({ op: Op.Heartbeat, d: this.sequence });
  }

  private _stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  private _handleDispatch(event: string, data: unknown) {
    if (event === "READY") {
      const d = data as {
        session_id: string;
        resume_gateway_url?: string;
      };
      this.sessionId = d.session_id;
      this.resumeGatewayUrl = d.resume_gateway_url;
      this.hasBeenReady = true;
      this.reconnectDelay = RECONNECT_MIN_DELAY;
      this._clearReadyTimer();
      log(`READY (session ${this.sessionId})`);
      this.emit("ready");
    } else if (event === "RESUMED") {
      log("RESUMED");
      this.reconnectDelay = RECONNECT_MIN_DELAY;
      this.emit("ready");
    } else if (event === "VOICE_SERVER_UPDATE") {
      log("VOICE_SERVER_UPDATE received");
      this._handleVoiceServerUpdate(data as VoiceServerUpdate);
    }
  }

  private _handleVoiceServerUpdate(data: VoiceServerUpdate) {
    // The initial join is sent with a null connection_id, so the server
    // assigns one and returns it here. Match the pending join by channel.
    let pending: PendingVoice | undefined;
    for (const candidate of this.pendingVoice.values()) {
      if (data.channel_id && data.channel_id === candidate.channelId) {
        pending = candidate;
        break;
      }
    }
    if (!pending) {
      log("VOICE_SERVER_UPDATE did not match a pending join");
      return;
    }
    // Remember the server's connection id so we can disconnect it cleanly
    if (data.connection_id) {
      this.activeConnections.set(pending.guildId, data.connection_id);
    }
    clearTimeout(pending.timeout);
    this.pendingVoice.delete(pending.guildId);
    if (!data.endpoint || !data.token) {
      // A peer-to-peer grant has ICE servers instead of a LiveKit endpoint
      pending.reject(new Error("The server did not return a LiveKit endpoint"));
      return;
    }
    if (data.e2ee_key) {
      log("Channel is end-to-end encrypted; publishing without encryption");
    }
    pending.resolve({ token: data.token, endpoint: data.endpoint });
  }

  /**
   * Join a voice channel. Sends op 4 and resolves with the LiveKit
   * connection details from the matching VOICE_SERVER_UPDATE.
   */
  joinVoice(guildId: string, channelId: string): Promise<VoiceServer> {
    // Cancel any in-flight join for this guild
    const existing = this.pendingVoice.get(guildId);
    if (existing) {
      clearTimeout(existing.timeout);
      existing.reject(new Error("Superseded by a new join request"));
      this.pendingVoice.delete(guildId);
    }

    log(`Joining voice: guild=${guildId} channel=${channelId}`);
    return new Promise<VoiceServer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingVoice.delete(guildId);
        reject(new Error("Timed out waiting for voice server"));
      }, VOICE_SERVER_TIMEOUT);

      this.pendingVoice.set(guildId, {
        guildId,
        channelId,
        resolve,
        reject,
        timeout,
      });

      // A null connection_id tells Fluxer to open a NEW voice connection and
      // mint a LiveKit token. Sending a client-generated id instead is treated
      // as an update to an existing connection and never returns a token.
      this._send({
        op: Op.VoiceStateUpdate,
        d: {
          guild_id: guildId,
          channel_id: channelId,
          connection_id: null,
          self_mute: false,
          self_deaf: false,
          self_video: false,
          self_stream: false,
        },
      });
    });
  }

  /** Leave the voice channel in the given guild (op 4 with channel_id null) */
  leaveVoice(guildId: string) {
    const pending = this.pendingVoice.get(guildId);
    if (pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Left before voice server arrived"));
      this.pendingVoice.delete(guildId);
    }
    // Disconnect the exact connection the server assigned, if we have it
    const connectionId = this.activeConnections.get(guildId) ?? null;
    this.activeConnections.delete(guildId);
    log(`Leaving voice: guild=${guildId} connection=${connectionId}`);
    this._send({
      op: Op.VoiceStateUpdate,
      d: {
        guild_id: guildId,
        channel_id: null,
        connection_id: connectionId,
        self_mute: false,
        self_deaf: false,
        self_video: false,
        self_stream: false,
      },
    });
  }

  private _send(payload: GatewayPayload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  private _handleClose = (code: number, reason: Buffer) => {
    this._stopHeartbeat();
    const reasonText = reason?.toString() || "";
    log(`Socket closed: code=${code} reason=${reasonText}`);

    if (this.closing || this.fatal) {
      return;
    }

    // Fatal protocol/auth errors: surface and stop (reconnecting would loop)
    const fatalMessage = FATAL_CLOSE_CODES[code];
    if (fatalMessage) {
      this.fatal = true;
      this._clearReadyTimer();
      this.emit("error", `Gateway closed: ${fatalMessage}`);
      this.emit("disconnected");
      return;
    }

    // If we never established a session, don't silently loop — surface it
    if (!this.hasBeenReady) {
      this.fatal = true;
      this._clearReadyTimer();
      this.emit(
        "error",
        `Gateway closed before the session was ready (code ${code}${
          reasonText ? `: ${reasonText}` : ""
        }).`,
      );
      this.emit("disconnected");
      return;
    }

    if (SESSION_INVALIDATING_CLOSE_CODES.includes(code)) {
      this.sessionId = undefined;
      this.sequence = null;
      this.resumeGatewayUrl = undefined;
    }

    // Established session dropped: attempt to reconnect (resume if possible),
    // backing off so a rate limit (4008) or an outage isn't hammered.
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(delay * 2, RECONNECT_MAX_DELAY);
    log(`Reconnecting in ${delay / 1000}s`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      if (!this.closing && !this.fatal) {
        this._open(this.resumeGatewayUrl ?? this.url);
      }
    }, delay);
  };

  destroy() {
    this.closing = true;
    this._clearReadyTimer();
    this._stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    for (const pending of this.pendingVoice.values()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Gateway destroyed"));
    }
    this.pendingVoice.clear();
    this.activeConnections.clear();
    if (this.ws) {
      this.ws.removeAllListeners();
      // Closing a socket that is still connecting emits an error; swallow it
      // so it can't surface as an unhandled 'error' event.
      this.ws.on("error", () => undefined);
      this.ws.close();
      this.ws = undefined;
    }
    this.sessionId = undefined;
    this.sequence = null;
    this.resumeGatewayUrl = undefined;
    this.hasBeenReady = false;
  }
}
