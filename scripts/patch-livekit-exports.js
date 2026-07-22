// @timfish/forge-externals-plugin resolves `<external>/package.json`, which
// fails for @livekit packages whose strict `exports` map doesn't expose it.
// Add `"./package.json": "./package.json"` to their exports after install.
const fs = require("fs");
const path = require("path");

const packages = ["@livekit/rtc-node", "@livekit/mutex"];

for (const name of packages) {
  const file = path.join(__dirname, "..", "node_modules", name, "package.json");
  if (!fs.existsSync(file)) {
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  if (pkg.exports && !pkg.exports["./package.json"]) {
    pkg.exports["./package.json"] = "./package.json";
    fs.writeFileSync(file, JSON.stringify(pkg, null, 2));
    console.log(`Patched exports of ${name}`);
  }
}
