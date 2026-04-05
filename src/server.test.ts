import { describe, expect, it } from "vitest";

import { buildHealthPayload, buildVersionPayload } from "./server";
import { PROTOCOL_VERSION, parseClientMessage } from "./protocol";
import { RoomStore } from "./room-store";

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

  it("parses a valid join message for the websocket protocol", () => {
    const message = parseClientMessage(
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

    expect(message?.type).toBe("join");
    expect(message && "roomId" in message ? message.roomId : undefined).toBe(
      "room-1",
    );
  });
});
