# Pulse Backend (Pulsiv)

High-performance, enterprise-grade SaaS observability and API monitoring backend built with TypeScript and Node.js.

---

## 🚀 Overview

Pulse provides end-to-end API monitoring, real-time metrics ingestion, intelligent alerting, and multi-tenant organization management. Designed for horizontal scalability and low-latency throughput.

### Core Capabilities
- **High-Throughput Ingestion**: Dedicated ingestion workers handling stream processing and batch writes to high-performance timeseries/relational data storage.
- **Alerting Engine**: Rule evaluation, notification dispatching, webhook delivery, and anomaly detection.
- **Enterprise Authentication & RBAC**: Multi-tenant authorization, session management, MFA, and organization hierarchy.
- **Billing & Subscriptions**: Usage tracking, tier enforcement, and billing catalog synchronization.
- **Worker Ecosystem**: Dedicated process roles for API gateway, ingestion, analytics, cron, and background queue workers managed via PM2.

---

## 🛠️ Tech Stack

- **Runtime**: Node.js & TypeScript
- **Web Framework**: Fastify
- **Database & Storage**: PostgreSQL / Timescale / TigerDB, Redis (caching & queues)
- **Process Management**: PM2 / Docker
- **Testing**: Vitest (Unit & Integration tests)

---

## 🌿 Branching Strategy & Lifecycle

This repository follows a strict promotion pipeline branching model where `main` serves as the single source of truth for production releases:

```
main (Production)
  ▲
  │ (Release Promotion / Deployment Tag)
pre-deployment (Staging / Pre-Prod Verification)
  ▲
  │ (QA Sign-off & Regression Tests)
testing (CI / Integration Test Pipeline)
  ▲
  │ (Merge Request / PR Review)
develop (Active Integration & Team Collaboration)
  ▲
  │ (Branch off develop or main)
feature/* (Feature Development)
```

- **`main`**: Production-ready code. Protected branch. All releases are deployed from here.
- **`pre-deployment`**: Staging and pre-production release candidate verification environment.
- **`testing`**: Automated QA, end-to-end testing, and integration test validation.
- **`develop`**: Central integration branch for ongoing development.
- **`feature`**: Base branch for feature branches and feature-level integration.

---

## 🏃 Getting Started

### Prerequisites
- Node.js >= 20.x
- Docker & Docker Compose
- Redis & PostgreSQL / Timescale instances running

### Installation

```bash
# Clone the repository
git clone https://github.com/APILogix/pulse.git
cd pulse

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env
```

### Running Locally

```bash
# Start API in development mode
npm run dev

# Start worker processes
npm run dev:workers
npm run dev:ingestion
npm run dev:analytics
npm run dev:alert:workers
```

### Testing

```bash
# Run unit tests
npm test

# Run integration tests
npm run test:integration
```

---

## 📚 Documentation

For detailed architectural specifications, refer to the [`docs/`](docs/) directory:
- [System Overview](docs/architecture/system-overview.md)
- [Ingestion Pipeline](docs/architecture/ingestion-pipeline.md)
- [Alerting Engine](docs/architecture/alerting-engine.md)
- [Queue & Worker Architecture](docs/architecture/queue-and-workers.md)
- [Authentication & RBAC](docs/architecture/authentication-rbac.md)
- [Data Layer](docs/architecture/data-layer.md)
