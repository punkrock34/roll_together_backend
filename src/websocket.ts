import type { Server as HttpServer } from "node:http";

import { Server, type Socket } from "socket.io";

import {
  PROTOCOL_VERSION,
  parseHeartbeatPayload,
  parseJoinRoomPayload,
  parseLeaveRoomPayload,
  parseNavigateEpisodePayload,
  parsePlaybackCommandPayload,
  parseRequestStatePayload,
  parseSetRoomControlModePayload,
  parseTransferHostPayload,
  type CommandErrorCode,
  type CommandErrorPayload,
  type HeartbeatAckPayload,
  type PresenceUpdatePayload,
  type RoomJoinedPayload,
  type RoomNavigationPayload,
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

function mutationErrorMessage(code: CommandErrorCode) {
  switch (code) {
    case "unknown_room":
      return "The room no longer exists.";
    case "not_joined":
      return "Join a room before sending commands.";
    case "episode_mismatch":
      return "The command episode does not match the room episode.";
    case "forbidden_playback_control":
      return "You are not allowed to control playback in this room mode.";
    case "forbidden_navigation_control":
      return "You are not allowed to change episodes in this room mode.";
    case "forbidden_host_transfer":
      return "Only the host can transfer host ownership.";
    case "forbidden_control_mode_change":
      return "Only the host can change room control mode.";
    case "unknown_participant":
      return "The selected participant is unavailable for this action.";
    case "invalid_message":
      return "Invalid socket message.";
    case "invalid_payload":
      return "Invalid command payload.";
  }
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
    message = mutationErrorMessage(code),
  ) => {
    const payload: CommandErrorPayload = {
      version: PROTOCOL_VERSION,
      code,
      message,
    };
    socket.emit("command_error", payload);
    logSync("command_rejected", {
      socketId: socket.id,
      code,
      message,
    });
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
  };

  const emitStateSnapshot = (roomId: string, snapshot: RoomStoreSnapshot) => {
    const payload: StateSnapshotPayload = {
      version: PROTOCOL_VERSION,
      state: snapshot,
    };
    io.to(roomId).emit("state_snapshot", payload);
  };

  const emitRoomNavigation = (
    roomId: string,
    snapshot: RoomStoreSnapshot,
    initiatedBySessionId: string,
  ) => {
    const payload: RoomNavigationPayload = {
      version: PROTOCOL_VERSION,
      roomId: snapshot.roomId,
      revision: snapshot.revision,
      navigationRevision: snapshot.navigationRevision,
      initiatedBySessionId,
      playback: snapshot.playback,
      updatedAt: snapshot.updatedAt,
    };
    io.to(roomId).emit("room_navigation", payload);
  };

  const getSocketContext = (socket: Socket): SocketContext | null => {
    const context = socketContexts.get(socket.id);
    if (!context?.roomId || !context.sessionId) {
      sendCommandError(socket, "not_joined");
      return null;
    }
    return context;
  };

  const applyPlaybackCommand = (
    socket: Socket,
    event: "play" | "pause" | "seek",
    payload: unknown,
  ) => {
    const parsed = parsePlaybackCommandPayload(payload);
    if (!parsed) {
      sendCommandError(
        socket,
        "invalid_payload",
        "Invalid playback command payload.",
      );
      return;
    }

    const context = getSocketContext(socket);
    if (!context?.roomId || !context.sessionId) {
      return;
    }

    const result =
      event === "play"
        ? store.play(context.roomId, context.sessionId, parsed.playback)
        : event === "pause"
          ? store.pause(context.roomId, context.sessionId, parsed.playback)
          : store.seek(context.roomId, context.sessionId, parsed.playback);

    if (!result.ok) {
      sendCommandError(socket, result.code);
      return;
    }

    logSync("playback_command_applied", {
      roomId: context.roomId,
      sessionId: context.sessionId,
      command: event,
      revision: result.snapshot.revision,
      episodeId: result.snapshot.playback.episodeId,
      state: result.snapshot.playback.state,
      currentTime: result.snapshot.playback.currentTime,
    });

    emitStateSnapshot(context.roomId, result.snapshot);
  };

  io.on("connection", (socket) => {
    socketContexts.set(socket.id, {});

    socket.on("join_room", (payload: unknown) => {
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
        state: joined,
      };

      socket.emit("room_joined", joinedPayload);
      emitStateSnapshot(joined.roomId, joined);
      emitPresence(joined.roomId, joined);
    });

    socket.on("leave_room", (payload: unknown) => {
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
        emitStateSnapshot(context.roomId, nextSnapshot);
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

    socket.on("navigate_episode", (payload: unknown) => {
      const parsed = parseNavigateEpisodePayload(payload);
      if (!parsed) {
        sendCommandError(
          socket,
          "invalid_payload",
          "Invalid navigate_episode payload.",
        );
        return;
      }

      const context = getSocketContext(socket);
      if (!context?.roomId || !context.sessionId) {
        return;
      }

      const result = store.navigateEpisode(
        context.roomId,
        context.sessionId,
        parsed.playback,
      );
      if (!result.ok) {
        sendCommandError(socket, result.code);
        return;
      }

      logSync("room_navigation_applied", {
        roomId: context.roomId,
        sessionId: context.sessionId,
        revision: result.snapshot.revision,
        navigationRevision: result.snapshot.navigationRevision,
        episodeId: result.snapshot.playback.episodeId,
      });

      emitRoomNavigation(context.roomId, result.snapshot, context.sessionId);
      emitStateSnapshot(context.roomId, result.snapshot);
    });

    socket.on("set_room_control_mode", (payload: unknown) => {
      const parsed = parseSetRoomControlModePayload(payload);
      if (!parsed) {
        sendCommandError(
          socket,
          "invalid_payload",
          "Invalid set_room_control_mode payload.",
        );
        return;
      }

      const context = getSocketContext(socket);
      if (!context?.roomId || !context.sessionId) {
        return;
      }

      const result = store.setRoomControlMode(
        context.roomId,
        context.sessionId,
        parsed.controlMode,
      );
      if (!result.ok) {
        sendCommandError(socket, result.code);
        return;
      }

      logSync("room_control_mode_changed", {
        roomId: context.roomId,
        sessionId: context.sessionId,
        revision: result.snapshot.revision,
        controlMode: result.snapshot.controlMode,
      });

      emitStateSnapshot(context.roomId, result.snapshot);
    });

    socket.on("transfer_host", (payload: unknown) => {
      const parsed = parseTransferHostPayload(payload);
      if (!parsed) {
        sendCommandError(
          socket,
          "invalid_payload",
          "Invalid transfer_host payload.",
        );
        return;
      }

      const context = getSocketContext(socket);
      if (!context?.roomId || !context.sessionId) {
        return;
      }

      const result = store.transferHost(
        context.roomId,
        context.sessionId,
        parsed.targetSessionId,
      );
      if (!result.ok) {
        sendCommandError(socket, result.code);
        return;
      }

      logSync("host_transferred", {
        roomId: context.roomId,
        fromSessionId: context.sessionId,
        toSessionId: result.snapshot.hostSessionId,
        revision: result.snapshot.revision,
      });

      emitStateSnapshot(context.roomId, result.snapshot);
      emitPresence(context.roomId, result.snapshot);
    });

    socket.on("request_state", (payload: unknown) => {
      const parsed = parseRequestStatePayload(payload);
      if (!parsed) {
        sendCommandError(
          socket,
          "invalid_payload",
          "Invalid request_state payload.",
        );
        return;
      }

      const context = getSocketContext(socket);
      if (!context?.roomId || !context.sessionId) {
        return;
      }

      const snapshot = store.getSnapshot(context.roomId);
      if (!snapshot) {
        sendCommandError(socket, "unknown_room");
        return;
      }

      const response: StateSnapshotPayload = {
        version: PROTOCOL_VERSION,
        state: snapshot,
      };
      socket.emit("state_snapshot", response);
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
    });

    socket.on("disconnect", () => {
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
