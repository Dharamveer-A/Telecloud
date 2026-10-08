# ── Stage 1: Build Frontend ──
FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build Backend ──
FROM node:22-bookworm-slim AS backend-builder
WORKDIR /app/backend
# Install build tools for native addons (better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./
RUN npm install
COPY backend/ ./
RUN npm run build

# ── Stage 3: Production Runtime (Hugging Face Spaces & Cloud compatible) ──
FROM node:22-bookworm-slim AS runner

# Install essential runtime tools
RUN apt-get update && apt-get install -y python3 make g++ curl ca-certificates && rm -rf /var/lib/apt/lists/*

# Hugging Face Spaces requires running as non-root user (UID 1000)
RUN useradd -m -u 1000 user
WORKDIR /home/user/app

# Install production dependencies only
COPY --chown=user:user backend/package*.json ./
RUN npm install --omit=dev

# Copy backend build output
COPY --chown=user:user --from=backend-builder /app/backend/dist ./dist
# Copy frontend production build for full standalone serving or fallback
COPY --chown=user:user --from=frontend-builder /app/frontend/dist ./dist/frontend_dist

# Set up data directories with user 1000 ownership
RUN mkdir -p /home/user/app/data /home/user/app/data/thumbnails && chown -R user:user /home/user/app

USER user

# Hugging Face Spaces default port is 7860
ENV PORT=7860 \
    NODE_ENV=production \
    DATA_DIR=/home/user/app/data \
    RENDER=true \
    AUTO_TUNNEL=false

EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:7860/api/health || exit 1

CMD ["node", "dist/index.js"]
