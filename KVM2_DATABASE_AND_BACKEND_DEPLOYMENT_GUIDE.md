# Pulse SaaS — KVM 2 Production Deployment & Resource Guide

> **Hardware Target:** **KVM 2** VPS  
> **Specifications:** **2 vCPU Cores | 8 GB RAM | 100 GB NVMe Disk | 8 TB Bandwidth**  
> **Architecture:** Control Plane (PostgreSQL 16 + pgvector + PGMQ) + Telemetry Plane (TimescaleDB HA PG16) + Redis + Fastify API + Worker Tier (PGMQ) + PgBouncer

---

## 1. Executive Summary & Hardware Budget

Deploying a high-throughput observability and APM backend on a 2 vCPU / 8 GB RAM machine requires strict resource bounds to avoid OOM killer terminations, CPU starvation, and database connection thrashing.

### System RAM Budget (8,192 MB Physical Total)

```
┌────────────────────────────────────────────────────────────────────────┐
│ Total Host RAM: 8,192 MB (8.0 GB)                                      │
├──────────────────────────────────────┬─────────────────────────────────┤
│ Container / Service                  │ Allocation & Limits             │
├──────────────────────────────────────┼─────────────────────────────────┤
│ Linux Host OS + Kernel + Page Cache  │ 1,760 MB (Uncapped Host Buffer) │
│ pulse_logdb (TimescaleDB PG16)       │ 2,300 MB Limit (1,024 MB Res)   │
│ pulse_primarydb (Postgres PG16)      │ 1,500 MB Limit (768 MB Res)     │
│ pulse_api (Fastify API)              │ 768 MB Limit (384 MB Res)       │
│ pulse_ingestion_workers (PGMQ Tier)  │ 512 MB Limit (256 MB Res)       │
│ pulse_workers (General Workers)      │ 384 MB Limit (128 MB Res)       │
│ pulse_analytics_workers (Rollups)    │ 384 MB Limit (128 MB Res)       │
│ pulse_redis (Cache & State)          │ 384 MB Limit (256 MB Maxmemory) │
│ pulse_pgbouncer (Connection Pooler)  │ 200 MB Limit (64 MB Res)        │
├──────────────────────────────────────┴─────────────────────────────────┤
│ Total Containers Max Limit: 6,432 MB (~6.3 GB)                         │
│ Free Host Headroom: 1,760 MB (~1.7 GB) -> Zero Host OOM Risk           │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. 100 GB NVMe Storage Partitioning & Retention

With a 100 GB NVMe disk, storage is carefully partitioned to guarantee continuous telemetry writes while preventing disk saturation:

| Sizing Slice | Capacity | Purpose & Retention Policy |
| :--- | :--- | :--- |
| **Linux OS & Packages** | **15 GB** | Ubuntu 24.04 LTS root filesystem, kernel updates, systemd logs |
| **Docker Engine & Images** | **10 GB** | Application container images, build cache, runtime overlays |
| **PrimaryDB (`pulse_primary`)**| **15 GB** | Users, orgs, projects, alert rules, tokens (`max_wal_size=2GB`) |
| **LogDB (`pulse_logdb`)** | **45 GB** | Timescale hypertables, telemetry chunks, rollup aggregates |
| **Log Files & Backups** | **5 GB** | Nginx access logs, PM2/Docker logs (rotated via logrotate) |
| **Emergency Headroom** | **10 GB** | Unallocated safety buffer to prevent read-only filesystem locks |

### TimescaleDB Retention & Compression Policy (LogDB)
- **Raw Telemetry Chunks:** Compressed automatically after **7 days** (`timescaledb.compress = true`).
- **Telemetry Retention:** Uncompressed/compressed raw events dropped after **14 days**.
- **Rollups (Hourly & Daily):** Retained for **90 days** (aggregates take <5% of raw space).

---

## 3. Connection Arithmetic & Pooling Math

### Mathematical Proof of Zero-Oversubscription

#### PrimaryDB (`max_connections = 40`)
| Consumer | Pool Mode | Limit | Notes |
| :--- | :--- | :--- | :--- |
| `pulse_primary` (PgBouncer) | `transaction` | **22** | Multiplexes Fastify API & workers |
| `pulse_primary_session` (PgBouncer)| `session` | **10** | PGMQ reader long-polling (`read_with_poll`) |
| Superuser / Admin direct | `direct` | **3** | Reserved for migrations & psql maintenance |
| Emergency buffer | `direct` | **5** | Spare capacity |
| **Total Peak Server Slots** | | **40** | **40 / 40 (100% capacity, zero rejects)** |

#### LogDB (`max_connections = 60`)
| Consumer | Pool Mode | Limit | Notes |
| :--- | :--- | :--- | :--- |
| `pulse_logdb` (PgBouncer) | `transaction` | **26** | API queries & dashboard requests |
| `pulse_logdb_session` (PgBouncer) | `session` | **8** | Analytical session queries |
| `ingestion_write_pool` | `direct` | **10** | High-throughput batch copies |
| `analytics_logdb_pool` | `direct` | **5** | Continuous rollup aggregates |
| Timescale Background Workers | `internal` | **3** | Chunk compression & retention jobs |
| PostgreSQL Superuser Reserved | `internal` | **3** | Reserved for superuser |
| Maintenance & Migrations | `direct` | **5** | Schema migrations & manual psql |
| **Total Peak Server Slots** | | **55** | **55 <= 60 (5 spare slots, zero overflow)** |

---

## 4. Multi-KVM Architecture Options

### Option A: All-in-One KVM 2 Node (Cost-Optimized)
Run all components on a single KVM 2 instance using [docker-compose.yml](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docker-compose.yml).
- **RAM Footprint:** 6.4 GB containers + 1.6 GB OS = 8.0 GB RAM.
- **CPU Footprint:** 2 vCPU shared via CFS cgroups across containers.

```
[Internet] -> [Nginx (Host/Docker)] -> [Fastify API: 0.75 CPU, 768 MB]
                                     -> [PgBouncer: 0.2 CPU, 200 MB]
                                          ├─> [PrimaryDB: 0.75 CPU, 1500 MB]
                                          └─> [LogDB: 1.0 CPU, 2300 MB]
                                     -> [Workers: 0.75 CPU, 1280 MB]
                                     -> [Redis: 0.25 CPU, 384 MB]
```

### Option B: Two-Node Split (Production Recommendation)
Separate the database storage tier from the compute tier:
1. **Node 1: Database Node (KVM 2: 2 vCPU, 8 GB RAM, 100 GB NVMe)**
   - Runs [docker-compose.database.yml](file:///c:/Users/vikas/OneDrive/Desktop/SaasBackend/pulse/docker-compose.database.yml) (`primarydb`, `logdb`, `pgbouncer`).
   - PrimaryDB: 2,500 MB RAM limit, `shared_buffers = 1024MB`.
   - LogDB: 4,000 MB RAM limit, `shared_buffers = 1536MB`.
   - PgBouncer: 384 MB RAM limit.
   - Total containers: ~6.9 GB RAM. Leaves 1.1 GB for OS page cache.
2. **Node 2: Application Node (KVM 2: 2 vCPU, 8 GB RAM, 50-100 GB NVMe)**
   - Runs `api`, `workers`, `ingestion-workers`, `analytics-workers`, `redis`, and `nginx`.
   - Dedicated 8 GB RAM for Node.js V8 runtimes, in-memory queues, and Redis streams.

---

## 5. Host Operating System Tuning (Ubuntu 24.04 LTS)

Before launching containers on KVM 2, apply these kernel parameters:

```bash
# Add to /etc/sysctl.d/99-pulse.conf:
sudo tee /etc/sysctl.d/99-pulse.conf << 'EOF'
# Prevent Linux OOM killer from prematurely killing Postgres/Node
vm.overcommit_memory = 1
vm.swappiness = 10

# Maximize socket listen backlog for Fastify and PgBouncer
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096

# Fast connection recycling
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_intvl = 15
net.ipv4.tcp_keepalive_probes = 5

# High-density file descriptors
fs.file-max = 2097152
EOF

sudo sysctl -p /etc/sysctl.d/99-pulse.conf
```

---

## 6. Step-by-Step Deployment Instructions

### Step 1: Clone and Configure Environment
```bash
git clone https://github.com/APILogix/pulse.git /opt/pulse
cd /opt/pulse

# Copy production environment template
cp .env.example .env
nano .env
```

Ensure the following pool variables are set in `.env`:
```env
NODE_ENV=production
PORT=5000
HOST=0.0.0.0

# Database URLs (pointing to PgBouncer)
DATABASE_URL=postgresql://postgres:postgres@localhost:6432/pulse_primary
PRIMARY_DATABASE_URL=postgresql://postgres:postgres@localhost:6432/pulse_primary
LOG_DB_PRIMARY=postgresql://postgres:postgres@localhost:6432/pulse_logdb
LOG_DB_DIRECT_URL=postgresql://postgres:postgres@localhost:5433/pulse_logdb
LOG_DATABASE_URL=postgresql://postgres:postgres@localhost:6432/pulse_logdb
TIMESCALEDB_URL=postgresql://postgres:postgres@localhost:6432/pulse_logdb

# Sized for KVM 2 Zero-Oversubscription
DB_POOL_MAX=10
DB_POOL_MIN=0
LOG_POOL_MAX=10
LOG_POOL_MIN=0
QUEUE_POOL_MAX=6
QUEUE_COMMAND_POOL_MAX=2
INGESTION_DB_POOL_SIZE=4
INGESTION_WRITE_POOL_SIZE=10
ANALYTICS_DB_POOL_MAX=3
```

### Step 2: Launch Databases and PgBouncer First
```bash
# Start primarydb, logdb, and pgbouncer
docker compose up -d primarydb logdb pgbouncer redis
```

### Step 3: Run Database Migrations
```bash
# Execute schema runner through PgBouncer/Postgres
docker compose run --rm api npx tsx scripts/run-modular-schema.ts --skip-seeds
```

### Step 4: Launch Full Application Stack
```bash
docker compose up -d
```

### Step 5: Verify Health & Prometheus Metrics
```bash
# Verify API readiness
curl -f http://localhost:5000/ready
# Expected: {"success":true,"data":{"status":"ready", ...}}

# Verify API health
curl -f http://localhost:5000/health
# Expected: {"success":true,"data":{"status":"ok", ...}}

# Verify Prometheus metrics (database query latencies and pool gauges)
curl -s http://localhost:5000/metrics | grep db_query_duration_seconds
```
