# Infrastructure

## Cloudflare

- Workers
- Durable Objects (session affinity / coordination)
- R2 (storage)
- KV (memory / cache)
- Queues

## Database

- PostgreSQL
- D1

## Cache

- Redis
- KV

## Design implication for the SDK

- Core must run on Workers (edge-compatible).
- Session coordination for multi-instance deploys targets Durable Objects.
- Memory plugins abstract Redis / Postgres / KV behind one interface.
