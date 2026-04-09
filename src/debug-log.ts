import { mkdir } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SyncDebugLogger {
  enabled: boolean;
  log(event: string, payload?: Record<string, unknown>): void;
}

const NOOP_LOGGER: SyncDebugLogger = {
  enabled: false,
  log: () => undefined,
};

export function createSyncDebugLogger(
  logFilePath: string | undefined,
): SyncDebugLogger {
  if (!logFilePath) {
    return NOOP_LOGGER;
  }

  let initialized = false;
  let disabled = false;

  const ensureDirectory = async () => {
    if (initialized || disabled) {
      return;
    }

    try {
      await mkdir(dirname(logFilePath), { recursive: true });
      initialized = true;
    } catch (error) {
      disabled = true;
      console.error("Failed to initialize sync debug log directory", error);
    }
  };

  void ensureDirectory();

  return {
    enabled: true,
    log(event, payload = {}) {
      if (disabled) {
        return;
      }

      if (!initialized) {
        void ensureDirectory();
      }

      const line = JSON.stringify({
        ts: new Date().toISOString(),
        event,
        ...payload,
      });

      try {
        appendFileSync(logFilePath, `${line}\n`, "utf8");
      } catch (error) {
        disabled = true;
        console.error("Failed to append sync debug log line", error);
      }
    },
  };
}
