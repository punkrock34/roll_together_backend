# Roll Together v2 Backend

Roll Together v2 Backend is the self-hostable realtime service that powers anonymous watch parties for the Roll Together browser extension.

## Project Lineage

This backend continues the original work from SamuraiExx's [`roll_together_backend`](https://github.com/samuraiexx/roll_together_backend) repository. The project remains MIT-licensed, and the original README has been preserved in [README.legacy.md](README.legacy.md).

## v2 Goals

- Typed WebSocket room protocol instead of the original Socket.IO flow.
- Versioned health and version endpoints for easier operations.
- In-memory rooms with reconnect handling and TTL cleanup.
- Simple self-hosting story with Docker Compose and `.env` configuration.
- Browser-extension-friendly defaults with no required accounts.

## API Surface

- `GET /health`
- `GET /version`
- `WS /ws`

The WebSocket contract supports `join`, `sync`, `presence`, `leave`, `ping`, and `pong`.

## Development

### Prerequisites

- Node.js 20+
- npm 10+

### Install

```bash
npm install
```

### Local Development

```bash
cp .env.example .env
npm run dev
```

The server listens on `http://localhost:3000` by default.

### Quality Checks

```bash
npm run lint
npm run check
npm run test
```

## Docker Compose

```bash
cp .env.example .env
docker compose up --build
```

Health endpoint:

```bash
curl http://localhost:3000/health
```

## Configuration

See `.env.example` for the supported settings:

- `PORT`
- `HOST`
- `ROOM_TTL_MS`
- `RECONNECT_GRACE_MS`
- `CORS_ORIGIN`

## Manual Self-Host Flow

1. Start this backend locally with Docker Compose or `npm run dev`.
2. In the extension repo, set the backend URLs to `http://localhost:3000` and `ws://localhost:3000/ws`.
3. Load the unpacked extension in Chrome or Firefox.
4. Open the same Crunchyroll episode in two windows and verify room sync.

## Reverse Proxy

A sample Nginx config is included at [docs/nginx.conf](docs/nginx.conf).
