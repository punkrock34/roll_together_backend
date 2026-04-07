import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
} from "./protocol";
import { buildHealthPayload, buildVersionPayload } from "./http";
import { createRoomStore } from "./room-store";

describe("backend server", () => {
  it("builds health and version payloads for operational endpoints", () => {
    const store = createRoomStore({
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });
    const health = buildHealthPayload(store, Date.now() - 2_500);
    const version = buildVersionPayload();

    expect(health.status).toBe("ok");
    expect(health.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(version.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("parses valid join, transfer, and host transfer websocket messages", () => {
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

    const transferHostMessage = parseClientMessage(
      JSON.stringify({
        type: "transfer_host",
        version: PROTOCOL_VERSION,
        targetSessionId: "viewer-1",
      }),
    );

    const hostTransferredMessage = parseServerMessage(
      JSON.stringify({
        type: "host_transferred",
        version: PROTOCOL_VERSION,
        roomId: "room-1",
        participantCount: 2,
        participants: [],
        hostSessionId: "viewer-1",
        previousHostSessionId: "host-1",
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
    expect(transferHostMessage?.type).toBe("transfer_host");
    expect(hostTransferredMessage?.type).toBe("host_transferred");
  });
});
