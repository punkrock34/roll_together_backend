import type { Server as HttpServer } from "node:http";

import { Server, type Socket } from "socket.io";

import {
  PROTOCOL_VERSION,
  parseHeartbeatPayload,
  parseJoinRoomPayload,
  parseLeaveRoomPayload,
  parsePlaybackCommandPayload,
  parseRequestStatePayload,
  type CommandErrorCode,
  type CommandErrorPayload,
  type HeartbeatAckPayload,
  type PresenceUpdatePayload,
  type RoomJoinedPayload,
  type StateSnapshotPayload,
} from "./protocol";
import type { RoomStore, RoomStoreSnapshot } from "./room-store";
import type { SyncDebugLogger } from "./debug-log";

interface SocketContext {
  roomId?: string;
  sessionId?: string;
}

interface RoomWebSocketServerOptions {
  httpServer: HttpServer;
  store: RoomStore;
  debugLogger?: SyncDebugLogger;
}

export function createRoomWebSocketServer({
  httpServer,
  store,
  debugLogger,
}: RoomWebSocketServerOptions) {
  const io = new Server(httpServer, {
    path: "/ws",
    cors: {
      origin: true,
      credentials: true,
    },
    transports: ["websocket"],
  });
  const socketContexts = new Map<string, SocketContext>();
  const logSync = (event: string, payload?: Record<string, unknown>) => {
    debugLogger?.log(event, payload);
  };

  const sendCommandError = (
    socket: Socket,
    code: CommandErrorCode,
    message: string,
  ) => {
    const payload: CommandErrorPayload = {
      version: PROTOCOL_VERSION,
      code,
      message,
    };
    socket.emit("command_error", payload);
    logSync("command_error", {
      socketId: socket.id,
      code,
      message,
    });
  };

  const messageForMutationError = (
    code: "unknown_room" | "not_joined" | "episode_mismatch",
  ) => {
    switch (code) {
      case "unknown_room":
        return "The room no longer exists.";
      case "not_joined":
        return "Join a room before sending playback commands.";
      case "episode_mismatch":
        return "The command episode does not match the room episode.";
    }
  };

  const emitPresence = (roomId: string, snapshot?: RoomStoreSnapshot) => {
    const source = snapshot ?? store.getSnapshot(roomId);
    if (!source) {
      return;
    }

    const payload: PresenceUpdatePayload = {
      version: PROTOCOL_VERSION,
      roomId: source.roomId,
      participants: source.participants,
      participantCount: source.participantCount,
      revision: source.revision,
      updatedAt: source.updatedAt,
    };
    io.to(roomId).emit("presence_update", payload);
    logSync("presence_update_emit", {
      roomId,
      revision: source.revision,
      participantCount: source.participantCount,
    });
  };

  const emitStateSnapshot = (roomId: string, snapshot: RoomStoreSnapshot) => {
    const payload: StateSnapshotPayload = {
      version: PROTOCOL_VERSION,
      state: snapshot,
    };
    io.to(roomId).emit("state_snapshot", payload);
    logSync("state_snapshot_emit", {
      roomId,
      revision: snapshot.revision,
      episodeId: snapshot.playback.episodeId,
      state: snapshot.playback.state,
      currentTime: snapshot.playback.currentTime,
      updatedAt: snapshot.playback.updatedAt,
      participantCount: snapshot.participantCount,
    });
  };

  const applyPlaybackCommand = (
    socket: Socket,
    event: "play" | "pause" | "seek",
    payload: unknown,
  ) => {
    logSync("playback_command_received", {
      socketId: socket.id,
      event,
    });

    const parsed = parsePlaybackCommandPayload(payload);
    if (!parsed) {
      sendCommandError(
        socket,
        "invalid_payload",
        "Invalid playback command payload.",
      );
      return;
    }

    const context = socketContexts.get(socket.id);
    if (!context?.roomId || !context.sessionId) {
      sendCommandError(
        socket,
        "not_joined",
        "Join a room before sending playback commands.",
      );
      return;
    }

    const result =
      event === "play"
        ? store.play(context.roomId, context.sessionId, parsed.playback)
        : event === "pause"
          ? store.pause(context.roomId, context.sessionId, parsed.playback)
          : store.seek(context.roomId, context.sessionId, parsed.playback);

    if (!result.ok) {
      sendCommandError(
        socket,
        result.code,
        messageForMutationError(result.code),
      );
      return;
    }

    logSync("playback_command_applied", {
      socketId: socket.id,
      roomId: context.roomId,
      sessionId: context.sessionId,
      event,
      revision: result.snapshot.revision,
      state: result.snapshot.playback.state,
      currentTime: result.snapshot.playback.currentTime,
      updatedAt: result.snapshot.playback.updatedAt,
    });

    emitStateSnapshot(context.roomId, result.snapshot);
  };

  io.on("connection", (socket) => {
    socketContexts.set(socket.id, {});
    logSync("socket_connected", { socketId: socket.id });

    socket.on("join_room", (payload: unknown) => {
      logSync("join_room_received", { socketId: socket.id });
      const parsed = parseJoinRoomPayload(payload);
      if (!parsed) {
        sendCommandError(
          socket,
          "invalid_payload",
          "Invalid join_room payload.",
        );
        return;
      }

      const joined = store.join({
        roomId: parsed.roomId,
        sessionId: parsed.sessionId,
        displayName: parsed.displayName,
        playback: parsed.playback,
      });

      socket.join(joined.roomId);
      socketContexts.set(socket.id, {
        roomId: joined.roomId,
        sessionId: joined.sessionId,
      });

      const joinedPayload: RoomJoinedPayload = {
        version: PROTOCOL_VERSION,
        roomId: joined.roomId,
        sessionId: joined.sessionId,
        state: {
          roomId: joined.roomId,
          revision: joined.revision,
          updatedAt: joined.updatedAt,
          playback: joined.playback,
          participants: joined.participants,
          participantCount: joined.participantCount,
        },
      };

      socket.emit("room_joined", joinedPayload);
      logSync("room_joined_emit", {
        socketId: socket.id,
        roomId: joined.roomId,
        sessionId: joined.sessionId,
        revision: joined.revision,
        participantCount: joined.participantCount,
      });
      emitStateSnapshot(joined.roomId, joined);
      emitPresence(joined.roomId, joined);
    });

    socket.on("leave_room", (payload: unknown) => {
      logSync("leave_room_received", { socketId: socket.id });
      const parsed = parseLeaveRoomPayload(payload);
      if (!parsed) {
        sendCommandError(
          socket,
          "invalid_payload",
          "Invalid leave_room payload.",
        );
        return;
      }

      const context = socketContexts.get(socket.id);
      if (!context?.roomId || !context.sessionId) {
        socketContexts.set(socket.id, {});
        socket.disconnect(true);
        return;
      }

      const nextSnapshot = store.leave(context.roomId, context.sessionId);
      socket.leave(context.roomId);
      socketContexts.set(socket.id, {});

      if (nextSnapshot) {
        emitPresence(context.roomId, nextSnapshot);
      }

      socket.disconnect(true);
    });

    socket.on("play", (payload: unknown) => {
      applyPlaybackCommand(socket, "play", payload);
    });

    socket.on("pause", (payload: unknown) => {
      applyPlaybackCommand(socket, "pause", payload);
    });

    socket.on("seek", (payload: unknown) => {
      applyPlaybackCommand(socket, "seek", payload);
    });

    socket.on("request_state", (payload: unknown) => {
      logSync("request_state_received", { socketId: socket.id });
      const parsed = parseRequestStatePayload(payload);
      if (!parsed) {
        sendCommandError(
          socket,
          "invalid_payload",
          "Invalid request_state payload.",
        );
        return;
      }

      const context = socketContexts.get(socket.id);
      if (!context?.roomId || !context.sessionId) {
        sendCommandError(
          socket,
          "not_joined",
          "Join a room before requesting state.",
        );
        return;
      }

      const snapshot = store.getSnapshot(context.roomId);
      if (!snapshot) {
        sendCommandError(socket, "unknown_room", "The room no longer exists.");
        return;
      }

      const response: StateSnapshotPayload = {
        version: PROTOCOL_VERSION,
        state: snapshot,
      };
      socket.emit("state_snapshot", response);
      logSync("request_state_emit", {
        socketId: socket.id,
        roomId: snapshot.roomId,
        revision: snapshot.revision,
        state: snapshot.playback.state,
        currentTime: snapshot.playback.currentTime,
      });
    });

    socket.on("heartbeat", (payload: unknown) => {
      const parsed = parseHeartbeatPayload(payload);
      if (!parsed) {
        sendCommandError(
          socket,
          "invalid_payload",
          "Invalid heartbeat payload.",
        );
        return;
      }

      const response: HeartbeatAckPayload = {
        version: PROTOCOL_VERSION,
        sentAt: parsed.sentAt,
        receivedAt: Date.now(),
      };
      socket.emit("heartbeat_ack", response);
      logSync("heartbeat_ack_emit", {
        socketId: socket.id,
        sentAt: parsed.sentAt,
        receivedAt: response.receivedAt,
      });
    });

    socket.on("disconnect", () => {
      logSync("socket_disconnected", { socketId: socket.id });
      const context = socketContexts.get(socket.id);
      socketContexts.delete(socket.id);

      if (!context?.roomId || !context.sessionId) {
        return;
      }

      const snapshot = store.markDisconnected(
        context.roomId,
        context.sessionId,
      );
      if (snapshot) {
        emitPresence(context.roomId, snapshot);
      }
    });
  });

  return { io };
}
