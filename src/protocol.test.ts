import { describe, expect, it } from "vitest";

import {
  PROTOCOL_VERSION,
  parseClientMessage,
  parseServerMessage,
} from "./protocol";

describe("backend protocol", () => {
  it("parses a valid transfer_host client message", () => {
    const message = parseClientMessage(
      JSON.stringify({
        type: "transfer_host",
        version: PROTOCOL_VERSION,
        targetSessionId: "viewer-1",
      }),
    );

    expect(message?.type).toBe("transfer_host");
    expect(
      message && "targetSessionId" in message
        ? message.targetSessionId
        : undefined,
    ).toBe("viewer-1");
  });

  it("parses a valid host_transferred server message", () => {
    const message = parseServerMessage(
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
          episodeTitle: "Episode 1",
          episodeUrl: "https://www.crunchyroll.com/watch/example",
          state: "paused",
          currentTime: 12,
          duration: 120,
          playbackRate: 1,
          updatedAt: 500,
        },
      }),
    );

    expect(message?.type).toBe("host_transferred");
  });

  it("rejects messages from another protocol version", () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          type: "transfer_host",
          version: PROTOCOL_VERSION - 1,
          targetSessionId: "viewer-1",
        }),
      ),
    ).toBeNull();
  });
});
