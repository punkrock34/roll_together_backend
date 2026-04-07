import type { Server as HttpServer } from "node:http";

import { WebSocket, WebSocketServer } from "ws";

import {
  PROTOCOL_VERSION,
  parseClientMessage,
  type ErrorMessage,
  type HostTransferredMessage,
  type JoinedMessage,
  type NavigateBroadcastMessage,
  type PingMessage,
  type PongMessage,
  type PresenceMessage,
  type RoomMutationErrorCode,
  type ServerMessage,
  type SyncBroadcastMessage,
} from "./protocol";
import type { JoinResult, RoomStore } from "./room-store";

interface SocketContext {
  roomId?: string;
  sessionId?: string;
}

interface RoomWebSocketServerOptions {
  httpServer: HttpServer;
  store: RoomStore;
}

export function createRoomWebSocketServer({
  httpServer,
  store,
}: RoomWebSocketServerOptions) {
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
      case "invalid_transfer_target":
        return "Choose a connected follower before transferring host control.";
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

  const broadcastHostTransferred = (
    roomId: string,
    previousHostSessionId: string,
  ) => {
    const snapshot = store.getSnapshot(roomId);
    if (!snapshot) {
      return;
    }

    const payload: HostTransferredMessage = {
      type: "host_transferred",
      version: PROTOCOL_VERSION,
      roomId,
      participantCount: snapshot.participantCount,
      participants: snapshot.participants,
      hostSessionId: snapshot.hostSessionId,
      previousHostSessionId,
      playback: snapshot.playback,
    };

    broadcastToRoom(roomId, () => payload);
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
            displayName: message.displayName,
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

        case "transfer_host": {
          if (!context.roomId || !context.sessionId) {
            sendError(
              socket,
              "not_joined",
              "Join a room before sending room updates.",
            );
            return;
          }

          const result = store.transferHost(
            context.roomId,
            context.sessionId,
            message.targetSessionId,
          );
          if (!result.ok) {
            sendError(
              socket,
              result.code,
              messageForMutationError(result.code),
            );
            return;
          }

          broadcastHostTransferred(
            context.roomId,
            result.previousHostSessionId,
          );
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

  return { wsServer };
}
