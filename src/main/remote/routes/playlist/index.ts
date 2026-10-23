import { FastifyPluginCallback } from "fastify";

import { PlayerManager } from "../../../managers/PlayerManager";
import { VIEW_ERROR, waitForReply } from "../..";
import { PlaylistsReply } from "../../../../types/player";

export const get: (manager: PlayerManager) => FastifyPluginCallback =
  (manager) => (fastify, _, done) => {
    fastify.get("/", async (_, reply) => {
      const view = manager.getView();
      if (view) {
        view.send("PLAYER_REMOTE_PLAYLIST_GET_ALL_REQUEST");
        try {
          const playlists = await waitForReply<PlaylistsReply>(
            "PLAYER_REMOTE_PLAYLIST_GET_ALL_REPLY"
          );
          reply.status(200).send(playlists);
        } catch {
          reply.status(408).send({
            statusCode: 408,
            error: "Request Timeout",
            message: "Unable to retrieve playlists in a reasonable time",
          });
        }
      } else {
        reply.status(503).send(VIEW_ERROR);
      }
    });

    done();
  };
