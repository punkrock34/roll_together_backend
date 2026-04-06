# Roll Together Backend

![CI](https://github.com/punkrock34/roll_together_backend/actions/workflows/ci.yml/badge.svg)
![License](https://img.shields.io/badge/license-MIT-green)
![Status](https://img.shields.io/badge/status-active-blue)

This repository contains the self-hostable realtime backend used by the Roll Together extension.

---

## Overview

The backend provides realtime synchronization between clients using a lightweight, self-hostable service designed for low-latency communication.

---

## Attribution

This backend continues work originally published by SamuraiExx in:

- https://github.com/samuraiexx/roll_together_backend

The project remains MIT-licensed, and that attribution is preserved as part of this continuation.

---

## Changes in This Fork

- refactored structure for clarity and maintainability
- improved local development and deployment flow
- prepared for future feature extensions and scaling

---

## Quick Start

```bash
cp .env.example .env
docker compose up -d --build
```

Health check:

```bash
curl http://localhost:3000/health
```

---

## Local Development

```bash
npm install
npm run dev
```

---

## Docs

- [API and protocol notes](docs/api.md)
- [Deployment and configuration](docs/deployment.md)
- Reverse proxy example: [docs/nginx.conf](docs/nginx.conf)
- Apache reverse proxy example: [docs/apache.conf](docs/apache.conf)

---

## License

MIT — see [LICENSE](./LICENSE)
