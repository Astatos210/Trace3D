# Single-container build for Hugging Face Spaces (free tier: 2 vCPU, 16 GB RAM).
# Builds the React frontend, then serves it from FastAPI alongside the full
# COLMAP + Open3D reconstruction pipeline. One port, one process, zero cost.

# ---- Stage 1: build the React frontend ----
FROM node:20-alpine AS frontend_build
WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ .
RUN npm run build

# ---- Stage 2: backend + COLMAP + static SPA ----
FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    colmap \
    libgl1 \
    libgomp1 \
    libglu1-mesa \
    libglib2.0-0 \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/
COPY pipeline/ pipeline/

# Compiled SPA -> picked up by backend/app/main.py and served at "/"
COPY --from=frontend_build /build/dist/ frontend_dist/

ENV PYTHONPATH=/app \
    HOST=0.0.0.0 \
    PORT=7860

# HF Spaces runs containers as a non-root user; make all writable paths usable.
RUN mkdir -p /app/data/uploads /app/data/samples /app/jobs \
    && chmod -R 777 /app/data /app/jobs

EXPOSE 7860
CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "7860"]
