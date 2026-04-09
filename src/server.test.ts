import type { AddressInfo } from "node:net";

import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it } from "vitest";

import { PROTOCOL_VERSION, type PlaybackSnapshot } from "./protocol";
import { buildHealthPayload, buildVersionPayload } from "./http";
import { createRoomStore } from "./room-store";
import { createRollTogetherServer } from "./server";

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

function waitForEvent<T>(
  socket: Socket,
  event: string,
  predicate?: (payload: T) => boolean,
  timeoutMs = 3_000,
) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      socket.off(event, handler as (...args: unknown[]) => void);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    const handler = (payload: T) => {
      if (predicate && !predicate(payload)) {
        return;
      }
      clearTimeout(timeoutId);
      socket.off(event, handler as (...args: unknown[]) => void);
      resolve(payload);
    };

    socket.on(event, handler as (...args: unknown[]) => void);
  });
}

describe("backend server", () => {
  const openSockets: Socket[] = [];

  afterEach(() => {
    for (const socket of openSockets) {
      if (socket.connected) {
        socket.disconnect();
      }
    }
    openSockets.length = 0;
  });

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

  it("emits canonical state_snapshot to all clients including sender", async () => {
    const server = createRollTogetherServer({
      host: "127.0.0.1",
      port: 0,
      corsOrigin: "*",
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });
    await server.start();

    try {
      const port = (server.httpServer.address() as AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      const clientA = createClient(baseUrl, {
        path: "/ws",
        transports: ["websocket"],
      });
      const clientB = createClient(baseUrl, {
        path: "/ws",
        transports: ["websocket"],
      });
      openSockets.push(clientA, clientB);

      await Promise.all([
        waitForEvent(clientA, "connect"),
        waitForEvent(clientB, "connect"),
      ]);

      const joinedA = waitForEvent<{
        roomId: string;
        sessionId: string;
        state: { revision: number };
      }>(clientA, "room_joined");
      clientA.emit("join_room", {
        version: PROTOCOL_VERSION,
        playback,
      });
      const joinedAPayload = await joinedA;

      const joinedB = waitForEvent<{
        roomId: string;
      }>(clientB, "room_joined");
      clientB.emit("join_room", {
        version: PROTOCOL_VERSION,
        roomId: joinedAPayload.roomId,
        playback,
      });
      await joinedB;

      const nextSnapshotForA = waitForEvent<{ state: { revision: number } }>(
        clientA,
        "state_snapshot",
        (payload) => payload.state.revision > joinedAPayload.state.revision,
      );
      const nextSnapshotForB = waitForEvent<{
        state: { revision: number; playback: { state: string } };
      }>(
        clientB,
        "state_snapshot",
        (payload) => payload.state.revision > joinedAPayload.state.revision,
      );

      clientA.emit("play", {
        version: PROTOCOL_VERSION,
        playback: {
          ...playback,
          state: "playing",
          currentTime: 25,
          updatedAt: Date.now(),
        },
      });

      const [snapshotA, snapshotB] = await Promise.all([
        nextSnapshotForA,
        nextSnapshotForB,
      ]);

      expect(snapshotA.state.revision).toBe(snapshotB.state.revision);
      expect(snapshotB.state.playback.state).toBe("playing");
    } finally {
      await server.stop();
    }
  });

  it("returns command_error for invalid payloads and preserves revision on request_state", async () => {
    const server = createRollTogetherServer({
      host: "127.0.0.1",
      port: 0,
      corsOrigin: "*",
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });
    await server.start();

    try {
      const port = (server.httpServer.address() as AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      const client = createClient(baseUrl, {
        path: "/ws",
        transports: ["websocket"],
      });
      openSockets.push(client);
      await waitForEvent(client, "connect");

      const joined = waitForEvent<{
        state: { revision: number };
      }>(client, "room_joined");
      client.emit("join_room", {
        version: PROTOCOL_VERSION,
        playback,
      });
      const joinedPayload = await joined;

      const commandError = waitForEvent<{ code: string }>(
        client,
        "command_error",
      );
      client.emit("play", {
        version: PROTOCOL_VERSION,
        playback: {
          ...playback,
          episodeId: "OTHER_EPISODE",
          updatedAt: Date.now(),
        },
      });

      expect((await commandError).code).toBe("episode_mismatch");

      const requestState = waitForEvent<{ state: { revision: number } }>(
        client,
        "state_snapshot",
      );
      client.emit("request_state", {
        version: PROTOCOL_VERSION,
      });

      expect((await requestState).state.revision).toBe(
        joinedPayload.state.revision,
      );
    } finally {
      await server.stop();
    }
  });

  it("enforces host-only navigation and emits room_navigation for accepted commands", async () => {
    const server = createRollTogetherServer({
      host: "127.0.0.1",
      port: 0,
      corsOrigin: "*",
      roomTtlMs: 60_000,
      reconnectGraceMs: 30_000,
    });
    await server.start();

    try {
      const port = (server.httpServer.address() as AddressInfo).port;
      const baseUrl = `http://127.0.0.1:${port}`;

      const host = createClient(baseUrl, {
        path: "/ws",
        transports: ["websocket"],
      });
      const follower = createClient(baseUrl, {
        path: "/ws",
        transports: ["websocket"],
      });
      openSockets.push(host, follower);

      await Promise.all([
        waitForEvent(host, "connect"),
        waitForEvent(follower, "connect"),
      ]);

      const hostJoined = waitForEvent<{
        roomId: string;
        sessionId: string;
      }>(host, "room_joined");
      host.emit("join_room", {
        version: PROTOCOL_VERSION,
        playback,
      });
      const hostJoinedPayload = await hostJoined;

      const followerJoined = waitForEvent(follower, "room_joined");
      follower.emit("join_room", {
        version: PROTOCOL_VERSION,
        roomId: hostJoinedPayload.roomId,
        playback,
      });
      await followerJoined;

      const deniedNavigation = waitForEvent<{ code: string }>(
        follower,
        "command_error",
      );
      follower.emit("navigate_episode", {
        version: PROTOCOL_VERSION,
        playback: {
          ...playback,
          episodeId: "G123NEWEP",
          episodeUrl: "https://www.crunchyroll.com/watch/G123NEWEP/example",
          episodeTitle: "Episode 2",
          currentTime: 0,
          updatedAt: Date.now(),
        },
      });
      expect((await deniedNavigation).code).toBe(
        "forbidden_navigation_control",
      );

      const roomNavigation = waitForEvent<{
        playback: { episodeId: string };
        navigationRevision: number;
      }>(
        follower,
        "room_navigation",
        (payload) => payload.playback.episodeId === "G123NEWEP",
      );
      const stateAfterNavigation = waitForEvent<{
        state: { playback: { episodeId: string } };
      }>(
        host,
        "state_snapshot",
        (payload) => payload.state.playback.episodeId === "G123NEWEP",
      );

      host.emit("navigate_episode", {
        version: PROTOCOL_VERSION,
        playback: {
          ...playback,
          episodeId: "G123NEWEP",
          episodeUrl: "https://www.crunchyroll.com/watch/G123NEWEP/example",
          episodeTitle: "Episode 2",
          currentTime: 0,
          updatedAt: Date.now(),
        },
      });

      const [navigationPayload] = await Promise.all([
        roomNavigation,
        stateAfterNavigation,
      ]);
      expect(navigationPayload.navigationRevision).toBe(1);
    } finally {
      await server.stop();
    }
  });
});
