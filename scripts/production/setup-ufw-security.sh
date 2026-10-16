#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# Pulse Production Security & UFW Hardening Script
# Usage: sudo ./setup-ufw-security.sh <KVM1_APP_PRIVATE_IP>
# Example: sudo ./setup-ufw-security.sh 10.0.0.5
# ==============================================================================

if [ "$#" -ne 1 ]; then
    echo "Usage: sudo $0 <KVM1_APP_PRIVATE_IP_OR_WIREGUARD_IP>"
    echo "Example: sudo $0 10.0.0.5 (or 10.8.0.1 for WireGuard)"
    exit 1
fi

KVM1_IP="$1"

echo "=========================================================="
echo "Hardening Firewall for Pulse Database Node"
echo "Allowing access ONLY from App Node IP: ${KVM1_IP}"
echo "=========================================================="

# 1. Reset UFW rules to default deny
sudo ufw --force reset
sudo ufw default deny incoming
sudo ufw default allow outgoing

# 2. Allow SSH (Port 22)
sudo ufw allow 22/tcp comment "SSH administration"

# 3. Allow WireGuard VPN port if used
sudo ufw allow 51820/udp comment "WireGuard encrypted tunnel"

# 4. Allow Database & Pooler traffic ONLY from App Node
sudo ufw allow from "${KVM1_IP}" to any port 6432 proto tcp comment "PgBouncer from App Node"
sudo ufw allow from "${KVM1_IP}" to any port 5432 proto tcp comment "Direct PrimaryDB for Migrations"
sudo ufw allow from "${KVM1_IP}" to any port 5433 proto tcp comment "Direct LogDB for Migrations"
sudo ufw allow from "${KVM1_IP}" to any port 7007 proto tcp comment "Dozzle Monitoring Agent"

# 5. Enable UFW
echo "y" | sudo ufw enable

echo ""
echo "Current UFW Status:"
sudo ufw status verbose

echo "=========================================================="
echo "✓ Firewall successfully hardened!"
echo "Database ports are completely blocked from public internet."
echo "=========================================================="
