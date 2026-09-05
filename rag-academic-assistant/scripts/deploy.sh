#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${PROJECT_DIR}"

if ! docker info >/dev/null 2>&1; then
  echo "Docker is unavailable. Reconnect after setup-ec2.sh or check the Docker service."
  exit 1
fi

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created ${PROJECT_DIR}/.env"
  echo "Edit it and set POSTGRES_PASSWORD, DATABASE_URL, JWT_SECRET and GEMINI_API_KEY."
  echo "Then run this script again."
  exit 2
fi

required=(POSTGRES_PASSWORD DATABASE_URL JWT_SECRET GEMINI_API_KEY)
for key in "${required[@]}"; do
  value="$(grep -E "^${key}=" .env | head -n1 | cut -d= -f2- || true)"
  if [[ -z "${value}" || "${value}" == change-* || "${value}" == replace-* ]]; then
    echo "Missing or placeholder value for ${key} in .env"
    exit 2
  fi
done

chmod 600 .env
echo "Validating Compose configuration..."
docker compose config --quiet

echo "Building and starting services..."
docker compose pull postgres qdrant
docker compose up -d --build --remove-orphans

echo "Waiting for the application health endpoint..."
for attempt in {1..30}; do
  if curl -fsS http://127.0.0.1/api/health >/dev/null; then
    echo "Deployment successful: http://$(curl -fsS --max-time 3 https://checkip.amazonaws.com || echo 'EC2_PUBLIC_IP')"
    docker compose ps
    exit 0
  fi
  sleep 2
done

echo "Health check failed. Recent logs:"
docker compose logs --tail=100 backend nginx
exit 1

