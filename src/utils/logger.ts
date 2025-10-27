type Level = "info" | "warn" | "error" | "debug";

function log(level: Level, message: string, extra?: Record<string, unknown>) {
  const payload = {
    level,
    message,
    ...extra
  };
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(payload));
}

export const logger = {
  info(message: string, extra?: Record<string, unknown>) {
    log("info", message, extra);
  },
  warn(message: string, extra?: Record<string, unknown>) {
    log("warn", message, extra);
  },
  error(message: string, extra?: Record<string, unknown>) {
    log("error", message, extra);
  },
  debug(message: string, extra?: Record<string, unknown>) {
    if (process.env.LOG_LEVEL === "debug") {
      log("debug", message, extra);
    }
  }
};
