# Self-Hosting Guide

This guide covers the simplest way to run the Roll Together backend on your own server.

The backend itself is just one HTTP + WebSocket service. Most setups look like this:

1. run the backend with Docker
2. put Nginx or Apache in front of it
3. point a domain at your server
4. use `https://your-domain` and `wss://your-domain/ws` in the extension

## What You Need

- a server or VPS with Docker and Docker Compose
- a domain name if you want external access
- optional: Nginx or Apache for reverse proxy + TLS

If you only want local testing on the same machine, you can skip the domain and reverse proxy and keep using `http://localhost:3000`.

## 1. Start the Backend with Docker

Copy the example environment file:

```bash
cp .env.example .env
```

A simple starting point:

```env
HOST_PORT=3000
PORT=3000
HOST=0.0.0.0
ROOM_TTL_MS=600000
RECONNECT_GRACE_MS=60000
CORS_ORIGIN=*
```

Then start the service:

```bash
docker compose up -d --build
```

Check that it is alive:

```bash
curl http://localhost:3000/health
```

If port `3000` is already in use, only change `HOST_PORT`:

```env
HOST_PORT=11420
PORT=3000
```

Then the local health check becomes:

```bash
curl http://localhost:11420/health
```

## 2. Point a Domain at the Server

If you want friends or other devices to connect, point a domain or subdomain at your server's public IP.

Common examples:

- `watch.example.com`
- `rt.example.com`

If your server is behind a home router, you will usually also need:

- router port forwarding for `80` and `443`
- firewall rules allowing `80/tcp` and `443/tcp`

Try to avoid exposing the backend's raw Docker port directly to the internet. It is cleaner to keep the backend local and let Nginx or Apache handle public traffic.

## 3. Put a Reverse Proxy in Front

The backend expects:

- normal HTTP traffic on `/`
- WebSocket traffic on `/ws`

This repository includes example reverse proxy configs:

- [Nginx example](nginx.conf)
- [Apache example](apache.conf)

### Nginx

Start from [nginx.conf](nginx.conf).

Typical flow:

1. copy the example into your server config
2. replace `server_name _;` with your real domain
3. if needed, replace `127.0.0.1:3000` with your chosen `HOST_PORT`
4. reload Nginx

### Apache

Start from [apache.conf](apache.conf).

Before enabling the site, make sure the required modules are on:

```bash
sudo a2enmod proxy proxy_http proxy_wstunnel headers
```

Then:

1. copy the example into a virtual host config
2. replace `example.com` with your real domain
3. if needed, replace `127.0.0.1:3000` with your chosen `HOST_PORT`
4. reload Apache

## 4. HTTPS

For real-world use, serve the backend through HTTPS.

The extension should then use:

- `https://your-domain`
- `wss://your-domain/ws`

If you stay on plain HTTP, modern browsers may block or warn about mixed-content and WebSocket issues depending on how the extension and page are loaded.

## 5. Configure the Extension

Inside the extension settings or popup settings, use:

```text
HTTP Base URL: https://your-domain
WebSocket URL: wss://your-domain/ws
```

For a local-only setup:

```text
HTTP Base URL: http://localhost:3000
WebSocket URL: ws://localhost:3000/ws
```

If you changed `HOST_PORT`, use that port instead of `3000`.

## 6. Basic Troubleshooting

### Health endpoint works locally but not from outside

Usually this means one of these:

- the domain DNS is wrong
- the router is not forwarding `80/443`
- the firewall is blocking `80/443`
- the reverse proxy is not forwarding to the correct local port

### Page loads but rooms do not connect

Check:

- the extension uses `wss://your-domain/ws`
- your reverse proxy forwards `/ws`
- WebSocket upgrade headers are enabled

### Docker container is running but `/health` fails

Check:

- `docker compose ps`
- `docker compose logs`
- whether `HOST_PORT` is already taken by another process

## Recommended Simple Production Setup

For most people, this is the easiest durable setup:

1. backend in Docker
2. Nginx or Apache on the server
3. domain or subdomain pointed at the server
4. HTTPS enabled
5. extension pointed at that domain

That keeps the backend simple, portable, and easy to move later.
