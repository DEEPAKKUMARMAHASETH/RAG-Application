#!/usr/bin/env bash
set -Eeuo pipefail

# One-time bootstrap for Ubuntu 24.04 EC2.
# Run as the normal ubuntu user: bash scripts/setup-ec2.sh

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this script as the normal ubuntu user, not root."
  exit 1
fi

if ! grep -qi ubuntu /etc/os-release; then
  echo "This script supports Ubuntu. Detected:"
  cat /etc/os-release
  exit 1
fi

echo "[1/5] Updating Ubuntu packages..."
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
sudo apt-get install -y ca-certificates curl git gnupg openssl unattended-upgrades

echo "[2/5] Installing Docker Engine and Compose plugin..."
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "${USER}"

echo "[3/5] Creating a 4 GiB swap file if swap is absent..."
if [[ "$(swapon --show --noheadings | wc -l)" -eq 0 ]]; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  fi
fi

echo "[4/5] Enabling automatic security updates..."
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

echo "[5/5] Creating application and backup directories..."
sudo install -d -o "${USER}" -g "${USER}" /opt/studysource
sudo install -d -o "${USER}" -g "${USER}" /opt/studysource-backups

echo
echo "Bootstrap complete. Log out and reconnect so Docker group membership applies."
echo "Then clone the repository into /opt/studysource and run scripts/deploy.sh."

