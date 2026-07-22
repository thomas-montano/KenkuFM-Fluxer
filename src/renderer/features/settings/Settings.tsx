import React, { useEffect, useState } from "react";

import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogContentText from "@mui/material/DialogContentText";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Link from "@mui/material/Link";
import Divider from "@mui/material/Divider";
import Typography from "@mui/material/Typography";
import FormGroup from "@mui/material/FormGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select, { SelectChangeEvent } from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormHelperText from "@mui/material/FormHelperText";

import { RootState } from "../../app/store";
import { useSelector, useDispatch } from "react-redux";
import { setStatus } from "../connection/connectionSlice";
import {
  setFluxerUrl,
  setFluxerToken,
  setExternalInputsEnabled,
  setMultipleInputsEnabled,
  setMultipleOutputsEnabled,
  setRemoteEnabled,
  setRemoteAddress,
  setRemotePort,
  setURLBarEnabled,
  setStreamingMode,
  StreamingMode,
} from "./settingsSlice";
import { showWindowControls } from "../../common/showWindowControls";

type SettingsProps = {
  open: boolean;
  onClose: () => void;
};

export function Settings({ open, onClose }: SettingsProps) {
  const connection = useSelector((state: RootState) => state.connection);
  const settings = useSelector((state: RootState) => state.settings);
  const dispatch = useDispatch();

  function handleFluxerUrlChange(e: React.ChangeEvent<HTMLInputElement>) {
    dispatch(setFluxerUrl(e.target.value));
  }

  function handleFluxerTokenChange(e: React.ChangeEvent<HTMLInputElement>) {
    dispatch(setFluxerToken(e.target.value));
  }

  function handleFluxerConnect() {
    if (connection.status === "disconnected") {
      dispatch(setStatus("connecting"));
      window.kenku.connect(settings.fluxerUrl, settings.fluxerToken);
    } else {
      window.kenku.disconnect();
    }
  }

  useEffect(() => {
    if (settings.fluxerUrl && settings.fluxerToken) {
      dispatch(setStatus("connecting"));
      window.kenku.connect(settings.fluxerUrl, settings.fluxerToken);
    }

    return () => {
      window.kenku.disconnect();
    };
  }, []);

  useEffect(() => {
    window.kenku.on("FLUXER_READY", () => {
      dispatch(setStatus("ready"));
    });
    window.kenku.on("FLUXER_DISCONNECTED", () => {
      dispatch(setStatus("disconnected"));
    });

    return () => {
      window.kenku.removeAllListeners("FLUXER_READY");
      window.kenku.removeAllListeners("FLUXER_DISCONNECTED");
    };
  }, [dispatch]);

  const fluxerSettings = (
    <Stack spacing={1}>
      <TextField
        margin="dense"
        size="small"
        id="server-url"
        label="Server URL"
        fullWidth
        variant="standard"
        autoComplete="off"
        InputLabelProps={{
          shrink: true,
        }}
        value={settings.fluxerUrl}
        onChange={handleFluxerUrlChange}
        disabled={connection.status !== "disconnected"}
        helperText="Enter your Fluxer server URL"
      />
      <TextField
        margin="dense"
        size="small"
        id="token"
        label="Bot Token"
        type="password"
        fullWidth
        variant="standard"
        autoComplete="off"
        InputLabelProps={{
          shrink: true,
        }}
        value={settings.fluxerToken}
        onChange={handleFluxerTokenChange}
        disabled={connection.status !== "disconnected"}
        helperText="Enter your bot's token"
      />
      <Button
        disabled={
          connection.status === "connecting" ||
          !settings.fluxerUrl ||
          !settings.fluxerToken
        }
        onClick={handleFluxerConnect}
        fullWidth
        variant="outlined"
        size="small"
      >
        {connection.status === "connecting" ? (
          <CircularProgress size={24} />
        ) : connection.status === "ready" ? (
          "Disconnect"
        ) : (
          "Connect"
        )}
      </Button>
      <Link
        href="https://docs.fluxer.app"
        variant="caption"
        textAlign="center"
        target="_blank"
        rel="noopener noreferrer"
        py={2}
      >
        Where do I get my token?
      </Link>
    </Stack>
  );

  function handleRemoteToggle() {
    const enabled = !settings.remoteEnabled;
    if (enabled) {
      window.kenku.playerStartRemote(
        settings.remoteAddress,
        settings.remotePort,
      );
    } else {
      window.kenku.playerStopRemote();
    }
    dispatch(setRemoteEnabled(enabled));
  }

  function handleRemoteAddressChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    dispatch(setRemoteAddress(event.target.value));
  }

  function handleRemotePortChange(event: React.ChangeEvent<HTMLInputElement>) {
    dispatch(setRemotePort(event.target.value));
  }

  useEffect(() => {
    if (settings.remoteEnabled) {
      window.kenku.playerStartRemote(
        settings.remoteAddress,
        settings.remotePort,
      );
    }
  }, []);

  const remoteSettings = (
    <Stack spacing={1}>
      <Stack direction="row">
        <TextField
          margin="dense"
          size="small"
          id="remote-address"
          label="Address"
          variant="standard"
          autoComplete="off"
          InputLabelProps={{
            shrink: true,
          }}
          inputProps={{ pattern: "d{1,3}.d{1,3}.d{1,3}.d{1,3}" }}
          value={settings.remoteAddress}
          onChange={handleRemoteAddressChange}
          disabled={settings.remoteEnabled}
          sx={{ mr: 0.5 }}
        />
        <TextField
          margin="dense"
          size="small"
          id="remote-port"
          label="Port"
          variant="standard"
          autoComplete="off"
          InputLabelProps={{
            shrink: true,
          }}
          inputProps={{ pattern: "d+" }}
          value={settings.remotePort}
          onChange={handleRemotePortChange}
          disabled={settings.remoteEnabled}
          sx={{ ml: 0.5 }}
        />
      </Stack>
      <Button
        onClick={handleRemoteToggle}
        fullWidth
        variant="outlined"
        size="small"
        disabled={!settings.remoteAddress || !settings.remotePort}
      >
        {settings.remoteEnabled ? "Stop Remote" : "Start Remote"}
      </Button>
      <Link
        href="https://www.kenku.fm/docs/using-kenku-remote"
        variant="caption"
        textAlign="center"
        target="_blank"
        rel="noopener noreferrer"
        py={2}
      >
        What is Kenku Remote?
      </Link>
    </Stack>
  );

  const [streamingModeChanged, setStreamingModeChanged] = useState(false);

  function handleStreamingModeChnage(event: SelectChangeEvent) {
    dispatch(setStreamingMode(event.target.value as StreamingMode));
    setStreamingModeChanged(true);
  }

  useEffect(() => {
    window.kenku.startAudioCapture(settings.streamingMode);
  }, []);

  const streamingSettings = (
    <FormControl fullWidth variant="standard" margin="dense">
      <InputLabel id="streaming-mode-select-label">Mode</InputLabel>
      <Select
        labelId="streaming-mode-select-label"
        label="Mode"
        value={settings.streamingMode}
        onChange={handleStreamingModeChnage}
      >
        <MenuItem value="lowLatency">Low Latency</MenuItem>
        <MenuItem value="performance">Performance</MenuItem>
      </Select>
      {streamingModeChanged && (
        <FormHelperText sx={{ color: "primary.main" }}>
          * Restart to apply change
        </FormHelperText>
      )}
    </FormControl>
  );

  function handleShowControlsToggle() {
    dispatch(setURLBarEnabled(!settings.urlBarEnabled));
  }

  function handleExternalInputsToggle() {
    dispatch(setExternalInputsEnabled(!settings.externalInputsEnabled));
  }

  function handleMultipleInputsToggle() {
    dispatch(setMultipleInputsEnabled(!settings.multipleInputsEnabled));
  }

  function handleMultipleOutputsToggle() {
    dispatch(setMultipleOutputsEnabled(!settings.multipleOutputsEnabled));
  }

  const [clearingCache, setClearingCache] = useState(false);
  async function handleCacheClear() {
    setClearingCache(true);
    await window.kenku.clearCache();
    setClearingCache(false);
  }

  const otherSettings = (
    <Stack spacing={1}>
      <FormGroup>
        <FormControlLabel
          control={
            <Switch
              checked={settings.urlBarEnabled}
              onChange={handleShowControlsToggle}
            />
          }
          sx={{ marginLeft: "-8px" }}
          label={<Typography variant="caption">Show Tab URL Bar</Typography>}
        />
      </FormGroup>
      <FormGroup>
        <FormControlLabel
          control={
            <Switch
              checked={settings.multipleOutputsEnabled}
              onChange={handleMultipleOutputsToggle}
            />
          }
          sx={{ marginLeft: "-8px" }}
          label={<Typography variant="caption">Multiple Outputs</Typography>}
        />
      </FormGroup>
      <FormGroup>
        <FormControlLabel
          control={
            <Switch
              checked={settings.externalInputsEnabled}
              onChange={handleExternalInputsToggle}
            />
          }
          sx={{ marginLeft: "-8px" }}
          label={<Typography variant="caption">External Inputs</Typography>}
        />
      </FormGroup>
      <FormGroup>
        <FormControlLabel
          control={
            <Switch
              checked={settings.multipleInputsEnabled}
              onChange={handleMultipleInputsToggle}
            />
          }
          disabled={!settings.externalInputsEnabled}
          sx={{ marginLeft: "-8px" }}
          label={
            <Typography
              variant="caption"
              sx={{ opacity: settings.externalInputsEnabled ? undefined : 0.5 }}
            >
              Multiple Inputs
            </Typography>
          }
        />
      </FormGroup>
      <Button
        onClick={handleCacheClear}
        fullWidth
        variant="outlined"
        size="small"
      >
        {clearingCache ? <CircularProgress size={24} /> : "Clear Cache"}
      </Button>
    </Stack>
  );

  return (
    <Dialog fullScreen sx={{ width: 240 }} open={open} onClose={onClose}>
      <DialogTitle
        sx={{
          textAlign: showWindowControls ? "left" : "right",
          py: showWindowControls ? 2 : 1.5,
        }}
      >
        Settings
      </DialogTitle>
      <DialogContent>
        <DialogContentText>Fluxer</DialogContentText>
        {fluxerSettings}
        <Divider sx={{ mb: 2 }} />
        <DialogContentText>Remote</DialogContentText>
        {remoteSettings}
        <Divider sx={{ mb: 2 }} />
        <DialogContentText>Streaming</DialogContentText>
        {streamingSettings}
        <Divider sx={{ mb: 2 }} />
        <DialogContentText>Other</DialogContentText>
        {otherSettings}
        <Stack my={1}>
          <Typography
            variant="caption"
            color="text.secondary"
            textAlign="center"
          >
            v{window.kenku.version}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Done</Button>
      </DialogActions>
    </Dialog>
  );
}
