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
  it("creates room host metadata and keeps reconnecting session ids", () => {
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
    expect(joined.controlMode).toBe("shared_playback");
    expect(joined.hostSessionId).toBe("session-1");

    store.markDisconnected("room-1", "session-1", 150);
    const rejoined = store.join({
      roomId: "room-1",
      playback: { ...playback, updatedAt: 200 },
      sessionId: "session-1",
      now: 200,
    });

    expect(rejoined.sessionId).toBe("session-1");
    expect(rejoined.revision).toBe(1);
    expect(rejoined.hostSessionId).toBe("session-1");
  });

  it("enforces host-only playback control when mode is host_only", () => {
    const store = createRoomStore({
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });
    const host = store.join({
      roomId: "room-1",
      playback,
      sessionId: "host-1",
      now: 100,
    });
    const follower = store.join({
      roomId: "room-1",
      playback,
      sessionId: "follower-1",
      now: 120,
    });

    const switched = store.setRoomControlMode(
      host.roomId,
      host.sessionId,
      "host_only",
      125,
    );
    expect(switched.ok).toBe(true);

    const denied = store.play(
      host.roomId,
      follower.sessionId,
      { ...playback, state: "playing", currentTime: 15, updatedAt: 130 },
      130,
    );
    expect(denied.ok).toBe(false);
    expect(denied.ok ? undefined : denied.code).toBe(
      "forbidden_playback_control",
    );

    const hostPlay = store.play(
      host.roomId,
      host.sessionId,
      { ...playback, state: "playing", currentTime: 18, updatedAt: 140 },
      140,
    );
    expect(hostPlay.ok).toBe(true);
  });

  it("allows shared playback but keeps navigation host-only in shared_playback mode", () => {
    const store = createRoomStore({
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });
    const host = store.join({
      roomId: "room-1",
      playback,
      sessionId: "host-1",
      now: 100,
    });
    const follower = store.join({
      roomId: "room-1",
      playback,
      sessionId: "follower-1",
      now: 120,
    });

    const modeChanged = store.setRoomControlMode(
      host.roomId,
      host.sessionId,
      "shared_playback",
      130,
    );
    expect(modeChanged.ok).toBe(true);
    expect(modeChanged.ok ? modeChanged.snapshot.controlMode : undefined).toBe(
      "shared_playback",
    );

    const followerPlay = store.play(
      host.roomId,
      follower.sessionId,
      { ...playback, state: "playing", currentTime: 22, updatedAt: 140 },
      140,
    );
    expect(followerPlay.ok).toBe(true);

    const followerNavigate = store.navigateEpisode(
      host.roomId,
      follower.sessionId,
      {
        ...playback,
        episodeId: "G123NEWEP",
        episodeUrl: "https://www.crunchyroll.com/watch/G123NEWEP/example",
        episodeTitle: "Episode 2",
        currentTime: 0,
        updatedAt: 150,
      },
      150,
    );
    expect(followerNavigate.ok).toBe(false);
    expect(followerNavigate.ok ? undefined : followerNavigate.code).toBe(
      "forbidden_navigation_control",
    );
  });

  it("keeps host navigation allowed while shared_playback is active", () => {
    const store = createRoomStore({
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });
    const host = store.join({
      roomId: "room-1",
      playback,
      sessionId: "host-1",
      now: 100,
    });
    store.join({
      roomId: "room-1",
      playback,
      sessionId: "follower-1",
      now: 120,
    });

    const modeChanged = store.setRoomControlMode(
      host.roomId,
      host.sessionId,
      "shared_playback",
      130,
    );
    expect(modeChanged.ok).toBe(true);

    const navigation = store.navigateEpisode(
      host.roomId,
      host.sessionId,
      {
        ...playback,
        episodeId: "G123NEWEP",
        episodeUrl: "https://www.crunchyroll.com/watch/G123NEWEP/example",
        episodeTitle: "Episode 2",
        currentTime: 0,
        updatedAt: 160,
      },
      160,
    );
    expect(navigation.ok).toBe(true);
    expect(
      navigation.ok ? navigation.snapshot.navigationRevision : undefined,
    ).toBe(1);
    expect(
      navigation.ok ? navigation.snapshot.playback.episodeId : undefined,
    ).toBe("G123NEWEP");
  });

  it("transfers host and reassigns host on host leave", () => {
    const store = createRoomStore({
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });
    const host = store.join({
      roomId: "room-1",
      playback,
      sessionId: "host-1",
      now: 100,
    });
    const follower = store.join({
      roomId: "room-1",
      playback,
      sessionId: "follower-1",
      now: 120,
    });

    const transferred = store.transferHost(
      host.roomId,
      host.sessionId,
      follower.sessionId,
      130,
    );
    expect(transferred.ok).toBe(true);
    expect(
      transferred.ok ? transferred.snapshot.hostSessionId : undefined,
    ).toBe(follower.sessionId);

    const afterLeave = store.leave(host.roomId, follower.sessionId, 140);
    expect(afterLeave?.hostSessionId).toBe(host.sessionId);
  });

  it("removes rooms once all participants leave", () => {
    const store = createRoomStore({ roomTtlMs: 50, reconnectGraceMs: 10 });
    store.join({ roomId: "room-2", playback, sessionId: "session-2", now: 0 });
    store.leave("room-2", "session-2", 10);

    expect(store.getRoomCount()).toBe(0);
  });
});
