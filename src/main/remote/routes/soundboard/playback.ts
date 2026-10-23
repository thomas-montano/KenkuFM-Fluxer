import { FastifyPluginCallback } from "fastify";

import { PlayerManager } from "../../../managers/PlayerManager";
import { VIEW_ERROR, waitForReply } from "../../";
import { SoundboardPlaybackReply } from "../../../../types/player";

export const playback: (manager: PlayerManager) => FastifyPluginCallback =
  (manager) => (fastify, _, done) => {
    fastify.get("/", async (_, reply) => {
      const view = manager.getView();
      if (view) {
        view.send("PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REQUEST");
        try {
          const playback = await waitForReply<SoundboardPlaybackReply>(
            "PLAYER_REMOTE_SOUNDBOARD_PLAYBACK_REPLY"
          );
          reply.status(200).send(playback);
        } catch {
          reply.status(408).send({
            statusCode: 408,
            error: "Request Timeout",
            message: "Unable to retrieve playback in a reasonable time",
          });
        }
      } else {
        reply.status(503).send(VIEW_ERROR);
      }
    });

    done();
  };
