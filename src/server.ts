import { createServer as createHttpServer } from "node:http";

import cors from "cors";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";

import { getConfig, type AppConfig } from "./config";
import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type ErrorMessage,
  type JoinedMessage,
  type PingMessage,
  type PongMessage,
  type PresenceMessage,
  type ServerMessage,
  type SyncBroadcastMessage,
} from "./protocol";
import { RoomStore } from "./room-store";

interface SocketContext {
  roomId?: string;
  sessionId?: string;
}

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

export function createRollTogetherServer(config: AppConfig = getConfig()) {
  const store = new RoomStore({
    roomTtlMs: config.roomTtlMs,
    reconnectGraceMs: config.reconnectGraceMs,
  });

  const startedAt = Date.now();
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

  const httpServer = createHttpServer(app);
  const wsServer = new WebSocketServer({ server: httpServer, path: "/ws" });
  const socketContexts = new WeakMap<WebSocket, SocketContext>();

  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  const sendError = (socket: WebSocket, code: string, message: string) => {
    const payload: ErrorMessage = {
      type: "error",
      version: PROTOCOL_VERSION,
      code,
      message,
    };
    send(socket, payload);
  };

  const broadcastPresence = (roomId: string) => {
    const snapshot = store.getSnapshot(roomId);
    if (!snapshot) {
      return;
    }

    const payload: PresenceMessage = {
      type: "presence",
      version: PROTOCOL_VERSION,
      roomId,
      participantCount: snapshot.participantCount,
      participants: snapshot.participants,
    };

    for (const client of wsServer.clients) {
      const context = socketContexts.get(client);
      if (context?.roomId === roomId) {
        send(client, payload);
      }
    }
  };

  wsServer.on("connection", (socket) => {
    socketContexts.set(socket, {});

    socket.on("message", (raw) => {
      const message = parseClientMessage(raw.toString());
      if (!message) {
        sendError(
          socket,
          "invalid_message",
          "The backend could not parse that message.",
        );
        return;
      }

      const context = socketContexts.get(socket) ?? {};

      switch (message.type) {
        case "join": {
          const joined = store.join({
            roomId: message.roomId,
            sessionId: message.sessionId,
            playback: message.playback,
          });

          socketContexts.set(socket, {
            roomId: joined.roomId,
            sessionId: joined.sessionId,
          });

          const payload: JoinedMessage = {
            type: "joined",
            version: PROTOCOL_VERSION,
            roomId: joined.roomId,
            sessionId: joined.sessionId,
            participantCount: joined.participantCount,
            participants: joined.participants,
            playback: joined.playback,
          };

          send(socket, payload);
          broadcastPresence(joined.roomId);
          break;
        }
        case "sync": {
          if (!context.roomId || !context.sessionId) {
            sendError(
              socket,
              "not_joined",
              "Join a room before sending sync events.",
            );
            return;
          }

          const snapshot = store.sync(
            context.roomId,
            context.sessionId,
            message.playback,
          );
          if (!snapshot) {
            sendError(socket, "unknown_room", "The room no longer exists.");
            return;
          }

          const payload: SyncBroadcastMessage = {
            type: "sync",
            version: PROTOCOL_VERSION,
            roomId: context.roomId,
            participantId: context.sessionId,
            participantCount: snapshot.participantCount,
            playback: snapshot.playback,
          };

          for (const client of wsServer.clients) {
            const clientContext = socketContexts.get(client);
            if (
              clientContext?.roomId === context.roomId &&
              clientContext.sessionId !== context.sessionId
            ) {
              send(client, payload);
            }
          }
          break;
        }
        case "leave": {
          if (context.roomId && context.sessionId) {
            store.leave(context.roomId, context.sessionId);
            broadcastPresence(context.roomId);
          }
          socketContexts.set(socket, {});
          socket.close();
          break;
        }
        case "ping": {
          const payload: PongMessage = {
            type: "pong",
            version: PROTOCOL_VERSION,
            sentAt: (message as PingMessage).sentAt,
            receivedAt: Date.now(),
          };
          send(socket, payload);
          break;
        }
      }
    });

    socket.on("close", () => {
      const context = socketContexts.get(socket);
      if (context?.roomId && context.sessionId) {
        store.markDisconnected(context.roomId, context.sessionId);
        broadcastPresence(context.roomId);
      }
    });
  });

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
