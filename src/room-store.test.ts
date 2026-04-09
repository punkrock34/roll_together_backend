import { describe, expect, it } from "vitest";

import type { PlaybackSnapshot } from "./protocol";
import { createRoomStore } from "./room-store";

const playback: PlaybackSnapshot = {
  provider: "crunchyroll",
  episodeId: "G4VUQ1ZKW",
  episodeTitle: "Episode 1",
  episodeUrl: "https://www.crunchyroll.com/watch/G4VUQ1ZKW/example",
  state: "paused",
  currentTime: 12,
  duration: 120,
  playbackRate: 1,
  updatedAt: 1,
};

describe("room store", () => {
  it("creates a room with canonical revision and reuses reconnecting session ids", () => {
    const store = createRoomStore({
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });
    const joined = store.join({
      roomId: "room-1",
      playback,
      sessionId: "session-1",
      now: 100,
    });

    expect(joined.revision).toBe(1);

    store.markDisconnected("room-1", "session-1", 150);
    const rejoined = store.join({
      roomId: "room-1",
      playback: { ...playback, updatedAt: 200 },
      sessionId: "session-1",
      now: 200,
    });

    expect(rejoined.sessionId).toBe("session-1");
    expect(rejoined.revision).toBe(1);
  });

  it("increments revision for accepted play, pause, and seek mutations", () => {
    const store = createRoomStore({
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });
    const joined = store.join({
      roomId: "room-1",
      playback,
      sessionId: "session-1",
      now: 100,
    });

    const played = store.play(
      joined.roomId,
      joined.sessionId,
      { ...playback, state: "playing", currentTime: 15, updatedAt: 120 },
      120,
    );
    expect(played.ok).toBe(true);
    expect(played.ok ? played.snapshot.revision : undefined).toBe(2);

    const paused = store.pause(
      joined.roomId,
      joined.sessionId,
      { ...playback, state: "paused", currentTime: 22, updatedAt: 150 },
      150,
    );
    expect(paused.ok).toBe(true);
    expect(paused.ok ? paused.snapshot.revision : undefined).toBe(3);

    const sought = store.seek(
      joined.roomId,
      joined.sessionId,
      { ...playback, state: "paused", currentTime: 45, updatedAt: 180 },
      180,
    );
    expect(sought.ok).toBe(true);
    expect(sought.ok ? sought.snapshot.revision : undefined).toBe(4);
    expect(sought.ok ? sought.snapshot.playback.currentTime : undefined).toBe(
      45,
    );
  });

  it("rejects playback mutations from participants that are not joined", () => {
    const store = createRoomStore({
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });

    store.join({
      roomId: "room-1",
      playback,
      sessionId: "session-1",
      now: 100,
    });

    const result = store.seek(
      "room-1",
      "missing-session",
      { ...playback, currentTime: 44, updatedAt: 120 },
      120,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.code).toBe("not_joined");
  });

  it("rejects playback mutations when command episodeId mismatches room episode", () => {
    const store = createRoomStore({
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });

    const joined = store.join({
      roomId: "room-1",
      playback,
      sessionId: "session-1",
      now: 100,
    });

    const result = store.play(
      joined.roomId,
      joined.sessionId,
      {
        ...playback,
        episodeId: "OTHER_EPISODE",
        episodeUrl: "https://www.crunchyroll.com/watch/OTHER_EPISODE/example",
        state: "playing",
        updatedAt: 140,
      },
      140,
    );

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.code).toBe("episode_mismatch");
  });

  it("removes rooms once all participants leave", () => {
    const store = createRoomStore({ roomTtlMs: 50, reconnectGraceMs: 10 });
    store.join({ roomId: "room-2", playback, sessionId: "session-2", now: 0 });
    store.leave("room-2", "session-2", 10);

    expect(store.getRoomCount()).toBe(0);
  });
});
