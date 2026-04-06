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
  type NavigateBroadcastMessage,
  type PingMessage,
  type PongMessage,
  type PresenceMessage,
  type RoomMutationErrorCode,
  type ServerMessage,
  type SyncBroadcastMessage,
} from "./protocol";
import { RoomStore, type JoinResult } from "./room-store";

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

  const sendError = (
    socket: WebSocket,
    code: ErrorMessage["code"],
    message: string,
  ) => {
    const payload: ErrorMessage = {
      type: "error",
      version: PROTOCOL_VERSION,
      code,
      message,
    };
    send(socket, payload);
  };

  const messageForMutationError = (code: RoomMutationErrorCode) => {
    switch (code) {
      case "unknown_room":
        return "The room no longer exists.";
      case "not_joined":
        return "Join a room before sending room updates.";
      case "not_host":
        return "Only the current host can control this room.";
    }
  };

  const broadcastToRoom = (
    roomId: string,
    buildMessage: (context: SocketContext) => ServerMessage | undefined,
  ) => {
    for (const client of wsServer.clients) {
      const context = socketContexts.get(client);
      if (!context || context.roomId !== roomId) {
        continue;
      }

      const payload = buildMessage(context);
      if (payload) {
        send(client, payload);
      }
    }
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
      hostSessionId: snapshot.hostSessionId,
    };

    broadcastToRoom(roomId, () => payload);
  };

  const broadcastNavigation = (
    joined: JoinResult,
    participantId: string,
    excludeSessionId?: string,
  ) => {
    const payload: NavigateBroadcastMessage = {
      type: "navigate",
      version: PROTOCOL_VERSION,
      roomId: joined.roomId,
      participantId,
      participantCount: joined.participantCount,
      participants: joined.participants,
      hostSessionId: joined.hostSessionId,
      playback: joined.playback,
    };

    broadcastToRoom(joined.roomId, (context) => {
      if (context.sessionId === excludeSessionId) {
        return undefined;
      }
      return payload;
    });
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
          const roomBeforeJoin = message.roomId
            ? store.getSnapshot(message.roomId)
            : undefined;
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
            hostSessionId: joined.hostSessionId,
            playback: joined.playback,
          };

          send(socket, payload);

          const switchedEpisode =
            Boolean(roomBeforeJoin) &&
            joined.episodeChanged &&
            joined.hostSessionId === joined.sessionId;
          if (switchedEpisode) {
            broadcastNavigation(joined, joined.sessionId, joined.sessionId);
          }

          broadcastPresence(joined.roomId);
          break;
        }
        case "sync": {
          if (!context.roomId || !context.sessionId) {
            sendError(
              socket,
              "not_joined",
              "Join a room before sending room updates.",
            );
            return;
          }

          const result = store.sync(
            context.roomId,
            context.sessionId,
            message.playback,
          );
          if (!result.ok) {
            sendError(
              socket,
              result.code,
              messageForMutationError(result.code),
            );
            return;
          }

          const payload: SyncBroadcastMessage = {
            type: "sync",
            version: PROTOCOL_VERSION,
            roomId: context.roomId,
            participantId: context.sessionId,
            participantCount: result.snapshot.participantCount,
            participants: result.snapshot.participants,
            hostSessionId: result.snapshot.hostSessionId,
            playback: result.snapshot.playback,
          };

          broadcastToRoom(context.roomId, (clientContext) => {
            if (clientContext.sessionId === context.sessionId) {
              return undefined;
            }
            return payload;
          });
          break;
        }
        case "navigate": {
          if (!context.roomId || !context.sessionId) {
            sendError(
              socket,
              "not_joined",
              "Join a room before sending room updates.",
            );
            return;
          }

          const result = store.navigate(
            context.roomId,
            context.sessionId,
            message.playback,
          );
          if (!result.ok) {
            sendError(
              socket,
              result.code,
              messageForMutationError(result.code),
            );
            return;
          }

          const payload: NavigateBroadcastMessage = {
            type: "navigate",
            version: PROTOCOL_VERSION,
            roomId: context.roomId,
            participantId: context.sessionId,
            participantCount: result.snapshot.participantCount,
            participants: result.snapshot.participants,
            hostSessionId: result.snapshot.hostSessionId,
            playback: result.snapshot.playback,
          };

          broadcastToRoom(context.roomId, (clientContext) => {
            if (clientContext.sessionId === context.sessionId) {
              return undefined;
            }
            return payload;
          });
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
