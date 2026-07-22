// Standalone connectivity check for a Fluxer instance + bot token.
// Exercises the same REST + gateway flow Kenku uses, with verbose output,
// so connection problems can be diagnosed without launching the full app.
//
// Usage:
//   node scripts/fluxer-doctor.js <server-url> <bot-token>
//   node scripts/fluxer-doctor.js https://your-fluxer-server.com MyBotToken
//
// Or via env vars: FLUXER_URL and FLUXER_TOKEN.

const WebSocket = require("ws");

const url = process.argv[2] || process.env.FLUXER_URL;
const token = process.argv[3] || process.env.FLUXER_TOKEN;

if (!url || !token) {
  console.error(
    "Usage: node scripts/fluxer-doctor.js <server-url> <bot-token>",
  );
  process.exit(1);
}

let origin = url.trim().replace(/\/+$/, "");
if (!/^https?:\/\//i.test(origin)) {
  origin = `https://${origin}`;
}
const baseUrl = `${origin}/api`;

const authHeaders = { Authorization: `Bot ${token}` };

function line() {
  console.log("-".repeat(60));
}

async function getJson(path) {
  const target = `${baseUrl}${path}`;
  process.stdout.write(`GET ${target}\n`);
  const res = await fetch(target, {
    headers: authHeaders,
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.text();
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText} - ${body.slice(0, 300)}`);
  }
  return JSON.parse(body);
}

async function checkRest() {
  line();
  console.log("STEP 1: Validate bot token (GET /users/@me)");
  const me = await getJson("/users/@me");
  console.log(`  OK - authenticated as ${me.username} (id ${me.id})`);

  line();
  console.log("STEP 2: List servers (GET /users/@me/guilds)");
  const guilds = await getJson("/users/@me/guilds");
  console.log(`  OK - bot is in ${guilds.length} server(s):`);
  for (const g of guilds) {
    console.log(`    - ${g.name} (id ${g.id})`);
  }
  if (guilds.length === 0) {
    console.log(
      "  ! The bot is not in any server. Invite it to a server first.",
    );
  }

  line();
  console.log("STEP 3: Discover gateway (GET /gateway/bot)");
  let gatewayUrl;
  try {
    const info = await getJson("/gateway/bot");
    gatewayUrl = info.url;
    console.log(`  OK - gateway URL: ${gatewayUrl}`);
  } catch (err) {
    gatewayUrl = `${origin.replace(/^http/i, "ws")}/gateway`;
    console.log(`  /gateway/bot failed (${err.message})`);
    console.log(`  Falling back to derived URL: ${gatewayUrl}`);
  }

  // Find the first voice channel (type 2) so we can test a voice join
  let voiceTarget = null;
  for (const g of guilds) {
    try {
      const channels = await getJson(`/guilds/${g.id}/channels`);
      const voice = channels
        .filter((c) => c.type === 2)
        .sort((a, b) => a.position - b.position)[0];
      if (voice) {
        voiceTarget = { guildId: g.id, channelId: voice.id, name: voice.name };
        break;
      }
    } catch {
      /* ignore and try the next guild */
    }
  }

  return { gatewayUrl, voiceTarget };
}

function buildWsUrl(gatewayUrl) {
  try {
    const parsed = new URL(gatewayUrl);
    if (!parsed.searchParams.has("v")) parsed.searchParams.set("v", "1");
    if (!parsed.searchParams.has("encoding"))
      parsed.searchParams.set("encoding", "json");
    return parsed.toString();
  } catch {
    const sep = gatewayUrl.includes("?") ? "&" : "?";
    return `${gatewayUrl}${sep}v=1&encoding=json`;
  }
}

function checkGateway(gatewayUrl, voiceTarget) {
  return new Promise((resolve) => {
    line();
    const wsUrl = buildWsUrl(gatewayUrl);
    console.log(`STEP 4: Connect to gateway`);
    console.log(`  ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    let heartbeat;
    let sequence = null;
    let settled = false;
    let readyTimeout;
    let voiceTimeout;

    const finish = (ok, message) => {
      if (settled) return;
      settled = true;
      if (heartbeat) clearInterval(heartbeat);
      clearTimeout(readyTimeout);
      clearTimeout(voiceTimeout);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      console.log(`  ${ok ? "OK" : "FAIL"} - ${message}`);
      resolve(ok);
    };

    readyTimeout = setTimeout(
      () => finish(false, "Timed out waiting for READY (20s)"),
      20000,
    );

    ws.on("open", () => console.log("  Socket open"));

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (typeof msg.s === "number") sequence = msg.s;

      if (msg.op === 10) {
        const interval = msg.d.heartbeat_interval;
        console.log(`  Received Hello (heartbeat every ${interval}ms)`);
        console.log("  Sending Identify...");
        ws.send(
          JSON.stringify({
            op: 2,
            d: {
              token: `Bot ${token}`,
              properties: {
                os: "windows",
                browser: "Kenku FM",
                device: "Kenku FM",
              },
            },
          }),
        );
        heartbeat = setInterval(
          () => ws.send(JSON.stringify({ op: 1, d: sequence })),
          interval,
        );
      } else if (msg.op === 0 && msg.t === "READY") {
        clearTimeout(readyTimeout);
        console.log(`  Received READY (session ${msg.d.session_id})`);
        if (!voiceTarget) {
          finish(
            true,
            "Gateway handshake succeeded (no voice channel found to test).",
          );
          return;
        }
        line();
        console.log(
          `STEP 5: Join voice channel "${voiceTarget.name}" (${voiceTarget.channelId})`,
        );
        console.log("  Sending op 4 with connection_id: null...");
        ws.send(
          JSON.stringify({
            op: 4,
            d: {
              guild_id: voiceTarget.guildId,
              channel_id: voiceTarget.channelId,
              connection_id: null,
              self_mute: false,
              self_deaf: false,
              self_video: false,
              self_stream: false,
            },
          }),
        );
        voiceTimeout = setTimeout(
          () =>
            finish(
              false,
              "Timed out waiting for VOICE_SERVER_UPDATE. The bot may lack " +
                "Connect permission on the channel, or LiveKit may not be " +
                "configured on the server.",
            ),
          15000,
        );
      } else if (msg.op === 0 && msg.t === "VOICE_SERVER_UPDATE") {
        clearTimeout(voiceTimeout);
        const endpoint = msg.d.endpoint;
        console.log(`  Received VOICE_SERVER_UPDATE`);
        console.log(`    endpoint: ${endpoint}`);
        console.log(`    connection_id: ${msg.d.connection_id}`);
        console.log(`    token: ${String(msg.d.token).slice(0, 24)}...`);
        // Leave again to avoid leaving a ghost bot in the channel
        ws.send(
          JSON.stringify({
            op: 4,
            d: {
              guild_id: voiceTarget.guildId,
              channel_id: null,
              connection_id: msg.d.connection_id,
              self_mute: false,
              self_deaf: false,
              self_video: false,
              self_stream: false,
            },
          }),
        );
        finish(true, "Voice join succeeded — Kenku voice output will work!");
      } else if (msg.op === 9) {
        finish(false, "Server sent Invalid Session (token rejected?)");
      }
    });

    ws.on("close", (code, reason) => {
      const text = reason ? reason.toString() : "";
      const hint =
        code === 4012
          ? " (invalid API version — this is the bug the fix addresses)"
          : code === 4004
            ? " (authentication failed — bad bot token)"
            : "";
      finish(false, `Socket closed: code ${code} ${text}${hint}`);
    });

    ws.on("error", (err) => finish(false, `Socket error: ${err.message}`));
  });
}

(async () => {
  console.log(`Fluxer Doctor — checking ${origin}`);
  try {
    const { gatewayUrl, voiceTarget } = await checkRest();
    const ok = await checkGateway(gatewayUrl, voiceTarget);
    line();
    if (ok) {
      console.log("RESULT: All checks passed. ✔");
      process.exit(0);
    } else {
      console.log("RESULT: Gateway check failed. See above. ✖");
      process.exit(2);
    }
  } catch (err) {
    line();
    console.log(`RESULT: Failed — ${err.message} ✖`);
    process.exit(2);
  }
})();
