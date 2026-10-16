# Production Deployment Guide: Multi-KVM Architecture & KVM 4 Database Sizing

This document provides the complete, production-grade architecture, sizing calculations, connection pooling strategies, security controls, and step-by-step installation runbook for deploying the **Pulse (Pulsiv)** platform across Hostinger KVM VPS instances.

---

## 1. Executive Summary & Plan Recommendation

### Evaluating the Proposed Separation:
> **Question:** *"Is deploying the databases on a separate KVM and the backend API + Redis + Nginx on another KVM the best method?"*

**Verdict: YES, 100% RECOMMENDED.**

Separating the database layer from the application tier is standard enterprise architecture for the following reasons:
1. **Resource Contention Elimination:** Ingestion workers execute continuous bulk writes and TimescaleDB rollups. If database I/O and CPU spikes occur on the same machine as Fastify and Nginx, user-facing HTTP requests will experience latency spikes, dropped connections, and 504 Gateway Timeouts.
2. **Memory Protection & OOM Isolation:** Node.js V8 runtimes, Redis in-memory storage, and PostgreSQL `shared_buffers` / page cache compete aggressively for RAM. Isolating them prevents the Linux Out-Of-Memory (OOM) killer from terminating your primary database when traffic surges.
3. **Storage Lifecycles:** LogDB stores time-series telemetry (metrics, logs, traces, spans, and error reports) which scales continuously. Having dedicated NVMe storage prevents database bloat from filling the root OS disk of your web server.
4. **Zero-Trust Network Security:** The database node has **zero public ports**. Ports `5432`, `5433`, and `6432` are exposed strictly to the internal private IP of KVM 1 via firewall rules or a WireGuard tunnel.

---

### Recommended Hosting Plans (Hostinger KVM)

| Deployment Scenario | KVM 1 (App, Redis, Nginx) | KVM 2 (Databases & PgBouncer) | Total Monthly Cost | Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **Option A (Recommended Best Method)** | **KVM 4**<br>(4 vCPU, 16 GB RAM, 200 GB NVMe) | **KVM 4**<br>(4 vCPU, 16 GB RAM, 200 GB NVMe) | **₹2,198 / mo**<br>*(₹1,099 × 2)* | **Enterprise-grade production setup.** 32 GB RAM & 8 vCPUs total. Provides maximum stability and headroom for ingestion bursts. |
| **Option B (Cost-Optimized)** | **KVM 2**<br>(2 vCPU, 8 GB RAM, 100 GB NVMe) | **KVM 4**<br>(4 vCPU, 16 GB RAM, 200 GB NVMe) | **₹1,698 / mo**<br>*(₹599 + ₹1,099)* | **Solid budget production.** Allocates the heavy 16 GB RAM to databases while keeping the app tier lean. |
| **Option C (All-in-One / Staging)** | **KVM 4 (Single Machine)**<br>(Runs App + DB + Redis together) | *None* | **₹1,099 / mo** | Suitable only for low-traffic staging/MVP. Requires strict memory caps to avoid crashes. |

---

## 2. KVM 4 Database Node Resource Allocation (16 GB RAM / 200 GB NVMe)

When running **PrimaryDB (PostgreSQL 16 + pgvector + PGMQ)**, **LogDB (TimescaleDB HA 16)**, and **PgBouncer** on a single 16 GB KVM 4 instance, resources must be strictly budgeted.

### 2.1 RAM Allocation (16 GB / 16,384 MB)

```
┌────────────────────────────────────────────────────────────────────────┐
│                   TOTAL SYSTEM RAM: 16 GB (16,384 MB)                  │
├──────────────┬──────────────┬──────────────┬──────────────┬────────────┤
│   OS & SSH   │  Linux Cache │ LogDB (TSDB) │  PrimaryDB   │ PgBouncer  │
│    1.5 GB    │    2.5 GB    │    6.5 GB    │    4.5 GB    │   1.0 GB   │
└──────────────┴──────────────┴──────────────┴──────────────┴────────────┘
```

| Component | RAM Budget | Container Memory Limit | PostgreSQL Key Parameters | Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **Linux OS & System** | **1.5 GB** | N/A (Host) | N/A | Systemd, SSH, Docker daemon, kernel page tables, and logging. |
| **OS Page Cache** | **2.5 GB** | Host Free RAM | N/A | PostgreSQL relies on Linux kernel file cache for fast index and sequential reads. |
| **LogDB (TimescaleDB)** | **6.5 GB** | `6500M` limit<br>(2500M reservation) | • `shared_buffers = 2560MB`<br>• `effective_cache_size = 6144MB`<br>• `work_mem = 32MB`<br>• `maintenance_work_mem = 512MB`<br>• `max_connections = 60` | High-throughput telemetry writes, continuous aggregate maintenance, and chunk compression jobs. |
| **PrimaryDB (pgvector + PGMQ)** | **4.5 GB** | `4500M` limit<br>(1500M reservation) | • `shared_buffers = 1536MB`<br>• `effective_cache_size = 4096MB`<br>• `work_mem = 16MB`<br>• `maintenance_work_mem = 256MB`<br>• `max_connections = 60` | Relational metadata, auth, billing, vector embeddings search, and queue message handling. |
| **PgBouncer** | **1.0 GB** | `1000M` limit<br>(128M reservation) | • `max_client_conn = 1000`<br>• `default_pool_size = 25` | Lightweight multiplexing proxy; uses <100MB active RAM, remainder serves as buffer for socket queues. |

---

### 2.2 NVMe Storage Allocation (200 GB)

| Partition / Volume | Allocated Size | Description & Retention Policy |
| :--- | :--- | :--- |
| **OS & Docker Runtime** | **25 GB** | Ubuntu OS, Docker engine, base images, system journals. |
| **`pulse_primarydb_data`** | **35 GB** | Control plane tables, vector index files, PGMQ queues, audit logs. |
| **`pulse_logdb_data`** | **100 GB** | Telemetry logs, traces, spans, and metrics. **TimescaleDB compression** reduces raw disk footprint by **70–85%**. Retention policy: 30–90 days. |
| **Automated Backups** | **30 GB** | `/var/backups/pulse-databases`: Compressed `pg_dump` files (`.sql.gz`) with 7-day rolling retention. |
| **Emergency Safety Buffer** | **10 GB** | Unallocated headroom to prevent disk-full crashes. |

---

## 3. Connection Pooling & Fleet Calculations

### 3.1 The Problem Without PgBouncer
The Pulse backend runs multiple processes via PM2 on the App Node:
- `api-backend`: 2 to 4 cluster workers
- `background-workers`: 1 worker
- `ingestion-workers`: 1 worker
- `analytics-workers`: 1 worker

Each Node.js process instantiates multiple connection pools (`DB_POOL_MAX=20`, `LOG_POOL_MAX=20`, `INGESTION_WRITE_POOL_SIZE=20`, `QUEUE_POOL_MAX=10`).
- **Fleet Connection Demand:** 4 API workers + 3 background workers = 7 Node processes.
- **Total potential client connections:** $7 \times 40 \approx \mathbf{280\text{ connections}}$.
- If connected directly to PostgreSQL, 280 processes consume **~2.8 GB of RAM** just in backend connection overhead, degrading CPU performance due to context-switching.

### 3.2 The Solution With PgBouncer
PgBouncer sits in front of both databases on port `6432` in **transaction pooling mode**:

```
[ App Node: Fastify API & PM2 Workers ]
   │ (Up to 1,000 persistent client connections)
   ▼
[ Database Node: PgBouncer (Port 6432) ]
   ├── Multiplexes traffic to PrimaryDB (Max 30 server connections)
   └── Multiplexes traffic to LogDB (Max 35 server connections)
   ▼
[ PostgreSQL Engines (Port 5432 & 5433) ]
   - Total active Postgres backends: ~65 connections (Uses <650 MB RAM!)
```

### 3.3 PgBouncer Database Mapping (Zero-Overflow Sizing)

| PgBouncer Database Alias | Target Database | Target Port | Pool Mode | Pool Size | Max Server Conns | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `pulse_primary` | `pulse_primary` | `5432` | `transaction` | 24 | 32 | All standard Fastify API queries, auth, billing, and reads. |
| `pulse_primary_session` | `pulse_primary` | `5432` | `session` | 12 | 16 | Worker PGMQ long-polling (`readWithPoll`), DDL, and migrations. |
| `pulse_logdb` | `pulse_logdb` | `5432` | `transaction` | 25 | 35 | Fastify telemetry reads and alert evaluations. |
| `pulse_logdb_session` | `pulse_logdb` | `5432` | `session` | 8 | 10 | Analytical rollup maintenance and continuous aggregates. |

---

## 4. End-to-End Architecture & Network Traffic Flow

```mermaid
flowchart TD
    subgraph Internet ["🌐 Public Internet"]
        Users["Web & Mobile Users"]
        Telemetry["Client Apps / SDKs Ingestion"]
    end

    subgraph KVM1 ["🖥️ KVM 1: Application Node (Public IP)"]
        Nginx["Nginx Reverse Proxy<br/>Ports 80 / 443 (SSL)"]
        API["Fastify API Cluster<br/>PM2 (Ports 3000)"]
        Workers["Background, Ingestion &<br/>Analytics Workers (PM2)"]
        Redis["Redis 7 (In-Memory Cache)<br/>Port 6379 (Localhost only)"]
    end

    subgraph PrivateNetwork ["🔒 Hostinger Internal Private Network / WireGuard"]
        Tunnel["Private Subnet (e.g. 10.0.0.0/24)<br/>Encrypted & Firewalled"]
    end

    subgraph KVM2 ["🛡️ KVM 2: Database Node (Private IP only)"]
        PGB["PgBouncer Connection Pooler<br/>Port 6432"]
        PrimaryDB["PrimaryDB (PostgreSQL 16)<br/>• pgvector (embeddings)<br/>• PGMQ (message queues)<br/>• pgcrypto / uuid-ossp"]
        LogDB["LogDB (TimescaleDB 16 HA)<br/>• Hypertables & Chunks<br/>• Rollups & Analytics<br/>• pg_uuidv7 / vector"]
        Backups["Automated Nightly Backup<br/>(pg_dump + gzip + rotation)"]
    end

    Users -->|HTTPS| Nginx
    Telemetry -->|HTTPS /api/v1/ingest| Nginx
    Nginx -->|Proxy pass| API
    API <-->|Fast Cache & PubSub| Redis
    API --> Tunnel
    Workers --> Tunnel
    Tunnel -->|TCP Port 6432| PGB
    PGB -->|Pool: 25 conns| PrimaryDB
    PGB -->|Pool: 30 conns| LogDB
    PrimaryDB -.->|Scheduled dump| Backups
    LogDB -.->|Scheduled dump| Backups
```

---

## 5. Step-by-Step Server Setup Runbook (KVM 2: Database Node)

Follow these exact commands on your fresh Ubuntu 22.04 or 24.04 LTS installation on KVM 2.

### Step 1: Linux Kernel & System Parameter Tuning
PostgreSQL and PgBouncer perform significantly better with tuned virtual memory and network sockets.

SSH into KVM 2 and edit `/etc/sysctl.conf`:
```bash
sudo bash -c 'cat <<EOF >> /etc/sysctl.conf
# Virtual Memory tuning for PostgreSQL & TimescaleDB
vm.swappiness = 10
vm.dirty_background_ratio = 5
vm.dirty_ratio = 10
vm.overcommit_memory = 2
vm.overcommit_ratio = 80

# Network socket tuning for high connection volume
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_intvl = 15
net.ipv4.tcp_keepalive_probes = 5
EOF'

# Apply parameters immediately without reboot
sudo sysctl -p
```

Increase system file descriptor limits in `/etc/security/limits.conf`:
```bash
sudo bash -c 'cat <<EOF >> /etc/security/limits.conf
* soft nofile 65536
* hard nofile 65536
* soft nproc 32768
* hard nproc 32768
EOF'
```

---

### Step 2: Install Docker Engine & Docker Compose
Install the official Docker repository:
```bash
sudo apt-get update && sudo apt-get install -y curl ca-certificates gnupg lsb-release
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
```

---

### Step 3: Firewall & Network Security (UFW)
Lock down KVM 2 so that database ports cannot be accessed from the public internet.

```bash
# Replace 10.0.0.5 with the PRIVATE IP address of your KVM 1 (App Node)
KVM1_PRIVATE_IP="10.0.0.5"

sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH
sudo ufw allow 22/tcp

# Allow PgBouncer, PrimaryDB, and LogDB ONLY from KVM 1 Private IP
sudo ufw allow from ${KVM1_PRIVATE_IP} to any port 6432 proto tcp comment "PgBouncer from App Node"
sudo ufw allow from ${KVM1_PRIVATE_IP} to any port 5432 proto tcp comment "Direct PrimaryDB for Migrations"
sudo ufw allow from ${KVM1_PRIVATE_IP} to any port 5433 proto tcp comment "Direct LogDB for Migrations"

# Enable Firewall
sudo ufw enable
sudo ufw status verbose
```

---

### Step 4: Clone Repository & Deploy Database Infrastructure
On KVM 2, create the application directory:
```bash
sudo mkdir -p /opt/pulse && cd /opt/pulse
# Clone your repository or copy the docker/ directory and docker-compose.database.yml
git clone <YOUR_GIT_REPO_URL> .
```

Configure your environment variables in `.env`:
```bash
cat <<EOF > .env
POSTGRES_USER=postgres
POSTGRES_PASSWORD=YourStrongProductionPasswordHere!
POSTGRES_DB=pulse_primary
LOG_POSTGRES_DB=pulse_logdb
PGBOUNCER_BIND_IP=0.0.0.0
PRIMARY_DB_BIND_IP=0.0.0.0
LOG_DB_BIND_IP=0.0.0.0
EOF
```

Update `docker/pgbouncer/userlist.txt` with your strong password:
```bash
cat <<EOF > docker/pgbouncer/userlist.txt
"postgres" "YourStrongProductionPasswordHere!"
"monitor" "monitor_secure_password"
EOF
chmod 600 docker/pgbouncer/userlist.txt
```

---

### Step 5: Start Database Containers & Verify Health
Launch the database stack using the dedicated production compose file:
```bash
docker compose -f docker-compose.database.yml up -d
```

Wait 30 seconds, then check container status and health:
```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Expected output:
```text
NAMES              STATUS                    PORTS
pulse_pgbouncer    Up (healthy)              0.0.0.0:6432->6432/tcp
pulse_primarydb    Up (healthy)              0.0.0.0:5432->5432/tcp
pulse_logdb        Up (healthy)              0.0.0.0:5433->5432/tcp
```

---

### Step 6: Test PgBouncer & Database Connectivity
Verify you can connect through PgBouncer:
```bash
# Test PrimaryDB via PgBouncer
docker exec -it pulse_pgbouncer psql -h 127.0.0.1 -p 6432 -U postgres -d pulse_primary -c "SELECT extname, extversion FROM pg_extension;"

# Test LogDB via PgBouncer
docker exec -it pulse_pgbouncer psql -h 127.0.0.1 -p 6432 -U postgres -d pulse_logdb -c "SELECT extname, extversion FROM pg_extension;"
```

---

### Step 7: Run Migrations From App Node (KVM 1)
On your App Node (KVM 1), configure your `.env` connection strings pointing to KVM 2:

```env
# Point to PgBouncer on KVM 2 (Private IP: e.g. 10.0.0.6)
DATABASE_URL=postgresql://postgres:YourStrongProductionPasswordHere!@10.0.0.6:6432/pulse_primary
PRIMARY_DATABASE_URL=postgresql://postgres:YourStrongProductionPasswordHere!@10.0.0.6:6432/pulse_primary

# LogDB via PgBouncer
LOG_DB_PRIMARY=postgresql://postgres:YourStrongProductionPasswordHere!@10.0.0.6:6432/pulse_logdb
LOG_DATABASE_URL=postgresql://postgres:YourStrongProductionPasswordHere!@10.0.0.6:6432/pulse_logdb

# Redis is local on KVM 1
REDIS_URL=redis://localhost:6379
```

Run the modular schema migration runner:
```bash
npm run db:schema:run
```
*(All 227 tables in PrimaryDB and 273 tables in LogDB will be created cleanly over the private network).*

---

### Step 8: Set Up Automated Nightly Backups
On KVM 2, make the backup script executable:
```bash
chmod +x /opt/pulse/scripts/production/backup-databases.sh
```

Test running the backup manually:
```bash
sudo /opt/pulse/scripts/production/backup-databases.sh
```

Add a nightly cron job at 02:00 AM:
```bash
sudo crontab -e
```
Add line:
```cron
0 2 * * * /opt/pulse/scripts/production/backup-databases.sh >> /var/log/db-backup.log 2>&1
```

---

## 6. Sizing & Configuration Reference Quickcard (Zero-Overflow Calibrated)

| Parameter | Recommended Value on KVM 4 | File Location |
| :--- | :--- | :--- |
| **LogDB `shared_buffers`** | `2048MB` (2.0 GB) | `docker-compose.database.yml` |
| **LogDB `effective_cache_size`** | `3840MB` (3.75 GB) | `docker-compose.database.yml` |
| **LogDB `work_mem`** | `16MB` | `docker-compose.database.yml` |
| **LogDB `maintenance_work_mem`** | `256MB` | `docker-compose.database.yml` |
| **LogDB `max_connections`** | `80` | `docker-compose.database.yml` |
| **LogDB `timescaledb.max_background_workers`** | `4` (Down from 8) | `docker-compose.database.yml` |
| **PrimaryDB `shared_buffers`** | `1280MB` (1.25 GB) | `docker-compose.database.yml` |
| **PrimaryDB `effective_cache_size`** | `2560MB` (2.5 GB) | `docker-compose.database.yml` |
| **PrimaryDB `work_mem`** | `12MB` | `docker-compose.database.yml` |
| **PrimaryDB `maintenance_work_mem`** | `192MB` | `docker-compose.database.yml` |
| **PrimaryDB `max_connections`** | `60` | `docker-compose.database.yml` |
| **WAL Compression** | `wal_compression = on` (both DBs) | `docker-compose.database.yml` |
| **PgBouncer `max_client_conn`** | `250` | `docker/pgbouncer/pgbouncer.ini` |
| **PgBouncer `default_pool_size`** | `20` | `docker/pgbouncer/pgbouncer.ini` |
| **PgBouncer `pulse_primary` max_db_connections** | `32` (pool_size = 24) | `docker/pgbouncer/pgbouncer.ini` |
| **PgBouncer `pulse_logdb` max_db_connections** | `35` (pool_size = 25) | `docker/pgbouncer/pgbouncer.ini` |
| **Linux `vm.swappiness`** | `10` | `/etc/sysctl.conf` |
| **Linux `vm.overcommit_memory`** | `2` | `/etc/sysctl.conf` |
