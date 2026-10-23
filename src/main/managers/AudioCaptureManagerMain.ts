import { randomUUID } from "crypto";
import { IncomingMessage } from "http";
import { AddressInfo } from "net";
import { BrowserWindow, ipcMain, webContents } from "electron";
import { TypedEmitter } from "tiny-typed-emitter";
import { WebSocketServer, WebSocket } from "ws";

declare const AUDIO_CAPTURE_WINDOW_WEBPACK_ENTRY: string;
declare const AUDIO_CAPTURE_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

interface AudioCaptureManagerEvents {
  streamStart: (channels: number, sampleRate: number) => void;
  data: (data: Buffer) => void;
  streamEnd: () => void;
}

/**
 * Manager to capture audio from browser views and external audio devices
 * This class is to be run on the main thread
 * For the render thread counterpart see `AudioCaptureManagerPreload.ts`
 */
export class AudioCaptureManagerMain extends TypedEmitter<AudioCaptureManagerEvents> {
  _browserWindow: BrowserWindow;
  _streaming = false;
  _wss: WebSocketServer;
  /** Shared with the capture window so no other client can inject audio */
  _wsSecret = randomUUID();

  constructor() {
    super();
    this._browserWindow = new BrowserWindow({
      webPreferences: {
        preload: AUDIO_CAPTURE_WINDOW_PRELOAD_WEBPACK_ENTRY,
        // Disable sandbox for the audio capture window
        // This allows us to use a web worker in the preload script
        // https://github.com/electron/forge/issues/2931
        // This has little security concerns as we don't load any third party
        // content in the capture window
        sandbox: false,
      },
      minimizable: false,
      frame: false,
      show: false
    });
    this._browserWindow.webContents.loadURL(AUDIO_CAPTURE_WINDOW_WEBPACK_ENTRY);
    // Loopback only, and only for clients that present the secret: anything
    // sent on this socket is streamed straight into the voice channel.
    this._wss = new WebSocketServer({
      host: "127.0.0.1",
      port: 0,
      verifyClient: ({ req }: { req: IncomingMessage }) =>
        new URL(req.url ?? "", "ws://127.0.0.1").searchParams.get(
          "secret",
        ) === this._wsSecret,
    });

    ipcMain.on("AUDIO_CAPTURE_START", this._handleStart);
    ipcMain.on("AUDIO_CAPTURE_SET_LOOPBACK", this._handleSetLoopback);
    ipcMain.on("AUDIO_CAPTURE_SET_MUTED", this._handleSetMuted);
    ipcMain.on(
      "AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE",
      this._handleStartExternalAudioCapture
    );
    ipcMain.on(
      "AUDIO_CAPTURE_STOP_EXTERNAL_AUDIO_CAPTURE",
      this._handleStopExternalAudioCapture
    );
    ipcMain.on("AUDIO_CAPTURE_STREAM_START", this._handleStreamStart);
    ipcMain.on("AUDIO_CAPTURE_STREAM_END", this._handleStreamEnd);
    ipcMain.handle(
      "AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS",
      this._handleGetWebsocketAddress
    );
    ipcMain.on(
      "AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM",
      this._handleStartBrowserViewStream
    );
    ipcMain.on(
      "AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM",
      this._handleStopBrowserViewStream
    );
    ipcMain.on(
      "AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS",
      this._handleStopAllBrowserViewStreams
    );

    this._wss.on("connection", this._handleWebsocketConnection);
  }

  destroy() {
    ipcMain.off("AUDIO_CAPTURE_START", this._handleStart);
    ipcMain.off("AUDIO_CAPTURE_SET_LOOPBACK", this._handleSetLoopback);
    ipcMain.off("AUDIO_CAPTURE_SET_MUTED", this._handleSetMuted);
    ipcMain.off(
      "AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE",
      this._handleStartExternalAudioCapture
    );
    ipcMain.off(
      "AUDIO_CAPTURE_STOP_EXTERNAL_AUDIO_CAPTURE",
      this._handleStopExternalAudioCapture
    );
    ipcMain.off("AUDIO_CAPTURE_STREAM_START", this._handleStreamStart);
    ipcMain.off("AUDIO_CAPTURE_STREAM_END", this._handleStreamEnd);
    ipcMain.removeHandler("AUDIO_CAPTURE_GET_WEBSOCKET_ADDRESS");
    ipcMain.off(
      "AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM",
      this._handleStartBrowserViewStream
    );
    ipcMain.off(
      "AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM",
      this._handleStopBrowserViewStream
    );
    ipcMain.off(
      "AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS",
      this._handleStopAllBrowserViewStreams
    );
    this._browserWindow.webContents.close();
    (this._browserWindow.webContents as any).destroy();
    this._handleStreamEnd();
    this._wss.close();
  }

  _handleWebsocketConnection = (ws: WebSocket) => {
    ws.on("message", this._handleStreamData);
  };

  _handleStart = (
    _: Electron.IpcMainEvent,
    streamingMode: "lowLatency" | "performance"
  ) => {
    this._browserWindow.webContents.send("AUDIO_CAPTURE_START", streamingMode);
  };

  _handleSetLoopback = (_: Electron.IpcMainEvent, loopback: boolean) => {
    this._browserWindow.webContents.send("AUDIO_CAPTURE_SET_LOOPBACK", loopback);
  };

  _handleSetMuted = (
    _: Electron.IpcMainEvent,
    viewId: number,
    muted: boolean
  ) => {
    this._browserWindow.webContents.send(
      "AUDIO_CAPTURE_BROWSER_VIEW_MUTED",
      viewId,
      muted
    );
  };

  _handleStartExternalAudioCapture = (
    _: Electron.IpcMainEvent,
    deviceId: string
  ) => {
    this._browserWindow.webContents.send(
      "AUDIO_CAPTURE_START_EXTERNAL_AUDIO_CAPTURE",
      deviceId
    );
  };

  _handleStopExternalAudioCapture = (
    _: Electron.IpcMainEvent,
    deviceId: string
  ) => {
    this._browserWindow.webContents.send(
      "AUDIO_CAPTURE_STOP_EXTERNAL_AUDIO_CAPTURE",
      deviceId
    );
  };

  _handleStreamStart = (
    _: Electron.IpcMainEvent,
    channels: number,
    _frameSize: number,
    sampleRate: number
  ) => {
    this._streaming = true;
    // Emit the raw PCM stream format; consumers encode/transport as needed
    this.emit("streamStart", channels, sampleRate);
  };

  _handleStreamData = async (data: Buffer) => {
    if (this._streaming) {
      this.emit("data", data);
    }
  };

  _handleStreamEnd = () => {
    this._streaming = false;
    this.emit("streamEnd");
  };

  _handleGetWebsocketAddress = async (event: Electron.IpcMainInvokeEvent) => {
    // Only the capture window may stream audio into the socket
    if (event.sender.id !== this._browserWindow.webContents.id) {
      return null;
    }
    const { port } = this._wss.address() as AddressInfo;
    return { port, secret: this._wsSecret };
  };

  _handleStartBrowserViewStream = (
    _: Electron.IpcMainEvent,
    viewId: number
  ) => {
    const contents = webContents.fromId(viewId);
    if (!contents) {
      return;
    }
    const mediaSourceId = contents.getMediaSourceId(
      this._browserWindow.webContents
    );
    this._browserWindow.webContents.send(
      "AUDIO_CAPTURE_START_BROWSER_VIEW_STREAM",
      viewId,
      mediaSourceId
    );
  };

  _handleStopBrowserViewStream = (_: Electron.IpcMainEvent, viewId: number) => {
    this._browserWindow.webContents.send(
      "AUDIO_CAPTURE_STOP_BROWSER_VIEW_STREAM",
      viewId
    );
  };

  _handleStopAllBrowserViewStreams = () => {
    this._browserWindow.webContents.send(
      "AUDIO_CAPTURE_STOP_ALL_BROWSER_VIEW_STREAMS"
    );
  };
}
