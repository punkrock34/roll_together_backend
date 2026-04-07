import { createServer as createHttpServer } from "node:http";

import { getConfig, type AppConfig } from "./config";
import { createHttpApp } from "./http";
import { createRoomStore } from "./room-store";
import { createRoomWebSocketServer } from "./websocket";

export function createRollTogetherServer(config: AppConfig = getConfig()) {
  const store = createRoomStore({
    roomTtlMs: config.roomTtlMs,
    reconnectGraceMs: config.reconnectGraceMs,
  });
  const startedAt = Date.now();
  const app = createHttpApp({ config, store, startedAt });
  const httpServer = createHttpServer(app);
  const { wsServer } = createRoomWebSocketServer({ httpServer, store });

  const pruneInterval = setInterval(() => {
    store.prune();
  }, 30_000);

  return {
    app,
    store,
    httpServer,
    wsServer,
    async start() {
      await new Promise<void>((resolve) => {
        httpServer.listen(config.port, config.host, () => resolve());
      });
    },
    async stop() {
      clearInterval(pruneInterval);

      for (const client of wsServer.clients) {
        client.close();
      }

      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

if (require.main === module) {
  const server = createRollTogetherServer();
  server
    .start()
    .then(() => {
      const config = getConfig();
      console.log(
        `Roll Together backend listening on http://${config.host}:${config.port}`,
      );
    })
    .catch((error) => {
      console.error("Failed to start Roll Together backend", error);
      process.exitCode = 1;
    });
}
