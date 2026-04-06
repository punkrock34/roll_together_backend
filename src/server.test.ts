import { describe, expect, it } from "vitest";

import { PROTOCOL_VERSION, parseClientMessage } from "./protocol";
import { RoomStore } from "./room-store";
import { buildHealthPayload, buildVersionPayload } from "./server";

describe("backend server", () => {
  it("builds health and version payloads for operational endpoints", () => {
    const store = new RoomStore({
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });
    const health = buildHealthPayload(store, Date.now() - 2_500);
    const version = buildVersionPayload();

    expect(health.status).toBe("ok");
    expect(health.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(version.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("parses valid join and navigate websocket messages", () => {
    const joinMessage = parseClientMessage(
      JSON.stringify({
        type: "join",
        version: PROTOCOL_VERSION,
        roomId: "room-1",
        sessionId: "session-1",
        playback: {
          provider: "crunchyroll",
          episodeTitle: "Episode 1",
          episodeUrl: "https://www.crunchyroll.com/watch/example",
          state: "paused",
          currentTime: 12,
          duration: 24,
          playbackRate: 1,
          updatedAt: Date.now(),
        },
      }),
    );

    const navigateMessage = parseClientMessage(
      JSON.stringify({
        type: "navigate",
        version: PROTOCOL_VERSION,
        playback: {
          provider: "crunchyroll",
          episodeTitle: "Episode 2",
          episodeUrl: "https://www.crunchyroll.com/watch/example-2",
          state: "paused",
          currentTime: 0,
          duration: 24,
          playbackRate: 1,
          updatedAt: Date.now(),
        },
      }),
    );

    expect(joinMessage?.type).toBe("join");
    expect(
      joinMessage && "roomId" in joinMessage ? joinMessage.roomId : undefined,
    ).toBe("room-1");
    expect(navigateMessage?.type).toBe("navigate");
  });
});
