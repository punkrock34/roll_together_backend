import type { PlaybackSnapshot, RoomMutationErrorCode } from "./protocol";
import {
  createId,
  createRoomRecord,
  promoteHost,
  resolveParticipantDisplayName,
  resolvePlayback,
  shouldAcceptPlaybackUpdate,
  snapshotRoom,
  type JoinResult,
  type RoomStoreSnapshot,
} from "./room-state";

interface MutationSuccess {
  ok: true;
  snapshot: RoomStoreSnapshot;
}

interface TransferHostSuccess extends MutationSuccess {
  previousHostSessionId: string;
}

interface MutationFailure {
  ok: false;
  code: RoomMutationErrorCode;
}

export type RoomMutationResult = MutationSuccess | MutationFailure;
export type TransferHostResult = TransferHostSuccess | MutationFailure;

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
  sync(
    roomId: string,
    sessionId: string,
    playback: PlaybackSnapshot,
    now?: number,
  ): RoomMutationResult;
  navigate(
    roomId: string,
    sessionId: string,
    playback: PlaybackSnapshot,
    now?: number,
  ): RoomMutationResult;
  transferHost(
    roomId: string,
    sessionId: string,
    targetSessionId: string,
    now?: number,
  ): TransferHostResult;
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

export function createRoomStore(options: RoomStoreOptions): RoomStore {
  const rooms = new Map<string, ReturnType<typeof createRoomRecord>>();

  const getSnapshot = (roomId: string, now = Date.now()) => {
    const room = rooms.get(roomId);
    if (!room) {
      return undefined;
    }

    return snapshotRoom(room, now);
  };

  const applyHostPlayback = (
    roomId: string,
    sessionId: string,
    playback: PlaybackSnapshot,
    now: number,
  ): RoomMutationResult => {
    const room = rooms.get(roomId);
    if (!room) {
      return { ok: false, code: "unknown_room" };
    }

    const participant = room.participants.get(sessionId);
    if (!participant) {
      return { ok: false, code: "not_joined" };
    }

    if (room.hostSessionId !== sessionId) {
      participant.connected = true;
      participant.lastSeenAt = now;
      room.lastActivityAt = now;
      return { ok: false, code: "not_host" };
    }

    participant.connected = true;
    participant.lastSeenAt = now;
    room.lastActivityAt = now;
    room.playback = { ...playback, updatedAt: now };

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
      const previousPlayback = createdRoom
        ? undefined
        : resolvePlayback(room, now);

      if (!existingRoom) {
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
      if (!room.hostSessionId) {
        room.hostSessionId = sessionId;
      }

      const isHost = room.hostSessionId === sessionId;
      let episodeChanged = false;

      if (createdRoom) {
        room.playback = { ...input.playback, updatedAt: now };
      } else if (
        isHost &&
        shouldAcceptPlaybackUpdate(previousPlayback, input.playback)
      ) {
        episodeChanged =
          previousPlayback?.episodeUrl !== input.playback.episodeUrl;
        room.playback = { ...input.playback, updatedAt: now };
      }

      promoteHost(room);

      return {
        sessionId,
        createdRoom,
        episodeChanged,
        ...snapshotRoom(room, now),
      };
    },

    sync(roomId, sessionId, playback, now = Date.now()) {
      return applyHostPlayback(roomId, sessionId, playback, now);
    },

    navigate(roomId, sessionId, playback, now = Date.now()) {
      return applyHostPlayback(roomId, sessionId, playback, now);
    },

    transferHost(roomId, sessionId, targetSessionId, now = Date.now()) {
      const room = rooms.get(roomId);
      if (!room) {
        return { ok: false, code: "unknown_room" };
      }

      const currentHost = room.participants.get(sessionId);
      if (!currentHost) {
        return { ok: false, code: "not_joined" };
      }

      currentHost.connected = true;
      currentHost.lastSeenAt = now;
      room.lastActivityAt = now;

      if (room.hostSessionId !== sessionId) {
        return { ok: false, code: "not_host" };
      }

      if (sessionId === targetSessionId) {
        return { ok: false, code: "invalid_transfer_target" };
      }

      const target = room.participants.get(targetSessionId);
      if (
        !target ||
        !target.connected ||
        room.hostSessionId === targetSessionId
      ) {
        return { ok: false, code: "invalid_transfer_target" };
      }

      target.lastSeenAt = now;
      room.lastActivityAt = now;
      room.playback = resolvePlayback(room, now);

      const previousHostSessionId = room.hostSessionId;
      room.hostSessionId = targetSessionId;

      return {
        ok: true,
        previousHostSessionId,
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
        room.lastActivityAt = now;
      }

      promoteHost(room);
      return snapshotRoom(room, now);
    },

    leave(roomId, sessionId, now = Date.now()) {
      const room = rooms.get(roomId);
      if (!room) {
        return undefined;
      }

      room.participants.delete(sessionId);
      room.lastActivityAt = now;
      promoteHost(room);

      if (room.participants.size === 0) {
        rooms.delete(roomId);
        return undefined;
      }

      return snapshotRoom(room, now);
    },

    prune(now = Date.now()) {
      const removedRooms: string[] = [];

      for (const [roomId, room] of rooms) {
        for (const [sessionId, participant] of room.participants) {
          if (
            !participant.connected &&
            now - participant.lastSeenAt > options.reconnectGraceMs
          ) {
            room.participants.delete(sessionId);
          }
        }

        promoteHost(room);

        if (
          room.participants.size === 0 &&
          now - room.lastActivityAt > options.roomTtlMs
        ) {
          rooms.delete(roomId);
          removedRooms.push(roomId);
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
