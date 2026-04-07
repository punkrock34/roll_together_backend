import { randomBytes } from "node:crypto";

import type { ParticipantPresence, PlaybackSnapshot } from "./protocol";

export interface ParticipantRecord {
  sessionId: string;
  displayName: string;
  joinedAt: number;
  lastSeenAt: number;
  connected: boolean;
}

export interface RoomRecord {
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
  hostSessionId: string;
}

export interface JoinResult extends RoomStoreSnapshot {
  sessionId: string;
  createdRoom: boolean;
  episodeChanged: boolean;
}

export function createRoomRecord(
  roomId: string,
  playback: PlaybackSnapshot,
  now: number,
) {
  return {
    roomId,
    hostSessionId: "",
    playback: { ...playback, updatedAt: now },
    participants: new Map<string, ParticipantRecord>(),
    lastActivityAt: now,
  } satisfies RoomRecord;
}

export function snapshotRoom(room: RoomRecord, now: number): RoomStoreSnapshot {
  const participants = Array.from(room.participants.values())
    .filter((participant) => participant.connected)
    .map<ParticipantPresence>((participant) => ({
      sessionId: participant.sessionId,
      displayName: participant.displayName,
      isHost: participant.sessionId === room.hostSessionId,
      joinedAt: participant.joinedAt,
      lastSeenAt: participant.lastSeenAt,
      connected: participant.connected,
    }))
    .sort((left, right) => left.joinedAt - right.joinedAt);

  return {
    roomId: room.roomId,
    playback: resolvePlayback(room, now),
    participants,
    participantCount: participants.length,
    hostSessionId: room.hostSessionId,
  };
}

export function resolvePlayback(
  room: RoomRecord,
  now: number,
): PlaybackSnapshot {
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

export function promoteHost(room: RoomRecord) {
  const currentHost = room.participants.get(room.hostSessionId);
  if (currentHost?.connected) {
    return;
  }

  const nextHost = Array.from(room.participants.values())
    .filter((participant) => participant.connected)
    .sort((left, right) => left.joinedAt - right.joinedAt)[0];

  room.hostSessionId = nextHost?.sessionId ?? "";
}

export function shouldAcceptPlaybackUpdate(
  currentPlayback: PlaybackSnapshot | undefined,
  nextPlayback: PlaybackSnapshot,
) {
  if (!currentPlayback) {
    return true;
  }

  return (
    currentPlayback.episodeUrl !== nextPlayback.episodeUrl ||
    currentPlayback.state !== nextPlayback.state ||
    Math.abs(currentPlayback.currentTime - nextPlayback.currentTime) > 0.05 ||
    currentPlayback.playbackRate !== nextPlayback.playbackRate ||
    currentPlayback.duration !== nextPlayback.duration ||
    currentPlayback.updatedAt < nextPlayback.updatedAt
  );
}

export function resolveParticipantDisplayName(
  nextDisplayName: string | undefined,
  existingDisplayName: string | undefined,
  sessionId: string,
) {
  const trimmed = nextDisplayName?.trim();
  if (trimmed) {
    return trimmed.slice(0, 40);
  }

  if (existingDisplayName) {
    return existingDisplayName;
  }

  return `Guest ${sessionId.slice(0, 4)}`;
}

export function createId(length: number) {
  return randomBytes(length).toString("base64url").slice(0, length);
}
