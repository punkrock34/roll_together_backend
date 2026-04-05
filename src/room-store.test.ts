import { describe, expect, it } from "vitest";

import { RoomStore } from "./room-store";
import type { PlaybackSnapshot } from "./protocol";

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

  it("removes an empty room immediately after the last participant leaves", () => {
    const store = new RoomStore({ roomTtlMs: 50, reconnectGraceMs: 10 });
    store.join({ roomId: "room-2", playback, sessionId: "session-2", now: 0 });
    store.leave("room-2", "session-2", 10);

    expect(store.getRoomCount()).toBe(0);
  });
});
