# Docker & Container Architecture Guide

This document describes the multi-stage Docker build process, container hardening practices, and multi-service Docker Compose topology for **Pulsiv**.

---

## 1. Multi-Stage Dockerfile Architecture

Pulsiv uses a hardened, multi-stage [`Dockerfile`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/Dockerfile) ensuring small image sizes and rootless security:

1. **Build Stage (`node:22-alpine AS builder`)**: Installs native build tools (`make`, `g++`, `python3`), compiles TypeScript with `tsc`, and outputs `dist/`.
2. **Production Stage (`node:22-alpine AS production`)**: Installs production-only dependencies (`npm ci --omit=dev`), copies built `dist/` bundle, and switches execution to a non-privileged `nodejs` user (`UID 1001`).
3. **Health Check Probes**: Native container health check executes `wget -qO- http://localhost:3000/health || exit 1`.

---

## 2. Docker Compose Multi-Container Stack

The production [`docker-compose.yml`](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docker-compose.yml) provisions:
- `api`: Fastify HTTP API backend (Port 3000).
- `workers`: General background workers (`main.js`).
- `ingestion-workers`: Telemetry queue drain worker (`ingestion-worker-main.js`).
- `postgres`: PostgreSQL 17 primary database with persistent volume.
- `redis`: Redis 7 in-memory cache with LRU eviction.

### Launching the Stack:
```bash
# Build and run containers in detached mode
docker compose up -d --build

# View real-time container logs
docker compose logs -f api ingestion-workers

# Verify container health status
docker compose ps
```
