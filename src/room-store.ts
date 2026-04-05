import { randomBytes } from "node:crypto";

import type { ParticipantPresence, PlaybackSnapshot } from "./protocol";

interface ParticipantRecord {
  sessionId: string;
  joinedAt: number;
  lastSeenAt: number;
  connected: boolean;
}

interface RoomRecord {
  roomId: string;
  hostSessionId: string;
  playback: PlaybackSnapshot;
  participants: Map<string, ParticipantRecord>;
  lastActivityAt: number;
}

export interface RoomStoreSnapshot {
  roomId: string;
  playback: PlaybackSnapshot;
  participants: ParticipantPresence[];
  participantCount: number;
}

interface RoomStoreOptions {
  roomTtlMs: number;
  reconnectGraceMs: number;
}

interface JoinInput {
  roomId?: string;
  sessionId?: string;
  playback: PlaybackSnapshot;
  now?: number;
}

export class RoomStore {
  private readonly rooms = new Map<string, RoomRecord>();

  constructor(private readonly options: RoomStoreOptions) {}

  join(input: JoinInput): RoomStoreSnapshot & { sessionId: string } {
    const now = input.now ?? Date.now();
    const roomId = input.roomId ?? this.createId(8);
    const room =
      this.rooms.get(roomId) ?? this.createRoom(roomId, input.playback, now);

    const participant = input.sessionId
      ? room.participants.get(input.sessionId)
      : undefined;
    const sessionId =
      participant?.sessionId ?? input.sessionId ?? this.createId(12);

    const joinedAt = participant?.joinedAt ?? now;
    room.participants.set(sessionId, {
      sessionId,
      joinedAt,
      lastSeenAt: now,
      connected: true,
    });

    room.lastActivityAt = now;
    if (this.resolvePlayback(room, now).updatedAt < input.playback.updatedAt) {
      room.playback = { ...input.playback, updatedAt: now };
    }

    if (
      !room.hostSessionId ||
      !room.participants.get(room.hostSessionId)?.connected
    ) {
      room.hostSessionId = sessionId;
    }

    return {
      sessionId,
      ...this.snapshotRoom(room, now),
    };
  }

  sync(
    roomId: string,
    sessionId: string,
    playback: PlaybackSnapshot,
    now = Date.now(),
  ) {
    const room = this.rooms.get(roomId);
    if (!room || !room.participants.has(sessionId)) {
      return undefined;
    }

    room.playback = { ...playback, updatedAt: now };
    room.lastActivityAt = now;

    const participant = room.participants.get(sessionId);
    if (participant) {
      participant.connected = true;
      participant.lastSeenAt = now;
    }

    return this.snapshotRoom(room, now);
  }

  getSnapshot(roomId: string, now = Date.now()) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return undefined;
    }

    return this.snapshotRoom(room, now);
  }

  markDisconnected(roomId: string, sessionId: string, now = Date.now()) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return undefined;
    }

    const participant = room.participants.get(sessionId);
    if (participant) {
      participant.connected = false;
      participant.lastSeenAt = now;
      room.lastActivityAt = now;
    }

    this.promoteHost(room);
    return this.snapshotRoom(room, now);
  }

  leave(roomId: string, sessionId: string, now = Date.now()) {
    const room = this.rooms.get(roomId);
    if (!room) {
      return undefined;
    }

    room.participants.delete(sessionId);
    room.lastActivityAt = now;
    this.promoteHost(room);

    if (room.participants.size === 0) {
      this.rooms.delete(roomId);
      return undefined;
    }

    return this.snapshotRoom(room, now);
  }

  prune(now = Date.now()) {
    const removedRooms: string[] = [];

    for (const [roomId, room] of this.rooms) {
      for (const [sessionId, participant] of room.participants) {
        if (
          !participant.connected &&
          now - participant.lastSeenAt > this.options.reconnectGraceMs
        ) {
          room.participants.delete(sessionId);
        }
      }

      this.promoteHost(room);

      if (
        room.participants.size === 0 &&
        now - room.lastActivityAt > this.options.roomTtlMs
      ) {
        this.rooms.delete(roomId);
        removedRooms.push(roomId);
      }
    }

    return removedRooms;
  }

  getRoomCount() {
    return this.rooms.size;
  }

  getConnectedParticipantCount() {
    let count = 0;
    for (const room of this.rooms.values()) {
      count += Array.from(room.participants.values()).filter(
        (participant) => participant.connected,
      ).length;
    }
    return count;
  }

  private createRoom(roomId: string, playback: PlaybackSnapshot, now: number) {
    const room: RoomRecord = {
      roomId,
      hostSessionId: "",
      playback: { ...playback, updatedAt: now },
      participants: new Map(),
      lastActivityAt: now,
    };

    this.rooms.set(roomId, room);
    return room;
  }

  private snapshotRoom(room: RoomRecord, now: number): RoomStoreSnapshot {
    const participants = Array.from(room.participants.values())
      .filter((participant) => participant.connected)
      .map<ParticipantPresence>((participant) => ({
        sessionId: participant.sessionId,
        isHost: participant.sessionId === room.hostSessionId,
        joinedAt: participant.joinedAt,
        lastSeenAt: participant.lastSeenAt,
        connected: participant.connected,
      }))
      .sort((left, right) => left.joinedAt - right.joinedAt);

    return {
      roomId: room.roomId,
      playback: this.resolvePlayback(room, now),
      participants,
      participantCount: participants.length,
    };
  }

  private resolvePlayback(room: RoomRecord, now: number): PlaybackSnapshot {
    if (room.playback.state !== "playing") {
      return room.playback;
    }

    const elapsedSeconds = Math.max(0, (now - room.playback.updatedAt) / 1000);
    const currentTime =
      room.playback.currentTime +
      elapsedSeconds * Math.max(room.playback.playbackRate, 1);

    return {
      ...room.playback,
      currentTime,
      updatedAt: now,
    };
  }

  private promoteHost(room: RoomRecord) {
    const currentHost = room.participants.get(room.hostSessionId);
    if (currentHost?.connected) {
      return;
    }

    const nextHost = Array.from(room.participants.values())
      .filter((participant) => participant.connected)
      .sort((left, right) => left.joinedAt - right.joinedAt)[0];

    room.hostSessionId = nextHost?.sessionId ?? "";
  }

  private createId(length: number) {
    return randomBytes(length).toString("base64url").slice(0, length);
  }
}
