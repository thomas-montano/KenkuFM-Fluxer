// CI force-moves the "nightly" tag to every commit pushed to main, and git
// won't overwrite a tag that already exists locally, so `git pull --tags`
// (which VS Code's Sync runs) fails with "would clobber existing tag". Add a
// forced fetch refspec for that one tag to this clone's git config.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const refspec = "+refs/tags/nightly:refs/tags/nightly";

function git(...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

// Only in a clone of this repo, and not in CI, which never pulls the tag
if (!process.env.CI && fs.existsSync(path.join(root, ".git"))) {
  try {
    const refspecs = git("config", "--get-all", "remote.origin.fetch");
    if (!refspecs.split(/\r?\n/).includes(refspec)) {
      git("config", "--add", "remote.origin.fetch", refspec);
      console.log(`Added ${refspec} to remote.origin.fetch`);
    }
  } catch {
    // No git on PATH or no origin remote, so there's nothing to configure
  }
}
