import type { PlaybackSnapshot } from "./protocol";
import {
  createId,
  createRoomRecord,
  resolveParticipantDisplayName,
  snapshotRoom,
  type JoinResult,
  type RoomStoreSnapshot,
} from "./room-state";

type MutationErrorCode = "unknown_room" | "not_joined" | "episode_mismatch";

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

    const participant = room.participants.get(sessionId);
    if (!participant) {
      return { ok: false, code: "not_joined" };
    }

    participant.connected = true;
    participant.lastSeenAt = now;
    room.lastActivityAt = now;

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

      room.participants.delete(sessionId);
      room.lastActivityAt = now;

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
