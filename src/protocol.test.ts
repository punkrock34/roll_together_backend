import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  parseHeartbeatPayload,
  parseJoinRoomPayload,
  parsePlaybackCommandPayload,
  parseRequestStatePayload,
  parseStateSnapshotPayload,
  type PlaybackSnapshot,
  type RoomStateSnapshot,
} from "./protocol";

const playback: PlaybackSnapshot = {
  provider: "crunchyroll",
  episodeId: "G4VUQ1ZKW",
  episodeTitle: "Episode 1",
  episodeUrl: "https://www.crunchyroll.com/watch/G4VUQ1ZKW/example",
  state: "paused",
  currentTime: 12,
  duration: 120,
  playbackRate: 1,
  updatedAt: 10,
};

describe("backend protocol payload validators", () => {
  it("parses a valid join_room payload", () => {
    const parsed = parseJoinRoomPayload({
      version: PROTOCOL_VERSION,
      roomId: "room-1",
      sessionId: "session-1",
      displayName: "Guest",
      playback,
    });

    expect(parsed?.roomId).toBe("room-1");
    expect(parsed?.playback.episodeId).toBe("G4VUQ1ZKW");
  });

  it("rejects join_room payloads from the wrong protocol version", () => {
    expect(
      parseJoinRoomPayload({
        version: PROTOCOL_VERSION - 1,
        playback,
      }),
    ).toBeNull();
  });

  it("parses playback command payloads", () => {
    const parsed = parsePlaybackCommandPayload({
      version: PROTOCOL_VERSION,
      playback: {
        ...playback,
        state: "playing",
      },
    });

    expect(parsed?.playback.state).toBe("playing");
  });

  it("parses request_state and heartbeat payloads", () => {
    expect(
      parseRequestStatePayload({
        version: PROTOCOL_VERSION,
      }),
    ).toEqual({
      version: PROTOCOL_VERSION,
    });

    expect(
      parseHeartbeatPayload({
        version: PROTOCOL_VERSION,
        sentAt: 123,
      }),
    ).toEqual({
      version: PROTOCOL_VERSION,
      sentAt: 123,
    });
  });

  it("parses state_snapshot payloads", () => {
    const snapshot: RoomStateSnapshot = {
      roomId: "room-1",
      revision: 3,
      updatedAt: 400,
      playback: {
        ...playback,
        state: "playing",
        currentTime: 25,
      },
      participantCount: 1,
      participants: [
        {
          sessionId: "session-1",
          displayName: "Guest",
          isHost: false,
          joinedAt: 100,
          lastSeenAt: 400,
          connected: true,
        },
      ],
    };

    const parsed = parseStateSnapshotPayload({
      version: PROTOCOL_VERSION,
      state: snapshot,
    });

    expect(parsed?.state.revision).toBe(3);
    expect(parsed?.state.playback.episodeId).toBe("G4VUQ1ZKW");
  });
});
