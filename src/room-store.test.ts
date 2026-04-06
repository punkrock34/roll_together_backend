import { describe, expect, it } from "vitest";

import type { PlaybackSnapshot } from "./protocol";
import { RoomStore } from "./room-store";

const playback: PlaybackSnapshot = {
  provider: "crunchyroll",
  episodeTitle: "Episode 1",
  episodeUrl: "https://www.crunchyroll.com/watch/example",
  state: "paused",
  currentTime: 12,
  duration: 120,
  playbackRate: 1,
  updatedAt: 1,
};

describe("RoomStore", () => {
  it("reuses a session id when a participant reconnects", () => {
    const store = new RoomStore({
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });
    const joined = store.join({
      roomId: "room-1",
      playback,
      sessionId: "session-1",
      now: 100,
    });

    store.markDisconnected("room-1", "session-1", 200);
    const rejoined = store.join({
      roomId: "room-1",
      playback: { ...playback, updatedAt: 250 },
      sessionId: "session-1",
      now: 250,
    });

    expect(rejoined.sessionId).toBe("session-1");
    expect(rejoined.participantCount).toBe(1);
    expect(joined.roomId).toBe("room-1");
  });

  it("rejects follower sync attempts and keeps the host authoritative", () => {
    const store = new RoomStore({
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });

    store.join({
      roomId: "room-1",
      playback,
      sessionId: "host-1",
      now: 100,
    });
    store.join({
      roomId: "room-1",
      playback: { ...playback, currentTime: 20, updatedAt: 120 },
      sessionId: "viewer-1",
      now: 120,
    });

    const result = store.sync(
      "room-1",
      "viewer-1",
      { ...playback, currentTime: 45, updatedAt: 140 },
      140,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.code).toBe("not_host");
    expect(store.getSnapshot("room-1")?.playback.currentTime).toBe(12);
  });

  it("lets the host switch the room to a new episode", () => {
    const store = new RoomStore({
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });

    const joined = store.join({
      roomId: "room-1",
      playback,
      sessionId: "host-1",
      now: 100,
    });

    const result = store.navigate(
      "room-1",
      joined.sessionId,
      {
        ...playback,
        episodeTitle: "Episode 2",
        episodeUrl: "https://www.crunchyroll.com/watch/example-2",
        currentTime: 0,
        updatedAt: 160,
      },
      160,
    );

    expect(result.ok).toBe(true);
    expect(
      result.ok ? result.snapshot.playback.episodeUrl : undefined,
    ).toContain("example-2");
  });

  it("removes an empty room immediately after the last participant leaves", () => {
    const store = new RoomStore({ roomTtlMs: 50, reconnectGraceMs: 10 });
    store.join({ roomId: "room-2", playback, sessionId: "session-2", now: 0 });
    store.leave("room-2", "session-2", 10);

    expect(store.getRoomCount()).toBe(0);
  });
});
