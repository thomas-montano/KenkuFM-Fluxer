import { BrowserWindow, ipcMain } from "electron";
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { FluxerApi, Guild } from "./FluxerApi";
import { FluxerGateway } from "./FluxerGateway";

/** Maximum amount of queued audio per room before frames are dropped */
const MAX_QUEUED_MS = 1000;

/**
 * A single LiveKit room for a joined voice channel. Owns its own
 * AudioSource so PCM can be fanned out to every active room independently.
 */
class VoiceRoom {
  readonly channelId: string;
  readonly guildId: string;
  private room = new Room();
  private source: AudioSource;
  private track?: LocalAudioTrack;
  private trackSid?: string;

  /** Serializes captureFrame calls so a slow room can't reorder frames */
  private chain: Promise<void> = Promise.resolve();
  /** Approximate amount of audio currently queued, in milliseconds */
  private queuedMs = 0;

  constructor(
    channelId: string,
    guildId: string,
    sampleRate: number,
    channels: number,
  ) {
    this.channelId = channelId;
    this.guildId = guildId;
    this.source = new AudioSource(sampleRate, channels);
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
  private rooms = new Map<string, VoiceRoom>();

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

  private _teardown() {
    for (const room of this.rooms.values()) {
      void room.close();
    }
    this.rooms.clear();
    this.gateway?.destroy();
    this.gateway = undefined;
    this.api = undefined;
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

    try {
      const api = new FluxerApi(url, token);
      console.log(`[FluxerBroadcast] Connecting to ${api.origin}`);
      // Validate the token early
      const user = await api.getCurrentUser();
      console.log(
        `[FluxerBroadcast] Authenticated as ${user.username} (${user.id})`,
      );
      this.api = api;

      const gatewayUrl = await api.getGatewayUrl();
      console.log(`[FluxerBroadcast] Gateway URL: ${gatewayUrl}`);
      const gateway = new FluxerGateway(gatewayUrl, token);
      this.gateway = gateway;

      gateway.on("error", (message) => {
        event.reply("ERROR", message);
      });
      gateway.on("disconnected", () => {
        event.reply("FLUXER_DISCONNECTED");
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
          const guilds: Guild[] = await api.getGuilds();
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
      this._teardown();
      event.reply("FLUXER_DISCONNECTED");
      event.reply("ERROR", `Error connecting to bot: ${(err as Error).message}`);
    }
  };

  _handleDisconnect = async (event: Electron.IpcMainEvent) => {
    this._teardown();
    event.reply("FLUXER_DISCONNECTED");
    event.reply("FLUXER_GUILDS", []);
    event.reply("FLUXER_CHANNEL_JOINED", "local");
  };

  _handleJoinChannel = async (
    event: Electron.IpcMainEvent,
    channelId: string,
  ) => {
    if (!this.api || !this.gateway) {
      event.reply("FLUXER_CHANNEL_LEFT", channelId);
      event.reply(
        "ERROR",
        "Unable to join voice channel. Not connected to a Fluxer server.",
      );
      return;
    }

    const guildId = await this._resolveGuild(channelId);
    if (!guildId) {
      event.reply("FLUXER_CHANNEL_LEFT", channelId);
      event.reply("ERROR", "Unable to join voice channel: channel not found");
      return;
    }

    // One channel per guild: close any existing room in the same guild
    for (const [existingId, room] of this.rooms) {
      if (room.guildId === guildId) {
        await room.close();
        this.rooms.delete(existingId);
        event.reply("FLUXER_CHANNEL_LEFT", existingId);
      }
    }

    try {
      const { endpoint, token } = await this.gateway.joinVoice(
        guildId,
        channelId,
      );
      const room = new VoiceRoom(
        channelId,
        guildId,
        this.sampleRate,
        this.channels,
      );
      await room.connect(endpoint, token);
      this.rooms.set(channelId, room);
      event.reply("FLUXER_CHANNEL_JOINED", channelId);
    } catch (err) {
      this.gateway.leaveVoice(guildId);
      event.reply("FLUXER_CHANNEL_LEFT", channelId);
      event.reply(
        "ERROR",
        `Error connecting to voice channel: ${(err as Error).message}`,
      );
    }
  };

  _handleLeaveChannel = async (
    event: Electron.IpcMainEvent,
    channelId: string,
  ) => {
    const room = this.rooms.get(channelId);
    if (room) {
      this.rooms.delete(channelId);
      await room.close();
      this.gateway?.leaveVoice(room.guildId);
    }
    event.reply("FLUXER_CHANNEL_LEFT", channelId);
  };

  private async _resolveGuild(channelId: string): Promise<string | undefined> {
    if (!this.api) {
      return undefined;
    }
    const guilds = await this.api.getGuilds();
    for (const guild of guilds) {
      if (guild.voiceChannels.some((channel) => channel.id === channelId)) {
        return guild.id;
      }
    }
    return undefined;
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
