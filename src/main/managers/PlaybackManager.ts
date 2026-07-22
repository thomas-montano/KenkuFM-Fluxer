import { BrowserWindow } from "electron";
import { FluxerBroadcast } from "../broadcast/FluxerBroadcast";
import { AudioCaptureManagerMain } from "./AudioCaptureManagerMain";

export class PlaybackManager {
  fluxer: FluxerBroadcast;
  audioCaptureManager: AudioCaptureManagerMain;

  constructor(window: BrowserWindow) {
    this.fluxer = new FluxerBroadcast(window);
    this.audioCaptureManager = new AudioCaptureManagerMain();
    this.audioCaptureManager.on("streamStart", (channels, sampleRate) => {
      this.fluxer.startStream(sampleRate, channels);
    });
    this.audioCaptureManager.on("data", (data) => {
      this.fluxer.writePcm(data);
    });
    this.audioCaptureManager.on("streamEnd", () => {
      this.fluxer.stopStream();
    });
  }

  destroy() {
    this.fluxer.destroy();
    this.audioCaptureManager.destroy();
  }
}
