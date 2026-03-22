import { info, error, warn, debug, trace } from "@tauri-apps/plugin-log";

export const logger = {
  trace: (msg: string) => {
    trace(msg);
    if (import.meta.env.DEV) console.debug(`[trace] ${msg}`);
  },
  debug: (msg: string) => {
    debug(msg);
    if (import.meta.env.DEV) console.debug(msg);
  },
  info: (msg: string) => {
    info(msg);
    if (import.meta.env.DEV) console.info(msg);
  },
  warn: (msg: string) => {
    warn(msg);
    if (import.meta.env.DEV) console.warn(msg);
  },
  error: (msg: string) => {
    error(msg);
    if (import.meta.env.DEV) console.error(msg);
  },
};
