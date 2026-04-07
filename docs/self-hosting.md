# Self-Hosting Guide

This guide is written for people who are new to self-hosting.

The Roll Together backend is small. It does not need powerful hardware, a giant database, or a complicated stack. You are mostly deciding where it should run and how other people will reach it.

At a high level, every setup looks like this:

1. run the backend
2. give it a reachable address
3. put those URLs into the extension

If you only remember one thing, make it this:

- easiest stable setup for regular use: a small Linux VPS
- cheapest long-term setup: an old laptop, Raspberry Pi, or mini PC you already own
- easiest temporary setup: your current PC, but you must start the backend every time

## Pick a Hosting Path

### Option 1: Small VPS

This is the simplest path for most people who want a setup they can keep using.

Good fit if:

- you want the backend online whenever you need it
- you want the cleanest setup for friends outside your home
- you do not want to fight with home router port forwarding

You do not need a large server. A tiny Linux VPS is enough.

Example provider:

- Hetzner: <https://www.hetzner.com/>

You can also use any other VPS provider you already trust.

### Option 2: Spare Laptop, Raspberry Pi, Mini PC, or Old Desktop

This is the cheapest long-term option if you already own the hardware.

Good fit if:

- you have a spare machine you can leave on when you host
- you are okay doing some home-network setup
- you want to avoid paying for a VPS every month

You will usually need one of these:

- router port forwarding for `80` and `443`
- or a tunnel service that exposes your local machine safely

### Option 3: Your Current PC

This is the easiest option for testing or occasional sessions.

Good fit if:

- you only host once in a while
- you want to learn the setup before putting it on another machine
- you do not mind starting the backend manually each time

Important:

- the backend is only online while your PC is on
- if the PC sleeps, reboots, or closes Docker, the room backend disappears
- this is fine for occasional use, but it is not the nicest setup for frequent hosting

## Domain, Subdomain, or Free Hostname

The cleanest setup is a normal domain or subdomain:

- `watch.example.com`
- `rt.example.com`

That gives you:

- `https://watch.example.com`
- `wss://watch.example.com/ws`

If you want to buy a domain, a registrar such as Cloudflare Registrar is one example:

- Cloudflare Registrar: <https://www.cloudflare.com/products/registrar/>

If you do not want to buy a domain yet, a free Dynamic DNS hostname can work for home hosting. That is usually more realistic than trying to find a free public domain.

One example:

- No-IP Dynamic DNS: <https://www.noip.com/>

If you want to avoid opening ports on your home router, a tunnel can be easier than port forwarding. One example:

- Cloudflare Tunnel: <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/>

## What You Actually Need

For a normal beginner-friendly setup, you usually need:

- one machine that can run Docker
- one reachable address, such as a domain, subdomain, or Dynamic DNS hostname
- one way to expose HTTPS and WebSocket traffic, such as Nginx, Apache, or a tunnel

If you only want local testing on the same machine, you can skip the domain and reverse proxy and keep using `http://localhost:3000`.

## Full Example: Small VPS Setup

If you want one full example to copy, use this path:

1. get a small Ubuntu VPS
2. point a domain or subdomain at its public IP
3. clone this repository onto the server
4. start the backend with Docker
5. put Nginx or Apache in front of it
6. enable HTTPS
7. point the extension at that HTTPS address

### 1. Start the Backend with Docker

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

Start the service:

```bash
docker compose up -d --build
```

Check that it is alive:

```bash
curl http://localhost:3000/health
```

If port `3000` is already in use, change only `HOST_PORT`:

```env
HOST_PORT=11420
PORT=3000
```

Then the local health check becomes:

```bash
curl http://localhost:11420/health
```

### 2. Point Your Domain at the Server

Create an `A` record that points your domain or subdomain at the server's public IP.

Common examples:

- `watch.example.com`
- `rt.example.com`

### 3. Put a Reverse Proxy in Front

The backend expects:

- normal HTTP traffic on `/`
- WebSocket traffic on `/ws`

This repository includes example reverse proxy configs:

- [Nginx example](nginx.conf)
- [Apache example](apache.conf)

#### Nginx

Start from [nginx.conf](nginx.conf).

Typical flow:

1. copy the example into your server config
2. replace `server_name _;` with your real domain
3. if needed, replace `127.0.0.1:3000` with your chosen `HOST_PORT`
4. reload Nginx

#### Apache

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

### 4. Enable HTTPS

For real-world use, serve the backend through HTTPS.

The extension should then use:

- `https://your-domain`
- `wss://your-domain/ws`

If you stay on plain HTTP, modern browsers may block or warn about mixed-content and WebSocket issues depending on how the extension and page are loaded.

## Home Hosting Notes

If you host from a spare laptop, Raspberry Pi, or your current PC, also check these:

- your router may need port forwarding for `80` and `443`
- your firewall must allow `80/tcp` and `443/tcp`
- if your home IP changes, a Dynamic DNS hostname helps
- a tunnel can be easier than exposing ports directly

If you use your current PC, remember that you must start the backend every time you want to watch with friends.

## Configure the Extension

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

## Basic Troubleshooting

### Health endpoint works locally but not from outside

Usually this means one of these:

- the domain or Dynamic DNS record is wrong
- the router is not forwarding `80/443`
- the firewall is blocking `80/443`
- the reverse proxy is not forwarding to the correct local port
- the tunnel is not pointed at the correct local service

### Page loads but rooms do not connect

Check:

- the extension uses `wss://your-domain/ws`
- your reverse proxy or tunnel forwards `/ws`
- WebSocket upgrade headers are enabled if you are using a reverse proxy

### Docker container is running but `/health` fails

Check:

- `docker compose ps`
- `docker compose logs`
- whether `HOST_PORT` is already taken by another process

## Recommended Durable Setup

For most people, this is the easiest reliable setup:

1. backend in Docker
2. small VPS or other machine that can stay online
3. domain or subdomain pointed at that machine
4. Nginx, Apache, or a tunnel in front
5. HTTPS enabled
6. extension pointed at that HTTPS address

That keeps the backend simple, portable, and easy to move later.
