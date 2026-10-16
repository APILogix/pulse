#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Pulse Database Automated Backup Script
# Usage: ./backup-databases.sh
# Can be scheduled in crontab: 0 2 * * * /opt/pulse/scripts/production/backup-databases.sh >> /var/log/db-backup.log 2>&1
# ==============================================================================

BACKUP_DIR="${BACKUP_DIR:-/var/backups/pulse-databases}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

mkdir -p "${BACKUP_DIR}/primary"
mkdir -p "${BACKUP_DIR}/logdb"

echo "=========================================================="
echo "Starting Pulse Database Backup at $(date)"
echo "Target directory: ${BACKUP_DIR}"
echo "=========================================================="

# 1. Backup PrimaryDB
echo "[1/2] Backing up PrimaryDB (pulse_primary)..."
PRIMARY_BACKUP_FILE="${BACKUP_DIR}/primary/primary_${TIMESTAMP}.sql.gz"
docker exec -t pulse_primarydb pg_dump -U postgres -d pulse_primary --clean --if-exists | gzip -9 > "${PRIMARY_BACKUP_FILE}"
echo "✓ PrimaryDB backup completed: ${PRIMARY_BACKUP_FILE} ($(du -h "${PRIMARY_BACKUP_FILE}" | cut -f1))"

# 2. Backup LogDB (Metadata + Hypertables / Data)
echo "[2/2] Backing up LogDB (pulse_logdb)..."
LOGDB_BACKUP_FILE="${BACKUP_DIR}/logdb/logdb_${TIMESTAMP}.sql.gz"
docker exec -t pulse_logdb pg_dump -U postgres -d pulse_logdb --clean --if-exists | gzip -9 > "${LOGDB_BACKUP_FILE}"
echo "✓ LogDB backup completed: ${LOGDB_BACKUP_FILE} ($(du -h "${LOGDB_BACKUP_FILE}" | cut -f1))"

# 3. Retention policy: Remove backups older than RETENTION_DAYS
echo "Applying retention policy (retaining ${RETENTION_DAYS} days)..."
find "${BACKUP_DIR}/primary" -type f -name "*.sql.gz" -mtime +"${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}/logdb" -type f -name "*.sql.gz" -mtime +"${RETENTION_DAYS}" -delete
echo "✓ Expired backup rotation finished."

echo "All database backups completed successfully at $(date)."
echo "=========================================================="
