module.exports = {
  /**
   * This is the main entry point for your application, it's the first file
   * that runs in the main process.
   */
  entry: "./src/index.ts",
  // Put your normal webpack config below here
  module: {
    rules: require("./webpack.rules"),
  },
  resolve: {
    extensions: [".js", ".ts", ".jsx", ".tsx", ".css", ".json"],
  },
  externals: {
    "@livekit/rtc-node": "commonjs2 @livekit/rtc-node",
    // Optional native addons that ws tries to load and falls back without.
    // Leave them as runtime requires instead of failing to resolve them.
    bufferutil: "commonjs bufferutil",
    "utf-8-validate": "commonjs utf-8-validate",
  },
};
