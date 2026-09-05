#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/studysource-backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DESTINATION="${BACKUP_ROOT}/${STAMP}"

cd "${PROJECT_DIR}"
mkdir -p "${DESTINATION}"
chmod 700 "${DESTINATION}"

echo "Backing up PostgreSQL..."
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "${DESTINATION}/postgres.dump"

echo "Archiving uploaded files and Qdrant data..."
docker run --rm \
  --volumes-from "$(docker compose ps -q backend)" \
  -v "${DESTINATION}":/backup \
  alpine:3.22 tar -czf /backup/uploads.tar.gz -C /data/uploads .
docker run --rm \
  --volumes-from "$(docker compose ps -q qdrant)" \
  -v "${DESTINATION}":/backup \
  alpine:3.22 tar -czf /backup/qdrant.tar.gz -C /qdrant/storage .

sha256sum "${DESTINATION}"/* > "${DESTINATION}/SHA256SUMS"
echo "Backup created at ${DESTINATION}. Copy it to S3 for off-server recovery."
