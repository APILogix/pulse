# Production Deployment Handbook: Security, Zero-Trust Database Isolation & Real-Time Monitoring

This handbook is the definitive, production-grade guide for operating the **Pulse (Pulsiv)** backend infrastructure across dedicated Hostinger KVM instances. It covers private database isolation, encrypted networking, real-time Docker monitoring across multiple hosts, automated backups, and OS hardening.

---

## 1. System Architecture & Topology

Pulse separates user-facing traffic and ingestion workloads from persistent databases across two dedicated virtual machines:

```mermaid
flowchart TD
    subgraph PublicInternet ["🌐 Public Internet (Cloudflare / Users / SDKs)"]
        Users["Web & Mobile Users"]
        Telemetry["Ingestion Clients / SDKs"]
    end

    subgraph KVM1 ["🖥️ KVM 1: Application Node (Public Facing)"]
        direction TB
        Nginx["Nginx Reverse Proxy<br/>Ports 80 / 443 (Let's Encrypt SSL)"]
        API["Fastify API Cluster (PM2)<br/>Ports 3000"]
        Workers["Ingestion & Analytics Workers (PM2)"]
        Redis["Redis 7 (In-Memory Cache & Pub/Sub)<br/>127.0.0.1:6379"]
        DozzleMaster["Dozzle Web Dashboard<br/>Port 8888 (Password Protected)"]
        UptimeKuma["Uptime Kuma Alerts<br/>Port 3001"]
    end

    subgraph SecureNetwork ["🔒 Encrypted Tunnel (WireGuard Mesh 10.8.0.0/24 or Private VPC)"]
        direction TB
        Tunnel["Encrypted Layer 3 Tunnel<br/>ChaCha20-Poly1305 Cipher<br/>Zero Public Exposure"]
    end

    subgraph KVM2 ["🛡️ KVM 2: Database Node (Private Only)"]
        direction TB
        PGB["PgBouncer Connection Pooler<br/>10.8.0.2:6432 (Transaction Mode)"]
        PrimaryDB["PrimaryDB (PostgreSQL 16)<br/>• pgvector (vector search)<br/>• PGMQ (message queues)<br/>• pgcrypto / uuid-ossp"]
        LogDB["LogDB (TimescaleDB 16 HA)<br/>• Hypertables & Compression<br/>• Rollups & Analytics<br/>• pg_uuidv7 / vector"]
        DozzleAgent["Dozzle Remote Agent<br/>10.8.0.2:7007"]
        BackupService["Automated Backup & S3 Sync<br/>(Local gzip + Cloudflare R2 / S3)"]
    end

    Users -->|HTTPS 443| Nginx
    Telemetry -->|HTTPS /api/v1/ingest| Nginx
    Nginx -->|Reverse Proxy| API
    API <-->|Localhost Latency <0.2ms| Redis
    API --> Tunnel
    Workers --> Tunnel
    Tunnel -->|Multiplexed TCP 6432| PGB
    PGB -->|Pool: 24 conns (Max 32)| PrimaryDB
    PGB -->|Pool: 25 conns (Max 35)| LogDB
    DozzleMaster <-->|Live Stream Stats 7007| DozzleAgent
    UptimeKuma -.->|Health Probes| API
    UptimeKuma -.->|Health Probes| PGB
    PrimaryDB -.-> BackupService
    LogDB -.-> BackupService
```

---

## 2. Zero-Trust Database Privacy (Only Backend Can Hit DB)

To guarantee that **no attacker or unauthorized service can access your database**, apply the 5-layer defense-in-depth model:

### Layer 1: Bind Docker Ports Strictly to Private Interfaces
> [!CAUTION]
> **The Docker iptables Bypass Trap:**
> By default, Docker modifies `iptables` directly and exposes ports to `0.0.0.0`, completely bypassing standard UFW rules!
> If your `docker-compose.yml` specifies `ports: - "6432:6432"`, your database is publicly reachable even if `ufw default deny` is enabled!

**The Fix:** Bind all ports in `docker-compose.database.yml` strictly to your private network interface or WireGuard VPN IP:
```yaml
ports:
  # NEVER use 0.0.0.0 in production!
  - "10.8.0.2:6432:6432" # PgBouncer bound to WireGuard IP
  - "10.8.0.2:5432:5432" # PrimaryDB direct bound to WireGuard IP
  - "10.8.0.2:5433:5432" # LogDB direct bound to WireGuard IP
```
When Docker binds to a specific IP (`10.8.0.2`), it only accepts packets arriving on that interface. Traffic from the public network interface (`eth0`) is rejected at the kernel level.

---

### Layer 2: Encrypted Peer-to-Peer Mesh (WireGuard)
Even within a cloud provider's internal network, data traversing shared switches should be encrypted. WireGuard establishes a lightweight, kernel-level encrypted tunnel between KVM 1 and KVM 2.

#### 1. Install WireGuard on Both Machines:
```bash
sudo apt-get update && sudo apt-get install -y wireguard
```

#### 2. Generate Keys on KVM 1 (App Node):
```bash
wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey
cat /etc/wireguard/privatekey
cat /etc/wireguard/publickey
```

#### 3. Generate Keys on KVM 2 (Database Node):
```bash
wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey
cat /etc/wireguard/privatekey
cat /etc/wireguard/publickey
```

#### 4. Configure KVM 1 (`/etc/wireguard/wg0.conf`):
```ini
[Interface]
Address = 10.8.0.1/24
ListenPort = 51820
PrivateKey = <KVM1_PRIVATE_KEY>

[Peer]
PublicKey = <KVM2_PUBLIC_KEY>
Endpoint = <KVM2_PUBLIC_IP>:51820
AllowedIPs = 10.8.0.2/32
PersistentKeepalive = 25
```

#### 5. Configure KVM 2 (`/etc/wireguard/wg0.conf`):
```ini
[Interface]
Address = 10.8.0.2/24
ListenPort = 51820
PrivateKey = <KVM2_PRIVATE_KEY>

[Peer]
PublicKey = <KVM1_PUBLIC_KEY>
Endpoint = <KVM1_PUBLIC_IP>:51820
AllowedIPs = 10.8.0.1/32
PersistentKeepalive = 25
```

#### 6. Start & Enable WireGuard:
```bash
sudo systemctl enable --now wg-quick@wg0
sudo wg show
# Verify ping:
ping -c 3 10.8.0.2 # On KVM 1 -> Pings KVM 2
```

---

### Layer 3: Firewall (UFW) Lockdown Script
Execute the included hardening script on KVM 2:
```bash
# Allow connections strictly from KVM 1 WireGuard IP (10.8.0.1)
sudo ./scripts/production/setup-ufw-security.sh 10.8.0.1
```

Verification output:
```text
To                         Action      From
--                         ------      ----
22/tcp                     ALLOW IN    Anywhere                   (SSH)
51820/udp                  ALLOW IN    Anywhere                   (WireGuard)
6432/tcp                   ALLOW IN    10.8.0.1                   (PgBouncer from App)
5432/tcp                   ALLOW IN    10.8.0.1                   (PrimaryDB from App)
5433/tcp                   ALLOW IN    10.8.0.1                   (LogDB from App)
7007/tcp                   ALLOW IN    10.8.0.1                   (Dozzle Agent from App)
```

---

### Layer 4: PostgreSQL Authentication & `pg_hba.conf`
Enforce `scram-sha-256` password hashing. In PostgreSQL entrypoint configurations, reject all non-encrypted or public subnet connection attempts:

```text
# TYPE  DATABASE        USER            ADDRESS                 METHOD
host    all             all             10.8.0.0/24             scram-sha-256
host    all             all             127.0.0.1/32            scram-sha-256
# Reject all other incoming IPs
host    all             all             all                     reject
```

---

### Layer 5: Dedicated Application Role (Least Privilege)
Avoid connecting from Fastify using the `postgres` superuser. Run this SQL script on initialization to provision a dedicated application user:

```sql
-- Run inside PrimaryDB:
CREATE ROLE pulse_app WITH LOGIN PASSWORD 'SuperStrongAppPassword123!';
GRANT CONNECT ON DATABASE pulse_primary TO pulse_app;
GRANT USAGE, CREATE ON SCHEMA public TO pulse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pulse_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pulse_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO pulse_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO pulse_app;

-- Run inside LogDB:
CREATE ROLE pulse_app WITH LOGIN PASSWORD 'SuperStrongAppPassword123!';
GRANT CONNECT ON DATABASE pulse_logdb TO pulse_app;
GRANT USAGE, CREATE ON SCHEMA public TO pulse_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO pulse_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pulse_app;
```

Update `docker/pgbouncer/userlist.txt`:
```text
"pulse_app" "SuperStrongAppPassword123!"
"postgres" "SuperStrongAdminPassword123!"
"monitor" "monitor_secure_password"
```

---

## 3. Real-Time Docker Status & Container Monitoring

To monitor containers across **both KVM 1 and KVM 2 in real time without heavy overhead**, use the following complementary solutions:

### Method 1: Dozzle Multi-Host Dashboard (Live Logs + Graphs)
Dozzle is an ultra-lightweight (~15 MB RAM) visual dashboard with zero database dependencies. It provides:
- Live streaming colored logs with instant text and regex filtering.
- Real-time CPU %, Memory usage (MB), Network I/O, and Disk I/O graphs per container.
- Container healthcheck status (`healthy`, `unhealthy`, `starting`).

#### How Multi-Host Mode Works:
- **KVM 1 (App Node)** runs the **Dozzle Master** web UI on port `8888`.
- **KVM 2 (Database Node)** runs the **Dozzle Agent** on port `7007` (bound to `10.8.0.2`).
- Both nodes appear in a single unified dropdown in your browser!

#### Deployment on KVM 2 (Database Node):
Launch the agent on KVM 2:
```bash
# In .env on KVM 2:
DOZZLE_AGENT_BIND_IP=10.8.0.2

# Start agent
docker compose -f docker-compose.agent.yml up -d
```

#### Deployment on KVM 1 (App Node):
Launch the dashboard on KVM 1:
```bash
# In .env on KVM 1:
DOZZLE_PORT=8888
DOZZLE_REMOTE_AGENT=10.8.0.2:7007

# Start monitoring dashboard
docker compose -f docker-compose.monitoring.yml up -d
```
Open `http://<KVM1_IP>:8888` in your browser. You can now toggle between KVM 1 and KVM 2 containers in real time!

---

### Method 2: Uptime Kuma (Real-Time Service Alerts)
Included in `docker-compose.monitoring.yml`, Uptime Kuma monitors your endpoints and database ports:
- **HTTP Liveness:** `http://localhost:3000/health/live` (pings every 20s).
- **HTTP Readiness & Backpressure:** `http://localhost:3000/health/ready` (evaluates queue depth and database pool status).
- **Database TCP Check:** `10.8.0.2:6432` (PgBouncer).
- **Instant Alerts:** Configurable webhooks to **Telegram**, **Discord**, **Slack**, or **Email** when any service goes down.

Open `http://<KVM1_IP>:3001` to configure your status page and notification channels.

---

### Method 3: Real-Time Terminal Monitoring (`ctop` & `docker stats`)
For fast diagnosis directly inside an SSH terminal session:

#### 1. Live Terminal UI (`ctop`):
```bash
# Install ctop on Ubuntu:
sudo wget https://github.com/bcicen/ctop/releases/download/v0.7.7/ctop-0.7.7-linux-amd64 -O /usr/local/bin/ctop
sudo chmod +x /usr/local/bin/ctop

# Run:
ctop
```
Provides an interactive `htop`-like display showing live CPU%, Mem%, Net I/O, and container logs.

#### 2. Native `docker stats` Stream:
```bash
docker stats --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"
```

---

## 4. Production Essentials ("Other Production Things")

### 1. Docker Daemon Log Rotation (Disk Full Prevention)
> [!IMPORTANT]
> By default, Docker never rotates container logs. High-volume ingestion workers or busy database logs can write tens of gigabytes to `/var/lib/docker/containers/`, silently filling the 200 GB NVMe disk and crashing the server!

Apply the included `docker/daemon.json` to `/etc/docker/daemon.json`:
```bash
sudo cp docker/daemon.json /etc/docker/daemon.json
sudo systemctl restart docker
```
This strictly limits logs to **3 rotating files of 50 MB** per container (maximum 150 MB total per container).

---

### 2. Linux Swap File (OOM Safety Cushion)
Even with 16 GB of physical RAM, temporary bursts should not trigger a kernel panic. Add a 4 GB swap file with low swappiness:

```bash
# Create 4GB swap
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile

# Persist in /etc/fstab
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# Set low swappiness (only swap under extreme memory pressure)
echo 'vm.swappiness = 10' | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

---

### 3. Automated Offsite Backup to Cloudflare R2 / AWS S3
Local backups on the same disk do not protect against VPS hardware loss or corrupted filesystems. Use the included `backup-offsite-s3.sh` script with `rclone`.

#### 1. Install & Configure `rclone`:
```bash
sudo apt-get install -y rclone
rclone config
# Configure a remote named 'r2' pointing to Cloudflare R2 or AWS S3
```

#### 2. Automated Daily Schedule (Crontab):
```bash
sudo crontab -e
```
Add the following entries:
```cron
# 02:00 AM: Run local database dumps with 7-day retention
0 2 * * * /opt/pulse/scripts/production/backup-databases.sh >> /var/log/db-backup.log 2>&1

# 02:30 AM: Sync encrypted dumps to offsite Cloudflare R2 with 30-day retention
30 2 * * * /opt/pulse/scripts/production/backup-offsite-s3.sh >> /var/log/db-backup-offsite.log 2>&1
```

---

### 4. Zero-Downtime Deployment Runbook (App Node)
When deploying code updates to KVM 1, avoid restarting all processes simultaneously:

```bash
cd /opt/pulse

# 1. Pull latest code
git pull origin main

# 2. Install production dependencies & build TypeScript
npm ci --only=production
npm run build

# 3. Graceful zero-downtime cluster reload via PM2
# PM2 restarts workers one-by-one; existing connections are drained gracefully
pm2 reload ecosystem.config.cjs --env production

# 4. Check worker health
pm2 list
pm2 monit
```

---

### 5. SSH Hardening & Fail2ban
Protect SSH on both KVM instances from brute-force botnets:

#### 1. Install Fail2ban:
```bash
sudo apt-get install -y fail2ban
sudo systemctl enable --now fail2ban
```

#### 2. Disable Password Authentication (`/etc/ssh/sshd_config`):
```text
PermitRootLogin prohibit-password
PasswordAuthentication no
PubkeyAuthentication yes
```
Restart SSH daemon:
```bash
sudo systemctl restart ssh
```

---

## 5. Pre-Production Launch Checklist

Before opening DNS traffic to production, verify every item on this checklist:

- [ ] **Private IP Binding:** Verified that `docker-compose.database.yml` binds to `10.8.0.2` (WireGuard) or private IP, not `0.0.0.0`.
- [ ] **Firewall Active:** `sudo ufw status verbose` on KVM 2 shows ports 6432, 5432, and 5433 restricted to KVM 1 IP.
- [ ] **PgBouncer Functional:** Fastify API connects to port `6432` with connection budget active.
- [ ] **Docker Log Rotation:** `/etc/docker/daemon.json` contains `max-size: 50m` and `max-file: 3`.
- [ ] **Swap Active:** `free -h` shows 4.0 GB of available swap.
- [ ] **Real-Time Monitoring:** Dozzle is streaming logs and container stats at `http://<KVM1_IP>:8888`.
- [ ] **Health Checks Passing:** `curl http://localhost:3000/health/live` and `curl http://localhost:3000/health/ready` return status `200`.
- [ ] **Automated Backups:** `backup-databases.sh` ran successfully and generated `.sql.gz` files in `/var/backups/pulse-databases`.
- [ ] **Offsite Sync:** `backup-offsite-s3.sh` successfully copied backup archives to remote S3/R2 storage.
- [ ] **SSH Hardened:** Password authentication disabled; public-key authentication enforced.
