export type VoiceChannel = {
  id: string;
  name: string;
  position: number;
};

export type Guild = {
  id: string;
  name: string;
  icon: string | null;
  voiceChannels: VoiceChannel[];
};

type RawUser = {
  id: string;
  username: string;
};

type RawGuild = {
  id: string;
  name: string;
  icon: string | null;
};

type RawChannel = {
  id: string;
  name: string;
  type: number;
  position: number;
};

/** Discord `GUILD_VOICE` channel type, matched by Fluxer */
const GUILD_VOICE = 2;

/** Abort REST requests that hang so the connect flow can't spin forever */
const REQUEST_TIMEOUT = 15000;

const log = (message: string, ...args: unknown[]) =>
  console.log(`[FluxerApi] ${message}`, ...args);

/**
 * Tiny REST client for a Fluxer instance over the global `fetch`.
 * Fluxer's HTTP API is Discord wire-compatible but has no version prefix.
 */
export class FluxerApi {
  /** Origin of the instance e.g. `https://your-fluxer-server.com` */
  readonly origin: string;
  /** REST base e.g. `https://your-fluxer-server.com/api` */
  readonly baseUrl: string;
  private readonly token: string;

  constructor(url: string, token: string) {
    let normalized = url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`;
    }
    this.origin = normalized;
    this.baseUrl = `${normalized}/api`;
    this.token = token;
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    log(`GET ${url}`);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Bot ${this.token}`,
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
    } catch (err) {
      const message =
        (err as Error).name === "TimeoutError"
          ? `Request to ${url} timed out`
          : `Could not reach ${url}: ${(err as Error).message}`;
      log(message);
      throw new Error(message);
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      log(`GET ${url} -> ${response.status} ${response.statusText} ${body}`);
      throw new Error(
        `${response.status} ${response.statusText} (${path})${
          body ? ` - ${body.slice(0, 200)}` : ""
        }`,
      );
    }
    return (await response.json()) as T;
  }

  /** Validates the token early by fetching the bot user */
  async getCurrentUser(): Promise<RawUser> {
    return this.request<RawUser>("/users/@me");
  }

  async getGuilds(): Promise<Guild[]> {
    const rawGuilds = await this.request<RawGuild[]>("/users/@me/guilds");
    return Promise.all(
      rawGuilds.map(async (guild) => ({
        id: guild.id,
        name: guild.name,
        icon: this.getGuildIconUrl(guild.id, guild.icon),
        voiceChannels: await this.getGuildChannels(guild.id),
      })),
    );
  }

  async getGuildChannels(guildId: string): Promise<VoiceChannel[]> {
    const channels = await this.request<RawChannel[]>(
      `/guilds/${guildId}/channels`,
    );
    return channels
      .filter((channel) => channel.type === GUILD_VOICE)
      .map((channel) => ({
        id: channel.id,
        name: channel.name,
        position: channel.position,
      }))
      .sort((a, b) => a.position - b.position);
  }

  /**
   * Resolve the gateway URL. Prefer `GET /gateway/bot`, falling back to the
   * derived `wss://host/gateway` if the call fails.
   */
  async getGatewayUrl(): Promise<string> {
    try {
      const { url } = await this.request<{ url: string }>("/gateway/bot");
      if (url) {
        return url;
      }
    } catch (err) {
      log(`/gateway/bot failed (${(err as Error).message}); using derived URL`);
    }
    return `${this.origin.replace(/^http/i, "ws")}/gateway`;
  }

  getGuildIconUrl(guildId: string, icon: string | null): string | null {
    if (!icon) {
      return null;
    }
    return `${this.origin}/media/icons/${guildId}/${icon}.webp`;
  }
}
