import { ipcMain } from "electron";
import { PlayerManager } from "../managers/PlayerManager";
import { get as playlistGet } from "./routes/playlist";
import { play as playlistPlay } from "./routes/playlist/play";
import { playback as playlistPlayback } from "./routes/playlist/playback";
import { get as soundboardGet } from "./routes/soundboard";
import { play as soundboardPlay } from "./routes/soundboard/play";
import { stop as soundboardStop } from "./routes/soundboard/stop";
import { playback as soundboardPlayback } from "./routes/soundboard/playback";

export type ReplyError = {
  statusCode: number;
  error: string;
  message: string;
};

export const VIEW_ERROR: ReplyError = {
  statusCode: 503,
  error: "Service Unavailable",
  message: "Unable to connect to Kenku FM",
};

/** Wait for the player view to answer a request on `channel` */
export function waitForReply<T>(channel: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const handler = (_: Electron.IpcMainEvent, reply: T) => {
      clearTimeout(timeout);
      resolve(reply);
    };
    const timeout = setTimeout(() => {
      ipcMain.off(channel, handler);
      reject(new Error("Request timeout"));
    }, 5000);
    ipcMain.once(channel, handler);
  });
}

export function registerRemote(manager: PlayerManager) {
  manager.fastify.register(playlistGet(manager), {
    prefix: "/v1/playlist",
  });
  manager.fastify.register(playlistPlay(manager), {
    prefix: "/v1/playlist/play",
  });
  manager.fastify.register(playlistPlayback(manager), {
    prefix: "/v1/playlist/playback",
  });
  manager.fastify.register(soundboardGet(manager), {
    prefix: "/v1/soundboard",
  });
  manager.fastify.register(soundboardPlay(manager), {
    prefix: "/v1/soundboard/play",
  });
  manager.fastify.register(soundboardStop(manager), {
    prefix: "/v1/soundboard/stop",
  });
  manager.fastify.register(soundboardPlayback(manager), {
    prefix: "/v1/soundboard/playback",
  });
}
