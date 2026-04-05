export interface AppConfig {
  host: string;
  port: number;
  roomTtlMs: number;
  reconnectGraceMs: number;
  corsOrigin: string;
}

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    host: env.HOST ?? "0.0.0.0",
    port: parseNumber(env.PORT, 3000),
    roomTtlMs: parseNumber(env.ROOM_TTL_MS, 10 * 60 * 1000),
    reconnectGraceMs: parseNumber(env.RECONNECT_GRACE_MS, 60 * 1000),
    corsOrigin: env.CORS_ORIGIN ?? "*",
  };
}
