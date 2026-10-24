[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

# Kenku for Fluxer

Kenku for Fluxer is a Windows desktop app for playing music and sound effects into a [Fluxer](https://github.com/fluxerapp/fluxer) voice call. It is an unofficial fork of [Kenku FM](https://github.com/owlbear-rodeo/kenku-fm) by Owlbear Rodeo, with the Discord integration replaced by support for a self-hosted Fluxer server.

- **Built-in player.** Build playlists and soundboards from your own music and sound-effect files.
- **Built-in browser.** Play audio from websites such as YouTube into the call. Browser tabs run an ad blocker that uses Ghostery's filter lists. Sites that use DRM, such as Spotify, need a signed build; see [Protected media](#protected-media).
- **Remote control.** An optional local HTTP API lets other tools control the player, including the Kenku FM [Stream Deck plugin](https://github.com/owlbear-rodeo/kenku-fm-stream-deck).
- **External inputs.** Mix in audio devices such as a microphone or a virtual audio cable.
- **Multiple outputs.** Play into voice channels on several Fluxer servers at once, and to **This Computer** so you can hear the mix or capture it in streaming software.

<p align="center">
  <img src="./docs/example.png" alt="Kenku FM window with bookmarks and voice channel outputs in the sidebar, and the built-in player showing playlists and soundboards" width="738">
  <br>
  <sub>Screenshot from upstream Kenku FM on macOS.</sub>
</p>

## Installing

Download a build from the [nightly pre-release](https://github.com/thomas-montano/KenkuFM-Fluxer/releases/tag/nightly). CI rebuilds it on every push to `main`, in two forms:

- **`…Setup.exe`** installs the app.
- **`…-portable.zip`** runs without installing. Extract it into a folder (the archive has no top-level folder) and run `kenku-fm.exe`. The portable build still saves its settings in `%APPDATA%\Kenku FM`, not next to the executable.

The builds are unsigned, so Windows may warn about an unrecognized publisher.

The downloads at [kenku.fm](https://www.kenku.fm) and in the [upstream releases](https://github.com/owlbear-rodeo/kenku-fm/releases) are the original Discord app and can't connect to Fluxer. To build this fork yourself, see [Building from source](#building-from-source).

## Connecting to Fluxer

You need:

- A Fluxer instance with voice enabled. Kenku sends audio over LiveKit, so the instance must have LiveKit configured.
- A bot account on that instance, and its token. The **Where do I get my token?** link in Settings opens the [Fluxer docs](https://docs.fluxer.app).
- The bot added to your Fluxer server, with permission to connect to the voice channels you want to use.

To connect:

1. Click the gear icon at the top of the sidebar to open **Settings**.
2. Under **Fluxer**, enter the **Server URL**, for example `https://your-fluxer-server.com`. If you leave out `https://`, Kenku adds it.
3. Enter the **Bot Token** and click **Connect**.
4. Click **Done**. Your servers and their voice channels appear under **Output**. Click a channel to join it.

Kenku saves the URL and token, unencrypted, in its app data folder, and reconnects automatically on the next launch.

Some limits apply:

- The bot can be in one voice channel per Fluxer server. Joining a second channel on the same server leaves the first.
- Kenku can't join peer-to-peer voice channels, or channels that are full.

### Troubleshooting the connection

`scripts/fluxer-doctor.js` checks a server URL and bot token without starting the app. Run it from a clone of this repo after `npm install`:

```
node scripts/fluxer-doctor.js <server-url> <bot-token>
```

You can also pass the values in the `FLUXER_URL` and `FLUXER_TOKEN` environment variables. The script follows the same steps as the app and prints the result of each:

1. Reads the server version, and whether voice is enabled, from `/.well-known/fluxer`.
2. Validates the token and lists the servers the bot is in.
3. Finds the gateway URL and connects to it.
4. Joins the first voice channel it finds, checks that the server returns a LiveKit endpoint, then leaves.

It exits with code 0 if every check passes and 2 if one fails. If the voice join times out, either the bot lacks permission to connect to the channel or the instance has no LiveKit configured.

## Settings

Besides the Fluxer connection, **Settings** has these options:

| Setting | What it does |
| --- | --- |
| **Remote** address and port | Where the remote API listens. The default is `127.0.0.1:3333`. Click **Start Remote** to turn it on. The API has no authentication, so if it listens on any address other than `127.0.0.1`, anyone on your network can control the player. |
| **Streaming** mode | **Performance** (the default) sends the mix in half-second chunks, which adds delay. **Low Latency** sends 10 ms chunks. Restart the app after changing it. |
| **Show Tab URL Bar** | Shows the address bar above browser tabs. |
| **Multiple Outputs** | Lets you select more than one output at once. |
| **External Inputs** | Adds an **Input** list to the sidebar for mixing in audio devices. |
| **Multiple Inputs** | Lets you select more than one external input. Needs **External Inputs**. |
| **Clear Cache** | Clears the browser cache, cookies and cache storage, which signs you out of websites. |

## Using Kenku

The upstream [Kenku FM docs](https://www.kenku.fm/docs) cover the player, the remote and the Stream Deck plugin, and they apply to this fork. Their connection pages describe Discord; follow [Connecting to Fluxer](#connecting-to-fluxer) instead.

### Remote API

The remote API is unchanged from upstream, so the [Stream Deck plugin](https://github.com/owlbear-rodeo/kenku-fm-stream-deck) works with this fork, and the upstream [remote docs](https://www.kenku.fm/docs/using-kenku-remote) describe it in full. Request bodies are JSON.

| Request | Body | Action |
| --- | --- | --- |
| `GET /v1/playlist` | | List playlists and tracks |
| `PUT /v1/playlist/play` | `{"id": "…"}` | Play a playlist or a track |
| `GET /v1/playlist/playback` | | Get the current playlist playback state |
| `PUT /v1/playlist/playback/play` | | Resume |
| `PUT /v1/playlist/playback/pause` | | Pause |
| `POST /v1/playlist/playback/next` | | Skip to the next track |
| `POST /v1/playlist/playback/previous` | | Go back to the previous track |
| `PUT /v1/playlist/playback/mute` | `{"mute": true}` | Mute or unmute |
| `PUT /v1/playlist/playback/volume` | `{"volume": 0.5}` | Set the volume, from 0 to 1 |
| `PUT /v1/playlist/playback/seek` | `{"to": 30}` | Seek to a position, in seconds |
| `PUT /v1/playlist/playback/repeat` | `{"repeat": "playlist"}` | Set repeat to `off`, `track` or `playlist` |
| `PUT /v1/playlist/playback/shuffle` | `{"shuffle": true}` | Turn shuffle on or off |
| `GET /v1/soundboard` | | List soundboards and sounds |
| `PUT /v1/soundboard/play` | `{"id": "…"}` | Play a sound, or a random sound from a soundboard |
| `PUT /v1/soundboard/stop` | `{"id": "…"}` | Stop a sound |
| `GET /v1/soundboard/playback` | | List the sounds that are playing |

## How it works

Kenku is an [Electron](https://www.electronjs.org/) app written in [TypeScript](https://www.typescriptlang.org/) and [React](https://react.dev/).

**Audio.** Each browser tab, and the built-in player, is an Electron `WebContentsView`. A hidden audio-capture window captures each view's audio and any external inputs, and mixes them in a Web Audio context at 48 kHz stereo. An audio worklet converts the mix to 16-bit PCM and sends it to the main process over a loopback WebSocket that only the capture window can use. The **This Computer** output plays the same mix on your speakers.

**Voice.** Kenku validates the bot token over Fluxer's REST API, then connects to the gateway as the bot. Fluxer's REST and gateway protocols are Discord-compatible, but its voice is not: when Kenku joins a channel, the gateway returns a [LiveKit](https://livekit.io/) endpoint and token instead of a Discord voice server. Kenku connects to that LiveKit room with [`@livekit/rtc-node`](https://github.com/livekit/node-sdks) and publishes the mix as an audio track. Each joined channel gets its own room.

**Remote.** The remote API is a [Fastify](https://fastify.dev/) server in the main process that passes requests on to the player.

## Building from source

You need Windows, [Node.js](https://nodejs.org/) 24 (the version CI uses) and Git. The project uses npm and [Electron Forge](https://www.electronforge.io/).

| Command | What it does |
| --- | --- |
| `npm install` | Installs dependencies and runs the postinstall scripts described below |
| `npm start` | Runs the app in development mode |
| `npm run make` | Builds the installer into `out/make/squirrel.windows/x64/` and the portable zip into `out/make/zip/win32/x64/` |
| `npm run package` | Builds the app into `out/` without an installer |
| `npm run lint` | Runs ESLint |

Some things to know about the install:

- The `electron` dependency is the [castlabs build](https://github.com/castlabs/electron-releases) (see [Protected media](#protected-media)), installed from Git. Its binary isn't downloaded during `npm install`; Electron downloads it the first time you start or build the app.
- `.npmrc` sets `legacy-peer-deps=true`, because Electron Forge's terminal UI declares React 19 as a peer dependency while the app uses React 18. It also sets `allow-git=all`, because npm 12 refuses Git dependencies without it.
- `scripts/patch-livekit-exports.js` adds `./package.json` to the `exports` map of `@livekit/rtc-node` and `@livekit/mutex`, which Forge's externals plugin needs to resolve them. It runs after install, and again from `forge.config.js` on every Forge command.
- `scripts/track-nightly-tag.js` adds `+refs/tags/nightly:refs/tags/nightly` to your clone's `remote.origin.fetch`. CI moves the `nightly` tag on every push, and without this refspec `git pull --tags` fails with "would clobber existing tag".

### Continuous integration

[`.github/workflows/build-release.yaml`](.github/workflows/build-release.yaml) runs on every push to `main`, and can be started by hand. It builds on `windows-latest` with Node.js 24, uploads `out/make/` as a workflow artifact, and replaces the `nightly` pre-release with the new `Setup.exe` and portable zip. The builds aren't code-signed, and the workflow needs no secrets.

## Protected media

Some sites, such as Spotify, play DRM-protected audio, which needs Google's [Widevine](https://www.widevine.com/) Content Decryption Module. Kenku uses castlabs' [Electron for Content Security](https://github.com/castlabs/electron-releases), a build of Electron that can load Widevine. If Widevine fails to load, the app shows "Widevine DRM Error: Licensed music playback is disabled".

The nightly builds aren't signed, and DRM playback isn't available in unsigned builds. To enable it in your own build, follow the signing steps in the [castlabs repo](https://github.com/castlabs/electron-releases).

## Project structure

| Path | Contents |
| --- | --- |
| `src/index.ts`, `src/menu.ts`, `src/bounds.ts` | Main-process entry point, app menu and saved window position |
| `src/main/broadcast/` | The Fluxer integration: `FluxerApi` (REST), `FluxerGateway` (gateway WebSocket) and `FluxerBroadcast` (voice joins and LiveKit rooms) |
| `src/main/managers/` | Main-process managers for the session, browser views, audio capture, playback and the player |
| `src/main/remote/` | Remote API routes |
| `src/main/adBlocker.ts` | Ad blocker setup. The filter engine is cached in the app data folder and refreshed after 24 hours. |
| `src/main/userAgent.ts` | The Chrome user agent that browser tabs send |
| `src/preload.ts`, `src/preload/` | Preload scripts that connect the main process to the UI, plus the Web Audio mixer (`AudioCaptureManagerPreload.ts`) and its PCM worklet |
| `src/renderer.ts`, `src/renderer/` | The main window's UI, in React with Redux Toolkit. Settings and bookmarks are saved with redux-persist. |
| `src/player/` | The built-in player, a separate React and Redux Toolkit app |
| `src/player/backgrounds/` | Default playlist and soundboard backgrounds, from Pexels (see [ATTRIBUTION.md](src/player/backgrounds/ATTRIBUTION.md)) |
| `src/audioCapture/` | The hidden window that hosts the audio mixer |
| `src/types/player.ts` | Types for the remote API's replies |
| `scripts/` | Install helpers and `fluxer-doctor.js` |
| `forge.config.js`, `webpack.*.js` | Electron Forge and webpack configuration. Forge builds three renderer entry points: `main_window`, `player_window` and `audio_capture_window`. |

## Licence

Kenku for Fluxer is licensed under the GNU General Public Licence v3.0, like upstream Kenku FM. See [LICENSE](./LICENSE) for the full text.

### Attribution and modifications

Kenku FM was originally developed by [Owlbear Rodeo](https://www.owlbear.rodeo); the upstream project is [owlbear-rodeo/kenku-fm](https://github.com/owlbear-rodeo/kenku-fm). Copyright in the original work remains with its authors.

As section 5 of the GPL requires, this notice states that this is a **modified version**. The changes, made from July 2026 onward:

- Replace the Discord voice integration with support for a self-hosted [Fluxer](https://github.com/fluxerapp/fluxer) server, using Fluxer's REST and gateway APIs and LiveKit voice.
- Add a built-in ad blocker for browser tabs.
- Ship license-free default backgrounds in the repository, leaving out upstream's five licensed Shutterstock images.
- Build for Windows only, with an unsigned nightly build from GitHub Actions.
- Move the build tooling from Yarn to npm.

This is an **unofficial fork, not affiliated with or endorsed by Owlbear Rodeo.** The name "Kenku FM" is used only to identify the upstream project.

## Contributing

This fork keeps upstream Kenku FM's contribution policy, which is modelled on [Litestream's](https://github.com/benbjohnson/litestream#open-source-not-open-contribution): pull requests for bug fixes are welcome, but pull requests for new features won't be accepted, because of the work of maintaining them.

Report bugs in this repo's [issues](https://github.com/thomas-montano/KenkuFM-Fluxer/issues), not upstream. For connection problems, include the output of `scripts/fluxer-doctor.js`, but never your bot token.
