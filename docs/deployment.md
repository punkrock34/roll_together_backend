# Deployment

If you are completely new to self-hosting, read [self-hosting.md](self-hosting.md) first. That guide starts with setup choices and plain-language explanations before getting into the deployment details here.

## Requirements

- Node.js 20+ for local development
- Docker and Docker Compose for the default self-host flow

## Environment

Supported variables are listed in `.env.example`:

- `HOST_PORT`
- `PORT`
- `HOST`
- `ROOM_TTL_MS`
- `RECONNECT_GRACE_MS`
- `CORS_ORIGIN`

## Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
```

If host port `3000` is already taken, keep the app on container port `3000` and change only the published host port:

```env
HOST_PORT=11420
PORT=3000
```

Then check:

```bash
curl http://localhost:11420/health
```

## Reverse Proxy and Tunnel

- A sample Nginx config lives in [nginx.conf](nginx.conf).
- A sample Apache config lives in [apache.conf](apache.conf).
- Home-hosted setups can also use a tunnel instead of router port forwarding.
- If you expose the backend through a reverse proxy or tunnel, the extension should use:
  - `https://your-domain`
  - `wss://your-domain/ws`

## Local Extension Pairing

Point the extension at the backend with either:

- popup/settings page controls, or
- the extension `.env` values used for local builds
