# StudySource AI — Academic RAG Assistant

A single-server RAG application for PDF, DOCX and TXT documents. It uses FastAPI, PostgreSQL, Qdrant, Gemini embeddings/chat, React and Nginx.

## Local start

1. Copy `.env.example` to `.env`.
2. Set strong `POSTGRES_PASSWORD`, `JWT_SECRET`, and a valid `GEMINI_API_KEY`.
3. Keep the password inside `DATABASE_URL` identical to `POSTGRES_PASSWORD`.
4. Run `docker compose up -d --build`.
5. Open `http://localhost` and verify `http://localhost/api/health`.

## EC2 requirements

- Ubuntu 24.04 LTS, 2 vCPU, 8 GB RAM, 40–50 GB gp3 EBS
- Security group: inbound 80/443 from the internet and 22 from your IP only
- Do not expose PostgreSQL 5432 or Qdrant 6333
- Docker Engine with the Compose plugin, Git, 4 GB swap, Elastic IP

## Production deployment

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
```

Log out/in, clone the repository, create `.env`, then:

```bash
docker compose up -d --build
docker compose ps
curl http://localhost/api/health
```

Use a domain plus Certbot or an HTTPS reverse proxy before collecting real user data. Back up all three named volumes, especially PostgreSQL and Qdrant. Uploaded files are stored in a separate persistent volume.

## Updating

```bash
git pull --ff-only
docker compose up -d --build
docker image prune -f
```

Never commit `.env`, database dumps, uploaded documents, private keys, or API keys.
