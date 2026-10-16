#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Pulse Offsite Database Backup Script (S3 / Cloudflare R2 / Backblaze B2)
# Dependencies: rclone (apt install rclone) or aws-cli
# Usage: ./backup-offsite-s3.sh
# Can be scheduled in crontab: 30 2 * * * /opt/pulse/scripts/production/backup-offsite-s3.sh >> /var/log/db-backup-offsite.log 2>&1
# ==============================================================================

LOCAL_BACKUP_DIR="${LOCAL_BACKUP_DIR:-/var/backups/pulse-databases}"
REMOTE_TARGET="${REMOTE_TARGET:-r2:pulse-backups}" # Configured in rclone.conf
RETENTION_DAYS="${OFFSITE_RETENTION_DAYS:-30}"

echo "=========================================================="
echo "Starting Offsite Database Backup Sync at $(date)"
echo "Source: ${LOCAL_BACKUP_DIR}"
echo "Destination: ${REMOTE_TARGET}"
echo "=========================================================="

if ! command -v rclone &> /dev/null; then
    echo "Warning: rclone is not installed. To enable offsite sync:"
    echo "  sudo apt install -y rclone && rclone config"
    echo "Skipping offsite sync."
    exit 0
fi

# 1. Sync compressed local dumps to remote cloud storage
echo "[1/2] Syncing backups to remote bucket..."
rclone copy "${LOCAL_BACKUP_DIR}" "${REMOTE_TARGET}" --fast-list --transfers 4 --checkers 8
echo "✓ Sync completed successfully."

# 2. Delete remote backups older than RETENTION_DAYS
echo "[2/2] Purging remote backups older than ${RETENTION_DAYS} days..."
rclone delete "${REMOTE_TARGET}" --min-age "${RETENTION_DAYS}d" --rmdirs
echo "✓ Remote rotation completed."

echo "Offsite backup pipeline finished at $(date)."
echo "=========================================================="
