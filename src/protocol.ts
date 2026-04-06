export const PROTOCOL_VERSION = 2;

export type ProviderName = "crunchyroll";
export type PlaybackState = "playing" | "paused";
export type RoomMutationErrorCode = "unknown_room" | "not_joined" | "not_host";

export interface EpisodeInfo {
  provider: ProviderName;
  episodeUrl: string;
  episodeTitle: string;
}

export interface PlaybackSnapshot extends EpisodeInfo {
  state: PlaybackState;
  currentTime: number;
  duration: number | null;
  playbackRate: number;
  updatedAt: number;
}

export interface ParticipantPresence {
  sessionId: string;
  isHost: boolean;
  joinedAt: number;
  lastSeenAt: number;
  connected: boolean;
}

export interface JoinMessage {
  type: "join";
  version: number;
  roomId?: string;
  sessionId?: string;
  playback: PlaybackSnapshot;
}

export interface SyncMessage {
  type: "sync";
  version: number;
  playback: PlaybackSnapshot;
}

export interface NavigateMessage {
  type: "navigate";
  version: number;
  playback: PlaybackSnapshot;
}

export interface LeaveMessage {
  type: "leave";
  version: number;
}

export interface PingMessage {
  type: "ping";
  version: number;
  sentAt: number;
}

export type ClientMessage =
  | JoinMessage
  | SyncMessage
  | NavigateMessage
  | LeaveMessage
  | PingMessage;

interface RoomSnapshotMessageBase {
  roomId: string;
  participantCount: number;
  participants: ParticipantPresence[];
  hostSessionId: string;
  playback: PlaybackSnapshot;
}

export interface JoinedMessage extends RoomSnapshotMessageBase {
  type: "joined";
  version: number;
  sessionId: string;
}

interface RoomBroadcastMessageBase extends RoomSnapshotMessageBase {
  version: number;
  participantId: string;
}

export interface SyncBroadcastMessage extends RoomBroadcastMessageBase {
  type: "sync";
}

export interface NavigateBroadcastMessage extends RoomBroadcastMessageBase {
  type: "navigate";
}

export interface PresenceMessage {
  type: "presence";
  version: number;
  roomId: string;
  participantCount: number;
  participants: ParticipantPresence[];
  hostSessionId: string;
}

export interface PongMessage {
  type: "pong";
  version: number;
  sentAt: number;
  receivedAt: number;
}

export interface ErrorMessage {
  type: "error";
  version: number;
  code: RoomMutationErrorCode | "invalid_message";
  message: string;
}

export type ServerMessage =
  | JoinedMessage
  | SyncBroadcastMessage
  | NavigateBroadcastMessage
  | PresenceMessage
  | PongMessage
  | ErrorMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isPlaybackSnapshot(value: unknown): value is PlaybackSnapshot {
  return (
    isRecord(value) &&
    value.provider === "crunchyroll" &&
    typeof value.episodeUrl === "string" &&
    typeof value.episodeTitle === "string" &&
    (value.state === "playing" || value.state === "paused") &&
    typeof value.currentTime === "number" &&
    (typeof value.duration === "number" || value.duration === null) &&
    typeof value.playbackRate === "number" &&
    typeof value.updatedAt === "number"
  );
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return null;
  }

  switch (parsed.type) {
    case "join":
      return isPlaybackSnapshot(parsed.playback)
        ? (parsed as unknown as JoinMessage)
        : null;
    case "sync":
      return isPlaybackSnapshot(parsed.playback)
        ? (parsed as unknown as SyncMessage)
        : null;
    case "navigate":
      return isPlaybackSnapshot(parsed.playback)
        ? (parsed as unknown as NavigateMessage)
        : null;
    case "leave":
      return parsed as unknown as LeaveMessage;
    case "ping":
      return typeof parsed.sentAt === "number"
        ? (parsed as unknown as PingMessage)
        : null;
    default:
      return null;
  }
}
