import type { PlaybackSnapshot, RoomControlMode } from "./protocol";
import {
  createId,
  createRoomRecord,
  resolveParticipantDisplayName,
  snapshotRoom,
  type JoinResult,
  type RoomStoreSnapshot,
} from "./room-state";
import { resolveRoomCapabilities as resolveCapabilities } from "./protocol";

type MutationErrorCode =
  | "unknown_room"
  | "not_joined"
  | "episode_mismatch"
  | "forbidden_playback_control"
  | "forbidden_navigation_control"
  | "forbidden_host_transfer"
  | "forbidden_control_mode_change"
  | "unknown_participant";

interface MutationSuccess {
  ok: true;
  snapshot: RoomStoreSnapshot;
}

interface MutationFailure {
  ok: false;
  code: MutationErrorCode;
}

export type RoomMutationResult = MutationSuccess | MutationFailure;

export interface RoomStoreOptions {
  roomTtlMs: number;
  reconnectGraceMs: number;
}

interface JoinInput {
  roomId?: string;
  sessionId?: string;
  displayName?: string;
  playback: PlaybackSnapshot;
  now?: number;
}

export interface RoomStore {
  join(input: JoinInput): JoinResult;
  play(
    roomId: string,
    sessionId: string,
    playback: PlaybackSnapshot,
    now?: number,
  ): RoomMutationResult;
  pause(
    roomId: string,
    sessionId: string,
    playback: PlaybackSnapshot,
    now?: number,
  ): RoomMutationResult;
  seek(
    roomId: string,
    sessionId: string,
    playback: PlaybackSnapshot,
    now?: number,
  ): RoomMutationResult;
  navigateEpisode(
    roomId: string,
    sessionId: string,
    playback: PlaybackSnapshot,
    now?: number,
  ): RoomMutationResult;
  setRoomControlMode(
    roomId: string,
    sessionId: string,
    controlMode: RoomControlMode,
    now?: number,
  ): RoomMutationResult;
  transferHost(
    roomId: string,
    sessionId: string,
    targetSessionId: string,
    now?: number,
  ): RoomMutationResult;
  getSnapshot(roomId: string, now?: number): RoomStoreSnapshot | undefined;
  markDisconnected(
    roomId: string,
    sessionId: string,
    now?: number,
  ): RoomStoreSnapshot | undefined;
  leave(
    roomId: string,
    sessionId: string,
    now?: number,
  ): RoomStoreSnapshot | undefined;
  prune(now?: number): string[];
  getRoomCount(): number;
  getConnectedParticipantCount(): number;
}

type RoomRecord = ReturnType<typeof createRoomRecord>;

function pickNextHostSessionId(room: RoomRecord): string | undefined {
  const all = Array.from(room.participants.values());
  if (all.length === 0) {
    return undefined;
  }

  const connected = all.filter((participant) => participant.connected);
  const source = connected.length > 0 ? connected : all;
  source.sort(
    (left, right) =>
      left.joinedAt - right.joinedAt ||
      left.sessionId.localeCompare(right.sessionId),
  );
  return source[0]?.sessionId;
}

function maybeReassignHost(
  room: RoomRecord,
  now: number,
  options: { incrementRevision: boolean },
) {
  if (room.hostSessionId && room.participants.has(room.hostSessionId)) {
    return false;
  }

  const nextHostSessionId = pickNextHostSessionId(room);
  if (!nextHostSessionId) {
    room.hostSessionId = "";
    return false;
  }

  if (room.hostSessionId === nextHostSessionId) {
    return false;
  }

  room.hostSessionId = nextHostSessionId;
  room.lastActivityAt = now;

  if (options.incrementRevision) {
    room.revision += 1;
  }

  return true;
}

function touchParticipant(room: RoomRecord, sessionId: string, now: number) {
  const participant = room.participants.get(sessionId);
  if (!participant) {
    return undefined;
  }

  participant.connected = true;
  participant.lastSeenAt = now;
  room.lastActivityAt = now;
  return participant;
}

function resolveCapabilitiesForParticipant(
  room: RoomRecord,
  sessionId: string,
): ReturnType<typeof resolveCapabilities> {
  return resolveCapabilities({
    controlMode: room.controlMode,
    hostSessionId: room.hostSessionId,
    sessionId,
  });
}

export function createRoomStore(options: RoomStoreOptions): RoomStore {
  const rooms = new Map<string, RoomRecord>();

  const getSnapshot = (roomId: string, now = Date.now()) => {
    const room = rooms.get(roomId);
    if (!room) {
      return undefined;
    }

    maybeReassignHost(room, now, { incrementRevision: false });
    return snapshotRoom(room, now);
  };

  const applyPlaybackMutation = (
    roomId: string,
    sessionId: string,
    playback: PlaybackSnapshot,
    now: number,
    nextState?: "playing" | "paused",
  ): RoomMutationResult => {
    const room = rooms.get(roomId);
    if (!room) {
      return { ok: false, code: "unknown_room" };
    }

    if (!touchParticipant(room, sessionId, now)) {
      return { ok: false, code: "not_joined" };
    }

    const capabilities = resolveCapabilitiesForParticipant(room, sessionId);
    if (!capabilities.canControlPlayback) {
      return { ok: false, code: "forbidden_playback_control" };
    }

    if (room.playback.episodeId !== playback.episodeId) {
      return { ok: false, code: "episode_mismatch" };
    }

    room.playback = {
      ...playback,
      state: nextState ?? playback.state,
      updatedAt: now,
    };
    room.revision += 1;

    return {
      ok: true,
      snapshot: snapshotRoom(room, now),
    };
  };

  return {
    join(input) {
      const now = input.now ?? Date.now();
      const roomId = input.roomId ?? createId(8);
      const existingRoom = rooms.get(roomId);
      const createdRoom = !existingRoom;
      const room =
        existingRoom ?? createRoomRecord(roomId, input.playback, now);

      if (!existingRoom) {
        room.revision = 1;
        rooms.set(roomId, room);
      }

      const participant = input.sessionId
        ? room.participants.get(input.sessionId)
        : undefined;
      const sessionId =
        participant?.sessionId ?? input.sessionId ?? createId(12);
      const joinedAt = participant?.joinedAt ?? now;
      const displayName = resolveParticipantDisplayName(
        input.displayName,
        participant?.displayName,
        sessionId,
      );

      room.participants.set(sessionId, {
        sessionId,
        displayName,
        joinedAt,
        lastSeenAt: now,
        connected: true,
      });
      room.lastActivityAt = now;

      if (createdRoom) {
        room.playback = { ...input.playback, updatedAt: now };
        room.hostSessionId = sessionId;
        room.controlMode = "shared_playback";
      } else if (
        !room.hostSessionId ||
        !room.participants.has(room.hostSessionId)
      ) {
        room.hostSessionId = sessionId;
        room.revision += 1;
      }

      return {
        sessionId,
        createdRoom,
        ...snapshotRoom(room, now),
      };
    },

    play(roomId, sessionId, playback, now = Date.now()) {
      return applyPlaybackMutation(roomId, sessionId, playback, now, "playing");
    },

    pause(roomId, sessionId, playback, now = Date.now()) {
      return applyPlaybackMutation(roomId, sessionId, playback, now, "paused");
    },

    seek(roomId, sessionId, playback, now = Date.now()) {
      return applyPlaybackMutation(roomId, sessionId, playback, now);
    },

    navigateEpisode(roomId, sessionId, playback, now = Date.now()) {
      const room = rooms.get(roomId);
      if (!room) {
        return { ok: false, code: "unknown_room" };
      }

      if (!touchParticipant(room, sessionId, now)) {
        return { ok: false, code: "not_joined" };
      }

      const capabilities = resolveCapabilitiesForParticipant(room, sessionId);
      if (!capabilities.canNavigate) {
        return { ok: false, code: "forbidden_navigation_control" };
      }

      room.playback = {
        ...playback,
        updatedAt: now,
      };
      room.navigationRevision += 1;
      room.revision += 1;

      return {
        ok: true,
        snapshot: snapshotRoom(room, now),
      };
    },

    setRoomControlMode(roomId, sessionId, controlMode, now = Date.now()) {
      const room = rooms.get(roomId);
      if (!room) {
        return { ok: false, code: "unknown_room" };
      }

      if (!touchParticipant(room, sessionId, now)) {
        return { ok: false, code: "not_joined" };
      }

      const capabilities = resolveCapabilitiesForParticipant(room, sessionId);
      if (!capabilities.canChangeMode) {
        return { ok: false, code: "forbidden_control_mode_change" };
      }

      if (room.controlMode !== controlMode) {
        room.controlMode = controlMode;
        room.revision += 1;
      }

      return {
        ok: true,
        snapshot: snapshotRoom(room, now),
      };
    },

    transferHost(roomId, sessionId, targetSessionId, now = Date.now()) {
      const room = rooms.get(roomId);
      if (!room) {
        return { ok: false, code: "unknown_room" };
      }

      if (!touchParticipant(room, sessionId, now)) {
        return { ok: false, code: "not_joined" };
      }

      const capabilities = resolveCapabilitiesForParticipant(room, sessionId);
      if (!capabilities.canTransferHost) {
        return { ok: false, code: "forbidden_host_transfer" };
      }

      const targetParticipant = room.participants.get(targetSessionId);
      if (!targetParticipant || !targetParticipant.connected) {
        return { ok: false, code: "unknown_participant" };
      }

      if (targetSessionId !== room.hostSessionId) {
        room.hostSessionId = targetSessionId;
        room.revision += 1;
      }

      return {
        ok: true,
        snapshot: snapshotRoom(room, now),
      };
    },

    getSnapshot,

    markDisconnected(roomId, sessionId, now = Date.now()) {
      const room = rooms.get(roomId);
      if (!room) {
        return undefined;
      }

      const participant = room.participants.get(sessionId);
      if (participant) {
        participant.connected = false;
        participant.lastSeenAt = now;
      }
      room.lastActivityAt = now;
      return snapshotRoom(room, now);
    },

    leave(roomId, sessionId, now = Date.now()) {
      const room = rooms.get(roomId);
      if (!room) {
        return undefined;
      }

      const wasHost = room.hostSessionId === sessionId;
      room.participants.delete(sessionId);
      room.lastActivityAt = now;

      if (room.participants.size === 0) {
        rooms.delete(roomId);
        return undefined;
      }

      if (wasHost) {
        maybeReassignHost(room, now, { incrementRevision: true });
      }

      return snapshotRoom(room, now);
    },

    prune(now = Date.now()) {
      const removedRooms: string[] = [];

      for (const [roomId, room] of rooms) {
        let removedHost = false;

        for (const [sessionId, participant] of room.participants) {
          if (
            !participant.connected &&
            now - participant.lastSeenAt > options.reconnectGraceMs
          ) {
            if (room.hostSessionId === sessionId) {
              removedHost = true;
            }
            room.participants.delete(sessionId);
          }
        }

        if (
          room.participants.size === 0 &&
          now - room.lastActivityAt > options.roomTtlMs
        ) {
          rooms.delete(roomId);
          removedRooms.push(roomId);
          continue;
        }

        if (removedHost) {
          maybeReassignHost(room, now, { incrementRevision: true });
        }
      }

      return removedRooms;
    },

    getRoomCount() {
      return rooms.size;
    },

    getConnectedParticipantCount() {
      let count = 0;
      for (const room of rooms.values()) {
        count += Array.from(room.participants.values()).filter(
          (participant) => participant.connected,
        ).length;
      }
      return count;
    },
  };
}

export type { JoinResult, RoomStoreSnapshot } from "./room-state";
