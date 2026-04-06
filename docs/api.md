# Backend API

## HTTP Endpoints

- `GET /health`
- `GET /version`
- `WS /ws`

## WebSocket Protocol

Protocol version: `2`

Client messages:

- `join`
- `sync`
- `navigate`
- `leave`
- `ping`

Server messages:

- `joined`
- `sync`
- `navigate`
- `presence`
- `pong`
- `error`

## Room Rules

- Rooms are anonymous and in-memory.
- The current host is authoritative for playback and episode changes.
- Non-host playback or navigation updates are rejected with `not_host`.
- Room state includes `hostSessionId`, connected participants, and canonical playback.
