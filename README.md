[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

# Kenku for Fluxer

Kenku for Fluxer is a desktop application for Windows designed to be the easiest way to share music in a [Fluxer](https://github.com/fluxerapp/fluxer) voice call. This fork replaces the original Discord integration with a self-hosted Fluxer server.

- Use the Kenku Player interface to share your **local music** and sound effects to your Fluxer calls.
- Use the built in web browser to share audio from your favourite websites like **YouTube** and **Spotify**. A built-in **ad blocker** (powered by Ghostery filter lists) runs on the browser tabs.
- Trigger and control sounds with the Kenku FM plugin for the **Elgato Stream Deck**.
- If you already have a **virtual audio cable** setup use Kenku FM as an easy way to connect to Fluxer with your existing software.

<p align="center">
  <img src="./docs/example.png" alt="Kenku FM Interface" width="738">
</p>

## Installing

This is a Fluxer fork, so the prebuilt binaries at [kenku.fm](https://www.kenku.fm) and the upstream [GitHub releases](https://github.com/owlbear-rodeo/kenku-fm/releases) **will not work** — those are the original Discord build. To run this fork, build it from source (see [Building](#building)) or use the binaries from your own release pipeline.

The nightly release provides two Windows builds: a `Setup.exe` installer, and a portable `-portable.zip` that needs no installation — extract it into a folder (the archive has no top-level directory) and run `kenku-fm.exe`. (The portable build still keeps its settings in the standard per-user app data folder, not in the extracted folder.)

Instead of a Discord bot, you connect by providing your Fluxer **server URL** and a **bot token** for your Fluxer instance.

## Docs

Docs on using the Kenku Player, remote and Stream Deck can be found [here](https://www.kenku.fm/docs). Note that the connection/setup docs describe Discord — in this fork you supply a Fluxer server URL and bot token instead.

## How it Works

1. Kenku FM is an [Electron](https://www.electronjs.org/) application primarily written in [Typescript](https://www.typescriptlang.org/) and [React](https://reactjs.org/).
2. Electron browser views are used to display external web content or the built in audio player app.
3. The user creates and provides their own Fluxer bot token and server URL to connect to their Fluxer instance.
4. The Electron media capture API is used to capture audio from each browser view. The audio is then mixed using a Web Audio Context and sent to a Fluxer voice call using [LiveKit](https://github.com/livekit/node-sdks).
5. An optional HTTP server allows users to trigger and control the playback of the built in player app. An example of this in action can be seen with our [Stream Deck plugin](https://www.kenku.fm/docs/using-kenku-remote).
6. Enable external inputs to allow mixing in OS audio inputs.
7. Enable multiple outputs to send your audio to several Fluxer voice channels at once (one channel per server/guild on your instance).
8. If you plan to use Kenku FM for streaming you can also output to your local machine for capture by a streaming app and a Fluxer call for your players at the same time.

Voice is delivered over [LiveKit](https://github.com/livekit/node-sdks) rather than Discord's UDP voice protocol: the gateway hands back a LiveKit endpoint and token, and Kenku publishes the mixed audio as a track into each joined room.

## Building

This fork uses [npm](https://www.npmjs.com/) as a package manager (migrated from Yarn) and [Electron Forge](https://www.electronforge.io/) as an Electron builder.

To install all the dependencies run:

`npm install`

A `postinstall` step (`scripts/patch-livekit-exports.js`) patches the `@livekit` packages' `exports` field so Electron Forge's externals plugin can resolve them — this runs automatically. The project `.npmrc` relaxes peer-dependency resolution (`legacy-peer-deps=true`) to accommodate some legacy dev dependencies, and allows git dependencies (`allow-git=all`), which npm 12 otherwise refuses — the castlabs Electron build is installed from git.

The castlabs Electron binary is not downloaded during install; Electron fetches it the first time you start or build the app.

To run Kenku FM in a development mode run:

`npm start`

To make a production build run:

`npm run make`

If you wish to add protected media playback support follow the build steps from the [Electron for Content Security](https://github.com/castlabs/electron-releases) repo.

### Troubleshooting the Fluxer connection

`scripts/fluxer-doctor.js` is a standalone connectivity check. It reports the server version and whether voice is enabled, validates the bot token over REST, then connects to the gateway and test-joins the first voice channel it finds. Run it against your instance to verify your server URL and bot token before launching the app:

`node scripts/fluxer-doctor.js <server-url> <bot-token>`

## Stream Deck

The stream deck plugin can be found [here](https://github.com/owlbear-rodeo/kenku-fm-stream-deck).

## Protected Media

As we act as a web browser in order to play protected media we need to support Google's Widevine [Content Decryption Module (CDM)](https://www.widevine.com/). To do this Kenku FM uses the [Electron for Content Security](https://github.com/castlabs/electron-releases) version of Electron provided by Castlabs.

This allows us to support loading of DRM protected media on Windows.

## Project Structure

All source files can be found in the `src` folder. The CI/CD workflow that builds the nightly release is in `.github/workflows`.

Within the `src` folder the `index.ts` file and `main` folder contains the code for the main process of Electron. This includes things like managing the Fluxer connection, creating the HTTP server for the remote control and managing the browser views.

The `renderer.ts` file and `renderer` folder contains code for the renderer process of Electron. The renderer is written in React and uses Redux Toolkit for state management.

The `preload.ts` file and `preload` folder contains code for the preload script for the renderer. The preload script mainly acts as a bridge to expose functionality from the main process to the renderer.

The `player` folder contains the code for the built in audio player. This runs as a separate web view and is loaded as a separate entry point in the `forge.config.js`. The player app is written in React and also uses Redux Toolkit for state management.

The `audioCapture` folder is a third renderer entry point (also registered in `forge.config.js`). It runs the Web Audio graph that mixes each browser view plus any external inputs down to a single PCM stream, which the main process forwards to LiveKit. The Fluxer-specific main-process code lives in `src/main/broadcast` (`FluxerApi`, `FluxerGateway`, `FluxerBroadcast`).

## Licence

Kenku FM is licensed under the GNU General Public Licence v3.0. See the [LICENSE](./LICENSE) file for the full text. This fork is distributed under the same licence.

### Attribution & modifications

Kenku FM is originally developed by [Owlbear Rodeo](https://www.owlbear.rodeo) — see the upstream project at [owlbear-rodeo/kenku-fm](https://github.com/owlbear-rodeo/kenku-fm). Copyright for the original work remains with its respective authors.

In accordance with section 5 of the GPL, this is a **modified version**. The changes in this fork, made in July 2026, replace the original Discord voice integration with support for a self-hosted [Fluxer](https://github.com/fluxerapp/fluxer) server (Fluxer REST/gateway APIs and LiveKit voice), add a built-in ad blocker, and migrate the build tooling from Yarn to npm.

This is an **unofficial fork and is not affiliated with or endorsed by Owlbear Rodeo.** "Kenku FM" is used here only to identify the upstream project it derives from.

## Contributing

For our own wellbeing Kenku FM follows a similar contribution policy projects like [Litestream](https://github.com/benbjohnson/litestream#open-source-not-open-contribution).

This means we are open to pull requests for bug fixes only. Pull requests for new features will not be accepted due to the burden of maintaining these features into the future.
