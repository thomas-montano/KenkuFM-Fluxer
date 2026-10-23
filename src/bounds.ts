import { BrowserWindow, Rectangle, screen } from "electron";
import Store from "electron-store";
import throttle from "lodash.throttle";

const store = new Store<{
  bounds: Rectangle;
  maximized: boolean;
}>();

export function getSavedBounds(
  minWidth: number,
  minHeight: number,
): {
  bounds: Partial<Rectangle>;
  maximized: boolean;
} {
  const bounds = store.get("bounds");
  const maximized = store.get("maximized");
  const savedBounds: Partial<Rectangle> = {};
  if (bounds) {
    const area = screen.getDisplayMatching(bounds).workArea;
    // If the saved position still valid (the window is entirely inside the display area), use it.
    if (
      bounds.x >= area.x &&
      bounds.y >= area.y &&
      bounds.x + bounds.width <= area.x + area.width &&
      bounds.y + bounds.height <= area.y + area.height
    ) {
      savedBounds.x = bounds.x;
      savedBounds.y = bounds.y;
    }
    // Restore the saved size, shrunk to fit the display but no smaller than
    // the window minimum.
    savedBounds.width = Math.max(Math.min(bounds.width, area.width), minWidth);
    savedBounds.height = Math.max(
      Math.min(bounds.height, area.height),
      minHeight,
    );
  }
  return { bounds: savedBounds, maximized };
}

export function saveWindowBounds(window: BrowserWindow) {
  function handleResizeOrMove() {
    if (!window.isDestroyed()) {
      store.set("bounds", window.getNormalBounds());
      store.set("maximized", false);
    }
  }
  const throttledResizeOrMove = throttle(handleResizeOrMove, 1000);
  window.on("resized", throttledResizeOrMove);
  window.on("moved", throttledResizeOrMove);

  function handleMaximize() {
    store.set("maximized", true);
  }
  function handleUnmaximize() {
    store.set("maximized", false);
  }
  window.on("maximize", handleMaximize);
  window.on("unmaximize", handleUnmaximize);
}
