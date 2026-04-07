import cors from "cors";
import express from "express";

import type { AppConfig } from "./config";
import { PROTOCOL_VERSION } from "./protocol";
import type { RoomStore } from "./room-store";

export function buildHealthPayload(store: RoomStore, startedAt: number) {
  return {
    status: "ok",
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    roomCount: store.getRoomCount(),
    connectedParticipants: store.getConnectedParticipantCount(),
    protocolVersion: PROTOCOL_VERSION,
  };
}

export function buildVersionPayload() {
  return {
    name: "roll-together-backend",
    version: process.env.npm_package_version ?? "1.0.0",
    protocolVersion: PROTOCOL_VERSION,
  };
}

interface HttpAppOptions {
  config: AppConfig;
  store: RoomStore;
  startedAt: number;
}

export function createHttpApp({ config, store, startedAt }: HttpAppOptions) {
  const app = express();
  app.use(
    cors({ origin: config.corsOrigin === "*" ? true : config.corsOrigin }),
  );

  app.get("/health", (_request, response) => {
    response.json(buildHealthPayload(store, startedAt));
  });

  app.get("/version", (_request, response) => {
    response.json(buildVersionPayload());
  });

  return app;
}
