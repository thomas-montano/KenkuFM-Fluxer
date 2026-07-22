const path = require("path");

const config = {
  packagerConfig: {
    executableName: "kenku-fm",
    out: "./out",
    icon: "./src/assets/icon",
    appBundleId: "com.kenku.fm",
    // This project uses the castlabs Electron build (electron dep pinned to
    // "#v37.6.0+wvcus"). Those "+wvcus" binaries only exist in the castlabs
    // release repo, so point @electron/get at the castlabs mirror — otherwise
    // packaging 404s trying to fetch them from electron/electron.
    download: {
      mirrorOptions: {
        mirror:
          "https://github.com/castlabs/electron-releases/releases/download/",
      },
    },
  },
  makers: [
    {
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "kenku_fm",
        setupIcon: path.join(__dirname, "src", "assets", "setup.ico"),
        loadingGif: path.join(__dirname, "src", "assets", "loading.gif"),
      },
    },
    {
      name: "@electron-forge/maker-deb",
      config: {
        name: "kenku_fm",
        productName: "Kenku FM",
        homepage: "https://github.com/thomas-montano/KenkuFM-Fluxer",
        icon: path.join(__dirname, "src", "assets", "icons", "256x256.png"),
      },
    },
    {
      // On Windows the zip doubles as a portable, no-install build.
      name: "@electron-forge/maker-zip",
      platforms: ["linux", "darwin", "win32"],
    },
    {
      name: "@electron-forge/maker-rpm",
      config: {
        name: "kenku_fm",
        productName: "Kenku FM",
        homepage: "https://github.com/thomas-montano/KenkuFM-Fluxer",
        icon: path.join(__dirname, "src", "assets", "icons", "256x256.png"),
      },
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-webpack",
      config: {
        mainConfig: "./webpack.main.config.js",
        renderer: {
          config: "./webpack.renderer.config.js",
          entryPoints: [
            {
              html: "./src/index.html",
              js: "./src/renderer.ts",
              name: "main_window",
              preload: {
                js: "./src/preload.ts",
              },
            },
            {
              html: "./src/player/index.html",
              js: "./src/player/renderer.ts",
              name: "player_window",
              preload: {
                js: "./src/player/preload.ts",
              },
            },
            {
              html: "./src/audioCapture/index.html",
              js: "./src/audioCapture/renderer.ts",
              name: "audio_capture_window",
              preload: {
                js: "./src/audioCapture/preload.ts",
              },
            },
          ],
        },
        devContentSecurityPolicy: "",
      },
    },
    {
      name: "@timfish/forge-externals-plugin",
      config: {
        externals: ["@livekit/rtc-node"],
        includeDeps: true,
      },
    },
  ],
};

module.exports = config;
