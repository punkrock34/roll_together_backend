export interface AppConfig {
  host: string;
  port: number;
  roomTtlMs: number;
  reconnectGraceMs: number;
  corsOrigin: string;
  syncDebugLogPath?: string;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isTestEnv = env.NODE_ENV === "test";
  const debugLoggingEnabled = env.SYNC_DEBUG_LOG !== "0" && !isTestEnv;

  return {
    host: env.HOST ?? "0.0.0.0",
    port: parseNumber(env.PORT, 3000),
    roomTtlMs: parseNumber(env.ROOM_TTL_MS, 10 * 60 * 1000),
    reconnectGraceMs: parseNumber(env.RECONNECT_GRACE_MS, 60 * 1000),
    corsOrigin: env.CORS_ORIGIN ?? "*",
    syncDebugLogPath: debugLoggingEnabled
      ? (env.SYNC_DEBUG_LOG_PATH ?? "/tmp/roll-together-sync.log")
      : undefined,
  };
}
