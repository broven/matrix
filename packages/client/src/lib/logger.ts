import {
  info as pluginInfo,
  error as pluginError,
  warn as pluginWarn,
  debug as pluginDebug,
  trace as pluginTrace,
} from "@tauri-apps/plugin-log";

export const logger = {
  trace: (msg: string) => {
    pluginTrace(msg).catch(() => {});
    if (import.meta.env.DEV) console.debug(`[trace] ${msg}`);
  },
  debug: (msg: string) => {
    pluginDebug(msg).catch(() => {});
    if (import.meta.env.DEV) console.debug(msg);
  },
  info: (msg: string) => {
    pluginInfo(msg).catch(() => {});
    if (import.meta.env.DEV) console.info(msg);
  },
  warn: (msg: string) => {
    pluginWarn(msg).catch(() => {});
    if (import.meta.env.DEV) console.warn(msg);
  },
  error: (msg: string, err?: unknown) => {
    const full = err instanceof Error ? `${msg}: ${err.message}\n${err.stack}` : msg;
    pluginError(full).catch(() => {});
    if (import.meta.env.DEV) console.error(msg, err ?? "");
  },
};
