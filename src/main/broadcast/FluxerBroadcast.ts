import { BrowserWindow, ipcMain } from "electron";
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { FluxerApi, Guild } from "./FluxerApi";
import { FluxerGateway, VoiceServer } from "./FluxerGateway";

/** Maximum amount of queued audio per room before frames are dropped */
const MAX_QUEUED_MS = 1000;

/**
 * A single LiveKit room for a joined voice channel. Owns its own
 * AudioSource so PCM can be fanned out to every active room independently.
 */
class VoiceRoom {
  readonly channelId: string;
  readonly guildId: string;
  /** Fluxer voice connection id, needed to leave the channel again */
  readonly connectionId?: string;
  /** Called when the room drops without `close()` (e.g. server kick) */
  onUnexpectedDisconnect?: () => void;
  private room = new Room();
  private source: AudioSource;
  private track?: LocalAudioTrack;
  private trackSid?: string;
  private closing = false;

  /** Serializes captureFrame calls so a slow room can't reorder frames */
  private chain: Promise<void> = Promise.resolve();
  /** Approximate amount of audio currently queued, in milliseconds */
  private queuedMs = 0;

  constructor(
    channelId: string,
    guildId: string,
    connectionId: string | undefined,
    sampleRate: number,
    channels: number,
  ) {
    this.channelId = channelId;
    this.guildId = guildId;
    this.connectionId = connectionId;
    this.source = new AudioSource(sampleRate, channels);
    this.room.on(RoomEvent.Disconnected, () => {
      if (!this.closing) {
        this.onUnexpectedDisconnect?.();
      }
    });
  }

  async connect(endpoint: string, token: string) {
    await this.room.connect(endpoint, token, {
      autoSubscribe: false,
      dynacast: false,
    });
    this.track = LocalAudioTrack.createAudioTrack("kenku-fm", this.source);
    const options = new TrackPublishOptions();
    options.source = TrackSource.SOURCE_MICROPHONE;
    options.dtx = false;
    options.red = false;
    const publication = await this.room.localParticipant?.publishTrack(
      this.track,
      options,
    );
    this.trackSid = publication?.sid;
  }

  /**
   * Fan a PCM frame into this room's source. Drops the frame if the room's
   * capture queue has backed up beyond MAX_QUEUED_MS so a single slow room
   * can't stall the shared write path.
   */
  writeFrame(data: Int16Array, sampleRate: number, channels: number) {
    if (this.queuedMs > MAX_QUEUED_MS) {
      return;
    }
    const samplesPerChannel = data.length / channels;
    const frameMs = (samplesPerChannel / sampleRate) * 1000;
    const frame = new AudioFrame(
      data,
      sampleRate,
      channels,
      samplesPerChannel,
    );
    this.queuedMs += frameMs;
    this.chain = this.chain
      .then(() => this.source.captureFrame(frame))
      .catch(() => {
        // Ignore capture errors (e.g. room disconnected mid-write)
      })
      .finally(() => {
        this.queuedMs -= frameMs;
      });
  }

  async close() {
    this.closing = true;
    try {
      if (this.trackSid) {
        await this.room.localParticipant?.unpublishTrack(this.trackSid);
      }
      await this.track?.close();
      await this.room.disconnect();
    } catch {
      // Best-effort cleanup
    }
  }
}

/**
 * Streams Kenku audio into a Fluxer instance. Same IPC role as the old
 * DiscordBroadcast but backed by Fluxer's REST/gateway APIs and LiveKit voice.
 */
export class FluxerBroadcast {
  window: BrowserWindow;
  private api?: FluxerApi;
  private gateway?: FluxerGateway;
  /** Guilds fetched on READY, used to map a channel to its guild */
  private guilds: Guild[] = [];
  private rooms = new Map<string, VoiceRoom>();
  /** Channels with a join in flight, mapped to their guild */
  private joining = new Map<string, string>();
  /** Bumped on every teardown so stale async connect/join work can bail out */
  private generation = 0;

  /** Current PCM stream format, set on startStream */
  private sampleRate = 48000;
  private channels = 2;
  private streaming = false;

  constructor(window: BrowserWindow) {
    this.window = window;
    ipcMain.on("FLUXER_CONNECT", this._handleConnect);
    ipcMain.on("FLUXER_DISCONNECT", this._handleDisconnect);
    ipcMain.on("FLUXER_JOIN_CHANNEL", this._handleJoinChannel);
    ipcMain.on("FLUXER_LEAVE_CHANNEL", this._handleLeaveChannel);
  }

  destroy() {
    ipcMain.off("FLUXER_CONNECT", this._handleConnect);
    ipcMain.off("FLUXER_DISCONNECT", this._handleDisconnect);
    ipcMain.off("FLUXER_JOIN_CHANNEL", this._handleJoinChannel);
    ipcMain.off("FLUXER_LEAVE_CHANNEL", this._handleLeaveChannel);
    this._teardown();
  }

  /** Drop the connection; with `event`, tell the renderer each channel left */
  private _teardown(event?: Electron.IpcMainEvent) {
    this.generation++;
    for (const channelId of [...this.rooms.keys(), ...this.joining.keys()]) {
      event?.reply("FLUXER_CHANNEL_LEFT", channelId);
    }
    for (const room of this.rooms.values()) {
      this.gateway?.leaveVoice(room.guildId, room.connectionId);
      void room.close();
    }
    this.rooms.clear();
    this.joining.clear();
    this.gateway?.destroy();
    this.gateway = undefined;
    this.api = undefined;
    this.guilds = [];
  }

  /** Leave a joined channel: tell Fluxer first, then close the LiveKit room */
  private _closeRoom(room: VoiceRoom) {
    this.rooms.delete(room.channelId);
    this.gateway?.leaveVoice(room.guildId, room.connectionId);
    void room.close();
  }

  _handleConnect = async (
    event: Electron.IpcMainEvent,
    url: string,
    token: string,
  ) => {
    if (!url || !token) {
      event.reply("FLUXER_DISCONNECTED");
      event.reply(
        "ERROR",
        "Error connecting to bot: Server URL and token are required",
      );
      return;
    }

    this._teardown();
    const generation = this.generation;

    try {
      const api = new FluxerApi(url, token);
      console.log(`[FluxerBroadcast] Connecting to ${api.origin}`);
      // Validate the token early
      const user = await api.getCurrentUser();
      console.log(
        `[FluxerBroadcast] Authenticated as ${user.username} (${user.id})`,
      );

      const gatewayUrl = await api.getGatewayUrl();
      if (generation !== this.generation) {
        // Disconnected or reconnected while the REST calls were in flight
        return;
      }
      console.log(`[FluxerBroadcast] Gateway URL: ${gatewayUrl}`);
      this.api = api;
      const gateway = new FluxerGateway(gatewayUrl, token);
      this.gateway = gateway;

      gateway.on("error", (message) => {
        event.reply("ERROR", message);
      });
      gateway.on("disconnected", () => {
        if (this.gateway !== gateway) {
          return;
        }
        // The gateway gave up for good, so stop streaming to voice as well
        this._teardown(event);
        event.reply("FLUXER_DISCONNECTED");
        event.reply("FLUXER_GUILDS", []);
        event.reply("FLUXER_CHANNEL_JOINED", "local");
      });

      let readied = false;
      gateway.on("ready", async () => {
        if (readied) {
          return;
        }
        readied = true;
        event.reply("FLUXER_READY");
        event.reply("MESSAGE", "Connected");
        try {
          const guilds = await api.getGuilds();
          if (generation !== this.generation) {
            return;
          }
          this.guilds = guilds;
          event.reply("FLUXER_GUILDS", guilds);
        } catch (err) {
          event.reply(
            "ERROR",
            `Error fetching servers: ${(err as Error).message}`,
          );
        }
      });

      gateway.connect();
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      this._teardown();
      event.reply("FLUXER_DISCONNECTED");
      event.reply("ERROR", `Error connecting to bot: ${(err as Error).message}`);
    }
  };

  _handleDisconnect = async (event: Electron.IpcMainEvent) => {
    this._teardown(event);
    event.reply("FLUXER_DISCONNECTED");
    event.reply("FLUXER_GUILDS", []);
    event.reply("FLUXER_CHANNEL_JOINED", "local");
  };

  _handleJoinChannel = async (
    event: Electron.IpcMainEvent,
    channelId: string,
  ) => {
    const gateway = this.gateway;
    if (!this.api || !gateway) {
      event.reply("FLUXER_CHANNEL_LEFT", channelId);
      event.reply(
        "ERROR",
        "Unable to join voice channel. Not connected to a Fluxer server.",
      );
      return;
    }
    if (this.rooms.has(channelId)) {
      event.reply("FLUXER_CHANNEL_JOINED", channelId);
      return;
    }
    if (this.joining.has(channelId)) {
      return;
    }

    // Claim the channel before any await so a leave sent right after this
    // join (the renderer switches channels with leave + join) can cancel it.
    const generation = this.generation;
    this.joining.set(channelId, "");
    // Join requests and leaves can interleave across the awaits below, so the
    // join is only still wanted while it holds its claim in `joining`.
    const stillWanted = () =>
      generation === this.generation && this.joining.has(channelId);

    let guildId: string | undefined;
    try {
      guildId = await this._resolveGuild(channelId);
    } catch (err) {
      if (stillWanted()) {
        this.joining.delete(channelId);
        event.reply("FLUXER_CHANNEL_LEFT", channelId);
        event.reply(
          "ERROR",
          `Unable to join voice channel: ${(err as Error).message}`,
        );
      }
      return;
    }
    if (!stillWanted()) {
      return;
    }
    if (!guildId) {
      this.joining.delete(channelId);
      event.reply("FLUXER_CHANNEL_LEFT", channelId);
      event.reply("ERROR", "Unable to join voice channel: channel not found");
      return;
    }

    // One channel per guild: leave any joined or joining channel in the same
    // guild. A superseded join fails silently once it loses its claim.
    for (const room of [...this.rooms.values()]) {
      if (room.guildId === guildId) {
        this._closeRoom(room);
        event.reply("FLUXER_CHANNEL_LEFT", room.channelId);
      }
    }
    for (const [otherId, otherGuildId] of this.joining) {
      if (otherGuildId === guildId && otherId !== channelId) {
        this.joining.delete(otherId);
        event.reply("FLUXER_CHANNEL_LEFT", otherId);
      }
    }
    this.joining.set(channelId, guildId);

    let server: VoiceServer | undefined;
    let room: VoiceRoom | undefined;
    try {
      server = await gateway.joinVoice(guildId, channelId);
      room = new VoiceRoom(
        channelId,
        guildId,
        server.connectionId,
        this.sampleRate,
        this.channels,
      );
      await room.connect(server.endpoint, server.token);
    } catch (err) {
      gateway.leaveVoice(guildId, server?.connectionId);
      void room?.close();
      if (stillWanted()) {
        this.joining.delete(channelId);
        event.reply("FLUXER_CHANNEL_LEFT", channelId);
        event.reply(
          "ERROR",
          `Error connecting to voice channel: ${(err as Error).message}`,
        );
      }
      return;
    }

    if (!stillWanted()) {
      // Left, superseded or disconnected while LiveKit was connecting
      gateway.leaveVoice(guildId, server.connectionId);
      void room.close();
      return;
    }
    this.joining.delete(channelId);
    room.onUnexpectedDisconnect = () => {
      if (this.rooms.get(channelId) !== room) {
        return;
      }
      this._closeRoom(room);
      event.reply("FLUXER_CHANNEL_LEFT", channelId);
      event.reply("ERROR", "Disconnected from the voice channel");
    };
    this.rooms.set(channelId, room);
    event.reply("FLUXER_CHANNEL_JOINED", channelId);
  };

  _handleLeaveChannel = async (
    event: Electron.IpcMainEvent,
    channelId: string,
  ) => {
    if (this.joining.delete(channelId)) {
      this.gateway?.cancelJoin(channelId);
    }
    const room = this.rooms.get(channelId);
    if (room) {
      this._closeRoom(room);
    }
    event.reply("FLUXER_CHANNEL_LEFT", channelId);
  };

  /** Find the guild a voice channel belongs to, refetching on a cache miss */
  private async _resolveGuild(channelId: string): Promise<string | undefined> {
    const find = (guilds: Guild[]) =>
      guilds.find((guild) =>
        guild.voiceChannels.some((channel) => channel.id === channelId),
      )?.id;

    const cached = find(this.guilds);
    if (cached || !this.api) {
      return cached;
    }
    const generation = this.generation;
    const guilds = await this.api.getGuilds();
    if (generation === this.generation) {
      this.guilds = guilds;
    }
    return find(guilds);
  }

  // --- Audio sink API used by PlaybackManager ---

  startStream(sampleRate: number, channels: number) {
    this.sampleRate = sampleRate;
    this.channels = channels;
    this.streaming = true;
  }

  writePcm(buffer: Buffer) {
    if (!this.streaming || this.rooms.size === 0) {
      return;
    }
    // Convert interleaved s16le PCM to Int16Array. Only alias the underlying
    // ArrayBuffer when the byte offset is 2-byte aligned; otherwise copy.
    let int16: Int16Array;
    if (buffer.byteOffset % 2 === 0) {
      int16 = new Int16Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength / 2,
      );
    } else {
      const copy = Buffer.from(buffer);
      int16 = new Int16Array(
        copy.buffer,
        copy.byteOffset,
        copy.byteLength / 2,
      );
    }
    for (const room of this.rooms.values()) {
      // Each room copies into its own AudioFrame internally on capture,
      // but the aliased view is shared: pass a copy per room to be safe.
      room.writeFrame(
        Int16Array.from(int16),
        this.sampleRate,
        this.channels,
      );
    }
  }

  stopStream() {
    this.streaming = false;
  }
}
