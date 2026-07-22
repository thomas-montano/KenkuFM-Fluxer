import path from "path";
import fs from "fs/promises";
import { app, Session } from "electron";
import { ElectronBlocker } from "@ghostery/adblocker-electron";

// How long a cached engine is considered fresh before we re-download the
// prebuilt filter lists (24h).
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

function cacheFile(): string {
  return path.join(app.getPath("userData"), "adblocker-engine.bin");
}

async function loadFromCache(): Promise<ElectronBlocker | null> {
  try {
    const file = cacheFile();
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      return null;
    }
    const buf = await fs.readFile(file);
    return ElectronBlocker.deserialize(new Uint8Array(buf));
  } catch {
    return null;
  }
}

async function saveToCache(blocker: ElectronBlocker): Promise<void> {
  try {
    await fs.writeFile(cacheFile(), Buffer.from(blocker.serialize()));
  } catch (err) {
    console.warn("Failed to cache ad blocker engine:", err);
  }
}

/**
 * Enable ad/tracker blocking on the given session.
 *
 * Browser tabs run on the default session, so blocking there covers every tab.
 * Unlike loading uBlock Origin as an extension, `@ghostery/adblocker-electron`
 * filters at the network layer and injects cosmetic filters/scriptlets via
 * `webContents.executeJavaScript` (main world, CSP-exempt) — which is what's
 * required to neutralise YouTube's in-video ads.
 *
 * Failures are logged but never block startup.
 */
export async function enableAdBlocker(session: Session): Promise<void> {
  try {
    let blocker = await loadFromCache();
    if (!blocker) {
      // Full list set: ads + tracking + annoyances (includes uBlock Origin's
      // YouTube rules and scriptlet resources).
      blocker = await ElectronBlocker.fromPrebuiltFull(fetch);
      await saveToCache(blocker);
    }
    blocker.enableBlockingInSession(session);
    console.log("Ad blocker enabled");
  } catch (err) {
    console.error("Failed to enable ad blocker:", err);
  }
}
